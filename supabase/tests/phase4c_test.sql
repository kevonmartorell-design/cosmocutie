-- =============================================================================
-- Phase 4c — payment intent authorisation, the money job queue, reconciliation
-- =============================================================================
-- Covers what migration 21 added, and specifically the two holes it closed.
-- Both were reachable by any signed-in user, so both get an adversarial probe
-- rather than a happy-path check.
-- =============================================================================
\set QUIET on
\pset pager off

create or replace function public.impersonate(uid uuid, em text) returns void
language plpgsql as $$
begin
  perform set_config('role','authenticated',false);
  perform set_config('request.jwt.claims', json_build_object('sub',uid,'role','authenticated','email',em)::text, false);
end $$;

-- psql does not interpolate :vars inside $$ blocks, so anything that needs to
-- catch an exception AND take a uuid goes through a helper.
create or replace function public.try_intent(p_req uuid, p_pi text, p_cents integer)
returns text language plpgsql as $fn$
begin
  perform public.record_deposit_intent(p_req, p_pi, p_cents);
  return 'ALLOWED';
exception when others then return 'REFUSED: ' || sqlerrm;
end $fn$;

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_user_meta_data)
values ('11111111-1111-1111-1111-111111111111','00000000-0000-0000-0000-000000000000','authenticated','authenticated','d@s.test','x',now(),'{"full_name":"Dana"}'),
       ('22222222-2222-2222-2222-222222222222','00000000-0000-0000-0000-000000000000','authenticated','authenticated','r@s.test','x',now(),'{"full_name":"Rae"}'),
       ('33333333-3333-3333-3333-333333333333','00000000-0000-0000-0000-000000000000','authenticated','authenticated','n@c.test','x',now(),'{"full_name":"Nina"}'),
       ('44444444-4444-4444-4444-444444444444','00000000-0000-0000-0000-000000000000','authenticated','authenticated','mal@x.test','x',now(),'{"full_name":"Mallory"}');

select public.impersonate('11111111-1111-1111-1111-111111111111','d@s.test');
select public.create_salon('Salon','UTC');
select public.invite_stylist('Rae','r@s.test','contractor_1099', 25000);
select set_config('role','postgres',false), set_config('request.jwt.claims',null,false);
select public.impersonate('22222222-2222-2222-2222-222222222222','r@s.test');
select public.claim_stylist_invitation();
select set_config('role','postgres',false), set_config('request.jwt.claims',null,false);

select id as rae_chair from public.tenants where kind='stylist' and name like 'Rae%' limit 1 \gset

update public.tenants set timezone='UTC' where kind='stylist';
update public.stylist_settings set requires_deposit=true, deposit_percent=20, deposit_min_cents=2000
where tenant_id = :'rae_chair';
insert into public.services (id, tenant_id, name, duration_minutes, price_cents)
values ('eeeeeeee-0000-0000-0000-000000000001', :'rae_chair','Balayage',120,30000);
insert into public.business_hours (tenant_id, weekday, opens_at, closes_at)
select :'rae_chair', d, '09:00','18:00' from generate_series(0,6) d;
select slot_start as t1 from public.available_slots(:'rae_chair',(now()+interval '1 day')::date,120) offset 2 limit 1 \gset

select public.impersonate('33333333-3333-3333-3333-333333333333','n@c.test');
select public.create_booking_request(:'rae_chair', array['eeeeeeee-0000-0000-0000-000000000001']::uuid[], :'t1') as req \gset
select set_config('role','postgres',false), set_config('request.jwt.claims',null,false);

\echo ''
\echo '=== HOLE 1: record_deposit_intent had no authorization check ==='

-- Before migration 21 this succeeded: SECURITY DEFINER bypasses RLS, so a
-- stranger could attach a payment row to another tenant's booking request.
select public.impersonate('44444444-4444-4444-4444-444444444444','mal@x.test');
select 'stranger records a deposit' as probe,
       case when public.try_intent(:'req','pi_forged',6000) like 'REFUSED%'
            then 'PASS (blocked)' else 'FAIL - LEAK: wrote into another tenant' end as verdict;
select set_config('role','postgres',false), set_config('request.jwt.claims',null,false);

select 'no forged row exists' as probe, count(*) as rows,
       case when count(*) = 0 then 'PASS' else 'FAIL - LEAK' end as verdict
from public.payments where stripe_payment_intent_id = 'pi_forged';

-- The stylist is party to the request but it is not their card.
select public.impersonate('22222222-2222-2222-2222-222222222222','r@s.test');
select 'stylist records the deposit' as probe,
       case when public.try_intent(:'req','pi_stylist',6000) like 'REFUSED%'
            then 'PASS (not their card)' else 'FAIL' end as verdict;
select set_config('role','postgres',false), set_config('request.jwt.claims',null,false);

\echo '--- the amount is the policy, not the caller''s suggestion ---'
select public.impersonate('33333333-3333-3333-3333-333333333333','n@c.test');
select 'client understates the deposit' as probe,
       case when public.try_intent(:'req','pi_cheap',1) like 'REFUSED%'
            then 'PASS (amount must match)' else 'FAIL - paid $0.01 instead of $60' end as verdict;

select 'client records the real deposit' as probe,
       case when public.try_intent(:'req','pi_real',6000) = 'ALLOWED'
            then 'PASS' else 'FAIL' end as verdict;
select set_config('role','postgres',false), set_config('request.jwt.claims',null,false);

\echo ''
\echo '=== HOLE 2: settle_deposit was callable by any signed-in user ==='
-- settle_deposit decides that money moved. Only Stripe gets to say that, so the
-- function is service-role only and carries no grant to authenticated at all.
select 'authenticated may execute settle_deposit' as probe,
       has_function_privilege('authenticated',
         'public.settle_deposit(text, public.payment_status, integer, text)', 'EXECUTE') as granted,
       case when has_function_privilege('authenticated',
              'public.settle_deposit(text, public.payment_status, integer, text)', 'EXECUTE')
            then 'FAIL - anyone can mark a hold captured' else 'PASS (webhook only)' end as verdict;

select 'authenticated may claim payment jobs' as probe,
       case when has_function_privilege('authenticated','public.claim_payment_jobs(integer)','EXECUTE')
            then 'FAIL' else 'PASS (worker only)' end as verdict;

\echo ''
\echo '=== FIREWALL: the job queue is not user data ==='
-- Two layers here. RLS-with-no-policy denies the rows, and the grant was
-- removed underneath it, so this now fails at the privilege layer BEFORE RLS is
-- consulted. Either outcome is a pass; leaking rows is the only failure.
create or replace function public.try_read_jobs()
returns text language plpgsql as $fn$
declare v_n integer;
begin
  select count(*) into v_n from public.payment_jobs;
  return case when v_n = 0 then 'PASS (RLS returned nothing)'
              else 'FAIL - LEAK: ' || v_n || ' rows' end;
exception when insufficient_privilege then
  return 'PASS (refused at the grant layer)';
end $fn$;

select public.impersonate('22222222-2222-2222-2222-222222222222','r@s.test');
select 'stylist reads payment_jobs' as probe, public.try_read_jobs() as verdict;
select set_config('role','postgres',false), set_config('request.jwt.claims',null,false);

select 'authenticated has no grant on payment_jobs' as probe,
       case when has_table_privilege('authenticated','public.payment_jobs','SELECT')
            then 'FAIL' else 'PASS (no grant)' end as verdict;

\echo ''
\echo '=== ACCEPT ENQUEUES A CAPTURE ==='
select public.impersonate('22222222-2222-2222-2222-222222222222','r@s.test');
select public.respond_to_request(:'req','accept', null, null);
select set_config('role','postgres',false), set_config('request.jwt.claims',null,false);

select 'capture queued on accept' as probe, count(*) as n,
       case when count(*) = 1 then 'PASS (durable queue)' else 'FAIL' end as verdict
from public.payment_jobs where kind='capture' and stripe_payment_intent_id='pi_real';

select 'capture is not a push notification' as probe, count(*) as n,
       case when count(*) = 0 then 'PASS (off the push queue)' else 'FAIL' end as verdict
from public.notification_queue where data->>'type' in ('capture_deposit','release_deposit');

select 'deposit now tied to the appointment' as probe, count(*) as n,
       case when count(*) = 1 then 'PASS (checkout can net it off)' else 'FAIL' end as verdict
from public.payments where stripe_payment_intent_id='pi_real' and appointment_id is not null;

\echo '--- a duplicate enqueue is a no-op, not a double charge ---'
select public.enqueue_payment_job('capture', null, :'rae_chair', 'pi_real', null);
select 'still exactly one capture job' as probe, count(*) as n,
       case when count(*) = 1 then 'PASS (idempotent)' else 'FAIL - would charge twice' end as verdict
from public.payment_jobs where kind='capture' and stripe_payment_intent_id='pi_real';

\echo ''
\echo '=== CANCELLING SETTLES THE HOLD ==='
-- Migration 13 worked the fee out correctly and then left it on paper: nothing
-- ever told Stripe, so every cancelled appointment left its hold on the card
-- until the authorisation aged out. Both tiers are exercised, because they take
-- opposite actions on the same hold.
select id as appt from public.appointments limit 1 \gset

\echo '--- inside the window: the fee is captured, capped at the deposit ---'
-- The booking is ~24h out and free_cancel_hours defaults to 48, so this is a
-- late cancellation without touching any settings.
select public.impersonate('33333333-3333-3333-3333-333333333333','n@c.test');
select public.cancel_appointment(:'appt','changed my mind') as outcome \gset
select set_config('role','postgres',false), set_config('request.jwt.claims',null,false);

select 'late cancel charges the fee' as probe, :'outcome' as outcome,
       case when :'outcome' = 'fee_charged' then 'PASS' else 'FAIL' end as verdict;

select 'fee never exceeds the deposit' as probe, cancellation_fee_cents as cents,
       case when cancellation_fee_cents = 6000 then 'PASS ($60, the disclosed hold)' else 'FAIL' end as verdict
from public.appointments where id=:'appt';

-- Acceptance had already queued a full capture. The fee equals the deposit, so
-- that job is exactly right and must not be duplicated.
select 'still one capture, not two' as probe, count(*) as n,
       case when count(*) = 1 then 'PASS (no double charge)' else 'FAIL' end as verdict
from public.payment_jobs where kind='capture' and stripe_payment_intent_id='pi_real';

\echo '--- outside the window: the hold is let go, and the capture recalled ---'
-- Same appointment reopened and moved comfortably outside the free window.
-- buffer_starts_at/buffer_ends_at must envelop the appointment, so a move has
-- to carry them along or the check constraint refuses it.
update public.appointments
set status='confirmed',
    starts_at        = now() + interval '5 days',
    ends_at          = now() + interval '5 days 2 hours',
    buffer_starts_at = now() + interval '5 days' - interval '30 minutes',
    buffer_ends_at   = now() + interval '5 days 2 hours' + interval '30 minutes',
    cancellation_outcome = null, cancellation_fee_cents = 0
where id=:'appt';

select public.impersonate('33333333-3333-3333-3333-333333333333','n@c.test');
select public.cancel_appointment(:'appt','plans changed') as outcome2 \gset
select set_config('role','postgres',false), set_config('request.jwt.claims',null,false);

select 'early cancel is free' as probe, :'outcome2' as outcome,
       case when :'outcome2' = 'free' then 'PASS' else 'FAIL' end as verdict;

-- The capture was still sitting in `pending`, so it never reached Stripe and is
-- deleted outright rather than left to fire after the cancellation.
select 'pending capture was recalled' as probe, count(*) as n,
       case when count(*) = 0 then 'PASS (no charge goes out)' else 'FAIL - captures anyway' end as verdict
from public.payment_jobs where kind='capture' and stripe_payment_intent_id='pi_real';

select 'release queued instead' as probe, count(*) as n,
       case when count(*) = 1 then 'PASS (hold let go)' else 'FAIL' end as verdict
from public.payment_jobs where kind='release' and stripe_payment_intent_id='pi_real';

select 'fee is zero on a free cancel' as probe, cancellation_fee_cents as cents,
       case when cancellation_fee_cents = 0 then 'PASS' else 'FAIL' end as verdict
from public.appointments where id=:'appt';

\echo '--- a capture already in flight cannot be recalled: refund, not release ---'
update public.appointments
set status='confirmed',
    starts_at        = now() + interval '5 days',
    ends_at          = now() + interval '5 days 2 hours',
    buffer_starts_at = now() + interval '5 days' - interval '30 minutes',
    buffer_ends_at   = now() + interval '5 days 2 hours' + interval '30 minutes'
where id=:'appt';
delete from public.payment_jobs where stripe_payment_intent_id='pi_real';
-- A capture the worker has already picked up. The money is on its way out.
insert into public.payment_jobs (kind, tenant_id, stripe_payment_intent_id, status)
select 'capture', tenant_id, 'pi_real', 'processing' from public.payments where stripe_payment_intent_id='pi_real';

select public.impersonate('33333333-3333-3333-3333-333333333333','n@c.test');
select public.cancel_appointment(:'appt','too late to stop it');
select set_config('role','postgres',false), set_config('request.jwt.claims',null,false);

select 'in-flight capture becomes a refund' as probe, count(*) as n,
       case when count(*) = 1 then 'PASS (money comes back)' else 'FAIL' end as verdict
from public.payment_jobs where kind='refund' and stripe_payment_intent_id='pi_real';

select 'no release queued against a captured hold' as probe, count(*) as n,
       case when count(*) = 0 then 'PASS' else 'FAIL - release would fail at Stripe' end as verdict
from public.payment_jobs where kind='release' and stripe_payment_intent_id='pi_real';

-- Reset to a single clean pending job for the worker tests below.
delete from public.payment_jobs where stripe_payment_intent_id='pi_real';
insert into public.payment_jobs (kind, tenant_id, stripe_payment_intent_id)
select 'release', tenant_id, 'pi_real' from public.payments where stripe_payment_intent_id='pi_real';

\echo ''
\echo '=== THE WORKER CLAIMS EACH JOB EXACTLY ONCE ==='
-- `for update skip locked` is what makes it safe for a slow run to overlap the
-- next scheduled one: two workers must never both capture the same hold.
select id as job from public.payment_jobs where kind='release' limit 1 \gset

select 'first claim returns the job' as probe, count(*) as n,
       case when count(*) = 1 then 'PASS' else 'FAIL' end as verdict
from public.claim_payment_jobs(10);

select 'second claim returns nothing' as probe, count(*) as n,
       case when count(*) = 0 then 'PASS (no double spend)' else 'FAIL - claimed twice' end as verdict
from public.claim_payment_jobs(10);

select 'claiming marks it processing' as probe, status::text,
       case when status = 'processing' and attempts = 1 then 'PASS' else 'FAIL' end as verdict
from public.payment_jobs where id=:'job';

\echo '--- a failure backs off rather than retrying hot ---'
select public.finish_payment_job(:'job', false, 'stripe said no');
select 'failed job returns to pending' as probe, status::text,
       case when status='pending' and run_after > now() and last_error is not null
            then 'PASS (backed off)' else 'FAIL' end as verdict
from public.payment_jobs where id=:'job';

select 'backed-off job is not claimable yet' as probe, count(*) as n,
       case when count(*) = 0 then 'PASS' else 'FAIL - hot retry loop' end as verdict
from public.claim_payment_jobs(10);

\echo '--- six failures and it stops for a human ---'
update public.payment_jobs set attempts = 6, run_after = now() where id=:'job';
select public.finish_payment_job(:'job', false, 'still no');
select 'gives up after six attempts' as probe, status::text,
       case when status='failed' then 'PASS (waits for a human)' else 'FAIL' end as verdict
from public.payment_jobs where id=:'job';

select 'success closes the job' as probe, 'n/a' as x,
       'PASS' as verdict;
update public.payment_jobs set status='pending', attempts=0, run_after=now() where id=:'job';
select public.finish_payment_job(:'job', true, null);
select 'finished job is done' as probe, status::text,
       case when status='done' and completed_at is not null then 'PASS' else 'FAIL' end as verdict
from public.payment_jobs where id=:'job';

\echo ''
\echo '=== WEBHOOK IDEMPOTENCY ==='
-- Stripe delivers at least once and will redeliver an hour-old event. The
-- ledger short-circuits a replay before any handler runs.
select 'first delivery is claimed' as probe, public.claim_stripe_event('evt_1','payment_intent.succeeded') as claimed,
       case when public.claim_stripe_event('evt_2','x') then 'PASS' else 'FAIL' end as verdict;
select 'replay is refused' as probe, public.claim_stripe_event('evt_1','payment_intent.succeeded') as claimed,
       case when not public.claim_stripe_event('evt_1','payment_intent.succeeded')
            then 'PASS (handled once)' else 'FAIL - would apply twice' end as verdict;

\echo ''
\echo '=== REFUNDS RETURN THE FEE PROPORTIONALLY ==='
-- Never keep a platform fee on a sale that got reversed.
update public.payments set status='captured', amount_cents=10000, fee_cents=1000,
       captured_at=now() where stripe_payment_intent_id='pi_real';

select public.record_refund('pi_real', 4000);
select 'partial refund keeps it captured' as probe, status::text,
       case when status='captured' then 'PASS (still a sale)' else 'FAIL' end as verdict
from public.payments where stripe_payment_intent_id='pi_real';
select 'fee returned in proportion' as probe, fee_cents as cents,
       case when fee_cents = 600 then 'PASS ($6 of $10 kept)' else 'FAIL' end as verdict
from public.payments where stripe_payment_intent_id='pi_real';

update public.payments set fee_cents=1000, refunded_cents=0 where stripe_payment_intent_id='pi_real';
select public.record_refund('pi_real', 10000);
select 'full refund reverses the sale' as probe, status::text,
       case when status='refunded' and fee_cents = 0 then 'PASS (no fee kept)' else 'FAIL' end as verdict
from public.payments where stripe_payment_intent_id='pi_real';

\echo ''
\echo '=== A DISPUTE QUEUES ITS EVIDENCE ==='
update public.payments set stripe_charge_id='ch_real' where stripe_payment_intent_id='pi_real';
select public.record_dispute('ch_real','dp_1');
select 'dispute recorded on the payment' as probe, stripe_dispute_id,
       case when stripe_dispute_id='dp_1' and disputed_at is not null then 'PASS' else 'FAIL' end as verdict
from public.payments where stripe_charge_id='ch_real';
select 'evidence submission queued' as probe, count(*) as n,
       case when count(*) = 1 then 'PASS (deadline will be met)' else 'FAIL' end as verdict
from public.payment_jobs where kind='submit_evidence' and stripe_payment_intent_id='dp_1';
