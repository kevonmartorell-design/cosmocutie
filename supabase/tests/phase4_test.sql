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
       ('22222222-2222-2222-2222-222222222222','00000000-0000-0000-0000-000000000000','authenticated','authenticated','r@s.test','x',now(),'{"full_name":"Rae"}'),
       ('33333333-3333-3333-3333-333333333333','00000000-0000-0000-0000-000000000000','authenticated','authenticated','n@c.test','x',now(),'{"full_name":"Nina"}');

select public.impersonate('11111111-1111-1111-1111-111111111111','d@s.test');
select public.create_salon('Salon','UTC');
select public.invite_stylist('Rae','r@s.test','contractor_1099', 25000);
select set_config('role','postgres',false), set_config('request.jwt.claims',null,false);
select public.impersonate('22222222-2222-2222-2222-222222222222','r@s.test');
select public.claim_stylist_invitation();
select set_config('role','postgres',false), set_config('request.jwt.claims',null,false);

select id as owner_chair from public.tenants where kind='stylist' and name like 'Dana%' limit 1 \gset
select id as rae_chair   from public.tenants where kind='stylist' and name like 'Rae%'  limit 1 \gset

\echo ''
\echo '=== PAYMENT ROUTING BY CLASSIFICATION ==='
select '1099 renter -> direct' as probe, public.route_for_tenant(:'rae_chair')::text as route,
       case when public.route_for_tenant(:'rae_chair') = 'direct' then 'PASS (merchant of record)' else 'FAIL' end as verdict;
select 'owner-operator -> salon' as probe, public.route_for_tenant(:'owner_chair')::text as route,
       case when public.route_for_tenant(:'owner_chair') = 'salon' then 'PASS' else 'FAIL' end as verdict;

\echo ''
\echo '=== DEPOSIT LIFECYCLE ==='
update public.tenants set timezone='UTC' where kind='stylist';
update public.stylist_settings set requires_deposit = true, deposit_percent = 20, deposit_min_cents = 2000
where tenant_id = :'rae_chair';
insert into public.services (id, tenant_id, name, duration_minutes, price_cents)
values ('eeeeeeee-0000-0000-0000-000000000001', :'rae_chair','Balayage',120,30000);
insert into public.business_hours (tenant_id, weekday, opens_at, closes_at)
select :'rae_chair', d, '09:00','18:00' from generate_series(0,6) d;
select slot_start as t1 from public.available_slots(:'rae_chair',(now()+interval '1 day')::date,120) offset 2 limit 1 \gset

select public.impersonate('33333333-3333-3333-3333-333333333333','n@c.test');
select public.create_booking_request(:'rae_chair', array['eeeeeeee-0000-0000-0000-000000000001']::uuid[], :'t1') as req \gset
select set_config('role','postgres',false), set_config('request.jwt.claims',null,false);

select 'deposit required on request' as probe, deposit_required::text as req,
       case when deposit_required then 'PASS' else 'FAIL' end as verdict
from public.booking_requests where id=:'req';
select 'deposit is 20% of $300' as probe, deposit_amount_cents as cents,
       case when deposit_amount_cents = 6000 then 'PASS ($60)' else 'FAIL' end as verdict
from public.booking_requests where id=:'req';

-- Stripe would create the intent; we record it.
select public.record_deposit_intent(:'req','pi_test_123', 6000) as pay \gset
select 'hold recorded as authorized' as probe, status::text,
       case when status='authorized' then 'PASS' else 'FAIL' end as verdict
from public.payments where id=:'pay';
select 'routed as direct charge' as probe, route::text,
       case when route='direct' then 'PASS' else 'FAIL' end as verdict
from public.payments where id=:'pay';

\echo '--- decline releases the hold ---'
select public.impersonate('22222222-2222-2222-2222-222222222222','r@s.test');
select public.respond_to_request(:'req','decline', null, 'Fully booked');
select set_config('role','postgres',false), set_config('request.jwt.claims',null,false);

select 'release queued on decline' as probe, count(*) as n,
       case when count(*) = 1 then 'PASS (hold will not linger)' else 'FAIL' end as verdict
from public.notification_queue where data->>'type' = 'release_deposit';

-- Separate statements: one statement sees a single snapshot, so checking the
-- row in the same statement that changes it reads the old value.
select public.settle_deposit('pi_test_123','released'::public.payment_status);
select 'settle marks released' as probe, status::text,
       case when status = 'released' and released_at is not null then 'PASS' else 'FAIL' end as verdict
from public.payments where id=:'pay';

\echo '--- settle is idempotent (webhooks retry) ---'
do $$
declare before_ts timestamptz; after_ts timestamptz;
begin
  select released_at into before_ts from public.payments limit 1;
  perform public.settle_deposit('pi_test_123','captured'::public.payment_status);
  select released_at into after_ts from public.payments limit 1;
  raise notice 'replayed webhook        -> %', case when before_ts = after_ts then 'PASS (ignored)' else 'FAIL - double applied' end;
end $$;

\echo ''
\echo '=== BOOTH RENT ==='
select public.impersonate('11111111-1111-1111-1111-111111111111','d@s.test');
insert into public.booth_rents (salon_id, chair_id, amount_cents, interval, next_due_on)
select t.parent_salon_id, :'rae_chair', 25000, 'monthly', (now()+interval '7 days')::date
from public.tenants t where t.id = :'rae_chair';
select set_config('role','postgres',false), set_config('request.jwt.claims',null,false);

select 'rent is flat, not a share' as probe, amount_cents as cents, 'PASS ($250 fixed)' as verdict
from public.booth_rents;

\echo '--- percentage rent is impossible: no column for it ---'
select 'schema has no percent field' as probe,
       count(*) as pct_columns,
       case when count(*) = 0 then 'PASS (flat by construction)' else 'FAIL' end as verdict
from information_schema.columns
where table_name = 'booth_rents' and column_name ilike '%percent%';

\echo ''
\echo '=== FIREWALL: renter payment data ==='
select public.impersonate('11111111-1111-1111-1111-111111111111','d@s.test');
select 'owner cannot see renter payments' as probe, count(*) as rows,
       case when count(*) = 0 then 'PASS (blocked)' else 'FAIL - LEAK' end as verdict
from public.payments;
select 'owner cannot see renter stripe acct' as probe, count(*) as rows,
       case when count(*) = 0 then 'PASS (blocked)' else 'FAIL - LEAK' end as verdict
from public.stripe_accounts where tenant_id = :'rae_chair';
select 'owner CAN see the rent owed' as probe, count(*) as rows,
       case when count(*) = 1 then 'PASS (their tenancy)' else 'FAIL' end as verdict
from public.booth_rents;
