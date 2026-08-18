-- =============================================================================
-- CosmoCutie · Phase 1 · Clinical records, consent, inventory, payments
-- =============================================================================

-- -----------------------------------------------------------------------------
-- formulas — attached to the APPOINTMENT, not just the client
-- -----------------------------------------------------------------------------
-- This matters more than it looks. A formula belongs to the service performed,
-- not to whoever paid. Without appointment-level attachment, a child's colour
-- history mixes into the guardian's record and a stylist looking up "last
-- formula" gets the wrong one — confusing at best, unsafe on a chemical
-- service. See PLAN.md → Minors.
create table public.formulas (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references public.tenants (id) on delete cascade,
  appointment_id   uuid not null references public.appointments (id) on delete cascade,
  client_record_id uuid not null references public.client_records (id) on delete cascade,

  -- Structured mix data: [{product, grams, developer_volume, ...}]
  components       jsonb not null default '[]'::jsonb,
  developer_volume text,
  processing_time_minutes integer,
  technique_notes  text,

  created_by       uuid references public.profiles (id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index formulas_tenant_record_idx on public.formulas (tenant_id, client_record_id, created_at desc);
create index formulas_appointment_idx   on public.formulas (appointment_id);

create type photo_stage as enum ('before', 'processing', 'after', 'reference');

create table public.formula_photos (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references public.tenants (id) on delete cascade,
  formula_id     uuid references public.formulas (id) on delete cascade,
  appointment_id uuid not null references public.appointments (id) on delete cascade,
  storage_path   text not null,
  stage          photo_stage not null default 'after',

  -- Per-photo, revocable consent to publish. The feed (Phase 8) may only show
  -- a photo where this is true, and revoking pulls the post down.
  consented_to_publish boolean not null default false,
  consent_granted_at   timestamptz,
  consent_revoked_at   timestamptz,

  created_at     timestamptz not null default now()
);

create index formula_photos_tenant_appt_idx on public.formula_photos (tenant_id, appointment_id);
create index formula_photos_publishable_idx on public.formula_photos (tenant_id)
  where consented_to_publish and consent_revoked_at is null;

-- -----------------------------------------------------------------------------
-- consents — decisions and outcomes, never medical histories
-- -----------------------------------------------------------------------------
-- Data minimisation is the whole strategy here (PLAN.md → Sensitive Data
-- Policy). There is deliberately no field for medications, conditions, or
-- pregnancy. What is stored is: a test happened, on this date, with this
-- result, signed by this person.
create type consent_kind as enum ('patch_test', 'service_intake', 'photo_release', 'policy_ack');
create type patch_test_result as enum ('pass', 'fail', 'reaction');

create table public.consents (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references public.tenants (id) on delete cascade,
  client_record_id uuid not null references public.client_records (id) on delete cascade,
  appointment_id   uuid references public.appointments (id) on delete set null,

  kind             consent_kind not null,

  -- Patch tests: what was tested and what happened. Not why.
  product_tested   text,
  result           patch_test_result,

  -- Contraindication screening stores a BOOLEAN OUTCOME only. The stylist asks
  -- the questions and has the conversation; the answers do not need a row.
  contraindications_disclosed boolean,
  proceeded        boolean,

  -- Guardian signs for a minor, in person.
  signed_by_name   text not null,
  signed_by_guardian boolean not null default false,
  signature_path   text,
  document_version text not null,
  signed_at        timestamptz not null default now(),

  expires_at       timestamptz,
  created_at       timestamptz not null default now()
);

create index consents_tenant_record_idx on public.consents (tenant_id, client_record_id, kind, signed_at desc);
create index consents_appointment_idx   on public.consents (appointment_id);

comment on table public.consents is
  'Stores consent decisions and outcomes only. No medical history fields exist
   by design — the safest health data is the health data never collected.';

-- -----------------------------------------------------------------------------
-- inventory
-- -----------------------------------------------------------------------------
create type stock_kind as enum ('backbar', 'retail');

create table public.inventory_items (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenants (id) on delete cascade,
  name            text not null,
  brand           text,
  kind            stock_kind not null default 'backbar',
  unit            text not null default 'ml',
  quantity_on_hand numeric(12,2) not null default 0,
  reorder_point   numeric(12,2),
  cost_cents      integer,
  price_cents     integer,
  is_active       boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index inventory_tenant_kind_idx on public.inventory_items (tenant_id, kind, is_active);

-- -----------------------------------------------------------------------------
-- payments
-- -----------------------------------------------------------------------------
create type payment_kind as enum ('deposit', 'service', 'retail', 'booth_rent', 'refund');
create type payment_status as enum (
  'authorized',   -- hold placed, not captured
  'captured',
  'released',     -- hold released without charge
  'refunded',
  'failed'
);

create table public.payments (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references public.tenants (id) on delete cascade,
  appointment_id    uuid references public.appointments (id) on delete set null,
  booking_request_id uuid references public.booking_requests (id) on delete set null,
  client_id         uuid references public.clients (id) on delete set null,

  kind              payment_kind not null,
  status            payment_status not null,

  amount_cents      integer not null,
  tip_cents         integer not null default 0,
  -- Platform/shop fee. Tracked per-payment so it can be reconciled and
  -- returned proportionally on refund — never keep a fee on a reversed sale.
  fee_cents         integer not null default 0,

  stripe_payment_intent_id text,
  stripe_charge_id         text,

  authorized_at     timestamptz,
  captured_at       timestamptz,
  released_at       timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index payments_tenant_created_idx on public.payments (tenant_id, created_at desc);
create index payments_appointment_idx    on public.payments (appointment_id);
create unique index payments_intent_idx  on public.payments (stripe_payment_intent_id)
  where stripe_payment_intent_id is not null;

create trigger formulas_touch before update on public.formulas
  for each row execute function public.touch_updated_at();
create trigger inventory_touch before update on public.inventory_items
  for each row execute function public.touch_updated_at();
create trigger payments_touch before update on public.payments
  for each row execute function public.touch_updated_at();
create trigger booking_requests_touch before update on public.booking_requests
  for each row execute function public.touch_updated_at();
