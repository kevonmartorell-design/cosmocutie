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
       ('99999999-9999-9999-9999-999999999999','00000000-0000-0000-0000-000000000000','authenticated','authenticated','stranger@x.test','x',now(),'{"full_name":"Stranger"}');

\echo ''
\echo '=== BEFORE: the door is open ==='
select 'signup available' as probe, public.salon_signup_available()::text as open,
       case when public.salon_signup_available() then 'PASS (first run)' else 'FAIL' end as verdict;

\echo '--- anon can check, without a session ---'
begin;
select set_config('role','anon',false);
select 'anon can read availability' as probe, public.salon_signup_available()::text as v,
       case when public.salon_signup_available() then 'PASS' else 'FAIL' end as verdict;
rollback;

\echo ''
\echo '=== THE OWNER SIGNS UP NORMALLY ==='
select public.impersonate('11111111-1111-1111-1111-111111111111','wife@salon.test');
select public.create_salon('CosmoCutie Salon','America/Chicago') as salon \gset
select set_config('role','postgres',false), set_config('request.jwt.claims',null,false);

select 'salon + her chair created' as probe, count(*) as tenants,
       case when count(*) = 2 then 'PASS' else 'FAIL' end as verdict
from public.tenants;
select 'she holds both roles' as probe, count(*) as memberships,
       case when count(*) = 2 then 'PASS (admin + stylist)' else 'FAIL' end as verdict
from public.tenant_members where profile_id='11111111-1111-1111-1111-111111111111';

\echo ''
\echo '=== AFTER: the door closes on its own ==='
select 'signup no longer available' as probe, public.salon_signup_available()::text as open,
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

do $$
declare blocked boolean;
begin
  perform public.impersonate('11111111-1111-1111-1111-111111111111','wife@salon.test');
  begin perform public.create_salon('Second Salon'); blocked := false;
  exception when others then blocked := true; end;
  raise notice 'owner creating a second -> %', case when blocked then 'PASS (refused)' else 'FAIL' end;
  perform set_config('role','postgres',false); perform set_config('request.jwt.claims',null,false);
end $$;

\echo ''
\echo '=== THE OLD MACHINERY IS GONE ==='
select 'platform_settings dropped' as probe, count(*) as tables,
       case when count(*) = 0 then 'PASS (no toggle to forget)' else 'FAIL' end as verdict
from information_schema.tables where table_name = 'platform_settings';
select 'bootstrap_salon dropped' as probe, count(*) as fns,
       case when count(*) = 0 then 'PASS (no SQL at handover)' else 'FAIL' end as verdict
from pg_proc where proname = 'bootstrap_salon';

\echo ''
\echo '=== A TYPO IS NOT FATAL: the name is editable ==='
select public.impersonate('11111111-1111-1111-1111-111111111111','wife@salon.test');
update public.tenants set name = 'CosmoCutie Hair Studio', city = 'Austin' where id = :'salon';
select 'renamed after the fact' as probe, name,
       case when name = 'CosmoCutie Hair Studio' then 'PASS (typo recoverable)' else 'FAIL' end as verdict
from public.tenants where id = :'salon';
