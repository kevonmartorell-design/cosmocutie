-- =============================================================================
-- CosmoCutie · Phase 3 · Availability engine
-- =============================================================================
-- Core rule (PLAN.md → Smart Booking & Availability): an unavailable time is
-- never shown. Not shown-then-rejected — simply absent from the list.
--
-- A slot is offered only if ALL hold:
--   · inside the stylist's business hours for that weekday
--   · the full service duration fits before closing
--   · its buffer envelope overlaps no live appointment's envelope
--   · it overlaps no personal time block
--   · it is not currently held by a pending booking request
-- =============================================================================

-- Slot granularity. 15 minutes keeps the list usable without pretending to a
-- precision no salon actually books at.
create or replace function public.available_slots(
  p_tenant_id uuid,
  p_date date,
  p_duration_minutes integer
)
returns table (slot_start timestamptz, slot_end timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_tz          text;
  v_buffer_mins integer;
  v_weekday     smallint;
begin
  select t.timezone into v_tz from public.tenants t where t.id = p_tenant_id;
  if v_tz is null then return; end if;

  select coalesce(s.buffer_minutes, 30) into v_buffer_mins
  from public.stylist_settings s where s.tenant_id = p_tenant_id;
  v_buffer_mins := coalesce(v_buffer_mins, 30);

  v_weekday := extract(dow from p_date)::smallint;

  return query
  with hours as (
    select bh.opens_at, bh.closes_at
    from public.business_hours bh
    where bh.tenant_id = p_tenant_id and bh.weekday = v_weekday
  ),
  -- Candidate starts every 15 minutes inside opening hours, resolved to real
  -- instants in the salon's own timezone so DST is handled by Postgres rather
  -- than by arithmetic here.
  candidates as (
    select generate_series(
             (p_date + h.opens_at) at time zone v_tz,
             (p_date + h.closes_at) at time zone v_tz,
             interval '15 minutes'
           ) as starts_at,
           (p_date + h.closes_at) at time zone v_tz as closes_at
    from hours h
  ),
  windows as (
    select c.starts_at,
           c.starts_at + make_interval(mins => p_duration_minutes) as ends_at,
           c.starts_at - make_interval(mins => v_buffer_mins)        as buf_start,
           c.starts_at + make_interval(mins => p_duration_minutes + v_buffer_mins) as buf_end,
           c.closes_at
    from candidates c
  )
  select w.starts_at, w.ends_at
  from windows w
  where
    -- The service itself must finish before closing; the trailing buffer may
    -- run past it, since cleaning up after hours is normal.
    w.ends_at <= w.closes_at
    -- Never offer a time in the past.
    and w.starts_at > now()
    -- No collision with a live appointment, comparing buffer envelopes so the
    -- gap between appointments is respected rather than merely intended.
    and not exists (
      select 1 from public.appointments a
      where a.tenant_id = p_tenant_id
        and a.status in ('confirmed','in_progress')
        and tstzrange(a.buffer_starts_at, a.buffer_ends_at, '[)')
            && tstzrange(w.buf_start, w.buf_end, '[)')
    )
    -- No collision with personal time off.
    and not exists (
      select 1 from public.time_blocks tb
      where tb.tenant_id = p_tenant_id
        and tstzrange(tb.starts_at, tb.ends_at, '[)')
            && tstzrange(w.starts_at, w.ends_at, '[)')
    )
    -- Not held by a negotiation in flight. Only one time is ever held per
    -- request, so a countered slot frees immediately.
    and not exists (
      select 1 from public.booking_requests br
      where br.tenant_id = p_tenant_id
        and br.status in ('awaiting_stylist','awaiting_client')
        and tstzrange(br.proposed_starts_at, br.proposed_ends_at, '[)')
            && tstzrange(w.starts_at, w.ends_at, '[)')
    )
  order by w.starts_at;
end;
$$;

comment on function public.available_slots is
  'Bookable start times for one stylist on one date. Excludes held negotiation
   slots, so two clients cannot both be shown the same time.';

grant execute on function public.available_slots(uuid, date, integer) to authenticated, anon;
