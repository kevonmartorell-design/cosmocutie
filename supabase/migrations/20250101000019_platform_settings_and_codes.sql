-- =============================================================================
-- CosmoCutie · Role-first signup, platform settings, salon address
-- =============================================================================

-- -----------------------------------------------------------------------------
-- platform_settings — one row, deliberately
-- -----------------------------------------------------------------------------
-- This app ships to a single salon. In that context "create your own salon" is
-- not a feature, it is a way for strangers to appear inside the owner's app.
-- Kept as data rather than a build flag so it can be turned on later without a
-- rebuild — and turned back off just as quickly if that was a mistake.
create table public.platform_settings (
  id                    boolean primary key default true,
  allow_salon_signup    boolean not null default false,
  updated_at            timestamptz not null default now(),

  -- Guarantees exactly one row: the primary key can only ever be `true`.
  constraint single_row check (id)
);

insert into public.platform_settings (id) values (true);

alter table public.platform_settings enable row level security;

-- Readable by anyone, because the sign-up screen must know which doors to draw
-- before a session exists. It contains no secrets — only which options exist.
create policy platform_settings_read on public.platform_settings
  for select using (true);

grant select on public.platform_settings to anon, authenticated;
-- Deliberately no write policy: this is changed in the Supabase dashboard by
-- the platform owner, not from inside the app by anyone who signs up.

-- -----------------------------------------------------------------------------
-- Salon address — salons move
-- -----------------------------------------------------------------------------
alter table public.tenants
  add column if not exists address_line1 text,
  add column if not exists address_line2 text,
  add column if not exists city          text,
  add column if not exists region        text,
  add column if not exists postal_code   text,
  add column if not exists country       text not null default 'US',
  add column if not exists phone         text;

-- -----------------------------------------------------------------------------
-- Invite codes
-- -----------------------------------------------------------------------------
-- Email matching alone fails the commonest real case: someone invited at one
-- address signing up with another. A short code survives that.
alter table public.stylist_invitations
  add column if not exists code text;

-- Six characters from an unambiguous alphabet — no O/0, no I/1/L — because
-- these get read aloud and typed by hand.
create or replace function public.generate_invite_code()
returns text
language plpgsql
volatile
as $$
declare
  alphabet constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  result text := '';
  i integer;
begin
  for i in 1..6 loop
    result := result || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
  end loop;
  return result;
end;
$$;

update public.stylist_invitations set code = public.generate_invite_code() where code is null;

alter table public.stylist_invitations alter column code set not null;
alter table public.stylist_invitations alter column code set default public.generate_invite_code();
create unique index stylist_invitations_code_idx on public.stylist_invitations (code);

-- Rebuilt to return the code, so the owner has something to pass on.
-- CREATE OR REPLACE cannot change a return type, and the old signature returned
-- a bare uuid, so the old one has to go first.
drop function if exists public.invite_stylist(text, text, public.worker_classification, integer, text);

create function public.invite_stylist(
  p_display_name text,
  p_email text,
  p_classification public.worker_classification,
  p_booth_rent_cents integer default 0,
  p_rent_interval text default 'monthly'
)
returns table (invitation_id uuid, invite_code text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller       uuid := (select auth.uid());
  v_salon_id   uuid;
  v_chair_id   uuid;
  v_invitation uuid;
  v_code       text;
begin
  select tm.tenant_id into v_salon_id
  from public.tenant_members tm
  join public.tenants t on t.id = tm.tenant_id
  where tm.profile_id = caller and tm.role = 'admin' and t.kind = 'salon'
  limit 1;

  if v_salon_id is null then
    raise exception 'only a salon admin can invite stylists';
  end if;
  if coalesce(trim(p_display_name), '') = '' or coalesce(trim(p_email), '') = '' then
    raise exception 'name and email are required';
  end if;

  -- W-2 hires work under the salon tenant: the salon owns those client
  -- relationships, which is what employment means.
  if p_classification = 'employee_w2' then
    v_chair_id := v_salon_id;
  else
    insert into public.tenants (kind, name, parent_salon_id, timezone)
    select 'stylist', trim(p_display_name) || '''s Chair', v_salon_id, t.timezone
    from public.tenants t where t.id = v_salon_id
    returning id into v_chair_id;

    insert into public.stylist_settings (tenant_id) values (v_chair_id);
  end if;

  v_code := public.generate_invite_code();

  insert into public.stylist_invitations
    (salon_id, chair_id, email, display_name, classification,
     booth_rent_cents, rent_interval, invited_by, code)
  values
    (v_salon_id, v_chair_id, lower(trim(p_email)), trim(p_display_name), p_classification,
     coalesce(p_booth_rent_cents, 0), p_rent_interval, caller, v_code)
  returning id into v_invitation;

  return query select v_invitation, v_code;
end;
$$;

-- Claim by code, falling back to the email match so an existing invitation
-- still works for someone who signs up with the address they were invited at.
-- Dropped rather than replaced: adding a defaulted parameter creates an
-- overload, and two candidates with zero required arguments is ambiguous.
drop function if exists public.claim_stylist_invitation();

create or replace function public.claim_stylist_invitation(p_code text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller       uuid := (select auth.uid());
  caller_email text := lower(coalesce((select auth.jwt() ->> 'email'), ''));
  inv          record;
begin
  if caller is null then raise exception 'must be signed in'; end if;

  if p_code is not null and trim(p_code) <> '' then
    select * into inv from public.stylist_invitations
    where upper(trim(code)) = upper(trim(p_code)) and claimed_at is null;
    if inv is null then
      raise exception 'that invite code is not valid, or has already been used';
    end if;
  else
    select * into inv from public.stylist_invitations
    where lower(email) = caller_email and claimed_at is null
    order by created_at limit 1;
    if inv is null then return null; end if;
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

-- Salon creation now respects the platform setting.
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
  caller       uuid := (select auth.uid());
  v_salon_id   uuid;
  v_chair_id   uuid;
  v_name       text;
  v_allowed    boolean;
begin
  if caller is null then raise exception 'must be signed in'; end if;

  select allow_salon_signup into v_allowed from public.platform_settings limit 1;
  if not coalesce(v_allowed, false) then
    raise exception 'salon signup is not enabled for this app';
  end if;

  if exists (
    select 1 from public.tenant_members tm
    join public.tenants t on t.id = tm.tenant_id
    where tm.profile_id = caller and tm.role = 'admin' and t.kind = 'salon'
  ) then
    raise exception 'you already administer a salon';
  end if;

  if coalesce(trim(salon_name), '') = '' then
    raise exception 'salon name is required';
  end if;

  select coalesce(nullif(trim(p.full_name), ''), 'My') into v_name
  from public.profiles p where p.id = caller;

  insert into public.tenants (kind, name, timezone)
  values ('salon', trim(salon_name), salon_timezone)
  returning id into v_salon_id;

  insert into public.tenant_members (tenant_id, profile_id, role, classification)
  values (v_salon_id, caller, 'admin', 'owner_operator');

  insert into public.tenants (kind, name, parent_salon_id, timezone)
  values ('stylist', v_name || '''s Chair', v_salon_id, salon_timezone)
  returning id into v_chair_id;

  insert into public.tenant_members (tenant_id, profile_id, role, classification)
  values (v_chair_id, caller, 'stylist', 'owner_operator');

  insert into public.stylist_settings (tenant_id) values (v_chair_id);

  return v_salon_id;
end;
$$;

-- Bootstrap for handover: creates the one salon regardless of the setting.
-- Run once from the Supabase SQL editor, then hand the app over.
create or replace function public.bootstrap_salon(
  p_owner_email text,
  p_salon_name text,
  p_timezone text default 'America/New_York'
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner    uuid;
  v_salon_id uuid;
  v_chair_id uuid;
  v_name     text;
begin
  select id into v_owner from auth.users where lower(email) = lower(trim(p_owner_email));
  if v_owner is null then
    raise exception 'no account exists for %; have them sign up first', p_owner_email;
  end if;

  select coalesce(nullif(trim(full_name), ''), 'Owner') into v_name
  from public.profiles where id = v_owner;

  insert into public.tenants (kind, name, timezone)
  values ('salon', trim(p_salon_name), p_timezone)
  returning id into v_salon_id;

  insert into public.tenant_members (tenant_id, profile_id, role, classification)
  values (v_salon_id, v_owner, 'admin', 'owner_operator');

  insert into public.tenants (kind, name, parent_salon_id, timezone)
  values ('stylist', v_name || '''s Chair', v_salon_id, p_timezone)
  returning id into v_chair_id;

  insert into public.tenant_members (tenant_id, profile_id, role, classification)
  values (v_chair_id, v_owner, 'stylist', 'owner_operator');

  insert into public.stylist_settings (tenant_id) values (v_chair_id);

  return v_salon_id;
end;
$$;

comment on function public.bootstrap_salon is
  'One-time handover helper. Creates the salon for an existing account without
   needing allow_salon_signup switched on. Run from the SQL editor.';

grant execute on function public.claim_stylist_invitation(text) to authenticated;
grant execute on function public.invite_stylist(text, text, public.worker_classification, integer, text) to authenticated;
