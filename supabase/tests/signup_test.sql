\set QUIET on
\pset pager off
create or replace function public.impersonate(uid uuid, em text) returns void
language plpgsql as $$
begin
  perform set_config('role','authenticated',false);
  perform set_config('request.jwt.claims', json_build_object('sub',uid,'role','authenticated','email',em)::text, false);
end $$;

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_user_meta_data)
values ('11111111-1111-1111-1111-111111111111','00000000-0000-0000-0000-000000000000','authenticated','authenticated','wife@salon.test','x',now(),'{"full_name":"Salon Owner"}'),
       ('22222222-2222-2222-2222-222222222222','00000000-0000-0000-0000-000000000000','authenticated','authenticated','rae@s.test','x',now(),'{"full_name":"Rae Chen"}'),
       ('99999999-9999-9999-9999-999999999999','00000000-0000-0000-0000-000000000000','authenticated','authenticated','stranger@x.test','x',now(),'{"full_name":"Random Stranger"}');

\echo ''
\echo '=== ONE SALON, FIRST COME ==='
-- Migration 20 replaced the platform_settings toggle and bootstrap_salon with a
-- rule the data enforces on its own: the door is open until a salon exists, and
-- shuts the moment one does. This suite was left testing the old machinery and
-- had been failing at HEAD since; it now tests what actually ships.
select 'door is open before anyone signs up' as probe,
       public.salon_signup_available() as available,
       case when public.salon_signup_available() then 'PASS' else 'FAIL' end as verdict;

\echo ''
\echo '=== THE OWNER TAKES THE SLOT ==='
select public.impersonate('11111111-1111-1111-1111-111111111111','wife@salon.test');
select public.create_salon('CosmoCutie Salon','America/Chicago') as salon \gset
select set_config('role','postgres',false), set_config('request.jwt.claims',null,false);

select 'door shuts behind her' as probe,
       public.salon_signup_available() as available,
       case when not public.salon_signup_available() then 'PASS (closed)' else 'FAIL' end as verdict;

do $$
declare blocked boolean;
begin
  perform public.impersonate('99999999-9999-9999-9999-999999999999','stranger@x.test');
  begin perform public.create_salon('Rival Salon'); blocked := false;
  exception when others then blocked := true; end;
  raise notice 'stranger creating salon -> %', case when blocked then 'PASS (refused)' else 'FAIL - LEAK' end;
  perform set_config('role','postgres',false); perform set_config('request.jwt.claims',null,false);
end $$;
select 'salon created for the owner' as probe, count(*) as tenants,
       case when count(*) = 2 then 'PASS (salon + her chair)' else 'FAIL' end as verdict
from public.tenants;
select 'owner holds both roles' as probe, count(*) as memberships,
       case when count(*) = 2 then 'PASS' else 'FAIL' end as verdict
from public.tenant_members where profile_id = '11111111-1111-1111-1111-111111111111';

\echo ''
\echo '=== ADDRESS IS EDITABLE ==='
update public.tenants
set address_line1 = '12 High Street', city = 'Austin', region = 'TX', postal_code = '78701', phone = '+15125550100'
where id = :'salon';
select 'address stored' as probe, (address_line1 || ', ' || city) as addr,
       case when city = 'Austin' then 'PASS' else 'FAIL' end as verdict
from public.tenants where id = :'salon';

update public.tenants set address_line1 = '400 Congress Ave', postal_code = '78704' where id = :'salon';
select 'address can change later' as probe, address_line1,
       case when address_line1 = '400 Congress Ave' then 'PASS (salons move)' else 'FAIL' end as verdict
from public.tenants where id = :'salon';

\echo ''
\echo '=== INVITE CODES ==='
select public.impersonate('11111111-1111-1111-1111-111111111111','wife@salon.test');
select invite_code as code from public.invite_stylist('Rae Chen','rae@s.test','contractor_1099', 25000) \gset
select set_config('role','postgres',false), set_config('request.jwt.claims',null,false);

select 'code is 6 characters' as probe, :'code' as code,
       case when length(:'code') = 6 then 'PASS' else 'FAIL' end as verdict;
select 'code avoids ambiguous chars' as probe, :'code' as code,
       case when :'code' !~ '[O0I1L]' then 'PASS (readable aloud)' else 'FAIL' end as verdict;

\echo '--- a WRONG email can still claim, using the code ---'
-- Rae was invited at rae@s.test but signs up as someone else. The email match
-- would fail here; the code is what saves it.
select public.impersonate('22222222-2222-2222-2222-222222222222','totally-different@gmail.test');
select public.claim_stylist_invitation(:'code') as chair \gset
select set_config('role','postgres',false), set_config('request.jwt.claims',null,false);

select 'claimed with mismatched email' as probe, count(*) as memberships,
       case when count(*) = 1 then 'PASS (code works regardless)' else 'FAIL' end as verdict
from public.tenant_members where profile_id = '22222222-2222-2222-2222-222222222222';

\echo '--- a code cannot be used twice ---'
do $$
declare blocked boolean; c text;
begin
  select code into c from public.stylist_invitations limit 1;
  perform public.impersonate('99999999-9999-9999-9999-999999999999','stranger@x.test');
  begin perform public.claim_stylist_invitation(c); blocked := false;
  exception when others then blocked := true; end;
  raise notice 'reusing a claimed code  -> %', case when blocked then 'PASS (refused)' else 'FAIL - LEAK' end;
  perform set_config('role','postgres',false); perform set_config('request.jwt.claims',null,false);
end $$;

\echo '--- a made-up code is refused ---'
do $$
declare blocked boolean;
begin
  perform public.impersonate('99999999-9999-9999-9999-999999999999','stranger@x.test');
  begin perform public.claim_stylist_invitation('ZZZZZZ'); blocked := false;
  exception when others then blocked := true; end;
  raise notice 'invented code           -> %', case when blocked then 'PASS (refused)' else 'FAIL - LEAK' end;
  perform set_config('role','postgres',false); perform set_config('request.jwt.claims',null,false);
end $$;

\echo ''
\echo '=== THE SLOT CANNOT BE TAKEN TWICE ==='
-- The check lives in create_salon rather than in the screen, because a hidden
-- button is a suggestion and this is a rule.
do $$
declare blocked boolean;
begin
  perform public.impersonate('11111111-1111-1111-1111-111111111111','wife@salon.test');
  begin perform public.create_salon('Second Salon'); blocked := false;
  exception when others then blocked := true; end;
  raise notice 'owner creating a second -> %', case when blocked then 'PASS (refused)' else 'FAIL - LEAK' end;
  perform set_config('role','postgres',false); perform set_config('request.jwt.claims',null,false);
end $$;
