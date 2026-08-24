-- =============================================================================
-- chair_occupants — the owner learns WHO, and still nothing else
-- =============================================================================
-- This function is SECURITY DEFINER, so it bypasses RLS entirely and its WHERE
-- clause is the only thing standing between a caller and every profile in the
-- database. It therefore gets adversarial probes, not a happy path.
-- =============================================================================
\set QUIET on
\pset pager off

create or replace function public.impersonate(uid uuid, em text) returns void
language plpgsql as $$
begin
  perform set_config('role','authenticated',false);
  perform set_config('request.jwt.claims', json_build_object('sub',uid,'role','authenticated','email',em)::text, false);
end $$;

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_user_meta_data)
values ('11111111-1111-1111-1111-111111111111','00000000-0000-0000-0000-000000000000','authenticated','authenticated','d@s.test','x',now(),'{"full_name":"Dana Owner"}'),
       ('22222222-2222-2222-2222-222222222222','00000000-0000-0000-0000-000000000000','authenticated','authenticated','r@s.test','x',now(),'{"full_name":"Rae Chen"}'),
       ('33333333-3333-3333-3333-333333333333','00000000-0000-0000-0000-000000000000','authenticated','authenticated','n@c.test','x',now(),'{"full_name":"Nina Client"}'),
       ('44444444-4444-4444-4444-444444444444','00000000-0000-0000-0000-000000000000','authenticated','authenticated','mal@x.test','x',now(),'{"full_name":"Mallory"}');

select public.impersonate('11111111-1111-1111-1111-111111111111','d@s.test');
select public.create_salon('Salon','UTC');
select public.invite_stylist('Rae Chen','r@s.test','contractor_1099', 25000);
select set_config('role','postgres',false), set_config('request.jwt.claims',null,false);
select public.impersonate('22222222-2222-2222-2222-222222222222','r@s.test');
select public.claim_stylist_invitation();
select set_config('role','postgres',false), set_config('request.jwt.claims',null,false);

select id as chair from public.tenants where kind='stylist' and name like 'Rae%' limit 1 \gset

-- Some of the renter's actual business, to prove none of it comes along.
insert into public.services (tenant_id, name, duration_minutes, price_cents)
values (:'chair','Balayage',120,30000);
insert into public.clients (profile_id, full_name)
values ('33333333-3333-3333-3333-333333333333','Nina Client');
insert into public.client_records (tenant_id, client_id)
select :'chair', id from public.clients limit 1;
insert into public.payments (tenant_id, kind, status, amount_cents)
values (:'chair','service','captured',30000);
insert into public.billing_methods (tenant_id, stripe_customer_id, payment_method_id, brand, last4)
values (:'chair','cus_rae','pm_rae','visa','4242');

\echo ''
\echo '=== FIXTURE: the renter has real business to leak ==='
-- Checked as postgres. Without this the "blocked" verdicts below would pass
-- just as happily against empty tables, which is a false pass and exactly the
-- kind of test that quietly stops testing anything.
select 'renter has a client record' as probe, count(*) as n,
       case when count(*) = 1 then 'PASS (there is something to hide)' else 'FAIL - fixture did not land' end as verdict
from public.client_records;
select 'renter has a payment' as probe, count(*) as n,
       case when count(*) = 1 then 'PASS' else 'FAIL - fixture did not land' end as verdict
from public.payments;
select 'renter has a saved rent card' as probe, count(*) as n,
       case when count(*) = 1 then 'PASS' else 'FAIL - fixture did not land' end as verdict
from public.billing_methods;

\echo ''
\echo '=== THE BUG: the owner could not name the occupant ==='
select public.impersonate('11111111-1111-1111-1111-111111111111','d@s.test');

select 'owner sees the occupant''s name' as probe, full_name,
       case when full_name = 'Rae Chen' then 'PASS' else 'FAIL - still shows Unoccupied' end as verdict
from public.chair_occupants() where tenant_id = :'chair';

select 'and their classification' as probe, classification::text,
       case when classification = 'contractor_1099' then 'PASS' else 'FAIL' end as verdict
from public.chair_occupants() where tenant_id = :'chair';

select 'the owner''s own chair is listed too' as probe, count(*) as n,
       case when count(*) = 2 then 'PASS (both chairs)' else 'FAIL' end as verdict
from public.chair_occupants();

\echo ''
\echo '=== AND STILL NOTHING ELSE ==='
-- The point of the whole tenant model. Administering a salon grants the name of
-- the person in the chair and no part of their business.
select 'renter''s clients' as probe, count(*) as rows,
       case when count(*) = 0 then 'PASS (blocked)' else 'FAIL - LEAK' end as verdict
from public.client_records;
select 'renter''s payments' as probe, count(*) as rows,
       case when count(*) = 0 then 'PASS (blocked)' else 'FAIL - LEAK' end as verdict
from public.payments;
select 'renter''s formulas' as probe, count(*) as rows,
       case when count(*) = 0 then 'PASS (blocked)' else 'FAIL - LEAK' end as verdict
from public.formulas;
select 'renter''s rent card' as probe, count(*) as rows,
       case when count(*) = 0 then 'PASS (blocked)' else 'FAIL - LEAK' end as verdict
from public.billing_methods;

\echo '--- and no contact details rode along with the name ---'
-- RLS is row-level, so a policy on `profiles` wide enough to show the name
-- would have exposed phone and email on the same row. A function returns only
-- the columns it names.
select 'profiles row is still unreadable' as probe, count(*) as rows,
       case when count(*) = 0 then 'PASS (name came from the function alone)' else 'FAIL' end as verdict
from public.profiles where id = '22222222-2222-2222-2222-222222222222';

select 'the function exposes no contact columns' as probe, count(*) as cols,
       case when count(*) = 0 then 'PASS' else 'FAIL - contact details leaked' end as verdict
from information_schema.routines r
join information_schema.parameters p on p.specific_name = r.specific_name
where r.routine_name = 'chair_occupants'
  and p.parameter_name in ('phone','email','avatar_url');
select set_config('role','postgres',false), set_config('request.jwt.claims',null,false);

\echo ''
\echo '=== ADVERSARIAL: it is SECURITY DEFINER, so who else can call it? ==='
-- A renter is not an admin of anything, so administered_child_tenant_ids() is
-- empty for them and the function returns nothing. If this ever returns rows,
-- every stylist can enumerate their neighbours.
select public.impersonate('22222222-2222-2222-2222-222222222222','r@s.test');
select 'a renter calling it' as probe, count(*) as rows,
       case when count(*) = 0 then 'PASS (not an admin)' else 'FAIL - LEAK: renters see each other' end as verdict
from public.chair_occupants();
select set_config('role','postgres',false), set_config('request.jwt.claims',null,false);

select public.impersonate('33333333-3333-3333-3333-333333333333','n@c.test');
select 'a client calling it' as probe, count(*) as rows,
       case when count(*) = 0 then 'PASS (blocked)' else 'FAIL - LEAK' end as verdict
from public.chair_occupants();
select set_config('role','postgres',false), set_config('request.jwt.claims',null,false);

select public.impersonate('44444444-4444-4444-4444-444444444444','mal@x.test');
select 'a stranger with no membership' as probe, count(*) as rows,
       case when count(*) = 0 then 'PASS (blocked)' else 'FAIL - LEAK' end as verdict
from public.chair_occupants();
select set_config('role','postgres',false), set_config('request.jwt.claims',null,false);

select set_config('role','anon',false);
do $$
declare v_n integer;
begin
  select count(*) into v_n from public.chair_occupants();
  raise notice 'anonymous caller        -> %', case when v_n = 0 then 'PASS (no session, no rows)' else 'FAIL - LEAK' end;
exception when insufficient_privilege then
  raise notice 'anonymous caller        -> PASS (refused at the grant layer)';
end $$;
select set_config('role','postgres',false);

\echo ''
\echo '=== AN OFFBOARDED RENTER DROPS OFF THE LIST ==='
-- The chair becomes genuinely unoccupied, which is what the screen should say.
update public.tenant_members set is_active = false
where tenant_id = :'chair' and role = 'stylist';

select public.impersonate('11111111-1111-1111-1111-111111111111','d@s.test');
select 'offboarded renter is not listed' as probe, count(*) as rows,
       case when count(*) = 0 then 'PASS (chair reads as empty)' else 'FAIL' end as verdict
from public.chair_occupants() where tenant_id = :'chair';
select set_config('role','postgres',false), set_config('request.jwt.claims',null,false);
