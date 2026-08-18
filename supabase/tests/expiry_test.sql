\set QUIET on
\pset pager off
\echo ''
\echo '=== EXPIRY + SLOT RELEASE ==='

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_user_meta_data)
values ('11111111-1111-1111-1111-111111111111','00000000-0000-0000-0000-000000000000','authenticated','authenticated','d@s.test','x',now(),'{"full_name":"Dana"}'),
       ('33333333-3333-3333-3333-333333333333','00000000-0000-0000-0000-000000000000','authenticated','authenticated','n@c.test','x',now(),'{"full_name":"Nina"}');

create or replace function public.impersonate(uid uuid, em text) returns void
language plpgsql as $$
begin
  perform set_config('role','authenticated',false);
  perform set_config('request.jwt.claims', json_build_object('sub',uid,'role','authenticated','email',em)::text, false);
end $$;

select public.impersonate('11111111-1111-1111-1111-111111111111','d@s.test');
select public.create_salon('Salon','UTC');
select set_config('role','postgres',false), set_config('request.jwt.claims',null,false);

select id as chair from public.tenants where kind='stylist' limit 1 \gset
update public.tenants set timezone='UTC' where id=:'chair';
insert into public.services (id, tenant_id, name, duration_minutes, price_cents)
values ('eeeeeeee-0000-0000-0000-000000000001', :'chair','Cut',60,9000);
insert into public.business_hours (tenant_id, weekday, opens_at, closes_at)
select :'chair', d, '09:00','18:00' from generate_series(0,6) d;

select slot_start as t1 from public.available_slots(:'chair',(now()+interval '1 day')::date,60) offset 2 limit 1 \gset

select public.impersonate('33333333-3333-3333-3333-333333333333','n@c.test');
select public.create_booking_request(:'chair', array['eeeeeeee-0000-0000-0000-000000000001']::uuid[], :'t1') as req \gset
select set_config('role','postgres',false), set_config('request.jwt.claims',null,false);

select 'slot held while pending' as probe, count(*) as n,
       case when count(*)=0 then 'PASS (hidden)' else 'FAIL' end as verdict
from public.available_slots(:'chair',(now()+interval '1 day')::date,60) s where s.slot_start=:'t1';

-- Wind the clock past the per-step deadline.
update public.booking_requests set step_deadline = now() - interval '1 minute' where id=:'req';

select 'expire_stale_requests ran' as probe, public.expire_stale_requests() as expired,
       'PASS' as verdict;

select 'request expired' as probe, status::text as state,
       case when status='expired' then 'PASS' else 'FAIL' end as verdict
from public.booking_requests where id=:'req';

select 'system event logged' as probe, count(*) as n,
       case when count(*)=1 then 'PASS' else 'FAIL' end as verdict
from public.negotiation_events where request_id=:'req' and actor='system';

select 'slot released for others' as probe, count(*) as n,
       case when count(*)=1 then 'PASS (bookable again)' else 'FAIL' end as verdict
from public.available_slots(:'chair',(now()+interval '1 day')::date,60) s where s.slot_start=:'t1';

\echo ''
\echo '=== CRON REGISTERED ==='
select 'job scheduled' as probe, jobname, schedule,
       case when active then 'PASS' else 'FAIL' end as verdict
from cron.job where jobname = 'expire-stale-booking-requests';
