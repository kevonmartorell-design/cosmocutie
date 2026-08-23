-- =============================================================================
-- CosmoCutie · Phase 3 · Waitlist matching and gap-time booking
-- =============================================================================

alter table public.waitlist_entries
  add column if not exists offered_slot_start timestamptz,
  add column if not exists notified_count smallint not null default 0;

-- -----------------------------------------------------------------------------
-- offer_freed_slot — when a slot opens, who gets told
-- -----------------------------------------------------------------------------
-- Notifying only the first person wastes the slot if they are asleep;
-- notifying everyone creates a scramble. Top three, first to claim wins, with
-- a 30-minute window (PLAN.md → Waitlist mechanics).
create or replace function public.offer_freed_slot(
  p_tenant_id uuid,
  p_slot_start timestamptz
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare n integer;
begin
  with picked as (
    select w.id
    from public.waitlist_entries w
    where w.tenant_id = p_tenant_id
      and w.claimed_at is null
      and (w.offer_expires_at is null or w.offer_expires_at < now())
      and p_slot_start::date between w.window_starts_on and w.window_ends_on
    order by w.created_at
    limit 3
  )
  update public.waitlist_entries w
  set offered_at = now(),
      offered_slot_start = p_slot_start,
      offer_expires_at = now() + interval '30 minutes',
      notified_count = w.notified_count + 1
  from picked
  where w.id = picked.id;

  get diagnostics n = row_count;
  return n;
end;
$$;

-- Freeing a slot should offer it onward without anything else having to
-- remember to. A cancellation is exactly when a waitlisted client wants to hear.
create or replace function public.on_appointment_freed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status in ('cancelled','no_show') and old.status in ('confirmed','in_progress') then
    perform public.offer_freed_slot(new.tenant_id, new.starts_at);
  end if;
  return new;
end;
$$;

create trigger appointments_offer_freed_slot
  after update on public.appointments
  for each row execute function public.on_appointment_freed();

-- -----------------------------------------------------------------------------
-- gap_slots — booking inside a chemical processing window
-- -----------------------------------------------------------------------------
-- While colour processes the stylist is idle, and that idle time is bookable
-- for something short. Distinct from the buffer BETWEEN appointments: the
-- buffer blocks the calendar, a processing window opens it.
--
-- Uses gap_buffer_minutes (small) rather than the 30-minute buffer — a 45
-- minute window minus 30 on each side is negative, which would make gap
-- booking arithmetically impossible. The stylist is already present and set up.
create or replace function public.gap_slots(
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
  v_gap_buffer integer;
begin
  select coalesce(gap_buffer_minutes, 10) into v_gap_buffer
  from public.stylist_settings where tenant_id = p_tenant_id;
  v_gap_buffer := coalesce(v_gap_buffer, 10);

  return query
  with windows as (
    select
      a.id,
      a.starts_at + make_interval(mins => aps.processing_starts_after) as win_start,
      a.starts_at + make_interval(mins => aps.processing_starts_after + aps.processing_window_minutes) as win_end
    from public.appointments a
    join lateral (
      select s.processing_window_minutes,
             s.processing_starts_after_minutes as processing_starts_after
      from public.appointment_services x
      join public.services s on s.id = x.service_id
      where x.appointment_id = a.id and s.processing_window_minutes > 0
      order by x.sort_order
      limit 1
    ) aps on true
    where a.tenant_id = p_tenant_id
      and a.status in ('confirmed','in_progress')
      and a.starts_at::date = p_date
  )
  select w.win_start + make_interval(mins => v_gap_buffer) as slot_start,
         w.win_start + make_interval(mins => v_gap_buffer + p_duration_minutes) as slot_end
  from windows w
  where
    -- The short appointment must fit inside the window with a small buffer
    -- at each end.
    w.win_start + make_interval(mins => v_gap_buffer + p_duration_minutes + v_gap_buffer) <= w.win_end
    and w.win_start + make_interval(mins => v_gap_buffer) > now()
    -- And must not collide with anything already booked or held.
    and not exists (
      select 1 from public.appointments a2
      where a2.tenant_id = p_tenant_id
        -- Exclude the parent appointment: the gap sits INSIDE it by
        -- definition, so comparing against it would always collide.
        and a2.id <> w.id
        and a2.status in ('confirmed','in_progress')
        and tstzrange(a2.starts_at, a2.ends_at, '[)')
            && tstzrange(w.win_start + make_interval(mins => v_gap_buffer),
                         w.win_start + make_interval(mins => v_gap_buffer + p_duration_minutes), '[)')
    )
    and not exists (
      select 1 from public.booking_requests br
      where br.tenant_id = p_tenant_id
        and br.status in ('awaiting_stylist','awaiting_client')
        and tstzrange(br.proposed_starts_at, br.proposed_ends_at, '[)')
            && tstzrange(w.win_start + make_interval(mins => v_gap_buffer),
                         w.win_start + make_interval(mins => v_gap_buffer + p_duration_minutes), '[)')
    );
end;
$$;

comment on function public.gap_slots is
  'Bookable time inside a chemical processing window, where the stylist is idle
   but present. Uses the small gap buffer, not the between-appointments buffer.';

grant execute on function public.offer_freed_slot(uuid, timestamptz)     to authenticated;
grant execute on function public.gap_slots(uuid, date, integer)          to authenticated, anon;

-- Expired waitlist offers should return to the pool rather than block the entry.
select cron.schedule(
  'release-expired-waitlist-offers',
  '*/5 * * * *',
  $$ update public.waitlist_entries
     set offered_at = null, offered_slot_start = null, offer_expires_at = null
     where claimed_at is null and offer_expires_at is not null and offer_expires_at < now(); $$
);
