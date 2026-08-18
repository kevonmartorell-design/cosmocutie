-- =============================================================================
-- CosmoCutie · Phase 1 · Clients: shared identity, tenant-scoped relationships
-- =============================================================================
-- Two layers, and the split is the entire point:
--
--   clients        — WHO someone is. Name, phone, email, login. Platform-wide,
--                    one row per human. A phone number is not a proprietary
--                    asset, so sharing this layer costs nothing.
--
--   client_records — the RELATIONSHIP. History, preferences, tags, spend. This
--                    is what actually constitutes a stylist's book, and it is
--                    isolated per tenant by RLS.
--
-- One person booking with two stylists gets ONE login and TWO independent
-- relationship records. Neither stylist sees the other's.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- clients — identity only
-- -----------------------------------------------------------------------------
create table public.clients (
  id          uuid primary key default gen_random_uuid(),
  -- Null for walk-ins a stylist added manually who never created a login.
  profile_id  uuid unique references public.profiles (id) on delete set null,
  full_name   text not null,
  phone       text,
  email       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index clients_phone_idx on public.clients (phone) where phone is not null;
create index clients_email_idx on public.clients (email) where email is not null;

comment on table public.clients is
  'Identity layer. Deliberately contains NOTHING proprietary — no history, no
   notes, no preferences. Everything a stylist owns lives in client_records.';

-- -----------------------------------------------------------------------------
-- client_records — the tenant-scoped relationship
-- -----------------------------------------------------------------------------
create table public.client_records (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references public.tenants (id) on delete cascade,
  client_id         uuid not null references public.clients (id) on delete cascade,

  -- How this client arrived. Invite attribution is not cosmetic: it is what
  -- puts an invited client into the inviting stylist's book (PLAN.md → Client
  -- invitations & deep linking).
  invited_by        uuid references public.profiles (id) on delete set null,

  first_seen_at     timestamptz not null default now(),
  last_seen_at      timestamptz,

  -- Denormalised counters. Kept here rather than computed so a stylist's
  -- dashboard never needs to scan another tenant's rows.
  visit_count       integer not null default 0,
  no_show_count     integer not null default 0,

  -- Narrow, specific service-safety flag. NOT a medical history field —
  -- see PLAN.md → Sensitive Data Policy. Example: 'PPD sensitivity'.
  safety_flag       text,

  -- Repeat no-shows can require prepayment. Per-stylist, not salon-wide.
  requires_prepay   boolean not null default false,

  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  unique (tenant_id, client_id)
);

-- tenant_id leads every composite index: RLS filters on it first, so the
-- planner should too.
create index client_records_tenant_client_idx on public.client_records (tenant_id, client_id);
create index client_records_tenant_seen_idx   on public.client_records (tenant_id, last_seen_at desc nulls last);
create index client_records_client_idx        on public.client_records (client_id);

comment on table public.client_records is
  'A stylist''s book. Isolated per tenant by RLS — this is the table the salon
   owner must never be able to read for a 1099 renter.';

-- -----------------------------------------------------------------------------
-- client_tags — operational tags only, no free text
-- -----------------------------------------------------------------------------
-- Decided in PLAN.md: structured tags, no free-text notes field. Tags drive
-- scheduling behaviour; free text only accumulates opinions and creates both
-- export-request and discrimination exposure. There is deliberately nowhere
-- here for a protected characteristic to land.
create type client_tag_kind as enum (
  'needs_extra_time',   -- pads booking duration
  'talker',             -- pads booking duration
  'runs_late',          -- sends the reminder earlier
  'punctual',
  'prefers_morning',
  'prefers_afternoon',
  'prefers_evening',
  'sensitive_scalp',    -- surfaces on the service screen
  'no_show_risk'
);

create table public.client_tags (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references public.tenants (id) on delete cascade,
  client_record_id uuid not null references public.client_records (id) on delete cascade,
  tag              client_tag_kind not null,
  created_by       uuid references public.profiles (id) on delete set null,
  created_at       timestamptz not null default now(),

  unique (client_record_id, tag)
);

create index client_tags_tenant_record_idx on public.client_tags (tenant_id, client_record_id);

comment on table public.client_tags is
  'Structured operational tags. No free-text notes column exists by design —
   see PLAN.md → Stylist Check-In / Check-Out & Client Notes.';

create trigger clients_touch_updated_at
  before update on public.clients
  for each row execute function public.touch_updated_at();

create trigger client_records_touch_updated_at
  before update on public.client_records
  for each row execute function public.touch_updated_at();

-- -----------------------------------------------------------------------------
-- Access helper (defined here because it depends on public.clients)
-- -----------------------------------------------------------------------------
-- Client identities belonging to the caller.
--
-- SECURITY DEFINER is load-bearing here, not incidental. The `clients` table
-- has its own RLS policy that looks up client_records; if a client_records
-- policy queried `clients` directly, the two would call each other forever
-- ("infinite recursion detected in policy"). Resolving identity through a
-- definer function breaks the cycle because it bypasses RLS on clients.
create or replace function public.current_client_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select c.id
  from public.clients c
  where c.profile_id = (select auth.uid());
$$;
