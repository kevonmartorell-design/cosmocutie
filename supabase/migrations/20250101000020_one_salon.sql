-- =============================================================================
-- CosmoCutie · One salon, first come
-- =============================================================================
-- Replaces the platform_settings toggle with something simpler: the app allows
-- exactly one salon, and the door closes the moment it exists.
--
-- The toggle was machinery in service of a rule the data can enforce on its
-- own. The owner signs up, picks "I run this salon", and from then on nobody
-- else can — no dashboard setting to remember, no SQL to run at handover.
-- =============================================================================

drop function if exists public.bootstrap_salon(text, text, text);
drop table if exists public.platform_settings;

-- Readable without a session, because the sign-up screen must know whether to
-- draw the salon door before anyone has signed in. Returns only a boolean —
-- nothing about the salon itself leaks.
create or replace function public.salon_signup_available()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select not exists (select 1 from public.tenants where kind = 'salon');
$$;

grant execute on function public.salon_signup_available() to anon, authenticated;

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
  caller     uuid := (select auth.uid());
  v_salon_id uuid;
  v_chair_id uuid;
  v_name     text;
begin
  if caller is null then raise exception 'must be signed in'; end if;

  -- One salon, and the first one wins. Checked here rather than trusted from
  -- the screen, because a hidden button is a suggestion and this is a rule.
  if exists (select 1 from public.tenants where kind = 'salon') then
    raise exception 'this app already has a salon';
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

  -- The owner is a working stylist too, and their chair is its own tenant so
  -- their book is scoped exactly like any renter's.
  insert into public.tenants (kind, name, parent_salon_id, timezone)
  values ('stylist', v_name || '''s Chair', v_salon_id, salon_timezone)
  returning id into v_chair_id;

  insert into public.tenant_members (tenant_id, profile_id, role, classification)
  values (v_chair_id, caller, 'stylist', 'owner_operator');

  insert into public.stylist_settings (tenant_id) values (v_chair_id);

  return v_salon_id;
end;
$$;

grant execute on function public.create_salon(text, text) to authenticated;
