-- =============================================================================
-- CosmoCutie · Phase 4 · Payment intents, capture/release, reconciliation
-- =============================================================================
-- Three things happen here.
--
-- 1. Two SECURITY DEFINER functions from migration 16 were reachable by any
--    signed-in user with no authorization check at all. Both are closed.
-- 2. Capture and release stop riding on `notification_queue`. That queue is
--    best-effort push delivery: it marks a row delivered even when the
--    recipient has no device registered, which silently discarded the job that
--    was supposed to take the money. Money movement gets its own durable queue.
-- 3. Post-capture events (refunds, disputes) get somewhere to land, so the
--    webhook can reconcile the whole lifecycle rather than just the hold.
--
-- Unchanged division of responsibility: this database decides what SHOULD
-- happen to money, Stripe is the record of what DID. Nothing here calls Stripe.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Platform fee — recorded here, decided outside
-- -----------------------------------------------------------------------------
-- PLAN.md sketches a platform fee as an explicit line item but never fixes the
-- rate for bookings, and migration 20 deleted `platform_settings` on the
-- principle that a one-person setting does not need a table. So the RATE lives
-- as `PLATFORM_FEE_BPS` on the edge function (basis points, default 0 — a
-- silent cut of every stylist's takings is the worst possible thing to ship by
-- accident), and what was actually charged is recorded per payment in
-- `fee_cents`. Reporting reads the record, not the rate.
--
-- The one unused duplicate: migration 5 created `fee_cents`, migration 16 added
-- `platform_fee_cents` beside it. Neither was ever written to. Keep the
-- documented original.
alter table public.payments drop column if exists platform_fee_cents;

-- -----------------------------------------------------------------------------
-- Close the two holes
-- -----------------------------------------------------------------------------
-- Which connected account a charge lands in, by classification.
--   direct      1099 renter — their own account, they are merchant of record
--   destination W-2 — charged on the platform, settled to their account
--   salon       owner-operator — the salon's own account, because it is the
--               same business entity and they do not pay themselves rent
create or replace function public.payout_account_for(p_tenant_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_route   public.charge_route := public.route_for_tenant(p_tenant_id);
  v_account text;
begin
  if v_route = 'salon' then
    select sa.stripe_account_id into v_account
    from public.tenants t
    join public.stripe_accounts sa on sa.tenant_id = t.parent_salon_id
    where t.id = p_tenant_id;
  end if;

  -- Direct and destination both settle to the chair's own account, and the
  -- salon route falls back to it if the salon has not onboarded yet.
  if v_account is null then
    select sa.stripe_account_id into v_account
    from public.stripe_accounts sa where sa.tenant_id = p_tenant_id;
  end if;

  return v_account;
end;
$$;

-- record_deposit_intent: SECURITY DEFINER bypasses RLS, so without an explicit
-- check any authenticated user could attach a payment row to a stranger's
-- booking request in another tenant. Worse, `payments_intent_idx` is unique on
-- the intent id, so squatting an id would also block the real deposit from ever
-- being recorded.
--
-- Split in two. Everything substantive lives in the internal function, so the
-- webhook (which has no auth.uid() and cannot pass a caller check) and the app
-- validate identically. The wrapper adds only the question the webhook cannot
-- ask: is this your card?
create or replace function public.record_deposit_intent_internal(
  p_request_id uuid,
  p_payment_intent_id text,
  p_amount_cents integer
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  r            record;
  v_payment_id uuid;
begin
  select * into r from public.booking_requests where id = p_request_id;
  if r is null then raise exception 'no such request'; end if;

  -- A closed negotiation must not grow a new hold: the release path has
  -- already run by then, and this row would never be settled.
  if r.status not in ('awaiting_stylist','awaiting_client') then
    raise exception 'that request is closed';
  end if;

  if not r.deposit_required then
    raise exception 'no deposit is required for that request';
  end if;

  -- The amount is the stylist's policy, not the caller's suggestion.
  if p_amount_cents is distinct from r.deposit_amount_cents then
    raise exception 'deposit amount does not match the amount disclosed at booking';
  end if;

  -- A replayed webhook must not create a second payment row.
  select id into v_payment_id from public.payments
  where stripe_payment_intent_id = p_payment_intent_id;
  if v_payment_id is not null then return v_payment_id; end if;

  insert into public.payments
    (tenant_id, booking_request_id, client_id, kind, status,
     amount_cents, route, stripe_account_id, stripe_payment_intent_id, authorized_at)
  values
    (r.tenant_id, p_request_id, r.client_id, 'deposit', 'authorized',
     p_amount_cents, public.route_for_tenant(r.tenant_id),
     public.payout_account_for(r.tenant_id), p_payment_intent_id, now())
  returning payments.id into v_payment_id;

  update public.booking_requests
  set stripe_payment_intent_id = p_payment_intent_id
  where booking_requests.id = p_request_id;

  return v_payment_id;
end;
$$;

create or replace function public.record_deposit_intent(
  p_request_id uuid,
  p_payment_intent_id text,
  p_amount_cents integer
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare r record;
begin
  select * into r from public.booking_requests where id = p_request_id;
  if r is null then raise exception 'no such request'; end if;

  -- The deposit is a hold on the CLIENT'S card, so only the client whose card
  -- it is may put one on record.
  if r.client_id not in (select public.current_client_ids()) then
    raise exception 'not your booking request';
  end if;

  return public.record_deposit_intent_internal(
    p_request_id, p_payment_intent_id, p_amount_cents);
end;
$$;

-- settle_deposit is the webhook's reconciliation path. It was granted to
-- `authenticated`, which meant any signed-in user could mark any hold captured
-- for an arbitrary amount. Nobody holding a user JWT has any business calling
-- it: only the webhook, which runs as service_role.
revoke all on function public.settle_deposit(text, public.payment_status, integer) from authenticated;

comment on function public.settle_deposit is
  'Webhook-only. Deliberately NOT granted to authenticated: this function
   decides that money moved, and only Stripe gets to tell us that.';

-- A client who backs out of the hosted payment page and comes back should land
-- on the same session rather than opening a second hold against the same
-- booking.
alter table public.booking_requests
  add column if not exists stripe_checkout_session_id text;

-- -----------------------------------------------------------------------------
-- The money job queue
-- -----------------------------------------------------------------------------
-- Separate from `notification_queue` on purpose. That queue is allowed to drop
-- work — a push to someone with no phone registered is marked delivered and
-- forgotten, which is correct for a notification and catastrophic for a
-- capture. This one retries, records why it failed, and never marks a job done
-- because it could not find somebody's device.
create type payment_job_kind as enum (
  'capture',         -- take an authorised hold
  'release',         -- let a hold go without charging
  'refund',          -- return money already captured
  'collect_rent',    -- charge a chair its booth rent
  'submit_evidence'  -- answer a chargeback
);

create type payment_job_status as enum ('pending', 'processing', 'done', 'failed');

create table public.payment_jobs (
  id           uuid primary key default gen_random_uuid(),
  kind         payment_job_kind not null,
  payment_id   uuid references public.payments (id) on delete cascade,
  tenant_id    uuid not null references public.tenants (id) on delete cascade,

  -- Denormalised from the payment so the worker needs one read, and so the job
  -- survives to explain itself even if the payment row is later detached.
  stripe_payment_intent_id text,
  -- Null means "the whole thing". A partial capture is how a cancellation fee
  -- smaller than the hold gets taken.
  amount_cents integer,

  status       payment_job_status not null default 'pending',
  attempts     smallint not null default 0,
  last_error   text,
  -- Backoff lives here: a failed job is rescheduled rather than retried hot.
  run_after    timestamptz not null default now(),

  created_at   timestamptz not null default now(),
  completed_at timestamptz
);

-- One capture and one release per intent, ever. The negotiation trigger can
-- fire more than once across a request's life; this makes a duplicate enqueue
-- a no-op instead of a double charge.
create unique index payment_jobs_once_per_intent
  on public.payment_jobs (kind, stripe_payment_intent_id)
  where stripe_payment_intent_id is not null;

create index payment_jobs_runnable_idx
  on public.payment_jobs (run_after)
  where status = 'pending';

alter table public.payment_jobs enable row level security;

-- No policy and no grant, deliberately. This is machinery, not user data:
-- the worker reads it as service_role and nobody else needs to see it. An
-- empty-policy table with RLS on denies everyone, which is the intent.
comment on table public.payment_jobs is
  'Internal money-movement queue. RLS on with no policy and no grants: only
   service_role touches this. A stylist has no reason to read it and a client
   certainly does not.';

-- -----------------------------------------------------------------------------
-- Enqueueing
-- -----------------------------------------------------------------------------
create or replace function public.enqueue_payment_job(
  p_kind public.payment_job_kind,
  p_payment_id uuid,
  p_tenant_id uuid,
  p_payment_intent_id text,
  p_amount_cents integer default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare v_job_id uuid;
begin
  if p_payment_intent_id is null then return null; end if;

  insert into public.payment_jobs
    (kind, payment_id, tenant_id, stripe_payment_intent_id, amount_cents)
  values
    (p_kind, p_payment_id, p_tenant_id, p_payment_intent_id, p_amount_cents)
  on conflict (kind, stripe_payment_intent_id) where stripe_payment_intent_id is not null
  do nothing
  returning id into v_job_id;

  return v_job_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- Claiming work
-- -----------------------------------------------------------------------------
-- `for update skip locked` is what makes it safe to run two workers, or to have
-- a scheduled run overlap a slow one: each row is handed to exactly one caller.
-- Returns routing context alongside each job. A direct charge lives ON the
-- connected account, so capturing it needs the Stripe-Account header; a
-- destination charge lives on the platform and must not carry one. Getting that
-- wrong is a 404 from Stripe, not a wrong amount, but it is still the worker's
-- job to know which it is holding.
create or replace function public.claim_payment_jobs(p_limit integer default 20)
returns table (
  job_id            uuid,
  kind              public.payment_job_kind,
  payment_id        uuid,
  tenant_id         uuid,
  payment_intent_id text,
  amount_cents      integer,
  attempts          smallint,
  route             public.charge_route,
  stripe_account_id text
)
language sql
security definer
set search_path = ''
as $$
  with claimed as (
    update public.payment_jobs j
    set status   = 'processing',
        attempts = j.attempts + 1
    where j.id in (
      select c.id
      from public.payment_jobs c
      where c.status = 'pending'
        and c.run_after <= now()
        -- Six attempts then it stops and waits for a human. A job that has
        -- failed six times is not going to succeed on the seventh, and a hot
        -- retry loop against a payments API is its own kind of damage.
        and c.attempts < 6
      order by c.created_at
      limit p_limit
      for update skip locked
    )
    returning j.*
  )
  select c.id, c.kind, c.payment_id, c.tenant_id,
         c.stripe_payment_intent_id, c.amount_cents, c.attempts,
         coalesce(p.route, public.route_for_tenant(c.tenant_id)),
         coalesce(p.stripe_account_id, public.payout_account_for(c.tenant_id))
  from claimed c
  left join public.payments p on p.id = c.payment_id;
$$;

create or replace function public.finish_payment_job(
  p_job_id uuid,
  p_ok boolean,
  p_error text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare v_attempts smallint;
begin
  select attempts into v_attempts from public.payment_jobs where id = p_job_id;

  if p_ok then
    update public.payment_jobs
    set status = 'done', completed_at = now(), last_error = null
    where id = p_job_id;
  else
    update public.payment_jobs
    set status     = case when v_attempts >= 6 then 'failed' else 'pending' end::public.payment_job_status,
        last_error = left(coalesce(p_error, 'unknown'), 500),
        -- Exponential-ish backoff, capped by the attempt limit above.
        run_after  = now() + (interval '1 minute' * power(3, v_attempts)::integer)
    where id = p_job_id;
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- The negotiation drives the hold
-- -----------------------------------------------------------------------------
-- Replaces the migration-16 version, which pushed capture/release intent into
-- `notification_queue`. Two things were wrong with that: the stylist received
-- actual push notifications about internal plumbing ("Deposit due for
-- capture"), and `send-push` marks a queued row delivered even when nobody has
-- a device registered — so on a stylist who had not opened the app on a phone,
-- the capture was thrown away and the client's deposit was never taken.
--
-- User-facing notifications are unaffected: those come from
-- `notify_on_negotiation_event`, which is a different trigger on a different
-- table and already says "Appointment confirmed" at the right moment.
create or replace function public.on_request_resolved()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare v_payment record;
begin
  if new.status = old.status then return new; end if;
  if new.stripe_payment_intent_id is null then return new; end if;

  select * into v_payment
  from public.payments
  where booking_request_id = new.id and kind = 'deposit';

  if new.status = 'accepted' then
    -- Tie the payment to the appointment now that one exists, so checkout can
    -- net the deposit off the balance later.
    update public.payments
    set appointment_id = new.appointment_id
    where booking_request_id = new.id;

    if new.deposit_required then
      perform public.enqueue_payment_job(
        'capture', v_payment.id, new.tenant_id, new.stripe_payment_intent_id, null);
    end if;

  elsif new.status in ('declined','cancelled','expired') then
    -- Any terminal outcome frees the card. A hold left behind on a declined
    -- request is money the client cannot spend and did not agree to lose.
    perform public.enqueue_payment_job(
      'release', v_payment.id, new.tenant_id, new.stripe_payment_intent_id, null);
  end if;

  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- Cancelling an appointment settles its deposit
-- -----------------------------------------------------------------------------
-- The migration-13 version worked out the fee correctly and then left it on
-- paper: nothing ever told Stripe. A `fee_charged` cancellation captured
-- nothing and a free one released nothing, so every cancelled appointment left
-- its hold sitting on the client's card until the authorisation aged out.
create or replace function public.cancel_appointment(
  p_appointment_id uuid,
  p_reason text default null
)
returns public.cancellation_outcome
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller     uuid := (select auth.uid());
  a            record;
  s            record;
  v_by_stylist boolean;
  v_hours_out  numeric;
  v_deposit    integer;
  v_outcome    public.cancellation_outcome;
  v_fee        integer := 0;
  v_payment    record;
  v_capture_inflight boolean := false;
begin
  select * into a from public.appointments where id = p_appointment_id;
  if a is null then raise exception 'no such appointment'; end if;
  if a.status not in ('confirmed','in_progress') then
    raise exception 'this appointment is already closed';
  end if;

  v_by_stylist := a.tenant_id in (select public.current_tenant_ids());
  if not v_by_stylist and a.client_id not in (select public.current_client_ids()) then
    raise exception 'not your appointment';
  end if;

  select * into s from public.stylist_settings where tenant_id = a.tenant_id;
  v_hours_out := extract(epoch from (a.starts_at - now())) / 3600;

  -- The hold that is actually still outstanding, and the row it lives on.
  select * into v_payment
  from public.payments
  where appointment_id = p_appointment_id and kind = 'deposit'
    and status in ('authorized','captured')
  limit 1;

  v_deposit := coalesce(v_payment.amount_cents, 0);

  if v_by_stylist then
    v_outcome := 'stylist_cancelled';
  elsif v_hours_out >= coalesce(s.free_cancel_hours, 48) then
    v_outcome := 'free';
  else
    v_outcome := 'fee_charged';
    -- Capped at the deposit. Nothing beyond the disclosed hold, ever.
    v_fee := v_deposit;
  end if;

  update public.appointments
  set status = 'cancelled',
      cancelled_at = now(),
      cancelled_by = v_caller,
      cancellation_reason = p_reason,
      cancellation_outcome = v_outcome,
      cancellation_fee_cents = v_fee
  where id = p_appointment_id;

  -- Now tell the money what the policy decided.
  --
  -- Acceptance already queued a capture, and a client who cancels minutes later
  -- races it. A capture still sitting in `pending` has not touched Stripe, so it
  -- is recalled outright — deleted rather than marked done, which also frees the
  -- (kind, intent) unique index in case a fee capture needs to take its place.
  if v_payment.id is not null then
    delete from public.payment_jobs
    where kind = 'capture'
      and stripe_payment_intent_id = v_payment.stripe_payment_intent_id
      and status = 'pending';

    -- One that already reached the worker cannot be recalled. Whatever the
    -- policy says, the money is on its way out of the client's account, so the
    -- remedy is a refund rather than a release.
    select exists (
      select 1 from public.payment_jobs
      where kind = 'capture'
        and stripe_payment_intent_id = v_payment.stripe_payment_intent_id
        and status in ('processing','done')
    ) into v_capture_inflight;

    if v_outcome = 'fee_charged' and v_fee > 0 then
      -- The fee is capped at the deposit, so when a capture is already in
      -- flight it is taking exactly this amount and there is nothing to add.
      if not v_capture_inflight then
        perform public.enqueue_payment_job(
          'capture', v_payment.id, a.tenant_id, v_payment.stripe_payment_intent_id, v_fee);
      end if;
    else
      -- Free, or the stylist cancelled. If the hold is still only a hold, drop
      -- it; if the money has moved or is moving, it has to come back.
      if v_payment.status = 'authorized' and not v_capture_inflight then
        perform public.enqueue_payment_job(
          'release', v_payment.id, a.tenant_id, v_payment.stripe_payment_intent_id, null);
      else
        perform public.enqueue_payment_job(
          'refund', v_payment.id, a.tenant_id, v_payment.stripe_payment_intent_id,
          v_payment.amount_cents);
      end if;
    end if;
  end if;

  return v_outcome;
end;
$$;

-- -----------------------------------------------------------------------------
-- Webhook reconciliation
-- -----------------------------------------------------------------------------
-- Stripe delivers events at least once, and will happily redeliver an event
-- from an hour ago. Every handler below is therefore written to be safe to run
-- twice, and this ledger short-circuits the common case: an event id we have
-- already seen is dropped before any handler runs.
create table public.stripe_events (
  id           text primary key,   -- Stripe's own evt_… id
  type         text not null,
  received_at  timestamptz not null default now()
);

alter table public.stripe_events enable row level security;
-- Service role only, same reasoning as payment_jobs.

-- Returns true the FIRST time an event id is seen and false on every replay,
-- so the webhook can simply `if not claimed then return ok`.
create or replace function public.claim_stripe_event(p_event_id text, p_type text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.stripe_events (id, type) values (p_event_id, p_type)
  on conflict (id) do nothing;
  return found;
end;
$$;

-- Settle now also records the charge id, which is what a dispute arrives
-- against later. Dropped rather than replaced: adding a defaulted parameter to
-- an existing function creates an overload instead of changing it.
drop function if exists public.settle_deposit(text, public.payment_status, integer);

create or replace function public.settle_deposit(
  p_payment_intent_id text,
  p_outcome public.payment_status,
  p_captured_cents integer default null,
  p_charge_id text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.payments
  set status       = p_outcome,
      captured_at  = case when p_outcome = 'captured' then now() else captured_at end,
      released_at  = case when p_outcome = 'released' then now() else released_at end,
      amount_cents = coalesce(p_captured_cents, amount_cents),
      stripe_charge_id = coalesce(p_charge_id, stripe_charge_id)
  where stripe_payment_intent_id = p_payment_intent_id
    -- Only an outstanding hold settles. A replayed webhook finds nothing to do,
    -- which is exactly the intent.
    and status = 'authorized';
end;
$$;

-- Money going back out. Kept separate from settle_deposit because a refund
-- applies to a payment that is already captured, which settle deliberately
-- refuses to touch.
create or replace function public.record_refund(
  p_payment_intent_id text,
  p_refunded_cents integer
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.payments
  set refunded_cents = p_refunded_cents,
      -- Partially refunded is still a captured sale; only a full reversal
      -- makes the payment itself refunded.
      status = case
                 when p_refunded_cents >= amount_cents then 'refunded'
                 else status
               end::public.payment_status,
      -- Never keep a platform fee on a sale that got reversed. Returned in the
      -- same proportion as the money itself.
      fee_cents = case
                    when amount_cents > 0
                      then (fee_cents * (amount_cents - p_refunded_cents)) / amount_cents
                    else 0
                  end
  where stripe_payment_intent_id = p_payment_intent_id;
end;
$$;

-- Chargebacks. `dispute_evidence` (migration 17) already assembles the bundle;
-- this is what tells it there is a deadline to meet.
alter table public.payments
  add column if not exists stripe_dispute_id text,
  add column if not exists disputed_at timestamptz;

create or replace function public.record_dispute(
  p_charge_id text,
  p_dispute_id text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare v_payment record;
begin
  select * into v_payment from public.payments where stripe_charge_id = p_charge_id;
  if v_payment is null then return; end if;

  update public.payments
  set stripe_dispute_id = p_dispute_id,
      disputed_at = coalesce(disputed_at, now())
  where id = v_payment.id;

  -- Evidence goes out through the same durable queue as everything else that
  -- has a deadline and must not be dropped.
  perform public.enqueue_payment_job(
    'submit_evidence', v_payment.id, v_payment.tenant_id, p_dispute_id, null);
end;
$$;

-- -----------------------------------------------------------------------------
-- Grants
-- -----------------------------------------------------------------------------
-- Two defaults have to be revoked explicitly here, and naming the roles is not
-- enough for either:
--
--   * Postgres grants EXECUTE on every new function to PUBLIC. Revoking from
--     `authenticated` leaves the PUBLIC grant standing, and `authenticated`
--     still gets in through it. The revoke has to name PUBLIC.
--   * Supabase's default privileges grant new tables in `public` to
--     `authenticated`. Migration 7 turned that off for `anon` only, on the
--     reasoning that authenticated access is normal and RLS gates it — true
--     for user data, wrong for machinery like this.
--
-- Both were caught by phase4c_test asserting on has_function_privilege /
-- has_table_privilege rather than on behaviour. RLS already denied the reads,
-- so nothing leaked; but that left one layer where the design wants two.

-- record_deposit_intent is the only one an app user calls, and it now checks
-- the caller itself.
revoke all on function public.record_deposit_intent(uuid, text, integer) from public;
grant execute on function public.record_deposit_intent(uuid, text, integer) to authenticated, service_role;

-- The internal variant skips the "is this your card" check, so it must never be
-- reachable with a user JWT.
revoke all on function public.record_deposit_intent_internal(uuid, text, integer) from public;
grant execute on function public.record_deposit_intent_internal(uuid, text, integer) to service_role;
revoke all on function public.payout_account_for(uuid) from public;
grant execute on function public.payout_account_for(uuid) to service_role;

-- Everything below is worker- or webhook-only: unreachable from a user JWT.
revoke all on function public.enqueue_payment_job(public.payment_job_kind, uuid, uuid, text, integer) from public;
revoke all on function public.claim_payment_jobs(integer)                                             from public;
revoke all on function public.finish_payment_job(uuid, boolean, text)                                 from public;
revoke all on function public.claim_stripe_event(text, text)                                          from public;
revoke all on function public.settle_deposit(text, public.payment_status, integer, text)              from public;
revoke all on function public.record_refund(text, integer)                                            from public;
revoke all on function public.record_dispute(text, text)                                              from public;

grant execute on function public.enqueue_payment_job(public.payment_job_kind, uuid, uuid, text, integer) to service_role;
grant execute on function public.claim_payment_jobs(integer)                                             to service_role;
grant execute on function public.finish_payment_job(uuid, boolean, text)                                 to service_role;
grant execute on function public.claim_stripe_event(text, text)                                          to service_role;
grant execute on function public.settle_deposit(text, public.payment_status, integer, text)              to service_role;
grant execute on function public.record_refund(text, integer)                                            to service_role;
grant execute on function public.record_dispute(text, text)                                              to service_role;

-- The queue tables are machinery, not user data. RLS-with-no-policy already
-- denies every read; this removes the inherited grant underneath it so the
-- privilege layer refuses first.
revoke all on public.payment_jobs   from anon, authenticated;
revoke all on public.stripe_events  from anon, authenticated;
grant  all on public.payment_jobs   to service_role;
grant  all on public.stripe_events  to service_role;
