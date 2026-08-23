-- =============================================================================
-- CosmoCutie · Phase 3 · Appointment lifecycle
-- =============================================================================
-- Everything that happens to an appointment AFTER it is agreed: moving it,
-- cancelling it, and recording a no-show. The negotiation covers getting one;
-- these cover living with one, which is the commoner event.
-- =============================================================================

-- Cancellation outcome, recorded here and settled by Stripe in Phase 4.
create type cancellation_outcome as enum ('free', 'fee_charged', 'stylist_cancelled');

alter table public.appointments
  add column if not exists cancellation_outcome cancellation_outcome,
  add column if not exists cancellation_fee_cents integer not null default 0,
  -- One free move per appointment, per the cancellation policy.
  add column if not exists reschedules_used smallint not null default 0,
  -- A pending move, awaiting the other side.
  add column if not exists pending_starts_at timestamptz,
  add column if not exists pending_requested_by uuid references public.profiles (id) on delete set null;

-- -----------------------------------------------------------------------------
-- cancel_appointment
-- -----------------------------------------------------------------------------
-- Fee tiers come from the stylist's own settings, and the fee can never exceed
-- the deposit already authorised — never surprise-charge a card beyond the
-- disclosed hold, because a chargeback costs more than the fee recovers.
--
-- A stylist cancelling is always free to the client, regardless of timing. They
-- changed it; the client should not pay for that.
create or replace function public.cancel_appointment(
  p_appointment_id uuid,
  p_reason text default null
)
returns public.cancellation_outcome
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller     uuid := (select auth.uid());
  a          record;
  s          record;
  by_stylist boolean;
  hours_out  numeric;
  deposit    integer;
  outcome    public.cancellation_outcome;
  fee        integer := 0;
begin
  select * into a from public.appointments where id = p_appointment_id;
  if a is null then raise exception 'no such appointment'; end if;
  if a.status not in ('confirmed','in_progress') then
    raise exception 'this appointment is already closed';
  end if;

  by_stylist := a.tenant_id in (select public.current_tenant_ids());
  if not by_stylist and a.client_id not in (select public.current_client_ids()) then
    raise exception 'not your appointment';
  end if;

  select * into s from public.stylist_settings where tenant_id = a.tenant_id;
  hours_out := extract(epoch from (a.starts_at - now())) / 3600;

  select coalesce(sum(amount_cents), 0) into deposit
  from public.payments
  where appointment_id = p_appointment_id and kind = 'deposit' and status in ('authorized','captured');

  if by_stylist then
    outcome := 'stylist_cancelled';
  elsif hours_out >= coalesce(s.free_cancel_hours, 48) then
    outcome := 'free';
  else
    outcome := 'fee_charged';
    -- Capped at the deposit. Nothing beyond the disclosed hold, ever.
    fee := deposit;
  end if;

  update public.appointments
  set status = 'cancelled',
      cancelled_at = now(),
      cancelled_by = caller,
      cancellation_reason = p_reason,
      cancellation_outcome = outcome,
      cancellation_fee_cents = fee
  where id = p_appointment_id;

  return outcome;
end;
$$;

-- -----------------------------------------------------------------------------
-- Rescheduling a confirmed appointment
-- -----------------------------------------------------------------------------
-- Deliberately NOT the six-step negotiation. Moving an appointment is usually
-- trivial, and reusing the full state machine for it would be tedious: one
-- proposal, one answer.
create or replace function public.request_appointment_reschedule(
  p_appointment_id uuid,
  p_new_starts_at  timestamptz
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := (select auth.uid());
  a      record;
  mins   integer;
begin
  select * into a from public.appointments where id = p_appointment_id;
  if a is null or a.status <> 'confirmed' then raise exception 'cannot move that appointment'; end if;

  if a.tenant_id not in (select public.current_tenant_ids())
     and a.client_id not in (select public.current_client_ids()) then
    raise exception 'not your appointment';
  end if;

  mins := extract(epoch from (a.ends_at - a.starts_at)) / 60;

  if not exists (
    select 1 from public.available_slots(a.tenant_id, (p_new_starts_at at time zone 'UTC')::date, mins) s
    where s.slot_start = p_new_starts_at
  ) then
    raise exception 'that time is not available';
  end if;

  update public.appointments
  set pending_starts_at = p_new_starts_at, pending_requested_by = caller
  where id = p_appointment_id;
end;
$$;

create or replace function public.respond_appointment_reschedule(
  p_appointment_id uuid,
  p_accept boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := (select auth.uid());
  a      record;
  buf    integer;
  mins   integer;
begin
  select * into a from public.appointments where id = p_appointment_id;
  if a is null or a.pending_starts_at is null then raise exception 'nothing pending'; end if;
  -- The proposer cannot accept their own proposal.
  if a.pending_requested_by = caller then raise exception 'waiting on the other side'; end if;

  if not p_accept then
    update public.appointments set pending_starts_at = null, pending_requested_by = null
    where id = p_appointment_id;
    return;
  end if;

  select coalesce(buffer_minutes, 30) into buf from public.stylist_settings where tenant_id = a.tenant_id;
  buf := coalesce(buf, 30);
  mins := extract(epoch from (a.ends_at - a.starts_at)) / 60;

  update public.appointments
  set starts_at        = a.pending_starts_at,
      ends_at          = a.pending_starts_at + make_interval(mins => mins),
      buffer_starts_at = a.pending_starts_at - make_interval(mins => buf),
      buffer_ends_at   = a.pending_starts_at + make_interval(mins => mins + buf),
      reschedules_used = a.reschedules_used + 1,
      pending_starts_at = null,
      pending_requested_by = null
  where id = p_appointment_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- mark_no_show — stylist only, after the grace period
-- -----------------------------------------------------------------------------
-- Repeat no-shows flip the client to prepay-required for THIS stylist only.
-- Not a ban and not salon-wide: a risk adjustment by the person carrying it.
create or replace function public.mark_no_show(p_appointment_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  a      record;
  s      record;
  shows  integer;
begin
  select * into a from public.appointments where id = p_appointment_id;
  if a is null then raise exception 'no such appointment'; end if;
  if a.tenant_id not in (select public.current_tenant_ids()) then
    raise exception 'only the stylist can mark a no-show';
  end if;

  select * into s from public.stylist_settings where tenant_id = a.tenant_id;

  if now() < a.starts_at + make_interval(mins => coalesce(s.no_show_grace_minutes, 15)) then
    raise exception 'still within the grace period';
  end if;

  update public.appointments set status = 'no_show' where id = p_appointment_id;

  update public.client_records
  set no_show_count = no_show_count + 1
  where id = a.client_record_id
  returning no_show_count into shows;

  if shows >= coalesce(s.prepay_after_no_shows, 2) then
    update public.client_records set requires_prepay = true where id = a.client_record_id;
  end if;
end;
$$;

grant execute on function public.cancel_appointment(uuid, text)                        to authenticated;
grant execute on function public.request_appointment_reschedule(uuid, timestamptz)     to authenticated;
grant execute on function public.respond_appointment_reschedule(uuid, boolean)         to authenticated;
grant execute on function public.mark_no_show(uuid)                                    to authenticated;
