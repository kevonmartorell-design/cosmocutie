\set QUIET on
\pset pager off
create or replace function public.impersonate(uid uuid, em text) returns void
language plpgsql as $$
begin
  perform set_config('role','authenticated',false);
  perform set_config('request.jwt.claims', json_build_object('sub',uid,'role','authenticated','email',em)::text, false);
end $$;

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_user_meta_data)
values ('11111111-1111-1111-1111-111111111111','00000000-0000-0000-0000-000000000000','authenticated','authenticated','d@s.test','x',now(),'{"full_name":"Dana"}'),
       ('33333333-3333-3333-3333-333333333333','00000000-0000-0000-0000-000000000000','authenticated','authenticated','n@c.test','x',now(),'{"full_name":"Nina"}');

select public.impersonate('11111111-1111-1111-1111-111111111111','d@s.test');
select public.create_salon('Salon','UTC');
select set_config('role','postgres',false), set_config('request.jwt.claims',null,false);
select id as chair from public.tenants where kind='stylist' limit 1 \gset
update public.tenants set timezone='UTC' where id=:'chair';
-- A colour service that requires a patch test, and a cut that does not.
insert into public.services (id, tenant_id, name, duration_minutes, price_cents, requires_patch_test)
values ('eeeeeeee-0000-0000-0000-000000000001', :'chair','Colour',120,30000,true),
       ('eeeeeeee-0000-0000-0000-000000000002', :'chair','Cut',60,9000,false);
insert into public.business_hours (tenant_id, weekday, opens_at, closes_at)
select :'chair', d, '09:00','18:00' from generate_series(0,6) d;

select slot_start as t1 from public.available_slots(:'chair',(now()+interval '1 day')::date,120) offset 2 limit 1 \gset
select public.impersonate('33333333-3333-3333-3333-333333333333','n@c.test');
select public.create_booking_request(:'chair', array['eeeeeeee-0000-0000-0000-000000000001']::uuid[], :'t1') as req \gset
select set_config('role','postgres',false), set_config('request.jwt.claims',null,false);
select public.impersonate('11111111-1111-1111-1111-111111111111','d@s.test');
select public.respond_to_request(:'req','accept');
select set_config('role','postgres',false), set_config('request.jwt.claims',null,false);
select id as appt from public.appointments limit 1 \gset
select client_record_id as crec from public.appointments where id=:'appt' \gset

\echo ''
\echo '=== PATCH TEST GATE ==='
select 'colour flagged as needing test' as probe, public.appointment_needs_patch_test(:'appt')::text as needs,
       case when public.appointment_needs_patch_test(:'appt') then 'PASS' else 'FAIL' end as verdict;

\echo '--- checkout refused without a test ---'
do $$
declare blocked boolean; aid uuid;
begin
  select id into aid from public.appointments limit 1;
  perform public.impersonate('11111111-1111-1111-1111-111111111111','d@s.test');
  begin perform public.record_checkout(aid, 0); blocked := false;
  exception when others then blocked := true; end;
  raise notice 'checkout, no patch test -> %', case when blocked then 'PASS (refused)' else 'FAIL - unsafe' end;
  perform set_config('role','postgres',false); perform set_config('request.jwt.claims',null,false);
end $$;

\echo '--- a REACTION does not count as clearance ---'
select public.impersonate('11111111-1111-1111-1111-111111111111','d@s.test');
select public.record_consent(:'crec','patch_test','Nina Diaz','v1.0', :'appt', 'Shades EQ 09V', 'reaction') as c1 \gset
select set_config('role','postgres',false), set_config('request.jwt.claims',null,false);
select 'reaction is not valid' as probe, is_valid::text,
       case when not is_valid then 'PASS (still blocked)' else 'FAIL - DANGEROUS' end as verdict
from public.patch_test_status(:'chair', :'crec');

\echo '--- a passing test clears it ---'
select public.impersonate('11111111-1111-1111-1111-111111111111','d@s.test');
select public.record_consent(:'crec','patch_test','Nina Diaz','v1.0', :'appt', 'Shades EQ 09V', 'pass') as c2 \gset
select set_config('role','postgres',false), set_config('request.jwt.claims',null,false);
select 'pass clears the gate' as probe, is_valid::text,
       case when is_valid then 'PASS' else 'FAIL' end as verdict
from public.patch_test_status(:'chair', :'crec');
select 'expiry recorded' as probe, (expires_at > now())::text as future,
       case when expires_at > now() then 'PASS (180 days)' else 'FAIL' end as verdict
from public.patch_test_status(:'chair', :'crec');

-- Must be the stylist: the previous statement reset the role to postgres,
-- which leaves auth.uid() null and fails the ownership check.
select public.impersonate('11111111-1111-1111-1111-111111111111','d@s.test');
select public.record_checkout(:'appt', 3000) as pay \gset
select set_config('role','postgres',false), set_config('request.jwt.claims',null,false);
select 'checkout now allowed' as probe, status::text,
       case when status = 'completed' then 'PASS (gate cleared)' else 'FAIL' end as verdict
from public.appointments where id=:'appt';

\echo ''
\echo '=== DATA MINIMISATION ==='
select 'no medical-history columns exist' as probe, count(*) as bad_columns,
       case when count(*) = 0 then 'PASS (nothing to leak)' else 'FAIL' end as verdict
from information_schema.columns
where table_name = 'consents'
  and (column_name ilike '%medication%' or column_name ilike '%condition%'
       or column_name ilike '%pregnan%' or column_name ilike '%diagnosis%'
       or column_name ilike '%medical%');

select 'screening stores only a boolean' as probe, data_type,
       case when data_type = 'boolean' then 'PASS (outcome, not answers)' else 'FAIL' end as verdict
from information_schema.columns
where table_name='consents' and column_name='contraindications_disclosed';

\echo ''
\echo '=== COLOUR BAR ==='
select public.impersonate('11111111-1111-1111-1111-111111111111','d@s.test');
insert into public.formulas (tenant_id, appointment_id, client_record_id, components, developer_volume, processing_time_minutes, technique_notes)
values (:'chair', :'appt', :'crec',
        '[{"product":"Shades EQ 09V","grams":60},{"product":"Shades EQ 010GI","grams":30}]'::jsonb,
        '20', 25, 'Root smudge, glossed mid-lengths');

select 'formula saved with weights' as probe,
       (components->0->>'grams') as first_gram,
       case when (components->0->>'grams') = '60' then 'PASS' else 'FAIL' end as verdict
from public.formulas;

select 'formula tied to the appointment' as probe, (appointment_id = :'appt')::text as linked,
       case when appointment_id = :'appt' then 'PASS (not just the client)' else 'FAIL' end as verdict
from public.formulas;

\echo ''
\echo '=== EXPORT: the ownership promise ==='
select public.export_my_book(:'chair') as ex \gset
select 'export includes clients' as probe, jsonb_array_length(:'ex'::jsonb->'clients') as n,
       case when jsonb_array_length(:'ex'::jsonb->'clients') = 1 then 'PASS' else 'FAIL' end as verdict;
select 'export includes formulas' as probe, jsonb_array_length(:'ex'::jsonb->'formulas') as n,
       case when jsonb_array_length(:'ex'::jsonb->'formulas') = 1 then 'PASS (the crown jewels)' else 'FAIL' end as verdict;
select 'export includes consents' as probe, jsonb_array_length(:'ex'::jsonb->'consents') as n,
       case when jsonb_array_length(:'ex'::jsonb->'consents') = 2 then 'PASS' else 'FAIL' end as verdict;
select set_config('role','postgres',false), set_config('request.jwt.claims',null,false);

\echo '--- nobody exports someone else''s book ---'
do $$
declare blocked boolean; t uuid;
begin
  select id into t from public.tenants where kind='stylist' limit 1;
  perform public.impersonate('33333333-3333-3333-3333-333333333333','n@c.test');
  begin perform public.export_my_book(t); blocked := false;
  exception when others then blocked := true; end;
  raise notice 'client exporting book   -> %', case when blocked then 'PASS (refused)' else 'FAIL - LEAK' end;
end $$;
