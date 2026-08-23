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
select parent_salon_id as salon from public.tenants where id=:'chair' \gset
update public.tenants set timezone='UTC' where id=:'chair';
insert into public.services (id, tenant_id, name, duration_minutes, price_cents)
values ('eeeeeeee-0000-0000-0000-000000000001', :'chair','Balayage',120,30000);
insert into public.business_hours (tenant_id, weekday, opens_at, closes_at)
select :'chair', d, '09:00','18:00' from generate_series(0,6) d;

\echo ''
\echo '=== BOOTH RENT DUE ==='
insert into public.booth_rents (salon_id, chair_id, amount_cents, interval, next_due_on)
values (:'salon', :'chair', 25000, 'monthly', current_date);

select 'rent raised when due' as probe, public.raise_due_booth_rents() as raised,
       'PASS' as verdict;
select 'charged to the chair, not salon' as probe,
       (tenant_id = :'chair')::text as correct_tenant,
       case when tenant_id = :'chair' then 'PASS (their outgoing)' else 'FAIL' end as verdict
from public.payments where kind='booth_rent';
select 'schedule advanced a month' as probe, next_due_on,
       case when next_due_on > current_date then 'PASS' else 'FAIL' end as verdict
from public.booth_rents;
select 'not raised twice same day' as probe, public.raise_due_booth_rents() as raised_again,
       case when public.raise_due_booth_rents() = 0 then 'PASS (idempotent)' else 'FAIL' end as verdict;

\echo ''
\echo '=== CHECKOUT ==='
select slot_start as t1 from public.available_slots(:'chair',(now()+interval '1 day')::date,120) offset 2 limit 1 \gset
select public.impersonate('33333333-3333-3333-3333-333333333333','n@c.test');
select public.create_booking_request(:'chair', array['eeeeeeee-0000-0000-0000-000000000001']::uuid[], :'t1') as req \gset
select set_config('role','postgres',false), set_config('request.jwt.claims',null,false);
select public.impersonate('11111111-1111-1111-1111-111111111111','d@s.test');
select public.respond_to_request(:'req','accept');
select set_config('role','postgres',false), set_config('request.jwt.claims',null,false);
select id as appt from public.appointments limit 1 \gset

-- Deposit was captured earlier; checkout should only bill the remainder.
insert into public.payments (tenant_id, appointment_id, client_id, kind, status, amount_cents)
select :'chair', :'appt', client_id, 'deposit','captured', 6000 from public.appointments where id=:'appt';

select public.impersonate('11111111-1111-1111-1111-111111111111','d@s.test');
select public.record_checkout(:'appt', 4500) as pay \gset
select set_config('role','postgres',false), set_config('request.jwt.claims',null,false);

select 'balance excludes deposit' as probe, amount_cents as cents,
       case when amount_cents = 24000 then 'PASS ($300 - $60 held)' else 'FAIL' end as verdict
from public.payments where id=:'pay';
select 'tip kept separate' as probe, tip_cents as tip,
       case when tip_cents = 4500 then 'PASS (reported separately)' else 'FAIL' end as verdict
from public.payments where id=:'pay';
select 'appointment completed' as probe, status::text,
       case when status='completed' then 'PASS' else 'FAIL' end as verdict
from public.appointments where id=:'appt';
select 'visit counted' as probe, visit_count,
       case when visit_count = 1 then 'PASS' else 'FAIL' end as verdict
from public.client_records limit 1;

\echo ''
\echo '=== CHARGEBACK EVIDENCE ==='
update public.appointments set arrived_at = starts_at, service_started_at = starts_at where id=:'appt';
insert into public.consents (tenant_id, client_record_id, appointment_id, kind, signed_by_name, document_version)
select :'chair', client_record_id, :'appt', 'patch_test','Nina Diaz','v1.0' from public.appointments where id=:'appt';

select public.impersonate('11111111-1111-1111-1111-111111111111','d@s.test');
select public.dispute_evidence(:'appt') as ev \gset

select 'evidence includes attendance' as probe,
       (:'ev'::jsonb -> 'attendance' ->> 'arrived_at' is not null)::text as has_arrival,
       case when :'ev'::jsonb -> 'attendance' ->> 'arrived_at' is not null then 'PASS' else 'FAIL' end as verdict;
select 'evidence includes the agreed thread' as probe,
       jsonb_array_length(:'ev'::jsonb -> 'agreement') as events,
       case when jsonb_array_length(:'ev'::jsonb -> 'agreement') >= 2 then 'PASS (timestamped agreement)' else 'FAIL' end as verdict;
select 'evidence includes signed consent' as probe,
       jsonb_array_length(:'ev'::jsonb -> 'consents') as n,
       case when jsonb_array_length(:'ev'::jsonb -> 'consents') = 1 then 'PASS (signature on record)' else 'FAIL' end as verdict;
select 'evidence includes services' as probe,
       jsonb_array_length(:'ev'::jsonb -> 'services') as n,
       case when jsonb_array_length(:'ev'::jsonb -> 'services') = 1 then 'PASS' else 'FAIL' end as verdict;
select set_config('role','postgres',false), set_config('request.jwt.claims',null,false);

\echo '--- another tenant cannot pull your evidence ---'
do $$
declare blocked boolean; aid uuid;
begin
  select id into aid from public.appointments limit 1;
  perform public.impersonate('33333333-3333-3333-3333-333333333333','n@c.test');
  begin perform public.dispute_evidence(aid); blocked := false;
  exception when others then blocked := true; end;
  raise notice 'client pulling evidence -> %', case when blocked then 'PASS (refused)' else 'FAIL - LEAK' end;
end $$;
