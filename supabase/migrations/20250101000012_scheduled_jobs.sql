-- =============================================================================
-- CosmoCutie · Phase 3 · Scheduled jobs
-- =============================================================================
-- Negotiations expire on two clocks (12h per step, 48h overall). Nothing in the
-- app is running when a deadline passes, so expiry has to be driven by the
-- database itself — otherwise a slot stays held by a request nobody will ever
-- answer, and the deposit hold rides along with it.
--
-- Reused later for booth rent collection (Phase 4) and reminders.

create extension if not exists pg_cron with schema extensions;

-- Every five minutes. The windows are measured in hours, so this is far more
-- resolution than needed — it just keeps a freed slot from sitting invisible
-- for long.
select cron.schedule(
  'expire-stale-booking-requests',
  '*/5 * * * *',
  $$ select public.expire_stale_requests(); $$
);
