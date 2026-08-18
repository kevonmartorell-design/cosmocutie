-- =============================================================================
-- CosmoCutie · Phase 1 · Restore defence in depth for anonymous callers
-- =============================================================================
-- Hosted Supabase projects ship default grants that give `anon` table-level
-- SELECT across the public schema, leaving RLS as the only thing standing
-- between an anonymous caller and private data. Locally there was no such
-- grant, so access failed at the privilege layer before RLS was consulted.
--
-- Behaviourally both are safe today — verified against the live project, anon
-- returns zero rows and writes are refused. But a single mistaken permissive
-- policy would be the difference between "leaked every client record" and
-- "still blocked by the missing grant". Two layers, not one.
--
-- The catalogue stays readable: browsing services before signing up is a real
-- flow, not an oversight.

revoke all on public.profiles             from anon;
revoke all on public.tenants              from anon;
revoke all on public.tenant_members       from anon;
revoke all on public.clients              from anon;
revoke all on public.client_records       from anon;
revoke all on public.client_tags          from anon;
revoke all on public.stylist_settings     from anon;
revoke all on public.time_blocks          from anon;
revoke all on public.appointments         from anon;
revoke all on public.appointment_services from anon;
revoke all on public.waitlist_entries     from anon;
revoke all on public.booking_requests     from anon;
revoke all on public.negotiation_events   from anon;
revoke all on public.formulas             from anon;
revoke all on public.formula_photos       from anon;
revoke all on public.consents             from anon;
revoke all on public.inventory_items      from anon;
revoke all on public.payments             from anon;

-- Writes were never intended for anonymous callers on the catalogue either.
revoke insert, update, delete on public.services       from anon;
revoke insert, update, delete on public.business_hours from anon;

-- New tables must not silently inherit anon access in future migrations.
alter default privileges in schema public revoke all on tables from anon;
