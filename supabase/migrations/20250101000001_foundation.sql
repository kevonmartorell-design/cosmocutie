-- =============================================================================
-- CosmoCutie · Phase 1 · Foundation: tenancy, identity, roles
-- =============================================================================
-- The multi-tenant spine. Every access rule in this app resolves through the
-- tables defined here, so the shapes matter more than anywhere else.
--
-- Tenancy model (PLAN.md → Client Data Ownership Model):
--   · The salon is a tenant.
--   · Each 1099 booth renter is their OWN tenant — they own their client book
--     and the salon owner cannot read it. This is IRS classification defence,
--     not a privacy nicety.
--   · The owner's own chair is its own tenant, separate from their admin scope.
--   · W-2 employees do NOT get a tenant; their client records belong to the
--     salon, because that is what an employment relationship means.
-- =============================================================================

create extension if not exists "pgcrypto";   -- gen_random_uuid()
create extension if not exists "btree_gist"; -- exclusion constraints on ranges

-- -----------------------------------------------------------------------------
-- Enums
-- -----------------------------------------------------------------------------

-- A tenant is either the salon itself or one stylist's independent practice.
create type tenant_kind as enum ('salon', 'stylist');

-- Drives payment routing (Phase 4) and which tenant owns a client record.
create type worker_classification as enum ('contractor_1099', 'employee_w2', 'owner_operator');

-- Roles are composable: the owner holds `admin` on the salon AND `stylist` on
-- their own tenant. Never model this as a single column on the user.
create type member_role as enum ('admin', 'stylist');

-- -----------------------------------------------------------------------------
-- profiles — one row per authenticated human, mirroring auth.users
-- -----------------------------------------------------------------------------
create table public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  full_name   text not null default '',
  phone       text,
  email       text,
  avatar_url  text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

comment on table public.profiles is
  'Application-side user record. One row per auth.users entry, created by trigger.';

-- -----------------------------------------------------------------------------
-- tenants — the isolation boundary
-- -----------------------------------------------------------------------------
create table public.tenants (
  id              uuid primary key default gen_random_uuid(),
  kind            tenant_kind not null,
  name            text not null,
  -- Stylist tenants point at the salon they operate inside. The salon's own
  -- row has this null. Deliberately NOT a cascade: deleting a salon must never
  -- silently delete renters' books.
  parent_salon_id uuid references public.tenants (id) on delete restrict,
  timezone        text not null default 'America/New_York',
  created_at      timestamptz not null default now(),

  constraint salon_has_no_parent
    check ((kind = 'salon' and parent_salon_id is null)
        or (kind = 'stylist' and parent_salon_id is not null))
);

create index tenants_parent_idx on public.tenants (parent_salon_id);

comment on column public.tenants.parent_salon_id is
  'Which salon this stylist practice operates inside. RESTRICT on delete: a
   renter''s data must never disappear because the salon row was removed.';

-- -----------------------------------------------------------------------------
-- tenant_members — who can act within a tenant, and as what
-- -----------------------------------------------------------------------------
create table public.tenant_members (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references public.tenants (id) on delete cascade,
  profile_id     uuid not null references public.profiles (id) on delete cascade,
  role           member_role not null,
  classification worker_classification,
  is_active      boolean not null default true,
  joined_at      timestamptz not null default now(),

  unique (tenant_id, profile_id, role)
);

create index tenant_members_profile_idx on public.tenant_members (profile_id) where is_active;
create index tenant_members_tenant_idx   on public.tenant_members (tenant_id, role) where is_active;

comment on table public.tenant_members is
  'Composable roles. The salon owner typically has (salon, admin) AND
   (own stylist tenant, stylist). Neither row grants the other''s access.';

-- -----------------------------------------------------------------------------
-- Access helpers
-- -----------------------------------------------------------------------------
-- These back every RLS policy. SECURITY DEFINER so policies can read membership
-- without recursing into tenant_members' own RLS. STABLE so the planner may
-- cache them per statement.
--
-- search_path is pinned to empty: a SECURITY DEFINER function with a mutable
-- search_path is a privilege-escalation vector.

create or replace function public.current_tenant_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select tm.tenant_id
  from public.tenant_members tm
  where tm.profile_id = (select auth.uid())
    and tm.is_active;
$$;

comment on function public.current_tenant_ids is
  'Every tenant the caller belongs to, in any role. The workhorse of RLS.';

-- Tenants where the caller is specifically an admin. Used for facility-level
-- reads. Deliberately separate from current_tenant_ids: admin of the salon must
-- NOT imply read access to a renter''s tenant.
create or replace function public.admin_tenant_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select tm.tenant_id
  from public.tenant_members tm
  where tm.profile_id = (select auth.uid())
    and tm.role = 'admin'
    and tm.is_active;
$$;

-- Stylist tenants operating inside a salon the caller administers.
-- Grants NO access to their data — it exists so facility-level aggregate views
-- can enumerate chairs without exposing their contents.
create or replace function public.administered_child_tenant_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select t.id
  from public.tenants t
  where t.parent_salon_id in (select public.admin_tenant_ids());
$$;

-- -----------------------------------------------------------------------------
-- Keep profiles in step with auth.users
-- -----------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name, email, phone)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    new.email,
    new.phone
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Generic updated_at maintenance, reused by later migrations.
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_touch_updated_at
  before update on public.profiles
  for each row execute function public.touch_updated_at();
