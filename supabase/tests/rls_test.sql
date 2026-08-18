\set QUIET on
\pset pager off
\set ON_ERROR_STOP on

-- Impersonate an authenticated user the way PostgREST does: assume the
-- `authenticated` role and set the JWT claims RLS reads via auth.uid().
create or replace function public.impersonate(uid uuid) returns void
language plpgsql as $$
begin
  perform set_config('role','authenticated',true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role','authenticated')::text, true);
end $$;

\echo ''
\echo '=========================================================='
\echo ' ADVERSARIAL RLS TESTS'
\echo ' Dana = salon ADMIN + stylist on her own chair'
\echo ' Rae  = 1099 renter. Her book must be unreachable by Dana.'
\echo '=========================================================='
\echo ''

-- ---------------------------------------------------------------- DANA
begin;
select public.impersonate('11111111-1111-1111-1111-111111111111');

\echo '--- Dana (admin + stylist), attempting to read Rae''s data ---'
select 'client_records visible to Dana' as probe, count(*) as rows,
       case when count(*) = 1 then 'PASS (only her own)' else 'FAIL' end as verdict
from public.client_records;

select 'Rae''s client_records reachable' as probe, count(*) as rows,
       case when count(*) = 0 then 'PASS (blocked)' else 'FAIL — LEAK' end as verdict
from public.client_records where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000003';

select 'Rae''s formulas reachable' as probe, count(*) as rows,
       case when count(*) = 0 then 'PASS (blocked)' else 'FAIL — LEAK' end as verdict
from public.formulas;

select 'Rae''s revenue reachable' as probe, coalesce(sum(amount_cents),0) as cents,
       case when coalesce(sum(amount_cents),0) = 0 then 'PASS (blocked)' else 'FAIL — LEAK' end as verdict
from public.payments;

select 'Rae''s appointments reachable' as probe, count(*) as rows,
       case when count(*) = 0 then 'PASS (blocked)' else 'FAIL — LEAK' end as verdict
from public.appointments;

select 'Rae''s client tags reachable' as probe, count(*) as rows,
       case when count(*) = 0 then 'PASS (blocked)' else 'FAIL — LEAK' end as verdict
from public.client_tags;

\echo ''
\echo '--- Dana CAN see facility structure (chairs exist), not contents ---'
select 'tenants Dana can enumerate' as probe, count(*) as rows,
       case when count(*) = 3 then 'PASS (salon + 2 chairs)' else 'FAIL' end as verdict
from public.tenants;
rollback;

-- ---------------------------------------------------------------- RAE
begin;
select public.impersonate('22222222-2222-2222-2222-222222222222');
\echo '--- Rae (1099 renter) ---'
select 'Rae sees her own book' as probe, count(*) as rows,
       case when count(*) = 1 then 'PASS' else 'FAIL' end as verdict
from public.client_records;

select 'Rae reaching Dana''s chair' as probe, count(*) as rows,
       case when count(*) = 0 then 'PASS (blocked)' else 'FAIL — LEAK' end as verdict
from public.client_records where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000002';

select 'Rae sees her own formula' as probe, count(*) as rows,
       case when count(*) = 1 then 'PASS' else 'FAIL' end as verdict
from public.formulas;
rollback;

-- ---------------------------------------------------------------- WES
begin;
select public.impersonate('33333333-3333-3333-3333-333333333333');
\echo '--- Wes (W-2, works under the salon tenant) ---'
select 'Wes reaching Rae''s book' as probe, count(*) as rows,
       case when count(*) = 0 then 'PASS (blocked)' else 'FAIL — LEAK' end as verdict
from public.client_records where tenant_id = 'aaaaaaaa-0000-0000-0000-000000000003';
rollback;

-- ---------------------------------------------------------------- NINA
begin;
select public.impersonate('44444444-4444-4444-4444-444444444444');
\echo '--- Nina (client, books with BOTH stylists) ---'
select 'Nina sees both her own records' as probe, count(*) as rows,
       case when count(*) = 2 then 'PASS (one per stylist)' else 'FAIL' end as verdict
from public.client_records;

select 'Nina reaching stylists'' formulas' as probe, count(*) as rows,
       case when count(*) = 0 then 'PASS (blocked)' else 'FAIL — LEAK' end as verdict
from public.formulas;

select 'Nina sees her own appointment' as probe, count(*) as rows,
       case when count(*) = 1 then 'PASS' else 'FAIL' end as verdict
from public.appointments;
rollback;

-- ---------------------------------------------------------------- ANON
begin;
select set_config('role','anon',true);
select set_config('request.jwt.claims', null, true);
\echo '--- Anonymous (no login) ---'
-- anon has no GRANT on these tables at all, so access fails before RLS is even
-- consulted. Defence in depth: the grant is the outer door, RLS the inner one.
do $$
declare blocked boolean;
begin
  begin
    perform 1 from public.client_records;
    blocked := false;
  exception when insufficient_privilege then
    blocked := true;
  end;
  raise notice 'anon reading client_records -> %', case when blocked then 'PASS (no grant)' else 'FAIL - LEAK' end;

  begin
    perform 1 from public.clients;
    blocked := false;
  exception when insufficient_privilege then
    blocked := true;
  end;
  raise notice 'anon reading clients        -> %', case when blocked then 'PASS (no grant)' else 'FAIL - LEAK' end;

  begin
    perform 1 from public.formulas;
    blocked := false;
  exception when insufficient_privilege then
    blocked := true;
  end;
  raise notice 'anon reading formulas       -> %', case when blocked then 'PASS (no grant)' else 'FAIL - LEAK' end;
end $$;

-- The catalogue IS meant to be browsable before signup.
select 'anon browsing services' as probe, count(*) as rows,
       case when count(*) = 2 then 'PASS (catalogue public)' else 'FAIL' end as verdict
from public.services;
rollback;

-- ------------------------------------------------- DOUBLE-BOOKING SAFEGUARD
\echo ''
\echo '--- Overlap exclusion constraint (the two-people-one-chair guard) ---'
do $$
declare blocked boolean;
begin
  begin
    -- Overlaps Rae's existing 14:00-17:00 booking (buffer 13:30-17:30).
    insert into public.appointments
      (tenant_id, stylist_id, client_id, client_record_id,
       starts_at, ends_at, buffer_starts_at, buffer_ends_at)
    values
      ('aaaaaaaa-0000-0000-0000-000000000003','22222222-2222-2222-2222-222222222222',
       'cccccccc-0000-0000-0000-000000000001','dddddddd-0000-0000-0000-000000000002',
       '2026-09-01 16:00+00','2026-09-01 16:45+00','2026-09-01 15:30+00','2026-09-01 17:15+00');
    blocked := false;
  exception when exclusion_violation then
    blocked := true;
  end;
  raise notice 'overlapping appointment     -> %', case when blocked then 'PASS (refused by DB)' else 'FAIL - DOUBLE BOOKED' end;

  -- Butting up against the buffer edge must still be refused.
  begin
    insert into public.appointments
      (tenant_id, stylist_id, client_id, client_record_id,
       starts_at, ends_at, buffer_starts_at, buffer_ends_at)
    values
      ('aaaaaaaa-0000-0000-0000-000000000003','22222222-2222-2222-2222-222222222222',
       'cccccccc-0000-0000-0000-000000000001','dddddddd-0000-0000-0000-000000000002',
       '2026-09-01 17:20+00','2026-09-01 18:00+00','2026-09-01 17:00+00','2026-09-01 18:30+00');
    blocked := false;
  exception when exclusion_violation then
    blocked := true;
  end;
  raise notice 'booking inside buffer gap   -> %', case when blocked then 'PASS (buffer enforced)' else 'FAIL - BUFFER IGNORED' end;

  -- Clear of the buffer entirely: must succeed.
  begin
    insert into public.appointments
      (tenant_id, stylist_id, client_id, client_record_id,
       starts_at, ends_at, buffer_starts_at, buffer_ends_at)
    values
      ('aaaaaaaa-0000-0000-0000-000000000003','22222222-2222-2222-2222-222222222222',
       'cccccccc-0000-0000-0000-000000000001','dddddddd-0000-0000-0000-000000000002',
       '2026-09-01 18:30+00','2026-09-01 19:00+00','2026-09-01 18:00+00','2026-09-01 19:30+00');
    blocked := false;
  exception when exclusion_violation then
    blocked := true;
  end;
  raise notice 'non-overlapping booking     -> %', case when blocked then 'FAIL - wrongly refused' else 'PASS (allowed)' end;
end $$;

-- ------------------------------------------------- NEGOTIATION CAPS
\echo ''
\echo '--- Negotiation guard rails ---'
do $$
declare blocked boolean;
begin
  begin
    insert into public.booking_requests
      (tenant_id, stylist_id, client_id, client_record_id,
       proposed_starts_at, proposed_ends_at, global_deadline, step_deadline,
       stylist_offers_used)
    values
      ('aaaaaaaa-0000-0000-0000-000000000003','22222222-2222-2222-2222-222222222222',
       'cccccccc-0000-0000-0000-000000000001','dddddddd-0000-0000-0000-000000000002',
       now(), now() + interval '1 hour', now() + interval '48 hours', now() + interval '12 hours',
       3);
    blocked := false;
  exception when check_violation then
    blocked := true;
  end;
  raise notice '3rd stylist counter-offer   -> %', case when blocked then 'PASS (capped at 2)' else 'FAIL - cap not enforced' end;
end $$;
