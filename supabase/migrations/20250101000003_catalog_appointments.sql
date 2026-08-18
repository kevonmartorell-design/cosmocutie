-- =============================================================================
-- CosmoCutie · Phase 1 · Service catalogue, stylist settings, appointments
-- =============================================================================

-- -----------------------------------------------------------------------------
-- stylist_settings — per-stylist autonomy
-- -----------------------------------------------------------------------------
-- Each stylist sets their own pricing, hours, policies. This is not a nicety:
-- an owner dictating a 1099 renter's terms is behavioural control, which is
-- exactly what triggers reclassification.
create table public.stylist_settings (
  tenant_id            uuid primary key references public.tenants (id) on delete cascade,

  -- DEFAULTS OFF. Decided in PLAN.md: stylists opt IN to deposits.
  -- Named in the positive ("requires") to avoid the double-negative bug where
  -- `no_deposit = false` reads backwards in code and in the UI.
  requires_deposit     boolean not null default false,
  deposit_percent      numeric(5,2) not null default 20.00,
  deposit_min_cents    integer not null default 2000,

  -- Dead time BETWEEN appointments: cleanup, station reset, running over.
  -- Distinct from a service's processing window, which OPENS the calendar.
  buffer_minutes       integer not null default 30,
  -- Processing-window bookings need their own smaller buffer, or a 45-minute
  -- window minus 30 on each side leaves negative usable time.
  gap_buffer_minutes   integer not null default 10,

  arrival_note         text not null default 'Please arrive 5 minutes early.',

  -- Cancellation tiers, in hours before start.
  free_cancel_hours    integer not null default 48,
  late_cancel_hours    integer not null default 24,
  no_show_grace_minutes integer not null default 15,
  prepay_after_no_shows integer not null default 2,

  -- Free adjustment window if a client is unhappy with a result.
  redo_window_days     integer not null default 14,

  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),

  constraint deposit_percent_sane check (deposit_percent >= 0 and deposit_percent <= 100),
  constraint buffers_sane check (buffer_minutes >= 0 and gap_buffer_minutes >= 0)
);

comment on column public.stylist_settings.requires_deposit is
  'Defaults FALSE — new stylists start with no deposit required and opt in.';

-- -----------------------------------------------------------------------------
-- services
-- -----------------------------------------------------------------------------
create table public.services (
  id                        uuid primary key default gen_random_uuid(),
  tenant_id                 uuid not null references public.tenants (id) on delete cascade,
  name                      text not null,
  description               text,
  duration_minutes          integer not null,
  price_cents               integer not null,

  -- Idle time INSIDE this service where the stylist is free to work on someone
  -- else (chemical processing). Zero means no gap.
  processing_window_minutes integer not null default 0,
  -- Where in the service the processing window falls, from the start.
  processing_starts_after_minutes integer not null default 0,

  requires_patch_test       boolean not null default false,
  is_active                 boolean not null default true,
  sort_order                integer not null default 0,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),

  constraint duration_positive check (duration_minutes > 0),
  constraint price_non_negative check (price_cents >= 0),
  constraint processing_fits check (
    processing_starts_after_minutes + processing_window_minutes <= duration_minutes
  )
);

create index services_tenant_active_idx on public.services (tenant_id, is_active, sort_order);

-- -----------------------------------------------------------------------------
-- business_hours / time_blocks — availability inputs
-- -----------------------------------------------------------------------------
create table public.business_hours (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants (id) on delete cascade,
  weekday     smallint not null,           -- 0 = Sunday
  opens_at    time not null,
  closes_at   time not null,

  constraint weekday_range check (weekday between 0 and 6),
  constraint hours_ordered check (closes_at > opens_at),
  unique (tenant_id, weekday, opens_at)
);

create index business_hours_tenant_idx on public.business_hours (tenant_id, weekday);

create table public.time_blocks (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references public.tenants (id) on delete cascade,
  starts_at  timestamptz not null,
  ends_at    timestamptz not null,
  reason     text,
  created_at timestamptz not null default now(),

  constraint block_ordered check (ends_at > starts_at)
);

create index time_blocks_tenant_range_idx on public.time_blocks (tenant_id, starts_at, ends_at);

-- -----------------------------------------------------------------------------
-- appointments
-- -----------------------------------------------------------------------------
create type appointment_status as enum (
  'confirmed', 'in_progress', 'completed', 'cancelled', 'no_show'
);

create table public.appointments (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references public.tenants (id) on delete cascade,
  stylist_id        uuid not null references public.profiles (id) on delete restrict,
  client_id         uuid not null references public.clients (id) on delete restrict,
  client_record_id  uuid not null references public.client_records (id) on delete cascade,

  starts_at         timestamptz not null,
  ends_at           timestamptz not null,
  -- Buffer is stored as an explicit span rather than recomputed, so a later
  -- change to a stylist's buffer setting cannot retroactively create overlaps
  -- in appointments that were already booked.
  buffer_starts_at  timestamptz not null,
  buffer_ends_at    timestamptz not null,

  status            appointment_status not null default 'confirmed',

  -- "Booking for a child": no child accounts exist. The guardian books, pays,
  -- signs consents, and must be present. See PLAN.md → Minors.
  is_for_child      boolean not null default false,
  child_first_name  text,
  child_age         smallint,

  -- Stylist-side service timeline. Actual vs booked duration is what lets
  -- future bookings be padded from real data instead of optimism.
  arrived_at        timestamptz,
  service_started_at timestamptz,
  service_ended_at  timestamptz,

  -- Set when this is a free redo linked to an earlier appointment.
  redo_of_appointment_id uuid references public.appointments (id) on delete set null,

  total_price_cents integer not null default 0,
  cancelled_at      timestamptz,
  cancelled_by      uuid references public.profiles (id) on delete set null,
  cancellation_reason text,

  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  constraint appointment_ordered check (ends_at > starts_at),
  constraint buffer_envelops check (
    buffer_starts_at <= starts_at and buffer_ends_at >= ends_at
  ),
  constraint child_fields_consistent check (
    (is_for_child and child_first_name is not null)
    or (not is_for_child and child_first_name is null and child_age is null)
  )
);

-- ---------------------------------------------------------------------------
-- The safeguard that matters most in this file.
--
-- Availability logic will have bugs, and two clients tapping "request" on the
-- same slot in the same second is an ordinary race, not an edge case. This
-- makes overlapping live appointments for one stylist physically impossible to
-- insert — the worst outcome becomes a caught error rather than two people in
-- one chair.
--
-- Compares buffer envelopes, not raw service times, so the 30-minute gap is
-- enforced by the database too. Cancelled and no-show rows are excluded so a
-- freed slot is genuinely rebookable.
-- ---------------------------------------------------------------------------
alter table public.appointments
  add constraint appointments_no_overlap
  exclude using gist (
    stylist_id with =,
    tstzrange(buffer_starts_at, buffer_ends_at, '[)') with &&
  )
  where (status in ('confirmed', 'in_progress'));

create index appointments_tenant_start_idx  on public.appointments (tenant_id, starts_at desc);
create index appointments_stylist_start_idx on public.appointments (stylist_id, starts_at desc);
create index appointments_client_record_idx on public.appointments (client_record_id, starts_at desc);

-- -----------------------------------------------------------------------------
-- appointment_services — one appointment holds many services
-- -----------------------------------------------------------------------------
-- Modelled now rather than retrofitted: adding this later would mean touching
-- the booking engine, pricing, deposits and processing windows at once.
-- Price and duration are snapshotted so historical appointments keep their
-- real figures when a stylist later edits the service.
create table public.appointment_services (
  id                        uuid primary key default gen_random_uuid(),
  appointment_id            uuid not null references public.appointments (id) on delete cascade,
  service_id                uuid not null references public.services (id) on delete restrict,
  tenant_id                 uuid not null references public.tenants (id) on delete cascade,

  price_cents               integer not null,
  duration_minutes          integer not null,
  processing_window_minutes integer not null default 0,
  sort_order                integer not null default 0,

  unique (appointment_id, service_id)
);

create index appointment_services_appt_idx   on public.appointment_services (appointment_id, sort_order);
create index appointment_services_tenant_idx on public.appointment_services (tenant_id);

-- -----------------------------------------------------------------------------
-- waitlist
-- -----------------------------------------------------------------------------
create table public.waitlist_entries (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references public.tenants (id) on delete cascade,
  client_id        uuid not null references public.clients (id) on delete cascade,
  service_id       uuid references public.services (id) on delete set null,
  window_starts_on date not null,
  window_ends_on   date not null,
  -- Set when a freed slot is offered; entries expire if unclaimed.
  offered_at       timestamptz,
  offer_expires_at timestamptz,
  claimed_at       timestamptz,
  created_at       timestamptz not null default now(),

  constraint window_ordered check (window_ends_on >= window_starts_on)
);

create index waitlist_tenant_window_idx on public.waitlist_entries (tenant_id, window_starts_on)
  where claimed_at is null;

create trigger stylist_settings_touch before update on public.stylist_settings
  for each row execute function public.touch_updated_at();
create trigger services_touch before update on public.services
  for each row execute function public.touch_updated_at();
create trigger appointments_touch before update on public.appointments
  for each row execute function public.touch_updated_at();
