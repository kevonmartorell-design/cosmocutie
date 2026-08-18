-- =============================================================================
-- CosmoCutie · Phase 2 · Onboarding RPCs
-- =============================================================================
-- Salon creation and stylist invitation are multi-step operations that must be
-- atomic: a salon with no admin membership, or a chair with no settings row,
-- is a broken state that would need manual repair.
--
-- They are also the only writes that legitimately need to create rows the
-- caller has no prior access to, which is exactly why they run as SECURITY
-- DEFINER functions rather than by opening INSERT policies on `tenants`. A
-- broad "authenticated users may insert tenants" policy would let anyone mint
-- a chair inside someone else's salon.

-- -----------------------------------------------------------------------------
-- create_salon — first run for an owner
-- -----------------------------------------------------------------------------
-- Creates the salon, makes the caller its admin, and gives them their own
-- chair as a separate tenant. The owner is a working stylist, so both roles
-- are established up front — and kept separate, per the firewall model.
create or replace function public.create_salon(
  salon_name text,
  salon_timezone text default 'America/New_York'
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := (select auth.uid());
  new_salon_id uuid;
  new_chair_id uuid;
  caller_name text;
begin
  if caller is null then
    raise exception 'must be signed in';
  end if;

  -- One salon per owner. Without this a double-tap on the button silently
  -- creates two salons and the app has no way to choose between them.
  if exists (
    select 1
    from public.tenant_members tm
    join public.tenants t on t.id = tm.tenant_id
    where tm.profile_id = caller and tm.role = 'admin' and t.kind = 'salon'
  ) then
    raise exception 'you already administer a salon';
  end if;

  if coalesce(trim(salon_name), '') = '' then
    raise exception 'salon name is required';
  end if;

  select coalesce(nullif(trim(p.full_name), ''), 'My') into caller_name
  from public.profiles p where p.id = caller;

  insert into public.tenants (kind, name, timezone)
  values ('salon', trim(salon_name), salon_timezone)
  returning id into new_salon_id;

  insert into public.tenant_members (tenant_id, profile_id, role, classification)
  values (new_salon_id, caller, 'admin', 'owner_operator');

  -- The owner's own chair: its own tenant, so their book is scoped exactly
  -- like any renter's and their admin role grants no access to it.
  insert into public.tenants (kind, name, parent_salon_id, timezone)
  values ('stylist', caller_name || '''s Chair', new_salon_id, salon_timezone)
  returning id into new_chair_id;

  insert into public.tenant_members (tenant_id, profile_id, role, classification)
  values (new_chair_id, caller, 'stylist', 'owner_operator');

  insert into public.stylist_settings (tenant_id) values (new_chair_id);

  return new_salon_id;
end;
$$;

comment on function public.create_salon is
  'First-run salon setup. Creates the salon, the caller''s admin membership,
   their own chair as a separate tenant, and default stylist settings.';

-- -----------------------------------------------------------------------------
-- invite_stylist — the only way into a salon
-- -----------------------------------------------------------------------------
-- Stylists cannot self-register: the owner controls who works there. This
-- creates the chair and a pending invitation; the stylist claims it on signup.
create table if not exists public.stylist_invitations (
  id             uuid primary key default gen_random_uuid(),
  salon_id       uuid not null references public.tenants (id) on delete cascade,
  chair_id       uuid not null references public.tenants (id) on delete cascade,
  email          text not null,
  display_name   text not null,
  classification worker_classification not null,
  booth_rent_cents integer not null default 0,
  rent_interval  text not null default 'monthly',
  invited_by     uuid references public.profiles (id) on delete set null,
  claimed_by     uuid references public.profiles (id) on delete set null,
  claimed_at     timestamptz,
  created_at     timestamptz not null default now(),

  constraint rent_non_negative check (booth_rent_cents >= 0)
);

create index stylist_invitations_salon_idx on public.stylist_invitations (salon_id);
create unique index stylist_invitations_open_email_idx
  on public.stylist_invitations (salon_id, lower(email))
  where claimed_at is null;

alter table public.stylist_invitations enable row level security;

create policy stylist_invitations_admin on public.stylist_invitations
  for all using (salon_id in (select public.admin_tenant_ids()))
  with check (salon_id in (select public.admin_tenant_ids()));

-- An invitee must be able to see their own pending invitation to claim it.
create policy stylist_invitations_select_own on public.stylist_invitations
  for select using (
    lower(email) = lower(coalesce((select auth.jwt() ->> 'email'), ''))
  );

grant select, insert, update, delete on public.stylist_invitations to authenticated;

create or replace function public.invite_stylist(
  p_display_name text,
  p_email text,
  p_classification worker_classification,
  p_booth_rent_cents integer default 0,
  p_rent_interval text default 'monthly'
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := (select auth.uid());
  salon_id uuid;
  new_chair_id uuid;
  invitation_id uuid;
begin
  select tm.tenant_id into salon_id
  from public.tenant_members tm
  join public.tenants t on t.id = tm.tenant_id
  where tm.profile_id = caller and tm.role = 'admin' and t.kind = 'salon'
  limit 1;

  if salon_id is null then
    raise exception 'only a salon admin can invite stylists';
  end if;

  if coalesce(trim(p_display_name), '') = '' or coalesce(trim(p_email), '') = '' then
    raise exception 'name and email are required';
  end if;

  -- W-2 employees work under the salon tenant rather than their own, because
  -- the salon legitimately owns those client relationships.
  if p_classification = 'employee_w2' then
    new_chair_id := salon_id;
  else
    insert into public.tenants (kind, name, parent_salon_id, timezone)
    select 'stylist', trim(p_display_name) || '''s Chair', salon_id, t.timezone
    from public.tenants t where t.id = salon_id
    returning id into new_chair_id;

    insert into public.stylist_settings (tenant_id) values (new_chair_id);
  end if;

  insert into public.stylist_invitations
    (salon_id, chair_id, email, display_name, classification,
     booth_rent_cents, rent_interval, invited_by)
  values
    (salon_id, new_chair_id, lower(trim(p_email)), trim(p_display_name), p_classification,
     coalesce(p_booth_rent_cents, 0), p_rent_interval, caller)
  returning id into invitation_id;

  return invitation_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- claim_stylist_invitation — run by the invitee after they sign up
-- -----------------------------------------------------------------------------
create or replace function public.claim_stylist_invitation()
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := (select auth.uid());
  caller_email text := lower(coalesce((select auth.jwt() ->> 'email'), ''));
  inv record;
begin
  if caller is null or caller_email = '' then
    raise exception 'must be signed in';
  end if;

  select * into inv
  from public.stylist_invitations
  where lower(email) = caller_email and claimed_at is null
  order by created_at
  limit 1;

  if inv is null then
    return null;
  end if;

  insert into public.tenant_members (tenant_id, profile_id, role, classification)
  values (inv.chair_id, caller, 'stylist', inv.classification)
  on conflict (tenant_id, profile_id, role) do nothing;

  update public.stylist_invitations
  set claimed_by = caller, claimed_at = now()
  where id = inv.id;

  return inv.chair_id;
end;
$$;

grant execute on function public.create_salon(text, text)                                   to authenticated;
grant execute on function public.invite_stylist(text, text, worker_classification, integer, text) to authenticated;
grant execute on function public.claim_stylist_invitation()                                 to authenticated;
