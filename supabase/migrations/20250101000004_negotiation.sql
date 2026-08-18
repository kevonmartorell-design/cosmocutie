-- =============================================================================
-- CosmoCutie · Phase 1 · Booking negotiation
-- =============================================================================
-- The capped back-and-forth from PLAN.md → Booking Negotiation Workflow:
--
--   1. Client requests Time A
--   2. Stylist  → Accept / Decline / Reschedule (Time B)
--   3. Client   → Accept / Cancel  / Counter    (Time C)
--   4. Stylist  → Accept / Decline / Reschedule (Time D)
--   5. Client   → Accept / Cancel  / Counter    (Time E)
--   6. Stylist  → Accept / Decline              (FINAL, binary)
--
-- Two counter-offers per side; the stylist always closes.
-- Timing: 48h global cap, 12h per step, whichever is sooner.
-- =============================================================================

create type booking_request_status as enum (
  'awaiting_stylist',  -- steps 2, 4, 6
  'awaiting_client',   -- steps 3, 5
  'accepted',
  'declined',          -- terminated by the stylist
  'cancelled',         -- terminated by the client
  'expired'            -- a deadline lapsed
);

create type negotiation_action as enum (
  'request',      -- client opens with Time A
  'accept',
  'decline',      -- stylist terminates
  'cancel',       -- client terminates
  'reschedule',   -- stylist proposes
  'counter',      -- client proposes
  'expire',       -- system
  'hold_released' -- system: deposit authorisation released
);

create type negotiation_actor as enum ('client', 'stylist', 'system');

-- -----------------------------------------------------------------------------
-- booking_requests
-- -----------------------------------------------------------------------------
create table public.booking_requests (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references public.tenants (id) on delete cascade,
  stylist_id        uuid not null references public.profiles (id) on delete cascade,
  client_id         uuid not null references public.clients (id) on delete cascade,
  client_record_id  uuid not null references public.client_records (id) on delete cascade,

  status            booking_request_status not null default 'awaiting_stylist',

  -- The single time currently on the table. When a stylist counters, the old
  -- slot releases and this moves — only ever ONE time is held per negotiation.
  proposed_starts_at timestamptz not null,
  proposed_ends_at   timestamptz not null,

  -- Counter-offers used, capped at 2 each. The initial request is not a counter.
  stylist_offers_used smallint not null default 0,
  client_counters_used smallint not null default 0,

  -- Two clocks. Whichever fires first ends the negotiation.
  global_deadline   timestamptz not null,
  step_deadline     timestamptz not null,

  -- Deposit authorisation, held from the initial request and captured on accept.
  -- 48h global cap keeps this comfortably inside any card auth window.
  deposit_required      boolean not null default false,
  deposit_amount_cents  integer not null default 0,
  stripe_payment_intent_id text,

  -- Set once accepted.
  appointment_id    uuid references public.appointments (id) on delete set null,

  is_for_child      boolean not null default false,
  child_first_name  text,
  child_age         smallint,

  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  resolved_at       timestamptz,

  constraint proposal_ordered check (proposed_ends_at > proposed_starts_at),
  constraint offers_capped   check (stylist_offers_used  between 0 and 2),
  constraint counters_capped check (client_counters_used between 0 and 2),
  -- A resolved request must record when, and an unresolved one must not.
  constraint resolution_consistent check (
    (status in ('accepted','declined','cancelled','expired') and resolved_at is not null)
    or (status in ('awaiting_stylist','awaiting_client') and resolved_at is null)
  )
);

-- Only ONE live negotiation per client per stylist at a time. Without this a
-- client could open several requests and hold multiple slots hostage.
create unique index booking_requests_one_live_per_pair
  on public.booking_requests (tenant_id, client_id)
  where status in ('awaiting_stylist', 'awaiting_client');

create index booking_requests_tenant_status_idx on public.booking_requests (tenant_id, status);
create index booking_requests_client_idx        on public.booking_requests (client_id, created_at desc);
-- Drives the scheduled expiry job: find everything past a deadline, cheaply.
create index booking_requests_step_deadline_idx on public.booking_requests (step_deadline)
  where status in ('awaiting_stylist', 'awaiting_client');

comment on table public.booking_requests is
  'One live negotiation per client/stylist pair. Holds exactly one proposed
   time; countering moves it rather than accumulating held slots.';

-- -----------------------------------------------------------------------------
-- negotiation_events — the audit trail that IS the chat thread
-- -----------------------------------------------------------------------------
-- The negotiation UI renders as a chat, but there is no messaging system here:
-- the thread is this event log, drawn as bubbles. Notes attach to actions and
-- can never be sent alone. See PLAN.md → Communication Policy.
create table public.negotiation_events (
  id                 uuid primary key default gen_random_uuid(),
  request_id         uuid not null references public.booking_requests (id) on delete cascade,
  tenant_id          uuid not null references public.tenants (id) on delete cascade,

  actor              negotiation_actor not null,
  actor_profile_id   uuid references public.profiles (id) on delete set null,
  action             negotiation_action not null,

  -- Present on request / reschedule / counter.
  proposed_starts_at timestamptz,
  proposed_ends_at   timestamptz,

  -- Optional short note riding along with the action. Capped deliberately:
  -- this is metadata on a state transition, not a message box.
  note               text,

  created_at         timestamptz not null default now(),

  constraint note_length check (note is null or char_length(note) <= 200),
  constraint proposal_pairs check (
    (proposed_starts_at is null) = (proposed_ends_at is null)
  )
);

create index negotiation_events_request_idx on public.negotiation_events (request_id, created_at);
create index negotiation_events_tenant_idx  on public.negotiation_events (tenant_id, created_at desc);

comment on table public.negotiation_events is
  'Append-only. Renders as the chat thread, archives with the appointment, and
   doubles as chargeback evidence.';
