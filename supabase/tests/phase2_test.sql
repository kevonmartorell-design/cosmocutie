\set QUIET on
\pset pager off

create or replace function public.impersonate(uid uuid, em text) returns void
language plpgsql as $$
begin
  -- Session-scoped (false), not transaction-local. Outside an explicit
  -- transaction every statement is its own, so a LOCAL setting would vanish
  -- before the next line ran.
  perform set_config('role','authenticated',false);
  perform set_config('request.jwt.claims',
    json_build_object('sub', uid, 'role','authenticated', 'email', em)::text, false);
end $$;

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_user_meta_data)
values
  ('11111111-1111-1111-1111-111111111111','00000000-0000-0000-0000-000000000000','authenticated','authenticated','dana@s.test','x',now(),'{"full_name":"Dana Rivera"}'),
  ('22222222-2222-2222-2222-222222222222','00000000-0000-0000-0000-000000000000','authenticated','authenticated','rae@s.test','x',now(),'{"full_name":"Rae Chen"}'),
  ('33333333-3333-3333-3333-333333333333','00000000-0000-0000-0000-000000000000','authenticated','authenticated','nina@c.test','x',now(),'{"full_name":"Nina Diaz"}');

\echo ''
\echo '=== PHASE 2: profiles, hours, client invites, offboarding ==='
\echo ''

-- Dana creates the salon and invites Rae.
select public.impersonate('11111111-1111-1111-1111-111111111111','dana@s.test');
select public.create_salon('CosmoCutie Salon');
select public.invite_stylist('Rae Chen','rae@s.test','contractor_1099', 25000);
select set_config('role','postgres',false), set_config('request.jwt.claims',null,false);

-- Existence checks run as postgres: the question is "does the row exist",
-- not "can this user see it".
select 'every chair auto-got a profile' as probe, count(*) as rows,
       case when count(*) = 2 then 'PASS (trigger fired twice)' else 'FAIL' end as verdict
from public.stylist_profiles;

-- Rae claims her invite and sets up her chair.
select public.impersonate('22222222-2222-2222-2222-222222222222','rae@s.test');
select public.claim_stylist_invitation();

update public.stylist_profiles
set bio = 'Balayage specialist', instagram_handle = 'raedoeshair', is_published = true
where tenant_id in (select public.current_tenant_ids());

insert into public.business_hours (tenant_id, weekday, opens_at, closes_at)
select t, 2, '10:00', '18:00' from unnest(array(select public.current_tenant_ids())) t;
insert into public.business_hours (tenant_id, weekday, opens_at, closes_at)
select t, 4, '10:00', '20:00' from unnest(array(select public.current_tenant_ids())) t;

select 'Rae set her own hours' as probe, count(*) as rows,
       case when count(*) = 2 then 'PASS' else 'FAIL' end as verdict
from public.business_hours;

with ins as (
  insert into public.client_invites (tenant_id, label)
  select t, 'Nina' from unnest(array(select public.current_tenant_ids())) t
  returning token
)
select 'Rae created a client invite' as probe, count(*) as rows,
       case when count(*) = 1 then 'PASS' else 'FAIL' end as verdict
from ins;

select token as invite_token from public.client_invites limit 1 \gset
select set_config('role','postgres',false), set_config('request.jwt.claims',null,false);

-- Nina claims the link.
select public.impersonate('33333333-3333-3333-3333-333333333333','nina@c.test');
select public.claim_client_invite(:'invite_token');

select 'Nina landed in a book' as probe, count(*) as rows,
       case when count(*) = 1 then 'PASS (attributed to Rae)' else 'FAIL' end as verdict
from public.client_records;

select 'Nina can see published profile' as probe, count(*) as rows,
       case when count(*) = 1 then 'PASS' else 'FAIL' end as verdict
from public.stylist_profiles where is_published;
select set_config('role','postgres',false), set_config('request.jwt.claims',null,false);

-- Offboarding.
select id as rae_chair from public.tenants where kind='stylist' and name like 'Rae%' limit 1 \gset
select public.impersonate('11111111-1111-1111-1111-111111111111','dana@s.test');
select public.offboard_stylist(:'rae_chair');
select set_config('role','postgres',false), set_config('request.jwt.claims',null,false);

select 'membership deactivated' as probe, count(*) as active,
       case when count(*) = 0 then 'PASS' else 'FAIL' end as verdict
from public.tenant_members where tenant_id = :'rae_chair' and is_active;

select 'profile unpublished' as probe, count(*) as published,
       case when count(*) = 0 then 'PASS' else 'FAIL' end as verdict
from public.stylist_profiles where tenant_id = :'rae_chair' and is_published;

select 'client book SURVIVES for export' as probe, count(*) as records,
       case when count(*) = 1 then 'PASS (not destroyed)' else 'FAIL - DATA LOST' end as verdict
from public.client_records where tenant_id = :'rae_chair';

-- A non-admin must not be able to offboard anyone.
select public.impersonate('22222222-2222-2222-2222-222222222222','rae@s.test');
do $$
declare blocked boolean; target uuid;
begin
  select id into target from public.tenants where kind='stylist' and name like 'Dana%' limit 1;
  begin
    perform public.offboard_stylist(target);
    blocked := false;
  exception when others then blocked := true;
  end;
  raise notice 'non-admin offboarding   -> %', case when blocked then 'PASS (refused)' else 'FAIL' end;
end $$;
select set_config('role','postgres',false), set_config('request.jwt.claims',null,false);
