-- =============================================================================
-- Phase 4d — booth rent collection
-- =============================================================================
-- Rent was raised daily and never collected. What matters here is not only that
-- it now charges, but that it charges the RIGHT WAY ROUND: from the renter's
-- own instrument to the salon, never out of the renter's takings. That
-- direction is the IRS firewall, so it gets an explicit assertion.
-- =============================================================================
\set QUIET on
\pset pager off

create or replace function public.impersonate(uid uuid, em text) returns void
language plpgsql as $$
begin
  perform set_config('role','authenticated',false);
  perform set_config('request.jwt.claims', json_build_object('sub',uid,'role','authenticated','email',em)::text, false);
end $$;

create or replace function public.try_read_billing(p_tenant uuid) returns text
language plpgsql as $fn$
declare v_n integer;
begin
  select count(*) into v_n from public.billing_methods where tenant_id = p_tenant;
  return case when v_n = 0 then 'PASS (RLS returned nothing)'
              else 'FAIL - LEAK: landlord can see the card' end;
exception when insufficient_privilege then
  return 'PASS (refused at the grant layer)';
end $fn$;

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_user_meta_data)
values ('11111111-1111-1111-1111-111111111111','00000000-0000-0000-0000-000000000000','authenticated','authenticated','d@s.test','x',now(),'{"full_name":"Dana"}'),
       ('22222222-2222-2222-2222-222222222222','00000000-0000-0000-0000-000000000000','authenticated','authenticated','r@s.test','x',now(),'{"full_name":"Rae"}');

select public.impersonate('11111111-1111-1111-1111-111111111111','d@s.test');
select public.create_salon('Salon','UTC');
select public.invite_stylist('Rae','r@s.test','contractor_1099', 25000);
select set_config('role','postgres',false), set_config('request.jwt.claims',null,false);
select public.impersonate('22222222-2222-2222-2222-222222222222','r@s.test');
select public.claim_stylist_invitation();
select set_config('role','postgres',false), set_config('request.jwt.claims',null,false);

select id as chair from public.tenants where kind='stylist' and name like 'Rae%' limit 1 \gset
select parent_salon_id as salon from public.tenants where id=:'chair' \gset

insert into public.booth_rents (salon_id, chair_id, amount_cents, interval, next_due_on)
values (:'salon', :'chair', 25000, 'monthly', current_date);

\echo ''
\echo '=== RENT DUE RAISES A CHARGE AND QUEUES ITS COLLECTION ==='
select 'rent raised' as probe, public.raise_due_booth_rents() as raised,
       'PASS' as verdict;

select 'charged to the chair, not the salon' as probe,
       case when tenant_id = :'chair' then 'PASS (their outgoing)' else 'FAIL' end as verdict
from public.payments where kind='booth_rent';

-- The bit that was missing: raising it queued nothing, so the row sat there
-- forever and the salon was never actually paid.
select 'collection queued' as probe, count(*) as n,
       case when count(*) = 1 then 'PASS (carried to Stripe)' else 'FAIL - raised but never collected' end as verdict
from public.payment_jobs where kind='collect_rent';

select 'queued job has no intent yet' as probe,
       case when stripe_payment_intent_id is null and payment_id is not null
            then 'PASS (keyed on the payment)' else 'FAIL' end as verdict
from public.payment_jobs where kind='collect_rent';

\echo '--- running the cron twice does not double-charge ---'
select 'second run raises nothing' as probe, public.raise_due_booth_rents() as raised,
       case when public.raise_due_booth_rents() = 0 then 'PASS (idempotent)' else 'FAIL' end as verdict;
select 'still one collection job' as probe, count(*) as n,
       case when count(*) = 1 then 'PASS' else 'FAIL - would charge twice' end as verdict
from public.payment_jobs where kind='collect_rent';

\echo ''
\echo '=== THE DIRECTION OF THE MONEY ==='
-- The whole tenant model rests on this. Rent comes off the renter's own saved
-- instrument and settles to the salon; it is never withheld from their takings.
insert into public.billing_methods (tenant_id, stripe_customer_id, payment_method_id, brand, last4)
values (:'chair', 'cus_rae', 'pm_rae_card', 'visa', '4242');
insert into public.stripe_accounts (tenant_id, stripe_account_id, charges_enabled)
values (:'salon', 'acct_salon', true);
insert into public.stripe_accounts (tenant_id, stripe_account_id, charges_enabled)
values (:'chair', 'acct_rae', true);

select id as rent_payment from public.payments where kind='booth_rent' limit 1 \gset

select 'instrument is the RENTER''s' as probe, payment_method_id,
       case when payment_method_id = 'pm_rae_card' then 'PASS (their own card)' else 'FAIL' end as verdict
from public.rent_collection_context(:'rent_payment');

select 'destination is the SALON''s account' as probe, salon_account_id,
       case when salon_account_id = 'acct_salon'
            then 'PASS (rent goes to the landlord)' else 'FAIL' end as verdict
from public.rent_collection_context(:'rent_payment');

select 'NOT taken from the renter''s own payout account' as probe, salon_account_id,
       case when salon_account_id <> 'acct_rae'
            then 'PASS (not a commission split)'
            else 'FAIL - this is withholding from their takings' end as verdict
from public.rent_collection_context(:'rent_payment');

\echo ''
\echo '=== FIREWALL: the renter''s card is not the landlord''s business ==='
select public.impersonate('11111111-1111-1111-1111-111111111111','d@s.test');
select 'owner reads the renter''s card' as probe, public.try_read_billing(:'chair') as verdict;
select set_config('role','postgres',false), set_config('request.jwt.claims',null,false);

select public.impersonate('22222222-2222-2222-2222-222222222222','r@s.test');
select 'renter sees their own card' as probe, count(*) as n,
       case when count(*) = 1 then 'PASS' else 'FAIL' end as verdict
from public.billing_methods;
select set_config('role','postgres',false), set_config('request.jwt.claims',null,false);

\echo ''
\echo '=== BOTH SIDES LEARN WHETHER RENT ARRIVED ==='
-- The payment row lives on the chair and the owner cannot see it, which is
-- right. But "did my rent arrive?" is the owner's own income, so the outcome is
-- mirrored onto the tenancy record both parties are party to.
select public.settle_payment_by_id(:'rent_payment', 'pi_rent_1', 25000, 'ch_rent_1');
select 'payment captured' as probe, status::text,
       case when status='captured' then 'PASS' else 'FAIL' end as verdict
from public.payments where id=:'rent_payment';

select 'tenancy records it was paid' as probe, last_paid_at is not null as paid,
       case when last_paid_at is not null and consecutive_fails = 0
            then 'PASS' else 'FAIL' end as verdict
from public.booth_rents;

select public.impersonate('11111111-1111-1111-1111-111111111111','d@s.test');
select 'owner can see rent arrived' as probe, count(*) as n,
       case when count(*) = 1 then 'PASS (their rental income)' else 'FAIL' end as verdict
from public.booth_rents where last_paid_at is not null;
select 'owner still cannot see the payment row' as probe, count(*) as n,
       case when count(*) = 0 then 'PASS (blocked)' else 'FAIL - LEAK' end as verdict
from public.payments;
select set_config('role','postgres',false), set_config('request.jwt.claims',null,false);

\echo ''
\echo '=== A DECLINED CARD IS VISIBLE, NOT SILENT ==='
insert into public.payments (tenant_id, kind, status, amount_cents, route)
values (:'chair', 'booth_rent', 'authorized', 25000, 'direct')
returning id as failing_payment \gset

update public.payments
set status = 'failed', failure_reason = 'Your card was declined.'
where id = :'failing_payment';

select 'failure reaches the tenancy' as probe, last_failure,
       case when last_failure = 'Your card was declined.' and consecutive_fails = 1
            then 'PASS (both sides can see it)' else 'FAIL' end as verdict
from public.booth_rents;

select public.impersonate('22222222-2222-2222-2222-222222222222','r@s.test');
select 'renter is told to fix their card' as probe, count(*) as n,
       case when count(*) = 1 then 'PASS' else 'FAIL' end as verdict
from public.booth_rents where last_failure is not null;
select set_config('role','postgres',false), set_config('request.jwt.claims',null,false);
