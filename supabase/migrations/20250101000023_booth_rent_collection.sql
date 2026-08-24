-- =============================================================================
-- CosmoCutie · Phase 4 · Collecting booth rent
-- =============================================================================
-- `raise_due_booth_rents` (migration 17) decides that rent is owed and writes a
-- payment row. Nothing ever carried it to Stripe, so the worker's `collect_rent`
-- branch failed loudly rather than pretending. This closes that.
--
-- How the money moves, and why this shape:
--
-- Rent is charged to the RENTER'S OWN saved payment method and settled to the
-- salon's connected account. It is emphatically NOT taken out of the renter's
-- takings. A salon that collects a stylist's money and hands back a share is
-- running a commission split, which is the single clearest signal of an
-- employment relationship; a stylist who receives everything and separately
-- pays a fixed rent is a tenant. The whole tenant architecture exists to keep
-- that distinction true, and it has to be true in the money movement too, not
-- just in the table names.
--
-- The charge is made on the platform and transferred to the salon, rather than
-- as a direct charge on the salon's account. A direct charge would require the
-- renter's card to be cloned onto the landlord's Stripe account, which is both
-- more machinery and a worse story about whose payment instrument it is.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- How a chair pays its rent
-- -----------------------------------------------------------------------------
-- Deliberately separate from `stripe_accounts`. That table is how a chair
-- RECEIVES money; this is how it PAYS. Conflating them would put the renter's
-- personal card in the same row as their payout account.
create table public.billing_methods (
  tenant_id             uuid primary key references public.tenants (id) on delete cascade,

  -- The chair as a customer of the platform. Carries tenant_id in its Stripe
  -- metadata so an incoming webhook can be traced back without a lookup table.
  stripe_customer_id    text unique,
  -- The instrument rent is charged to. Null until the stylist saves one.
  payment_method_id     text,

  -- Display only. Enough to show "Visa ending 4242" and nothing more: we never
  -- see or store a full number, and Stripe holds the instrument itself.
  brand                 text,
  last4                 text,
  exp_month             smallint,
  exp_year              smallint,

  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create trigger billing_methods_touch before update on public.billing_methods
  for each row execute function public.touch_updated_at();

alter table public.billing_methods enable row level security;

-- The chair, and only the chair. A renter's payment card is not the landlord's
-- business under any reading — there is deliberately no admin carve-out, the
-- same as `stripe_accounts`.
create policy billing_methods_own on public.billing_methods
  for all using (tenant_id in (select public.current_tenant_ids()))
  with check (tenant_id in (select public.current_tenant_ids()));

grant select, insert, update on public.billing_methods to authenticated;
revoke all on public.billing_methods from anon;

comment on table public.billing_methods is
  'How a chair pays its booth rent. Separate from stripe_accounts, which is how
   it gets paid. Visible to the chair alone: the renter''s own card is not
   something a landlord gets to see.';

-- -----------------------------------------------------------------------------
-- Rent collection status, visible to BOTH parties
-- -----------------------------------------------------------------------------
-- The payment row for rent sits on the chair's tenant and is invisible to the
-- salon, which is correct — but it leaves the owner unable to answer "did the
-- rent arrive?", which is their own rental income and a fair question.
--
-- So the outcome is mirrored onto `booth_rents`, which both sides can already
-- see because both are party to the tenancy. The owner learns whether rent was
-- paid and nothing else about how the renter's business is doing.
alter table public.booth_rents
  add column if not exists last_charged_at   timestamptz,
  add column if not exists last_paid_at      timestamptz,
  add column if not exists last_failure      text,
  add column if not exists consecutive_fails smallint not null default 0;

comment on column public.booth_rents.last_failure is
  'Why the last attempt failed, in Stripe''s words. Shown to both sides: the
   renter needs to know to fix their card, and the owner needs to know the rent
   has not arrived.';

-- -----------------------------------------------------------------------------
-- The queue has to accept a job that has no payment intent yet
-- -----------------------------------------------------------------------------
-- Every job so far referred to a hold that already existed at Stripe, so
-- `enqueue_payment_job` keyed on the intent id and refused a null one. Rent has
-- no intent until the moment it is charged, so it could not be queued at all —
-- which is the real reason `collect_rent` was unreachable.
--
-- Second key, same guarantee: one job of each kind per payment.
create unique index payment_jobs_once_per_payment
  on public.payment_jobs (kind, payment_id)
  where payment_id is not null;

-- ON CONFLICT can only infer one index, and there are now two. Catching the
-- violation covers both, and means a duplicate enqueue stays a no-op rather
-- than becoming a second charge.
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
  -- A job needs SOMETHING to identify it, or the duplicate guard cannot work.
  if p_payment_id is null and p_payment_intent_id is null then
    raise exception 'a payment job needs either a payment or an intent';
  end if;

  begin
    insert into public.payment_jobs
      (kind, payment_id, tenant_id, stripe_payment_intent_id, amount_cents)
    values
      (p_kind, p_payment_id, p_tenant_id, p_payment_intent_id, p_amount_cents)
    returning id into v_job_id;
  exception when unique_violation then
    -- Already queued. Not an error: the trigger that enqueues can fire more
    -- than once across a request's life.
    return null;
  end;

  return v_job_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- Raising rent now also queues its collection
-- -----------------------------------------------------------------------------
create or replace function public.raise_due_booth_rents()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count      integer := 0;
  r            record;
  v_payment_id uuid;
begin
  for r in
    select * from public.booth_rents
    where is_active and next_due_on <= current_date
  loop
    -- Rent is owed BY the chair TO the salon, so the payment is recorded
    -- against the chair's tenant: it is their outgoing, not the salon's income
    -- from a client.
    insert into public.payments
      (tenant_id, kind, status, amount_cents, route)
    values
      (r.chair_id, 'booth_rent', 'authorized', r.amount_cents, 'direct')
    returning id into v_payment_id;

    -- New: carry it to Stripe. Without this the row sat there forever and the
    -- salon was never actually paid.
    perform public.enqueue_payment_job(
      'collect_rent', v_payment_id, r.chair_id, null, r.amount_cents);

    update public.booth_rents
    set next_due_on = case interval
          when 'weekly'   then next_due_on + 7
          when 'biweekly' then next_due_on + 14
          else (next_due_on + interval '1 month')::date
        end,
        last_charged_at = now()
    where id = r.id;

    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

-- -----------------------------------------------------------------------------
-- What the worker needs to charge rent
-- -----------------------------------------------------------------------------
-- Rent is the one job whose money moves the opposite way from everything else:
-- FROM the chair TO the salon. So the account it settles to is the salon's, and
-- the instrument is the chair's saved card — neither of which the generic job
-- context can supply.
create or replace function public.rent_collection_context(p_payment_id uuid)
returns table (
  amount_cents        integer,
  chair_id            uuid,
  stripe_customer_id  text,
  payment_method_id   text,
  salon_account_id    text,
  already_paid        boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select p.amount_cents,
         p.tenant_id,
         b.stripe_customer_id,
         b.payment_method_id,
         sa.stripe_account_id,
         (p.status <> 'authorized')
  from public.payments p
  left join public.billing_methods b on b.tenant_id = p.tenant_id
  left join public.tenants t         on t.id = p.tenant_id
  left join public.stripe_accounts sa on sa.tenant_id = t.parent_salon_id
  where p.id = p_payment_id and p.kind = 'booth_rent';
$$;

-- -----------------------------------------------------------------------------
-- Mirroring the outcome onto the tenancy
-- -----------------------------------------------------------------------------
-- A trigger rather than a call inside the webhook, so it holds no matter which
-- path settles the payment — the generic `settle_deposit`, a manual correction,
-- or anything added later.
create or replace function public.on_booth_rent_settled()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.kind <> 'booth_rent' or new.status = old.status then return new; end if;

  if new.status = 'captured' then
    update public.booth_rents
    set last_paid_at = now(), last_failure = null, consecutive_fails = 0
    where chair_id = new.tenant_id;

  elsif new.status = 'failed' then
    update public.booth_rents
    set last_failure = coalesce(new.failure_reason, 'the payment was declined'),
        consecutive_fails = consecutive_fails + 1
    where chair_id = new.tenant_id;
  end if;

  return new;
end;
$$;

create trigger payments_booth_rent_settled
  after update on public.payments
  for each row execute function public.on_booth_rent_settled();

revoke all on function public.rent_collection_context(uuid) from public;
grant execute on function public.rent_collection_context(uuid) to service_role;
