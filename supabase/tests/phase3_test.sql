\set QUIET on
\pset pager off

create or replace function public.impersonate(uid uuid, em text) returns void
language plpgsql as $$
begin
  perform set_config('role','authenticated',false);
  perform set_config('request.jwt.claims',
    json_build_object('sub', uid, 'role','authenticated', 'email', em)::text, false);
end $$;

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_user_meta_data)
values
  ('11111111-1111-1111-1111-111111111111','00000000-0000-0000-0000-000000000000','authenticated','authenticated','dana@s.test','x',now(),'{"full_name":"Dana Rivera"}'),
  ('33333333-3333-3333-3333-333333333333','00000000-0000-0000-0000-000000000000','authenticated','authenticated','nina@c.test','x',now(),'{"full_name":"Nina Diaz"}');

-- Dana sets up: salon, a service, and Tuesday hours.
select public.impersonate('11111111-1111-1111-1111-111111111111','dana@s.test');
select public.create_salon('CosmoCutie Salon','UTC');
select set_config('role','postgres',false), set_config('request.jwt.claims',null,false);

select id as chair from public.tenants where kind='stylist' limit 1 \gset
update public.tenants set timezone = 'UTC' where id = :'chair';

insert into public.services (id, tenant_id, name, duration_minutes, price_cents)
values ('eeeeeeee-0000-0000-0000-000000000001', :'chair', 'Cut', 60, 9000);

-- Open every weekday so the test never depends on which day it runs.
insert into public.business_hours (tenant_id, weekday, opens_at, closes_at)
select :'chair', d, '09:00', '18:00' from generate_series(0,6) d;

\echo ''
\echo '=== AVAILABILITY ==='
select 'slots offered tomorrow' as probe, count(*) as n,
       case when count(*) > 10 then 'PASS' else 'FAIL' end as verdict
from public.available_slots(:'chair', (now() + interval '1 day')::date, 60);

select slot_start as t1 from public.available_slots(:'chair', (now() + interval '1 day')::date, 60) offset 2 limit 1 \gset

\echo ''
\echo '=== NEGOTIATION: the full six steps ==='
select public.impersonate('33333333-3333-3333-3333-333333333333','nina@c.test');
select public.create_booking_request(:'chair', array['eeeeeeee-0000-0000-0000-000000000001']::uuid[], :'t1', 'Any chance of the morning?') as req \gset
select set_config('role','postgres',false), set_config('request.jwt.claims',null,false);

select 'step 1 client requested' as probe, status::text as state,
       case when status = 'awaiting_stylist' then 'PASS' else 'FAIL' end as verdict
from public.booking_requests where id = :'req';

select 'held slot vanishes from list' as probe, count(*) as n,
       case when count(*) = 0 then 'PASS (not double-offered)' else 'FAIL' end as verdict
from public.available_slots(:'chair', (now() + interval '1 day')::date, 60) s
where s.slot_start = :'t1';

-- Stylist reschedules (offer 1)
select public.impersonate('11111111-1111-1111-1111-111111111111','dana@s.test');
select public.respond_to_request(:'req','reschedule', :'t1'::timestamptz + interval '2 hours', 'Colour running long, 2h later?');
select set_config('role','postgres',false), set_config('request.jwt.claims',null,false);
select 'step 2 stylist rescheduled' as probe, status::text as state,
       case when status='awaiting_client' and stylist_offers_used=1 then 'PASS' else 'FAIL' end as verdict
from public.booking_requests where id = :'req';

-- Client counters (counter 1)
select public.impersonate('33333333-3333-3333-3333-333333333333','nina@c.test');
select public.respond_to_request(:'req','counter', :'t1'::timestamptz + interval '3 hours', 'Could we do 3h?');
select set_config('role','postgres',false), set_config('request.jwt.claims',null,false);

-- Stylist reschedules (offer 2 — their last)
select public.impersonate('11111111-1111-1111-1111-111111111111','dana@s.test');
select public.respond_to_request(:'req','reschedule', :'t1'::timestamptz + interval '4 hours', 'How about 4h?');
select set_config('role','postgres',false), set_config('request.jwt.claims',null,false);

-- Client counters (counter 2 — their last)
select public.impersonate('33333333-3333-3333-3333-333333333333','nina@c.test');
select public.respond_to_request(:'req','counter', :'t1'::timestamptz + interval '5 hours', 'Last try — 5h?');
select set_config('role','postgres',false), set_config('request.jwt.claims',null,false);

select 'both sides spent 2 offers' as probe,
       (stylist_offers_used || '/' || client_counters_used) as used,
       case when stylist_offers_used=2 and client_counters_used=2 then 'PASS' else 'FAIL' end as verdict
from public.booking_requests where id = :'req';

\echo '--- step 6: stylist can no longer reschedule, only accept/decline ---'
select public.impersonate('11111111-1111-1111-1111-111111111111','dana@s.test');
do $$
declare blocked boolean; rid uuid;
begin
  select id into rid from public.booking_requests limit 1;
  begin
    perform public.respond_to_request(rid,'reschedule', now() + interval '9 days', 'one more');
    blocked := false;
  exception when others then blocked := true;
  end;
  raise notice 'third stylist offer     -> %', case when blocked then 'PASS (refused)' else 'FAIL - cap leaked' end;
end $$;

select public.respond_to_request(:'req','accept', null, 'See you then');
select set_config('role','postgres',false), set_config('request.jwt.claims',null,false);

\echo ''
\echo '=== ACCEPTANCE ==='
select 'request accepted' as probe, status::text as state,
       case when status='accepted' then 'PASS' else 'FAIL' end as verdict
from public.booking_requests where id = :'req';

select 'appointment created' as probe, count(*) as n,
       case when count(*)=1 then 'PASS' else 'FAIL' end as verdict
from public.appointments;

select 'service line snapshotted' as probe, price_cents as cents,
       case when price_cents = 9000 then 'PASS' else 'FAIL' end as verdict
from public.appointment_services limit 1;

select 'buffers applied (30 min)' as probe,
       (extract(epoch from (starts_at - buffer_starts_at))/60)::int as mins,
       case when extract(epoch from (starts_at - buffer_starts_at))/60 = 30 then 'PASS' else 'FAIL' end as verdict
from public.appointments limit 1;

select 'thread has every step' as probe, count(*) as events,
       case when count(*) = 6 then 'PASS (6 bubbles)' else 'FAIL' end as verdict
from public.negotiation_events where request_id = :'req';

select 'booked time now blocked' as probe, count(*) as n,
       case when count(*) = 0 then 'PASS' else 'FAIL' end as verdict
from public.available_slots(:'chair', (now() + interval '1 day')::date, 60) s
where s.slot_start = :'t1'::timestamptz + interval '5 hours';
