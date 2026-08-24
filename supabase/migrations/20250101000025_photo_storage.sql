-- =============================================================================
-- CosmoCutie · Phase 5 · Photo storage
-- =============================================================================
-- `formula_photos` has existed since migration 5 with a `storage_path` column
-- and nowhere to point it. This creates the bucket, and — more importantly —
-- extends the tenant firewall to cover the objects themselves.
--
-- The firewall has to reach Storage, not just the table. A row in
-- `formula_photos` is already tenant-isolated, but the FILE lives in a
-- different subsystem with its own access rules. Without policies on
-- `storage.objects`, anyone holding a path could fetch another stylist's
-- client photos while the database row stayed perfectly private. Photos of
-- someone's hair, attached to their name and appointment, are exactly the kind
-- of thing the renter's book is supposed to protect.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- The bucket
-- -----------------------------------------------------------------------------
-- Private. There is no version of this that is safe to serve publicly: the
-- feed (Phase 8) will read published photos through a signed URL after checking
-- `consented_to_publish`, not by making the bucket world-readable.
--
-- The size limit is a backstop, not the strategy. Images are resized and
-- compressed on the device before upload (see the comment on `bytes` below);
-- this is what stops an un-compressed original getting through if that path is
-- ever bypassed.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'formula-photos',
  'formula-photos',
  false,
  2097152,  -- 2 MiB
  array['image/jpeg', 'image/webp', 'image/png']
)
on conflict (id) do update
set public             = false,
    file_size_limit    = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

-- -----------------------------------------------------------------------------
-- Tenant isolation on the objects themselves
-- -----------------------------------------------------------------------------
-- Path convention, and it is load-bearing:
--
--     {tenant_id}/{appointment_id}/{filename}
--
-- The first folder is the tenant, which is what every policy below keys on. A
-- path that does not start with one of the caller's tenants is unreadable and
-- unwritable. `record_formula_photo` enforces the same shape from the database
-- side so the row and the object can never disagree about who owns the file.
--
-- Deliberately NO admin carve-out, exactly as on `formula_photos` and
-- `client_records`. Administering a salon grants nothing inside a renter's
-- tenant, and a client's before/after photos are about as far inside it as it
-- gets.

create policy formula_photos_read on storage.objects
  for select to authenticated
  using (
    bucket_id = 'formula-photos'
    and (storage.foldername(name))[1] in (
      select t::text from public.current_tenant_ids() t
    )
  );

create policy formula_photos_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'formula-photos'
    and (storage.foldername(name))[1] in (
      select t::text from public.current_tenant_ids() t
    )
  );

create policy formula_photos_update on storage.objects
  for update to authenticated
  using (
    bucket_id = 'formula-photos'
    and (storage.foldername(name))[1] in (
      select t::text from public.current_tenant_ids() t
    )
  );

-- Deleting a photo is a real workflow: a client withdraws consent, or the
-- stylist took a bad shot. Scoped the same way as everything else.
create policy formula_photos_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'formula-photos'
    and (storage.foldername(name))[1] in (
      select t::text from public.current_tenant_ids() t
    )
  );

-- -----------------------------------------------------------------------------
-- What we keep about each image
-- -----------------------------------------------------------------------------
-- PLAN.md asks for a compression strategy decided HERE, not after the bill
-- arrives, so the numbers are written down rather than left implicit:
--
--   full image  longest edge 1600px, JPEG q0.70  → ~200–350 KB
--   thumbnail   longest edge  400px, JPEG q0.60  → ~20–40 KB
--
-- The arithmetic that motivates it: 1,000 clients × 3 photos an appointment ×
-- 4 appointments a year is 12,000 images. Straight off a modern phone camera
-- (3–5 MB each) that is ~50 GB a year. At the sizes above it is ~4 GB — the
-- difference between a storage tier nobody thinks about and one that becomes a
-- monthly conversation.
--
-- Resizing happens on the DEVICE, before upload. That is the only place it
-- saves bandwidth as well as storage, and it means the original never leaves
-- the phone.
alter table public.formula_photos
  add column if not exists thumbnail_path text,
  add column if not exists width          integer,
  add column if not exists height         integer,
  -- Recorded so storage growth is measurable from SQL instead of guessed at
  -- from the Supabase dashboard.
  add column if not exists bytes          integer,
  add column if not exists captured_at    timestamptz;

comment on column public.formula_photos.bytes is
  'Size of the stored full image. Kept so "how fast is storage growing" is a
   query rather than a guess — the Phase 5 cost risk PLAN.md flags.';

-- -----------------------------------------------------------------------------
-- Recording a photo
-- -----------------------------------------------------------------------------
-- The upload and the row are two separate operations against two different
-- subsystems, and nothing makes them agree by itself. This is the seam where
-- they get checked against each other: the path must live under a tenant the
-- caller belongs to, and must match the appointment it claims.
create or replace function public.record_formula_photo(
  p_appointment_id uuid,
  p_storage_path   text,
  p_stage          public.photo_stage,
  p_thumbnail_path text default null,
  p_width          integer default null,
  p_height         integer default null,
  p_bytes          integer default null,
  p_formula_id     uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  a          record;
  v_photo_id uuid;
  v_prefix   text;
begin
  select * into a from public.appointments where id = p_appointment_id;
  if a is null then raise exception 'no such appointment'; end if;

  -- SECURITY DEFINER bypasses RLS, so the tenant check is explicit.
  if a.tenant_id not in (select public.current_tenant_ids()) then
    raise exception 'not your appointment';
  end if;

  -- The path must sit under this appointment's tenant. Without this a stylist
  -- could file a row pointing at another tenant's object and read it back
  -- through their own gallery.
  v_prefix := a.tenant_id::text || '/' || p_appointment_id::text || '/';
  if p_storage_path is null or left(p_storage_path, length(v_prefix)) <> v_prefix then
    raise exception 'photo path must be under %', v_prefix;
  end if;
  if p_thumbnail_path is not null
     and left(p_thumbnail_path, length(v_prefix)) <> v_prefix then
    raise exception 'thumbnail path must be under %', v_prefix;
  end if;

  insert into public.formula_photos
    (tenant_id, appointment_id, formula_id, storage_path, thumbnail_path,
     stage, width, height, bytes, captured_at)
  values
    (a.tenant_id, p_appointment_id, p_formula_id, p_storage_path, p_thumbnail_path,
     p_stage, p_width, p_height, p_bytes, now())
  returning id into v_photo_id;

  return v_photo_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- Consent, and withdrawing it
-- -----------------------------------------------------------------------------
-- Per-photo and revocable, per the column comments from migration 5. Kept as a
-- function so the timestamps cannot drift out of step with the boolean.
create or replace function public.set_photo_publish_consent(
  p_photo_id uuid,
  p_consented boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare p record;
begin
  select * into p from public.formula_photos where id = p_photo_id;
  if p is null then raise exception 'no such photo'; end if;
  if p.tenant_id not in (select public.current_tenant_ids()) then
    raise exception 'not your photo';
  end if;

  update public.formula_photos
  set consented_to_publish = p_consented,
      consent_granted_at   = case when p_consented then now() else consent_granted_at end,
      -- Revocation is stamped and never cleared. If a photo is ever published
      -- again later, the record still shows it was once pulled down.
      consent_revoked_at   = case when p_consented then consent_revoked_at else now() end
  where id = p_photo_id;
end;
$$;

revoke all on function public.record_formula_photo(uuid, text, public.photo_stage, text, integer, integer, integer, uuid) from public;
grant execute on function public.record_formula_photo(uuid, text, public.photo_stage, text, integer, integer, integer, uuid) to authenticated;

revoke all on function public.set_photo_publish_consent(uuid, boolean) from public;
grant execute on function public.set_photo_publish_consent(uuid, boolean) to authenticated;
