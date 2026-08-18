\set QUIET on
\pset pager off

create or replace function public.impersonate(uid uuid, em text) returns void
language plpgsql as $$
begin
  perform set_config('role','authenticated',true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', uid, 'role','authenticated', 'email', em)::text, true);
end $$;

-- Two humans: Dana (will own the salon), Rae (will be invited as a renter).
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_user_meta_data)
values
  ('11111111-1111-1111-1111-111111111111','00000000-0000-0000-0000-000000000000','authenticated','authenticated','dana@salon.test','x',now(),'{"full_name":"Dana Rivera"}'),
  ('22222222-2222-2222-2222-222222222222','00000000-0000-0000-0000-000000000000','authenticated','authenticated','rae@salon.test','x',now(),'{"full_name":"Rae Chen"}');

\echo ''
\echo '=== ONBOARDING FLOW ==='

begin;
select public.impersonate('11111111-1111-1111-1111-111111111111','dana@salon.test');

\echo '--- Dana creates the salon ---'
select public.create_salon('CosmoCutie Salon', 'America/Chicago') as salon_id \gset

select 'salon + chair created' as probe, count(*) as tenants,
       case when count(*) = 2 then 'PASS (salon + owner chair)' else 'FAIL' end as verdict
from public.tenants;

select 'Dana holds BOTH roles' as probe, count(*) as memberships,
       case when count(*) = 2 then 'PASS (admin + stylist)' else 'FAIL' end as verdict
from public.tenant_members where profile_id = '11111111-1111-1111-1111-111111111111';

select 'owner chair got settings' as probe, count(*) as rows,
       case when count(*) = 1 then 'PASS' else 'FAIL' end as verdict
from public.stylist_settings;

select 'deposit defaults OFF' as probe, requires_deposit::text as value,
       case when requires_deposit = false then 'PASS (opt-in)' else 'FAIL' end as verdict
from public.stylist_settings limit 1;

\echo '--- Dana cannot create a second salon ---'
do $$
declare blocked boolean;
begin
  begin
    perform public.create_salon('Sneaky Second Salon');
    blocked := false;
  exception when others then blocked := true;
  end;
  raise notice 'duplicate salon        -> %', case when blocked then 'PASS (refused)' else 'FAIL' end;
end $$;

\echo '--- Dana invites Rae as a 1099 renter ---'
select public.invite_stylist('Rae Chen','rae@salon.test','contractor_1099', 25000, 'weekly') as inv_id \gset

select 'Rae chair created' as probe, count(*) as rows,
       case when count(*) = 3 then 'PASS (salon + 2 chairs)' else 'FAIL' end as verdict
from public.tenants;

select 'invitation is pending' as probe, count(*) as rows,
       case when count(*) = 1 then 'PASS' else 'FAIL' end as verdict
from public.stylist_invitations where claimed_at is null;
commit;

-- ------------------------------------------------------------------ RAE
begin;
select public.impersonate('22222222-2222-2222-2222-222222222222','rae@salon.test');

\echo '--- Rae claims her invitation ---'
select 'Rae sees her invite' as probe, count(*) as rows,
       case when count(*) = 1 then 'PASS' else 'FAIL' end as verdict
from public.stylist_invitations;

select public.claim_stylist_invitation() as chair \gset

select 'Rae is now a stylist' as probe, count(*) as rows,
       case when count(*) = 1 then 'PASS' else 'FAIL' end as verdict
from public.tenant_members where profile_id = '22222222-2222-2222-2222-222222222222';

\echo '--- Rae cannot invite anyone (not an admin) ---'
do $$
declare blocked boolean;
begin
  begin
    perform public.invite_stylist('Impostor','x@y.test','contractor_1099');
    blocked := false;
  exception when others then blocked := true;
  end;
  raise notice 'non-admin inviting     -> %', case when blocked then 'PASS (refused)' else 'FAIL' end;
end $$;
commit;

-- ---------------------------------------------------- FIREWALL STILL HOLDS
begin;
select public.impersonate('11111111-1111-1111-1111-111111111111','dana@salon.test');
\echo '--- Dana (admin) still cannot reach into Rae''s chair ---'
select 'Dana sees own settings only' as probe, count(*) as rows,
       case when count(*) = 1 then 'PASS (not Rae''s)' else 'FAIL - LEAK' end as verdict
from public.stylist_settings;

select 'Dana enumerates 3 tenants' as probe, count(*) as rows,
       case when count(*) = 3 then 'PASS (structure visible)' else 'FAIL' end as verdict
from public.tenants;
rollback;
