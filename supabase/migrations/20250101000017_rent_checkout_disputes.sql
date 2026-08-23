-- =============================================================================
-- CosmoCutie · Phase 4 · Rent collection, checkout, chargeback evidence
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Booth rent: raise a charge when it falls due
-- -----------------------------------------------------------------------------
-- Creates the payment row and advances the schedule. Actually moving the money
-- is the edge function's job; this decides that it is owed.
create or replace function public.raise_due_booth_rents()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer := 0;
  r       record;
begin
  for r in
    select * from public.booth_rents
    where is_active and next_due_on <= current_date
  loop
    -- Rent is owed BY the chair TO the salon, so the payment is recorded
    -- against the chair's tenant: it is their outgoing, not the salon's income
    -- from a client.
    insert into public.payments
      (tenant_id, kind, status, amount_cents, route)
    values
      (r.chair_id, 'booth_rent', 'authorized', r.amount_cents, 'direct');

    update public.booth_rents
    set next_due_on = case interval
          when 'weekly'   then next_due_on + 7
          when 'biweekly' then next_due_on + 14
          else (next_due_on + interval '1 month')::date
        end
    where id = r.id;

    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

select cron.schedule(
  'raise-due-booth-rents',
  '0 9 * * *',   -- once a day; rent is a daily-granularity concern
  $$ select public.raise_due_booth_rents(); $$
);

-- -----------------------------------------------------------------------------
-- Checkout
-- -----------------------------------------------------------------------------
-- Records what is owed at the end of a service. Tip is stored as its own
-- figure rather than folded into the total, because tips are reported
-- separately at tax time and folding them in loses that.
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

  select coalesce(sum(price_cents), 0) into v_total
  from public.appointment_services where appointment_id = p_appointment_id;

  -- A captured deposit is money already taken; it comes off the balance rather
  -- than being charged twice.
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
-- Chargeback evidence
-- -----------------------------------------------------------------------------
-- Assembles what actually rebuts a dispute. Every element is something the app
-- already captured for its own reasons — which is the point: the evidence is a
-- by-product of running the business properly, not extra paperwork.
create or replace function public.dispute_evidence(p_appointment_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  a        record;
  evidence jsonb;
begin
  select * into a from public.appointments where id = p_appointment_id;
  if a is null then return null; end if;
  if a.tenant_id not in (select public.current_tenant_ids()) then
    raise exception 'not your appointment';
  end if;

  select jsonb_build_object(
    'appointment', jsonb_build_object(
      'id', a.id,
      'scheduled_for', a.starts_at,
      'status', a.status,
      'total_cents', a.total_price_cents
    ),
    -- Proof the client was physically present, and when.
    'attendance', jsonb_build_object(
      'arrived_at', a.arrived_at,
      'service_started_at', a.service_started_at,
      'service_ended_at', a.service_ended_at
    ),
    'services', coalesce((
      select jsonb_agg(jsonb_build_object('name', s.name, 'price_cents', x.price_cents))
      from public.appointment_services x
      join public.services s on s.id = x.service_id
      where x.appointment_id = a.id
    ), '[]'::jsonb),
    -- The negotiation thread: a timestamped record, visible to both parties,
    -- of the time they agreed to.
    'agreement', coalesce((
      select jsonb_agg(jsonb_build_object(
        'at', e.created_at, 'actor', e.actor, 'action', e.action,
        'proposed', e.proposed_starts_at, 'note', e.note
      ) order by e.created_at)
      from public.negotiation_events e
      join public.booking_requests br on br.id = e.request_id
      where br.appointment_id = a.id
    ), '[]'::jsonb),
    -- Signed consent is the strongest single item: the client's own signature
    -- against a named document version.
    'consents', coalesce((
      select jsonb_agg(jsonb_build_object(
        'kind', c.kind, 'signed_by', c.signed_by_name,
        'signed_at', c.signed_at, 'document_version', c.document_version
      ))
      from public.consents c where c.appointment_id = a.id
    ), '[]'::jsonb),
    'policy_shown', jsonb_build_object(
      'cancellation_outcome', a.cancellation_outcome,
      'fee_cents', a.cancellation_fee_cents
    )
  ) into evidence;

  return evidence;
end;
$$;

grant execute on function public.raise_due_booth_rents()                to authenticated;
grant execute on function public.record_checkout(uuid, integer)         to authenticated;
grant execute on function public.dispute_evidence(uuid)                 to authenticated;
