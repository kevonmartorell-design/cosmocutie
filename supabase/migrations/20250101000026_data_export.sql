-- =============================================================================
-- CosmoCutie · Phase 5 · Data export for booth renters
-- =============================================================================
-- PLAN.md's no-lock-in principle: a renter must be able to take everything they
-- own and leave. That is not a courtesy feature — a stylist whose client book
-- is trapped inside their landlord's app is a stylist whose landlord controls
-- their business, which is the behavioural-control problem the whole tenant
-- model exists to avoid.
--
-- The export is therefore scoped to the CALLER'S OWN tenant and nothing else.
-- A salon owner cannot export a renter's book: they are not a member of that
-- chair's tenant, so `current_tenant_ids()` does not contain it.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Somewhere to put a finished export
-- -----------------------------------------------------------------------------
-- An export file is the single most sensitive object in the system: one
-- download containing a renter's entire client book. Private, tenant-scoped,
-- and swept up afterwards (see `purge_stale_exports` below).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('data-exports', 'data-exports', false, 52428800,  -- 50 MiB
        array['application/json', 'text/csv'])
on conflict (id) do update
set public             = false,
    file_size_limit    = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

-- Same path convention and same reasoning as formula-photos:
-- {tenant_id}/{export_id}/{file}. The first folder is the tenant.
create policy data_exports_read on storage.objects
  for select to authenticated
  using (
    bucket_id = 'data-exports'
    and (storage.foldername(name))[1] in (select t::text from public.current_tenant_ids() t)
  );

create policy data_exports_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'data-exports'
    and (storage.foldername(name))[1] in (select t::text from public.current_tenant_ids() t)
  );

-- Writes come from the edge function as service_role, never from the app: the
-- client should not be able to put arbitrary files in a bucket whose name
-- implies they are an authoritative export.

-- -----------------------------------------------------------------------------
-- Everything one chair owns
-- -----------------------------------------------------------------------------
-- Assembled in SQL rather than by the edge function so the tenant check happens
-- once, next to the data, instead of being re-implemented per query.
create or replace function public.export_tenant_data(p_tenant_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare v_out jsonb;
begin
  -- SECURITY DEFINER bypasses RLS, so this is the only thing standing between
  -- a caller and another chair's entire client book.
  if p_tenant_id not in (select public.current_tenant_ids()) then
    raise exception 'you can only export your own chair';
  end if;

  select jsonb_build_object(
    'exported_at', now(),
    'tenant', (
      select jsonb_build_object('id', t.id, 'name', t.name, 'timezone', t.timezone)
      from public.tenants t where t.id = p_tenant_id
    ),

    -- The client book. This is the part that matters: names and contact
    -- details, so the stylist can still reach their own clients afterwards.
    'clients', coalesce((
      select jsonb_agg(jsonb_build_object(
        'client_record_id', cr.id,
        'name',             c.full_name,
        'phone',            c.phone,
        'email',            c.email,
        'first_seen_at',    cr.first_seen_at,
        'last_seen_at',     cr.last_seen_at,
        'visit_count',      cr.visit_count,
        'no_show_count',    cr.no_show_count,
        'safety_flag',      cr.safety_flag,
        'requires_prepay',  cr.requires_prepay,
        -- Structured tags, not free text — see PLAN.md's note on notes being
        -- where sensitive detail leaks.
        'tags', coalesce((
          select jsonb_agg(ct.tag order by ct.tag)
          from public.client_tags ct where ct.client_record_id = cr.id
        ), '[]'::jsonb)
      ) order by c.full_name)
      from public.client_records cr
      join public.clients c on c.id = cr.client_id
      where cr.tenant_id = p_tenant_id
    ), '[]'::jsonb),

    'appointments', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',           a.id,
        'starts_at',    a.starts_at,
        'ends_at',      a.ends_at,
        'status',       a.status,
        'client',       c.full_name,
        'total_cents',  a.total_price_cents,
        'is_for_child', a.is_for_child,
        'child_first_name', a.child_first_name,
        'services', coalesce((
          select jsonb_agg(jsonb_build_object('name', s.name, 'price_cents', x.price_cents))
          from public.appointment_services x
          join public.services s on s.id = x.service_id
          where x.appointment_id = a.id
        ), '[]'::jsonb)
      ) order by a.starts_at desc)
      from public.appointments a
      left join public.clients c on c.id = a.client_id
      where a.tenant_id = p_tenant_id
    ), '[]'::jsonb),

    -- The Digital Colour Bar. Reproducing a formula months later is the whole
    -- point of having recorded it, and that has to survive leaving.
    'formulas', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',                f.id,
        'appointment_id',    f.appointment_id,
        'created_at',        f.created_at,
        'components',        f.components,
        'developer_volume',  f.developer_volume,
        'processing_time_minutes', f.processing_time_minutes,
        'technique_notes',   f.technique_notes
      ) order by f.created_at desc)
      from public.formulas f where f.tenant_id = p_tenant_id
    ), '[]'::jsonb),

    -- Metadata only. The image files are listed separately by the edge
    -- function, which can sign a URL for each one.
    'photos', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',             p.id,
        'appointment_id', p.appointment_id,
        'stage',          p.stage,
        'storage_path',   p.storage_path,
        'captured_at',    p.captured_at,
        'consented_to_publish', p.consented_to_publish
      ) order by p.captured_at)
      from public.formula_photos p where p.tenant_id = p_tenant_id
    ), '[]'::jsonb),

    -- Signed consents are the stylist's own liability record. They would be
    -- mad to leave without them.
    'consents', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',               k.id,
        'appointment_id',   k.appointment_id,
        'kind',             k.kind,
        'signed_by_name',   k.signed_by_name,
        'signed_at',        k.signed_at,
        'document_version', k.document_version
      ) order by k.signed_at desc)
      from public.consents k where k.tenant_id = p_tenant_id
    ), '[]'::jsonb),

    'payments', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',           y.id,
        'kind',         y.kind,
        'status',       y.status,
        'amount_cents', y.amount_cents,
        'tip_cents',    y.tip_cents,
        'created_at',   y.created_at
      ) order by y.created_at desc)
      from public.payments y where y.tenant_id = p_tenant_id
    ), '[]'::jsonb)
  ) into v_out;

  return v_out;
end;
$$;

-- -----------------------------------------------------------------------------
-- Exports do not linger
-- -----------------------------------------------------------------------------
-- A finished export is a client book sitting in a bucket. Useful for an hour,
-- a liability for a year — so it is swept daily and the stylist re-runs the
-- export if they need it again.
create or replace function public.purge_stale_exports()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare v_count integer;
begin
  with gone as (
    delete from storage.objects
    where bucket_id = 'data-exports'
      and created_at < now() - interval '7 days'
    returning 1
  )
  select count(*) into v_count from gone;
  return v_count;
end;
$$;

select cron.schedule(
  'purge-stale-exports',
  '30 3 * * *',
  $$ select public.purge_stale_exports(); $$
);

revoke all on function public.export_tenant_data(uuid) from public;
grant execute on function public.export_tenant_data(uuid) to authenticated, service_role;
revoke all on function public.purge_stale_exports() from public;
grant execute on function public.purge_stale_exports() to service_role;
