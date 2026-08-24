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


-- The connected account the webhook will route against.
insert into public.stripe_accounts (tenant_id, stripe_account_id, details_submitted, charges_enabled, payouts_enabled)
values (:'rae_chair', 'acct_local_test', true, true, true);

\echo 'SEEDED'
select 'REQUEST_ID=' || id from public.booking_requests limit 1;
select 'DEPOSIT_CENTS=' || deposit_amount_cents from public.booking_requests limit 1;
