-- =============================================================================
-- CosmoCutie · Phase 2 · Stylist profiles, offboarding, client invitations
-- =============================================================================

-- -----------------------------------------------------------------------------
-- stylist_profiles — the public face of a chair
-- -----------------------------------------------------------------------------
-- Separate from stylist_settings: settings are operational policy (deposits,
-- buffers), this is what a client sees when browsing. Keeping them apart means
-- a public read of the profile never risks exposing policy internals.
create table public.stylist_profiles (
  tenant_id        uuid primary key references public.tenants (id) on delete cascade,
  display_name     text not null default '',
  headline         text,
  bio              text,
  instagram_handle text,
  avatar_path      text,
  -- An unpublished chair is invisible to clients — useful while a new stylist
  -- is still building their menu.
  is_published     boolean not null default false,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),

  constraint bio_length check (bio is null or char_length(bio) <= 600)
);

create trigger stylist_profiles_touch before update on public.stylist_profiles
  for each row execute function public.touch_updated_at();

alter table public.stylist_profiles enable row level security;

-- Owning tenant may write.
create policy stylist_profiles_tenant_write on public.stylist_profiles
  for all using (tenant_id in (select public.current_tenant_ids()))
  with check (tenant_id in (select public.current_tenant_ids()));

-- Published profiles are browsable — that is the point of a profile.
create policy stylist_profiles_public_read on public.stylist_profiles
  for select using (is_published or tenant_id in (select public.current_tenant_ids()));

grant select, insert, update, delete on public.stylist_profiles to authenticated;
grant select on public.stylist_profiles to anon;

-- Backfill a profile row for every chair that already exists.
insert into public.stylist_profiles (tenant_id, display_name)
select t.id, t.name from public.tenants t where t.kind = 'stylist'
on conflict (tenant_id) do nothing;

-- Give every new chair a profile automatically, so no screen has to cope with
-- the row being absent.
create or replace function public.ensure_stylist_profile()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.kind = 'stylist' then
    insert into public.stylist_profiles (tenant_id, display_name)
    values (new.id, new.name)
    on conflict (tenant_id) do nothing;
  end if;
  return new;
end $$;

create trigger tenants_ensure_profile
  after insert on public.tenants
  for each row execute function public.ensure_stylist_profile();

-- -----------------------------------------------------------------------------
-- Business hours are already modelled; open them for public reads by weekday
-- so a client can see when a stylist works before booking.
-- -----------------------------------------------------------------------------
-- (policy already permits public select — see migration 6)

-- -----------------------------------------------------------------------------
-- offboard_stylist — a renter leaving
-- -----------------------------------------------------------------------------
-- Deliberately does NOT delete anything. Their records must survive until an
-- export has been taken; destroying a departing renter's book on the way out
-- is the opposite of the ownership promise the whole architecture makes.
create or replace function public.offboard_stylist(p_chair_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := (select auth.uid());
  parent uuid;
begin
  select parent_salon_id into parent from public.tenants where id = p_chair_id;

  if parent is null or parent not in (select public.admin_tenant_ids()) then
    raise exception 'only the salon admin can offboard a stylist from this chair';
  end if;

  -- Deactivate membership: they stop appearing on the roster and lose access,
  -- but nothing is destroyed.
  update public.tenant_members
  set is_active = false
  where tenant_id = p_chair_id;

  -- Unpublish so clients stop seeing a stylist who no longer works here.
  update public.stylist_profiles set is_published = false where tenant_id = p_chair_id;

  -- Future appointments need explicit handling rather than silently vanishing.
  update public.appointments
  set status = 'cancelled', cancelled_at = now(), cancelled_by = caller,
      cancellation_reason = 'stylist left the salon'
  where tenant_id = p_chair_id
    and starts_at > now()
    and status in ('confirmed', 'in_progress');

  -- Any live negotiation dies with the chair; deposits release on expiry.
  update public.booking_requests
  set status = 'cancelled', resolved_at = now()
  where tenant_id = p_chair_id and status in ('awaiting_stylist','awaiting_client');
end;
$$;

comment on function public.offboard_stylist is
  'Deactivates a chair without deleting data. Export first — the renter owns
   their book and it must leave with them.';

-- -----------------------------------------------------------------------------
-- client_invites — a stylist bringing their existing clientele on
-- -----------------------------------------------------------------------------
-- The stylist shares the link through whatever they already use with that
-- client. The app never sends it: an app-sent SMS to someone who never
-- consented is an unsolicited commercial message under TCPA, whereas a stylist
-- texting their own client is unremarkable.
create table public.client_invites (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants (id) on delete cascade,
  -- gen_random_uuid() rather than gen_random_bytes(): on hosted Supabase
  -- pgcrypto lives in the `extensions` schema and is not on the search_path
  -- for a DDL default, so gen_random_bytes fails there while working locally.
  token       text not null unique default replace(gen_random_uuid()::text, '-', ''),
  label       text,
  created_by  uuid references public.profiles (id) on delete set null,
  claimed_by  uuid references public.clients (id) on delete set null,
  claimed_at  timestamptz,
  created_at  timestamptz not null default now()
);

create index client_invites_tenant_idx on public.client_invites (tenant_id, created_at desc);

alter table public.client_invites enable row level security;

create policy client_invites_tenant on public.client_invites
  for all using (tenant_id in (select public.current_tenant_ids()))
  with check (tenant_id in (select public.current_tenant_ids()));

grant select, insert, update, delete on public.client_invites to authenticated;

-- Claiming attributes the client to the inviting stylist's book. Attribution is
-- not cosmetic: it is what makes the ownership model work in practice.
create or replace function public.claim_client_invite(p_token text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := (select auth.uid());
  inv record;
  the_client uuid;
  record_id uuid;
begin
  if caller is null then raise exception 'must be signed in'; end if;

  select * into inv from public.client_invites
  where token = p_token and claimed_at is null;
  if inv is null then return null; end if;

  select id into the_client from public.clients where profile_id = caller;
  if the_client is null then
    insert into public.clients (profile_id, full_name, email)
    select caller,
           coalesce(nullif(trim(p.full_name), ''), 'Client'),
           p.email
    from public.profiles p where p.id = caller
    returning id into the_client;
  end if;

  insert into public.client_records (tenant_id, client_id, invited_by)
  values (inv.tenant_id, the_client, inv.created_by)
  on conflict (tenant_id, client_id) do nothing
  returning id into record_id;

  update public.client_invites
  set claimed_by = the_client, claimed_at = now()
  where id = inv.id;

  return inv.tenant_id;
end;
$$;

grant execute on function public.offboard_stylist(uuid)  to authenticated;
grant execute on function public.claim_client_invite(text) to authenticated;
