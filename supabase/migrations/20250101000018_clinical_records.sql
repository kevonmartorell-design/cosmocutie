-- =============================================================================
-- CosmoCutie · Phase 5 · Clinical records and consent
-- =============================================================================
-- Governing principle (PLAN.md → Sensitive Data Policy): collect the minimum.
-- Store consent DECISIONS and OUTCOMES, never medical histories. The safest
-- health data is the health data never collected — which is also why there is
-- no free-text medical field anywhere in this schema.
-- =============================================================================

alter table public.stylist_settings
  -- How long a patch test stays good. Industry practice is a fresh test per
  -- colour appointment, but stylists differ, so it is theirs to set.
  add column if not exists patch_test_valid_days integer not null default 180,
  add column if not exists patch_test_min_hours_before integer not null default 48;

alter table public.consents
  add column if not exists valid_until timestamptz;

-- -----------------------------------------------------------------------------
-- patch_test_status — is this client cleared for a chemical service?
-- -----------------------------------------------------------------------------
create or replace function public.patch_test_status(
  p_tenant_id uuid,
  p_client_record_id uuid
)
returns table (is_valid boolean, tested_at timestamptz, expires_at timestamptz, result text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare v_days integer;
begin
  select coalesce(patch_test_valid_days, 180) into v_days
  from public.stylist_settings where tenant_id = p_tenant_id;
  v_days := coalesce(v_days, 180);

  return query
  select
    -- A recorded reaction is never "valid": it is a positive finding, and
    -- treating it as clearance would be exactly backwards.
    (c.result = 'pass' and c.signed_at + make_interval(days => v_days) > now()),
    c.signed_at,
    c.signed_at + make_interval(days => v_days),
    c.result::text
  from public.consents c
  where c.tenant_id = p_tenant_id
    and c.client_record_id = p_client_record_id
    and c.kind = 'patch_test'
  order by c.signed_at desc
  limit 1;
end;
$$;

-- -----------------------------------------------------------------------------
-- record_consent — the only way a consent is written
-- -----------------------------------------------------------------------------
-- Note what this signature does NOT accept: no medications, no conditions, no
-- pregnancy field. Contraindication screening is a boolean outcome. The stylist
-- still asks every question and still has the conversation; the answers simply
-- do not need a database row.
create or replace function public.record_consent(
  p_client_record_id uuid,
  p_kind public.consent_kind,
  p_signed_by_name text,
  p_document_version text,
  p_appointment_id uuid default null,
  p_product_tested text default null,
  p_result public.patch_test_result default null,
  p_contraindications_disclosed boolean default null,
  p_proceeded boolean default null,
  p_signed_by_guardian boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant uuid;
  v_id     uuid;
  v_days   integer;
begin
  select tenant_id into v_tenant from public.client_records where id = p_client_record_id;
  if v_tenant is null then raise exception 'no such client record'; end if;
  if v_tenant not in (select public.current_tenant_ids()) then
    raise exception 'not your client';
  end if;
  if coalesce(trim(p_signed_by_name), '') = '' then
    raise exception 'a signature name is required';
  end if;

  select coalesce(patch_test_valid_days, 180) into v_days
  from public.stylist_settings where tenant_id = v_tenant;

  insert into public.consents
    (tenant_id, client_record_id, appointment_id, kind,
     product_tested, result, contraindications_disclosed, proceeded,
     signed_by_name, signed_by_guardian, document_version, valid_until)
  values
    (v_tenant, p_client_record_id, p_appointment_id, p_kind,
     p_product_tested, p_result, p_contraindications_disclosed, p_proceeded,
     trim(p_signed_by_name), coalesce(p_signed_by_guardian,false), p_document_version,
     case when p_kind = 'patch_test'
          then now() + make_interval(days => coalesce(v_days,180)) end)
  returning id into v_id;

  return v_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- Checkout is the enforcement point for patch tests
-- -----------------------------------------------------------------------------
-- Not booking: a patch test must happen BEFORE the appointment, so it cannot be
-- a precondition of making one. Checkout is the last moment the service is
-- known to have happened, which makes it the right place to refuse.
create or replace function public.appointment_needs_patch_test(p_appointment_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  a          record;
  v_required boolean;
  v_valid    boolean;
begin
  select * into a from public.appointments where id = p_appointment_id;
  if a is null then return false; end if;

  select exists (
    select 1 from public.appointment_services x
    join public.services s on s.id = x.service_id
    where x.appointment_id = p_appointment_id and s.requires_patch_test
  ) into v_required;

  if not v_required then return false; end if;

  select ps.is_valid into v_valid
  from public.patch_test_status(a.tenant_id, a.client_record_id) ps;

  return not coalesce(v_valid, false);
end;
$$;

create or replace function public.record_checkout(
  p_appointment_id uuid,
  p_tip_cents integer default 0
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  a            record;
  v_total      integer;
  v_payment_id uuid;
begin
  select * into a from public.appointments where id = p_appointment_id;
  if a is null then raise exception 'no such appointment'; end if;
  if a.tenant_id not in (select public.current_tenant_ids()) then
    raise exception 'only the stylist can check out an appointment';
  end if;

  -- Refusing here is the point: a chemical service with no valid patch test on
  -- file is the exact scenario the record exists to defend against.
  if public.appointment_needs_patch_test(p_appointment_id) then
    raise exception 'a valid patch test is required before completing this service';
  end if;

  select coalesce(sum(price_cents), 0) into v_total
  from public.appointment_services where appointment_id = p_appointment_id;

  v_total := v_total - coalesce((
    select sum(amount_cents) from public.payments
    where appointment_id = p_appointment_id and kind = 'deposit' and status = 'captured'
  ), 0);

  insert into public.payments
    (tenant_id, appointment_id, client_id, kind, status,
     amount_cents, tip_cents, route)
  values
    (a.tenant_id, p_appointment_id, a.client_id, 'service', 'authorized',
     greatest(v_total, 0), coalesce(p_tip_cents, 0), public.route_for_tenant(a.tenant_id))
  returning id into v_payment_id;

  update public.appointments
  set status = 'completed', service_ended_at = coalesce(service_ended_at, now())
  where id = p_appointment_id;

  update public.client_records
  set visit_count = visit_count + 1, last_seen_at = now()
  where id = a.client_record_id;

  return v_payment_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- export_my_book — the no-lock-in promise, made executable
-- -----------------------------------------------------------------------------
-- A renter owns their book, and ownership that cannot be exercised is not
-- ownership. This is what makes the claim real rather than rhetorical.
create or replace function public.export_my_book(p_tenant_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_tenant_id not in (select public.current_tenant_ids()) then
    raise exception 'not your book';
  end if;

  return jsonb_build_object(
    'exported_at', now(),
    'clients', coalesce((
      select jsonb_agg(jsonb_build_object(
        'name', cl.full_name, 'phone', cl.phone, 'email', cl.email,
        'first_seen', cr.first_seen_at, 'last_seen', cr.last_seen_at,
        'visits', cr.visit_count, 'safety_flag', cr.safety_flag,
        'tags', coalesce((select jsonb_agg(t.tag) from public.client_tags t
                          where t.client_record_id = cr.id), '[]'::jsonb)
      ))
      from public.client_records cr
      join public.clients cl on cl.id = cr.client_id
      where cr.tenant_id = p_tenant_id
    ), '[]'::jsonb),
    'appointments', coalesce((
      select jsonb_agg(jsonb_build_object(
        'when', a.starts_at, 'status', a.status, 'total_cents', a.total_price_cents
      ))
      from public.appointments a where a.tenant_id = p_tenant_id
    ), '[]'::jsonb),
    -- Formulas are the crown jewels of a colourist's book. An export without
    -- them would be worthless.
    'formulas', coalesce((
      select jsonb_agg(jsonb_build_object(
        'at', f.created_at, 'components', f.components,
        'developer_volume', f.developer_volume,
        'processing_minutes', f.processing_time_minutes,
        'notes', f.technique_notes
      ))
      from public.formulas f where f.tenant_id = p_tenant_id
    ), '[]'::jsonb),
    'consents', coalesce((
      select jsonb_agg(jsonb_build_object(
        'kind', c.kind, 'signed_at', c.signed_at,
        'signed_by', c.signed_by_name, 'result', c.result
      ))
      from public.consents c where c.tenant_id = p_tenant_id
    ), '[]'::jsonb)
  );
end;
$$;

grant execute on function public.patch_test_status(uuid, uuid)              to authenticated;
grant execute on function public.record_consent(uuid, public.consent_kind, text, text, uuid, text, public.patch_test_result, boolean, boolean, boolean) to authenticated;
grant execute on function public.appointment_needs_patch_test(uuid)         to authenticated;
grant execute on function public.export_my_book(uuid)                       to authenticated;
