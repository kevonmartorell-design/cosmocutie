-- =============================================================================
-- CosmoCutie · Phase 3 · Push notification delivery
-- =============================================================================
-- The negotiation runs on 12h and 48h clocks, so someone has to be told it is
-- their turn. Without notifications the flow is technically correct and
-- practically unusable.

create table public.push_tokens (
  id         uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles (id) on delete cascade,
  token      text not null unique,
  platform   text not null,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

create index push_tokens_profile_idx on public.push_tokens (profile_id);

alter table public.push_tokens enable row level security;

-- A device token is personal: you may register and remove your own, and see
-- nobody else's.
create policy push_tokens_own on public.push_tokens
  for all using (profile_id = (select auth.uid()))
  with check (profile_id = (select auth.uid()));

grant select, insert, update, delete on public.push_tokens to authenticated;

-- -----------------------------------------------------------------------------
-- Outbound queue
-- -----------------------------------------------------------------------------
-- Notifications are queued rather than sent inline. A database trigger cannot
-- make an HTTP call, and even if it could, a slow push service must never be
-- able to hold up a booking transaction.
create table public.notification_queue (
  id          uuid primary key default gen_random_uuid(),
  profile_id  uuid not null references public.profiles (id) on delete cascade,
  title       text not null,
  body        text not null,
  data        jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  sent_at     timestamptz,
  attempts    smallint not null default 0,
  last_error  text
);

create index notification_queue_pending_idx on public.notification_queue (created_at)
  where sent_at is null;

alter table public.notification_queue enable row level security;
-- Written by SECURITY DEFINER triggers, read by the sender using the service
-- role. No end user has any business reading this table.
create policy notification_queue_none on public.notification_queue for select using (false);

-- -----------------------------------------------------------------------------
-- Queue a notification whenever the turn changes
-- -----------------------------------------------------------------------------
create or replace function public.notify_on_negotiation_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  r          record;
  recipient  uuid;
  title      text;
  body       text;
  when_text  text;
begin
  select * into r from public.booking_requests where id = new.request_id;
  if r is null then return new; end if;

  -- Tell whoever now owes a response, not whoever just acted.
  if r.status = 'awaiting_stylist' then
    recipient := r.stylist_id;
  elsif r.status = 'awaiting_client' then
    select p.id into recipient
    from public.clients c join public.profiles p on p.id = c.profile_id
    where c.id = r.client_id;
  elsif r.status in ('accepted','declined','cancelled','expired') then
    -- On a terminal action, tell the party who did NOT act.
    if new.actor = 'stylist' then
      select p.id into recipient
      from public.clients c join public.profiles p on p.id = c.profile_id
      where c.id = r.client_id;
    else
      recipient := r.stylist_id;
    end if;
  end if;

  if recipient is null or recipient = new.actor_profile_id then return new; end if;

  when_text := to_char(r.proposed_starts_at, 'Dy DD Mon at HH12:MIam');

  title := case
    when r.status = 'accepted'  then 'Appointment confirmed'
    when r.status = 'declined'  then 'Request declined'
    when r.status = 'cancelled' then 'Request cancelled'
    when r.status = 'expired'   then 'Request expired'
    when new.action = 'request' then 'New booking request'
    else 'Your turn'
  end;

  body := case
    when r.status = 'accepted' then when_text
    when r.status in ('declined','cancelled','expired') then 'Tap to see what happened'
    else coalesce(nullif(new.note, ''), when_text)
  end;

  insert into public.notification_queue (profile_id, title, body, data)
  values (recipient, title, body,
          jsonb_build_object('type','negotiation','requestId', r.id::text));

  return new;
end;
$$;

create trigger negotiation_events_notify
  after insert on public.negotiation_events
  for each row execute function public.notify_on_negotiation_event();
