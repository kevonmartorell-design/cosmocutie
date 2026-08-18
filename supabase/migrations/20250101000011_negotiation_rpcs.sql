-- =============================================================================
-- CosmoCutie · Phase 3 · Booking negotiation state machine
-- =============================================================================
--   1. Client requests Time A
--   2. Stylist  → Accept / Decline / Reschedule (B)
--   3. Client   → Accept / Cancel  / Counter    (C)
--   4. Stylist  → Accept / Decline / Reschedule (D)
--   5. Client   → Accept / Cancel  / Counter    (E)
--   6. Stylist  → Accept / Decline              (FINAL, binary)
--
-- Two counter-offers per side; the stylist always closes. The caps are what
-- produce that shape: at step 6 the stylist has spent both offers, so
-- "reschedule" is unavailable and only accept/decline remain.
--
-- Timing: 48h global cap, 12h per step, whichever expires first. Under 2h
-- remaining, a new round is not started — a "you have 7 minutes" notification
-- is worse than a clean expiry.
-- =============================================================================

-- Requested services live on the request until it is accepted. They cannot go
-- into appointment_services yet: that table requires an appointment_id, and no
-- appointment exists until someone says yes.
alter table public.booking_requests
  add column if not exists service_ids uuid[] not null default '{}';

create or replace function public.step_deadline_for(p_global timestamptz)
returns timestamptz
language sql immutable
as $$
  select least(now() + interval '12 hours', p_global);
$$;

-- -----------------------------------------------------------------------------
-- create_booking_request — the client opens with Time A
-- -----------------------------------------------------------------------------
create or replace function public.create_booking_request(
  p_tenant_id   uuid,
  p_service_ids uuid[],
  p_starts_at   timestamptz,
  p_note        text default null,
  p_is_for_child boolean default false,
  p_child_name  text default null,
  p_child_age   smallint default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller        uuid := (select auth.uid());
  the_client    uuid;
  the_record    uuid;
  stylist       uuid;
  total_minutes integer;
  total_cents   integer;
  ends_at       timestamptz;
  global_dl     timestamptz;
  req_id        uuid;
  needs_deposit boolean;
  deposit_cents integer;
begin
  if caller is null then raise exception 'must be signed in'; end if;
  if p_service_ids is null or array_length(p_service_ids, 1) is null then
    raise exception 'pick at least one service';
  end if;

  -- Multi-service: duration and price are the sum, snapshotted at request time.
  select sum(s.duration_minutes), sum(s.price_cents)
  into total_minutes, total_cents
  from public.services s
  where s.id = any(p_service_ids) and s.tenant_id = p_tenant_id and s.is_active;

  if total_minutes is null then raise exception 'those services are not available'; end if;

  ends_at := p_starts_at + make_interval(mins => total_minutes);

  -- The slot must still be free. Checked here rather than trusted from the
  -- client, because the list they saw may be seconds stale.
  if not exists (
    select 1 from public.available_slots(p_tenant_id, (p_starts_at at time zone 'UTC')::date, total_minutes) s
    where s.slot_start = p_starts_at
  ) then
    raise exception 'that time is no longer available';
  end if;

  select id into the_client from public.clients where profile_id = caller;
  if the_client is null then
    insert into public.clients (profile_id, full_name, email)
    select caller, coalesce(nullif(trim(p.full_name),''),'Client'), p.email
    from public.profiles p where p.id = caller
    returning id into the_client;
  end if;

  insert into public.client_records (tenant_id, client_id)
  values (p_tenant_id, the_client)
  on conflict (tenant_id, client_id) do update set updated_at = now()
  returning id into the_record;

  select tm.profile_id into stylist
  from public.tenant_members tm
  where tm.tenant_id = p_tenant_id and tm.role = 'stylist' and tm.is_active
  limit 1;
  if stylist is null then raise exception 'that stylist is not taking bookings'; end if;

  select s.requires_deposit,
         greatest(s.deposit_min_cents, (total_cents * s.deposit_percent / 100)::integer)
  into needs_deposit, deposit_cents
  from public.stylist_settings s where s.tenant_id = p_tenant_id;

  global_dl := now() + interval '48 hours';

  insert into public.booking_requests (
    tenant_id, stylist_id, client_id, client_record_id,
    proposed_starts_at, proposed_ends_at,
    global_deadline, step_deadline,
    deposit_required, deposit_amount_cents,
    is_for_child, child_first_name, child_age
  ) values (
    p_tenant_id, stylist, the_client, the_record,
    p_starts_at, ends_at,
    global_dl, public.step_deadline_for(global_dl),
    coalesce(needs_deposit,false), case when needs_deposit then deposit_cents else 0 end,
    p_is_for_child, p_child_name, p_child_age
  )
  returning id into req_id;

  -- The thread is this event log, rendered. Not a messaging system.
  insert into public.negotiation_events
    (request_id, tenant_id, actor, actor_profile_id, action,
     proposed_starts_at, proposed_ends_at, note)
  values (req_id, p_tenant_id, 'client', caller, 'request', p_starts_at, ends_at, p_note);

  update public.booking_requests set service_ids = p_service_ids where id = req_id;

  return req_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- Shared: turn a request into a real appointment
-- -----------------------------------------------------------------------------
create or replace function public.materialise_appointment(p_request_id uuid, p_actor uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  r          record;
  buffer_min integer;
  appt_id    uuid;
begin
  select * into r from public.booking_requests where id = p_request_id;

  select coalesce(buffer_minutes, 30) into buffer_min
  from public.stylist_settings where tenant_id = r.tenant_id;
  buffer_min := coalesce(buffer_min, 30);

  -- Buffers are stored explicitly rather than recomputed later, so a change to
  -- the stylist's buffer setting cannot retroactively create overlaps in
  -- appointments that were already agreed.
  insert into public.appointments (
    tenant_id, stylist_id, client_id, client_record_id,
    starts_at, ends_at, buffer_starts_at, buffer_ends_at,
    status, is_for_child, child_first_name, child_age, total_price_cents
  ) values (
    r.tenant_id, r.stylist_id, r.client_id, r.client_record_id,
    r.proposed_starts_at, r.proposed_ends_at,
    r.proposed_starts_at - make_interval(mins => buffer_min),
    r.proposed_ends_at   + make_interval(mins => buffer_min),
    'confirmed', r.is_for_child, r.child_first_name, r.child_age, 0
  )
  returning id into appt_id;

  -- Snapshot price and duration so a later edit to the service menu cannot
  -- rewrite what was actually agreed.
  insert into public.appointment_services
    (appointment_id, service_id, tenant_id, price_cents, duration_minutes,
     processing_window_minutes, sort_order)
  select appt_id, s.id, r.tenant_id, s.price_cents, s.duration_minutes,
         s.processing_window_minutes, s.sort_order
  from public.services s
  where s.id = any(r.service_ids);

  update public.appointments a
  set total_price_cents = coalesce((
    select sum(x.price_cents) from public.appointment_services x
    where x.appointment_id = appt_id), 0)
  where a.id = appt_id;

  update public.booking_requests
  set status = 'accepted', resolved_at = now(), appointment_id = appt_id
  where id = p_request_id;

  return appt_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- respond_to_request — one entry point, role inferred from membership
-- -----------------------------------------------------------------------------
create or replace function public.respond_to_request(
  p_request_id   uuid,
  p_action       negotiation_action,
  p_new_starts_at timestamptz default null,
  p_note         text default null
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller     uuid := (select auth.uid());
  r          record;
  is_stylist boolean;
  duration   integer;
  new_ends   timestamptz;
begin
  select * into r from public.booking_requests where id = p_request_id;
  if r is null then raise exception 'no such request'; end if;
  if r.status not in ('awaiting_stylist','awaiting_client') then
    raise exception 'this request is already resolved';
  end if;

  is_stylist := r.tenant_id in (select public.current_tenant_ids());

  -- Turn-taking is enforced here, not in the UI.
  if is_stylist and r.status <> 'awaiting_stylist' then
    raise exception 'waiting on the client';
  end if;
  if not is_stylist and r.status <> 'awaiting_client' then
    raise exception 'waiting on the stylist';
  end if;
  if not is_stylist and r.client_id not in (select public.current_client_ids()) then
    raise exception 'not your request';
  end if;

  duration := extract(epoch from (r.proposed_ends_at - r.proposed_starts_at)) / 60;

  if p_action = 'accept' then
    perform public.materialise_appointment(p_request_id, caller);

  elsif p_action = 'decline' or p_action = 'cancel' then
    update public.booking_requests
    set status = (case when is_stylist then 'declined' else 'cancelled' end)::public.booking_request_status,
        resolved_at = now()
    where id = p_request_id;

  elsif p_action in ('reschedule','counter') then
    if is_stylist and p_action <> 'reschedule' then raise exception 'stylists reschedule'; end if;
    if not is_stylist and p_action <> 'counter' then raise exception 'clients counter'; end if;
    if p_new_starts_at is null then raise exception 'a new time is required'; end if;

    if is_stylist and r.stylist_offers_used >= 2 then
      raise exception 'no offers left — accept or decline';
    end if;
    if not is_stylist and r.client_counters_used >= 2 then
      raise exception 'no counters left — accept or cancel';
    end if;

    -- Do not open a round that cannot realistically be answered.
    if r.global_deadline - now() < interval '2 hours' then
      update public.booking_requests
      set status = 'expired', resolved_at = now() where id = p_request_id;
      insert into public.negotiation_events (request_id, tenant_id, actor, action, note)
      values (p_request_id, r.tenant_id, 'system', 'expire', 'Too little time left to continue');
      return 'expired';
    end if;

    new_ends := p_new_starts_at + make_interval(mins => duration);

    update public.booking_requests
    set proposed_starts_at   = p_new_starts_at,
        proposed_ends_at     = new_ends,
        stylist_offers_used  = r.stylist_offers_used  + (case when is_stylist then 1 else 0 end),
        client_counters_used = r.client_counters_used + (case when is_stylist then 0 else 1 end),
        status               = (case when is_stylist then 'awaiting_client' else 'awaiting_stylist' end)::public.booking_request_status,
        step_deadline        = public.step_deadline_for(r.global_deadline)
    where id = p_request_id;
  else
    raise exception 'unsupported action';
  end if;

  insert into public.negotiation_events
    (request_id, tenant_id, actor, actor_profile_id, action,
     proposed_starts_at, proposed_ends_at, note)
  values (p_request_id, r.tenant_id,
          (case when is_stylist then 'stylist' else 'client' end)::public.negotiation_actor,
          caller, p_action,
          p_new_starts_at,
          case when p_new_starts_at is null then null else new_ends end,
          p_note);

  return (select status::text from public.booking_requests where id = p_request_id);
end;
$$;

-- -----------------------------------------------------------------------------
-- expire_stale_requests — driven by a scheduled job
-- -----------------------------------------------------------------------------
create or replace function public.expire_stale_requests()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare n integer;
begin
  with stale as (
    update public.booking_requests
    set status = 'expired', resolved_at = now()
    where status in ('awaiting_stylist','awaiting_client')
      and (step_deadline < now() or global_deadline < now())
    returning id, tenant_id
  ), logged as (
    insert into public.negotiation_events (request_id, tenant_id, actor, action, note)
    select s.id, s.tenant_id, 'system', 'expire', 'No response in time'
    from stale s
    returning 1
  )
  select count(*) into n from logged;
  return coalesce(n, 0);
end;
$$;

grant execute on function public.create_booking_request(uuid, uuid[], timestamptz, text, boolean, text, smallint) to authenticated;
grant execute on function public.respond_to_request(uuid, negotiation_action, timestamptz, text) to authenticated;
grant execute on function public.expire_stale_requests() to authenticated;
