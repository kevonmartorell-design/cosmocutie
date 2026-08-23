-- =============================================================================
-- CosmoCutie · Phase 4 · Payment plumbing
-- =============================================================================
-- Division of responsibility: this database is the source of truth for what
-- SHOULD happen to money, Stripe is the source of truth for what DID. Edge
-- functions carry intent to Stripe; webhooks reconcile the result back.
--
-- Nothing here calls Stripe. A trigger cannot make an HTTP request, and money
-- movement must never be able to hold up a booking transaction.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Connected accounts — one per tenant that receives money
-- -----------------------------------------------------------------------------
-- Every stylist gets their OWN Stripe account. A 1099 renter's takings must
-- never pass through the salon's ledger: routing them through the owner is
-- exactly the pattern that reads as employment.
create table public.stripe_accounts (
  tenant_id            uuid primary key references public.tenants (id) on delete cascade,
  stripe_account_id    text unique,
  -- Stripe's own readiness flags, mirrored so the app can gate booking without
  -- an API round trip on every screen.
  details_submitted    boolean not null default false,
  charges_enabled      boolean not null default false,
  payouts_enabled      boolean not null default false,
  requirements_due     jsonb not null default '[]'::jsonb,
  onboarded_at         timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

create trigger stripe_accounts_touch before update on public.stripe_accounts
  for each row execute function public.touch_updated_at();

alter table public.stripe_accounts enable row level security;

-- A tenant sees only its own account. Deliberately no admin carve-out: a
-- renter's payout status is not the landlord's business.
create policy stripe_accounts_own on public.stripe_accounts
  for all using (tenant_id in (select public.current_tenant_ids()))
  with check (tenant_id in (select public.current_tenant_ids()));

grant select, insert, update on public.stripe_accounts to authenticated;

-- -----------------------------------------------------------------------------
-- Payment routing
-- -----------------------------------------------------------------------------
-- Which Stripe pattern a charge uses is decided by worker classification, not
-- by the screen taking the payment.
create type charge_route as enum (
  'direct',      -- 1099 renter: stylist is merchant of record, platform fee on top
  'destination', -- W-2: salon is merchant, funds settled on_behalf_of
  'salon'        -- owner-operator: straight to the salon's own account
);

create or replace function public.route_for_tenant(p_tenant_id uuid)
returns public.charge_route
language plpgsql
stable
security definer
set search_path = ''
as $$
declare c public.worker_classification;
begin
  select tm.classification into c
  from public.tenant_members tm
  where tm.tenant_id = p_tenant_id and tm.role = 'stylist' and tm.is_active
  limit 1;

  return case c
    when 'contractor_1099' then 'direct'
    when 'employee_w2'     then 'destination'
    when 'owner_operator'  then 'salon'
    else 'direct'
  end::public.charge_route;
end;
$$;

comment on function public.route_for_tenant is
  'Direct charges for 1099 renters keep them merchant of record, which is the
   arrangement that matches how they actually work.';

alter table public.payments
  add column if not exists route public.charge_route,
  add column if not exists stripe_account_id text,
  -- What the platform took, tracked per payment so it can be returned
  -- proportionally on refund — never keep a fee on a reversed sale.
  add column if not exists platform_fee_cents integer not null default 0,
  add column if not exists refunded_cents integer not null default 0,
  add column if not exists failure_reason text;

-- -----------------------------------------------------------------------------
-- Deposit lifecycle, wired to the negotiation
-- -----------------------------------------------------------------------------
-- Authorised at the initial request, captured on acceptance, released on any
-- terminal outcome. The 48h negotiation cap exists precisely so a hold never
-- approaches a card authorisation's expiry.
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
declare
  r          record;
  v_payment_id uuid;
begin
  select * into r from public.booking_requests where id = p_request_id;
  if r is null then raise exception 'no such request'; end if;

  insert into public.payments
    (tenant_id, booking_request_id, client_id, kind, status,
     amount_cents, route, stripe_payment_intent_id, authorized_at)
  values
    (r.tenant_id, p_request_id, r.client_id, 'deposit', 'authorized',
     p_amount_cents, public.route_for_tenant(r.tenant_id), p_payment_intent_id, now())
  returning payments.id into v_payment_id;

  update public.booking_requests
  set stripe_payment_intent_id = p_payment_intent_id
  where booking_requests.id = p_request_id;

  return v_payment_id;
end;
$$;

-- Called by the webhook once Stripe confirms. Kept idempotent because webhooks
-- are delivered at least once, not exactly once.
create or replace function public.settle_deposit(
  p_payment_intent_id text,
  p_outcome public.payment_status,
  p_captured_cents integer default null
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
      amount_cents = coalesce(p_captured_cents, amount_cents)
  where stripe_payment_intent_id = p_payment_intent_id
    and status = 'authorized';
end;
$$;

-- When a negotiation ends, the hold must follow. Without this a declined
-- request leaves money sitting on someone's card.
create or replace function public.on_request_resolved()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = old.status then return new; end if;

  if new.status = 'accepted' and new.stripe_payment_intent_id is not null then
    update public.payments
    set appointment_id = new.appointment_id
    where booking_request_id = new.id;
    -- Capture itself is performed by the edge function against Stripe; this
    -- only records that it is owed.
    insert into public.notification_queue (profile_id, title, body, data)
    select new.stylist_id, 'Deposit due for capture', 'Booking confirmed',
           jsonb_build_object('type','capture_deposit','paymentIntent', new.stripe_payment_intent_id)
    where new.deposit_required;

  elsif new.status in ('declined','cancelled','expired')
        and new.stripe_payment_intent_id is not null then
    insert into public.notification_queue (profile_id, title, body, data)
    select new.stylist_id, 'Deposit hold releasing', 'Request closed',
           jsonb_build_object('type','release_deposit','paymentIntent', new.stripe_payment_intent_id);
  end if;

  return new;
end;
$$;

create trigger booking_requests_settle_deposit
  after update on public.booking_requests
  for each row execute function public.on_request_resolved();

-- -----------------------------------------------------------------------------
-- Booth rent — flat, never a percentage
-- -----------------------------------------------------------------------------
-- A percentage of takings is a commission split, which is the single clearest
-- signal of an employment relationship. Flat rent is what keeps a booth rental
-- a tenancy.
create table public.booth_rents (
  id             uuid primary key default gen_random_uuid(),
  salon_id       uuid not null references public.tenants (id) on delete cascade,
  chair_id       uuid not null references public.tenants (id) on delete cascade,
  amount_cents   integer not null,
  interval       text not null default 'monthly',
  next_due_on    date not null,
  is_active      boolean not null default true,
  created_at     timestamptz not null default now(),

  constraint rent_positive check (amount_cents >= 0),
  constraint rent_interval_valid check (interval in ('weekly','biweekly','monthly')),
  unique (chair_id)
);

alter table public.booth_rents enable row level security;

-- Both sides can see the arrangement they are party to; only the salon sets it.
create policy booth_rents_visible on public.booth_rents
  for select using (
    salon_id in (select public.current_tenant_ids())
    or chair_id in (select public.current_tenant_ids())
  );

create policy booth_rents_admin_write on public.booth_rents
  for all using (salon_id in (select public.admin_tenant_ids()))
  with check (salon_id in (select public.admin_tenant_ids()));

grant select, insert, update, delete on public.booth_rents to authenticated;

create index booth_rents_due_idx on public.booth_rents (next_due_on) where is_active;

grant execute on function public.route_for_tenant(uuid)                              to authenticated;
grant execute on function public.record_deposit_intent(uuid, text, integer)          to authenticated;
grant execute on function public.settle_deposit(text, public.payment_status, integer) to authenticated;
