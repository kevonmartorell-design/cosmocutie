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
\echo '=== NOTIFICATION ROUTING ==='
select public.impersonate('33333333-3333-3333-3333-333333333333','n@c.test');
select public.create_booking_request(:'chair', array['eeeeeeee-0000-0000-0000-000000000001']::uuid[], :'t1','Morning ok?') as req \gset
select set_config('role','postgres',false), set_config('request.jwt.claims',null,false);

select 'client requests -> stylist notified' as probe,
       (select full_name from public.profiles where id = profile_id) as who, title,
       case when profile_id='11111111-1111-1111-1111-111111111111' then 'PASS' else 'FAIL' end as verdict
from public.notification_queue order by created_at desc limit 1;

select public.impersonate('11111111-1111-1111-1111-111111111111','d@s.test');
select public.respond_to_request(:'req','reschedule', :'t1'::timestamptz + interval '2 hours','Colour running long');
select set_config('role','postgres',false), set_config('request.jwt.claims',null,false);

select 'stylist reschedules -> client notified' as probe,
       (select full_name from public.profiles where id = profile_id) as who, title,
       case when profile_id='33333333-3333-3333-3333-333333333333' then 'PASS' else 'FAIL' end as verdict
from public.notification_queue order by created_at desc limit 1;

select 'note carried into body' as probe, body,
       case when body = 'Colour running long' then 'PASS' else 'FAIL' end as verdict
from public.notification_queue order by created_at desc limit 1;

select public.impersonate('33333333-3333-3333-3333-333333333333','n@c.test');
select public.respond_to_request(:'req','accept');
select set_config('role','postgres',false), set_config('request.jwt.claims',null,false);

select 'acceptance -> other side notified' as probe,
       (select full_name from public.profiles where id = profile_id) as who, title,
       case when profile_id='11111111-1111-1111-1111-111111111111' and title='Appointment confirmed'
            then 'PASS' else 'FAIL' end as verdict
from public.notification_queue order by created_at desc limit 1;

select 'never notifies the actor' as probe, count(*) as self_notifications,
       case when count(*) = 0 then 'PASS' else 'FAIL' end as verdict
from public.notification_queue q
join public.negotiation_events e on e.created_at = (
  select max(created_at) from public.negotiation_events where request_id = :'req')
where q.profile_id = e.actor_profile_id and q.created_at >= e.created_at;

select 'deep link payload present' as probe, data->>'type' as kind,
       case when data->>'requestId' is not null then 'PASS' else 'FAIL' end as verdict
from public.notification_queue order by created_at desc limit 1;
