-- =============================================================================
-- Phase 5b — photo records, paths, and consent
-- =============================================================================
-- The storage OBJECTS are tested separately over real HTTP in
-- storage_e2e_test.mjs, because policies on `storage.objects` are enforced by
-- the storage service and cannot be proven from psql alone. This suite covers
-- the database half: who may file a photo row, and where it may point.
-- =============================================================================
\set QUIET on
\pset pager off

create or replace function public.impersonate(uid uuid, em text) returns void
language plpgsql as $$
begin
  perform set_config('role','authenticated',false);
  perform set_config('request.jwt.claims', json_build_object('sub',uid,'role','authenticated','email',em)::text, false);
end $$;

create or replace function public.try_record_photo(p_appt uuid, p_path text)
returns text language plpgsql as $fn$
begin
  perform public.record_formula_photo(p_appt, p_path, 'after'::public.photo_stage);
  return 'ALLOWED';
exception when others then return 'REFUSED: ' || sqlerrm;
end $fn$;

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

select id as rae_chair   from public.tenants where kind='stylist' and name like 'Rae%'  limit 1 \gset
select id as dana_chair  from public.tenants where kind='stylist' and name like 'Dana%' limit 1 \gset

update public.tenants set timezone='UTC' where kind='stylist';
insert into public.services (id, tenant_id, name, duration_minutes, price_cents)
values ('eeeeeeee-0000-0000-0000-000000000001', :'rae_chair','Balayage',120,30000);
insert into public.business_hours (tenant_id, weekday, opens_at, closes_at)
select :'rae_chair', d, '09:00','18:00' from generate_series(0,6) d;
select slot_start as t1 from public.available_slots(:'rae_chair',(now()+interval '1 day')::date,120) offset 2 limit 1 \gset

select public.impersonate('33333333-3333-3333-3333-333333333333','n@c.test');
select public.create_booking_request(:'rae_chair', array['eeeeeeee-0000-0000-0000-000000000001']::uuid[], :'t1') as req \gset
select set_config('role','postgres',false), set_config('request.jwt.claims',null,false);
select public.impersonate('22222222-2222-2222-2222-222222222222','r@s.test');
select public.respond_to_request(:'req','accept', null, null);
select set_config('role','postgres',false), set_config('request.jwt.claims',null,false);

select id as appt from public.appointments limit 1 \gset

\echo ''
\echo '=== THE BUCKET IS PRIVATE ==='
-- There is no version of a public bucket that is safe here: these are photos of
-- identifiable people attached to a named appointment.
select 'bucket exists and is private' as probe, public::text,
       case when public = false then 'PASS' else 'FAIL - world readable' end as verdict
from storage.buckets where id = 'formula-photos';

select 'only images may be uploaded' as probe, array_length(allowed_mime_types,1) as kinds,
       case when allowed_mime_types @> array['image/jpeg'] and not (allowed_mime_types @> array['application/pdf'])
            then 'PASS (images only)' else 'FAIL' end as verdict
from storage.buckets where id = 'formula-photos';

select 'a size backstop exists' as probe, file_size_limit,
       case when file_size_limit is not null and file_size_limit <= 4194304
            then 'PASS (compression is the strategy, this is the guard)' else 'FAIL' end as verdict
from storage.buckets where id = 'formula-photos';

\echo ''
\echo '=== A PHOTO ROW MUST POINT INSIDE ITS OWN TENANT ==='
select public.impersonate('22222222-2222-2222-2222-222222222222','r@s.test');

select 'stylist files a photo on their own appointment' as probe,
       case when public.try_record_photo(:'appt', :'rae_chair' || '/' || :'appt' || '/a.jpg') = 'ALLOWED'
            then 'PASS' else 'FAIL' end as verdict;

-- The attack this blocks: file a row that points at somebody else's object,
-- then read it back through your own gallery. The row would look like yours.
select 'path pointing at ANOTHER tenant' as probe,
       case when public.try_record_photo(:'appt', :'dana_chair' || '/' || :'appt' || '/steal.jpg') like 'REFUSED%'
            then 'PASS (blocked)' else 'FAIL - LEAK: row points outside the tenant' end as verdict;

select 'path with no tenant folder at all' as probe,
       case when public.try_record_photo(:'appt', 'loose.jpg') like 'REFUSED%'
            then 'PASS (blocked)' else 'FAIL' end as verdict;

select 'path under the right tenant but wrong appointment' as probe,
       case when public.try_record_photo(:'appt', :'rae_chair' || '/00000000-0000-0000-0000-000000000000/x.jpg') like 'REFUSED%'
            then 'PASS (blocked)' else 'FAIL' end as verdict;
select set_config('role','postgres',false), set_config('request.jwt.claims',null,false);

\echo ''
\echo '=== THE OWNER CANNOT SEE A RENTER''S PHOTOS ==='
-- Same rule as client_records: administering a salon grants nothing inside a
-- renter's tenant, and photos of their clients are as far inside as it gets.
select public.impersonate('11111111-1111-1111-1111-111111111111','d@s.test');
select 'owner reads renter photo rows' as probe, count(*) as rows,
       case when count(*) = 0 then 'PASS (blocked)' else 'FAIL - LEAK' end as verdict
from public.formula_photos;

select 'owner files a photo on a renter appointment' as probe,
       case when public.try_record_photo(:'appt', :'dana_chair' || '/' || :'appt' || '/x.jpg') like 'REFUSED%'
            then 'PASS (not their appointment)' else 'FAIL' end as verdict;
select set_config('role','postgres',false), set_config('request.jwt.claims',null,false);

\echo ''
\echo '=== CONSENT IS PER PHOTO AND REVOCABLE ==='
select id as photo from public.formula_photos limit 1 \gset

select 'defaults to NOT publishable' as probe, consented_to_publish::text,
       case when consented_to_publish = false then 'PASS (opt in, never opt out)' else 'FAIL' end as verdict
from public.formula_photos where id=:'photo';

select public.impersonate('22222222-2222-2222-2222-222222222222','r@s.test');
select public.set_photo_publish_consent(:'photo', true);
select set_config('role','postgres',false), set_config('request.jwt.claims',null,false);
select 'granting stamps the time' as probe, consent_granted_at is not null as stamped,
       case when consented_to_publish and consent_granted_at is not null then 'PASS' else 'FAIL' end as verdict
from public.formula_photos where id=:'photo';

select public.impersonate('22222222-2222-2222-2222-222222222222','r@s.test');
select public.set_photo_publish_consent(:'photo', false);
select set_config('role','postgres',false), set_config('request.jwt.claims',null,false);
select 'revoking is stamped and permanent' as probe, consent_revoked_at is not null as stamped,
       case when not consented_to_publish and consent_revoked_at is not null and consent_granted_at is not null
            then 'PASS (the grant is still on record)' else 'FAIL' end as verdict
from public.formula_photos where id=:'photo';

\echo '--- a stranger cannot flip somebody else''s consent ---'
create or replace function public.try_consent(p_photo uuid) returns text
language plpgsql as $fn$
begin
  perform public.set_photo_publish_consent(p_photo, true);
  return 'ALLOWED';
exception when others then return 'REFUSED: ' || sqlerrm;
end $fn$;

select public.impersonate('11111111-1111-1111-1111-111111111111','d@s.test');
select 'owner publishes a renter photo' as probe,
       case when public.try_consent(:'photo') like 'REFUSED%'
            then 'PASS (blocked)' else 'FAIL - LEAK: could publish a client''s photo' end as verdict;
select set_config('role','postgres',false), set_config('request.jwt.claims',null,false);
