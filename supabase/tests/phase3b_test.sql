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
       ('33333333-3333-3333-3333-333333333333','00000000-0000-0000-0000-000000000000','authenticated','authenticated','n@c.test','x',now(),'{"full_name":"Nina"}'),
       ('44444444-4444-4444-4444-444444444444','00000000-0000-0000-0000-000000000000','authenticated','authenticated','w@c.test','x',now(),'{"full_name":"Wanda"}');

select public.impersonate('11111111-1111-1111-1111-111111111111','d@s.test');
select public.create_salon('Salon','UTC');
select set_config('role','postgres',false), set_config('request.jwt.claims',null,false);
select id as chair from public.tenants where kind='stylist' limit 1 \gset
update public.tenants set timezone='UTC' where id=:'chair';
insert into public.services (id, tenant_id, name, duration_minutes, price_cents)
values ('eeeeeeee-0000-0000-0000-000000000001', :'chair','Cut',60,9000);
-- A colour with a 90-minute processing window starting 30 min in.
insert into public.services (id, tenant_id, name, duration_minutes, price_cents, processing_window_minutes, processing_starts_after_minutes)
values ('eeeeeeee-0000-0000-0000-000000000002', :'chair','Colour',180,25000,90,30);
insert into public.business_hours (tenant_id, weekday, opens_at, closes_at)
select :'chair', d, '09:00','18:00' from generate_series(0,6) d;

select slot_start as t1 from public.available_slots(:'chair',(now()+interval '1 day')::date,60) offset 4 limit 1 \gset

\echo ''
\echo '=== RESCHEDULE A CONFIRMED APPOINTMENT ==='
select public.impersonate('33333333-3333-3333-3333-333333333333','n@c.test');
select public.create_booking_request(:'chair', array['eeeeeeee-0000-0000-0000-000000000001']::uuid[], :'t1') as r1 \gset
select set_config('role','postgres',false), set_config('request.jwt.claims',null,false);
select public.impersonate('11111111-1111-1111-1111-111111111111','d@s.test');
select public.respond_to_request(:'r1','accept');
select set_config('role','postgres',false), set_config('request.jwt.claims',null,false);
select id as appt from public.appointments limit 1 \gset

-- Client proposes a move
select public.impersonate('33333333-3333-3333-3333-333333333333','n@c.test');
select public.request_appointment_reschedule(:'appt', :'t1'::timestamptz + interval '3 hours');
select set_config('role','postgres',false), set_config('request.jwt.claims',null,false);
select 'move proposed' as probe, (pending_starts_at is not null)::text as pending,
       case when pending_starts_at is not null then 'PASS' else 'FAIL' end as verdict
from public.appointments where id=:'appt';

\echo '--- proposer cannot accept their own proposal ---'
do $$
declare blocked boolean; aid uuid;
begin
  select id into aid from public.appointments limit 1;
  perform public.impersonate('33333333-3333-3333-3333-333333333333','n@c.test');
  begin perform public.respond_appointment_reschedule(aid, true); blocked := false;
  exception when others then blocked := true; end;
  raise notice 'self-accept            -> %', case when blocked then 'PASS (refused)' else 'FAIL' end;
  perform set_config('role','postgres',false); perform set_config('request.jwt.claims',null,false);
end $$;

-- Stylist accepts the move
select public.impersonate('11111111-1111-1111-1111-111111111111','d@s.test');
select public.respond_appointment_reschedule(:'appt', true);
select set_config('role','postgres',false), set_config('request.jwt.claims',null,false);
select 'appointment moved' as probe, to_char(starts_at,'HH24:MI') as new_time,
       case when starts_at = :'t1'::timestamptz + interval '3 hours' then 'PASS' else 'FAIL' end as verdict
from public.appointments where id=:'appt';
select 'buffers moved too' as probe, (extract(epoch from (starts_at-buffer_starts_at))/60)::int as mins,
       case when extract(epoch from (starts_at-buffer_starts_at))/60 = 30 then 'PASS' else 'FAIL' end as verdict
from public.appointments where id=:'appt';

\echo ''
\echo '=== CANCELLATION TIERS ==='
-- Far out: free
-- Buffers must move with the appointment or the envelope constraint refuses
-- the row — which is the constraint working, not a bug.
update public.appointments
set starts_at = now() + interval '5 days',
    ends_at = now() + interval '5 days 1 hour',
    buffer_starts_at = now() + interval '5 days' - interval '30 minutes',
    buffer_ends_at = now() + interval '5 days 1 hour 30 minutes'
where id=:'appt';
select public.impersonate('33333333-3333-3333-3333-333333333333','n@c.test');
-- Two statements: a single statement sees one snapshot, so a subquery here
-- would read the row as it was BEFORE the function ran.
select public.cancel_appointment(:'appt','changed plans') as outcome \gset
select set_config('role','postgres',false), set_config('request.jwt.claims',null,false);
select 'client cancels >48h' as probe, cancellation_outcome::text as outcome,
       case when cancellation_outcome = 'free' and cancellation_fee_cents = 0
            then 'PASS (no fee)' else 'FAIL' end as verdict
from public.appointments where id=:'appt';
select set_config('role','postgres',false), set_config('request.jwt.claims',null,false);

\echo ''
\echo '=== WAITLIST OFFER ON CANCELLATION ==='
insert into public.clients (id, profile_id, full_name) values ('cccccccc-0000-0000-0000-000000000009','44444444-4444-4444-4444-444444444444','Wanda');
insert into public.waitlist_entries (tenant_id, client_id, window_starts_on, window_ends_on)
values (:'chair','cccccccc-0000-0000-0000-000000000009', (now())::date, (now()+interval '10 days')::date);

-- Book and then cancel a fresh appointment; the trigger should offer the slot.
insert into public.client_records (id, tenant_id, client_id) values ('dddddddd-0000-0000-0000-000000000009', :'chair','cccccccc-0000-0000-0000-000000000009') on conflict do nothing;
insert into public.appointments (id, tenant_id, stylist_id, client_id, client_record_id, starts_at, ends_at, buffer_starts_at, buffer_ends_at)
values ('aaaa0000-0000-0000-0000-00000000000a', :'chair','11111111-1111-1111-1111-111111111111','cccccccc-0000-0000-0000-000000000009','dddddddd-0000-0000-0000-000000000009',
        now()+interval '2 days', now()+interval '2 days 1 hour', now()+interval '2 days' - interval '30 min', now()+interval '2 days 1 hour 30 min');
update public.appointments set status='cancelled' where id='aaaa0000-0000-0000-0000-00000000000a';

select 'waitlist offered on cancel' as probe, count(*) as offered,
       case when count(*) = 1 then 'PASS (trigger fired)' else 'FAIL' end as verdict
from public.waitlist_entries where offered_at is not null;
select 'offer expires in 30 min' as probe,
       round(extract(epoch from (offer_expires_at - offered_at))/60)::int as mins,
       case when round(extract(epoch from (offer_expires_at-offered_at))/60) = 30 then 'PASS' else 'FAIL' end as verdict
from public.waitlist_entries where offered_at is not null;

\echo ''
\echo '=== GAP-TIME BOOKING ==='
select slot_start as t2 from public.available_slots(:'chair',(now()+interval '3 day')::date,180) offset 1 limit 1 \gset
select public.impersonate('33333333-3333-3333-3333-333333333333','n@c.test');
select public.create_booking_request(:'chair', array['eeeeeeee-0000-0000-0000-000000000002']::uuid[], :'t2') as r2 \gset
select set_config('role','postgres',false), set_config('request.jwt.claims',null,false);
select public.impersonate('11111111-1111-1111-1111-111111111111','d@s.test');
select public.respond_to_request(:'r2','accept');
select set_config('role','postgres',false), set_config('request.jwt.claims',null,false);

select 'gap slot inside colour' as probe, count(*) as n,
       case when count(*) = 1 then 'PASS (idle time bookable)' else 'FAIL' end as verdict
from public.gap_slots(:'chair',(now()+interval '3 day')::date, 45);

select 'gap slot starts inside window' as probe,
       to_char(slot_start,'HH24:MI') as t,
       case when slot_start >= :'t2'::timestamptz + interval '30 minutes' then 'PASS' else 'FAIL' end as verdict
from public.gap_slots(:'chair',(now()+interval '3 day')::date, 45);

select 'too-long service rejected' as probe, count(*) as n,
       case when count(*) = 0 then 'PASS (does not fit)' else 'FAIL' end as verdict
from public.gap_slots(:'chair',(now()+interval '3 day')::date, 120);

\echo ''
\echo '=== NO-SHOW ==='
update public.appointments
set starts_at = now() - interval '1 hour', ends_at = now(), status='confirmed',
    buffer_starts_at = now() - interval '1 hour 30 minutes', buffer_ends_at = now() + interval '30 minutes'
where id='aaaa0000-0000-0000-0000-00000000000a';
select public.impersonate('11111111-1111-1111-1111-111111111111','d@s.test');
select public.mark_no_show('aaaa0000-0000-0000-0000-00000000000a');
select set_config('role','postgres',false), set_config('request.jwt.claims',null,false);
select 'marked no-show' as probe, status::text,
       case when status='no_show' then 'PASS' else 'FAIL' end as verdict
from public.appointments where id='aaaa0000-0000-0000-0000-00000000000a';
select 'count incremented' as probe, no_show_count,
       case when no_show_count=1 then 'PASS' else 'FAIL' end as verdict
from public.client_records where id='dddddddd-0000-0000-0000-000000000009';
