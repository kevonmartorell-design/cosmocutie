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
insert into public.services (id, tenant_id, name, duration_minutes, price_cents)
values ('eeeeeeee-0000-0000-0000-000000000001', :'chair','Cut',60,9000);
insert into public.business_hours (tenant_id, weekday, opens_at, closes_at)
select :'chair', d, '09:00','18:00' from generate_series(0,6) d;
select slot_start as t1 from public.available_slots(:'chair',(now()+interval '1 day')::date,60) offset 3 limit 1 \gset

\echo ''
\echo '=== NOTIFICATIONS QUEUED ON TURN CHANGE ==='
select public.impersonate('33333333-3333-3333-3333-333333333333','n@c.test');
select public.create_booking_request(:'chair', array['eeeeeeee-0000-0000-0000-000000000001']::uuid[], :'t1','Morning ok?') as req \gset
select set_config('role','postgres',false), set_config('request.jwt.claims',null,false);

select 'client request -> notifies STYLIST' as probe,
       (select p.full_name from public.profiles p where p.id = q.profile_id) as recipient,
       case when q.profile_id = '11111111-1111-1111-1111-111111111111' then 'PASS' else 'FAIL' end as verdict
from public.notification_queue q order by q.created_at desc limit 1;

select 'title is actionable' as probe, title,
       case when title = 'New booking request' then 'PASS' else 'FAIL' end as verdict
from public.notification_queue order by created_at desc limit 1;

select 'note used as body' as probe, body,
       case when body = 'Morning ok?' then 'PASS (stylist sees the ask)' else 'FAIL' end as verdict
from public.notification_queue order by created_at desc limit 1;

-- Stylist reschedules -> should notify the CLIENT
select public.impersonate('11111111-1111-1111-1111-111111111111','d@s.test');
select public.respond_to_request(:'req','reschedule', :'t1'::timestamptz + interval '2 hours','Colour running long');
select set_config('role','postgres',false), set_config('request.jwt.claims',null,false);

select 'stylist reply -> notifies CLIENT' as probe,
       (select p.full_name from public.profiles p where p.id = q.profile_id) as recipient,
       case when q.profile_id = '33333333-3333-3333-3333-333333333333' then 'PASS' else 'FAIL' end as verdict
from public.notification_queue q order by q.created_at desc limit 1;

select 'never notifies the actor' as probe, count(*) as self_notifications,
       case when count(*) = 0 then 'PASS' else 'FAIL' end as verdict
from public.notification_queue q
join public.negotiation_events e on e.request_id = :'req'
where q.profile_id = e.actor_profile_id and q.created_at = e.created_at;

-- Accept -> client told it is confirmed
select public.impersonate('33333333-3333-3333-3333-333333333333','n@c.test');
select public.respond_to_request(:'req','accept');
select set_config('role','postgres',false), set_config('request.jwt.claims',null,false);

select 'acceptance notifies stylist' as probe, title,
       case when title = 'Appointment confirmed' then 'PASS' else 'FAIL' end as verdict
from public.notification_queue order by created_at desc limit 1;

select 'queue has one per turn' as probe, count(*) as total,
       case when count(*) = 3 then 'PASS (3 turns, 3 alerts)' else 'FAIL' end as verdict
from public.notification_queue;

select 'payload carries requestId' as probe, (data->>'requestId' is not null)::text as has_id,
       case when data->>'requestId' is not null then 'PASS (deep link works)' else 'FAIL' end as verdict
from public.notification_queue order by created_at desc limit 1;
