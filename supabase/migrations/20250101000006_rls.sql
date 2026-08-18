-- =============================================================================
-- CosmoCutie · Phase 1 · Row-Level Security
-- =============================================================================
-- The firewall. Every rule lives here rather than in application code, because
-- app-side checks hold only until someone forgets one — and that is a single
-- missing `if` between working and leaking every renter's book.
--
-- The rule this file exists to enforce:
--   A salon owner, holding admin on the salon AND stylist on their own chair,
--   still cannot read a 1099 renter's clients, formulas, notes or revenue.
--   Not by policy. By the database refusing.
-- =============================================================================

alter table public.profiles             enable row level security;
alter table public.tenants              enable row level security;
alter table public.tenant_members       enable row level security;
alter table public.clients              enable row level security;
alter table public.client_records       enable row level security;
alter table public.client_tags          enable row level security;
alter table public.stylist_settings     enable row level security;
alter table public.services             enable row level security;
alter table public.business_hours       enable row level security;
alter table public.time_blocks          enable row level security;
alter table public.appointments         enable row level security;
alter table public.appointment_services enable row level security;
alter table public.waitlist_entries     enable row level security;
alter table public.booking_requests     enable row level security;
alter table public.negotiation_events   enable row level security;
alter table public.formulas             enable row level security;
alter table public.formula_photos       enable row level security;
alter table public.consents             enable row level security;
alter table public.inventory_items      enable row level security;
alter table public.payments             enable row level security;

-- -----------------------------------------------------------------------------
-- profiles — you see yourself; staff see colleagues in shared tenants
-- -----------------------------------------------------------------------------
create policy profiles_select_self on public.profiles
  for select using (id = (select auth.uid()));

create policy profiles_update_self on public.profiles
  for update using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- Visible to anyone who shares a tenant — needed to show "your stylist".
create policy profiles_select_shared_tenant on public.profiles
  for select using (
    exists (
      select 1 from public.tenant_members tm
      where tm.profile_id = public.profiles.id
        and tm.tenant_id in (select public.current_tenant_ids())
    )
  );

-- -----------------------------------------------------------------------------
-- tenants / memberships
-- -----------------------------------------------------------------------------
-- Admins can enumerate the chairs in their salon. That reveals only that a
-- tenant EXISTS — nothing inside it.
create policy tenants_select_own on public.tenants
  for select using (
    id in (select public.current_tenant_ids())
    or id in (select public.administered_child_tenant_ids())
  );

create policy tenants_admin_update on public.tenants
  for update using (id in (select public.admin_tenant_ids()))
  with check (id in (select public.admin_tenant_ids()));

create policy tenant_members_select on public.tenant_members
  for select using (
    profile_id = (select auth.uid())
    or tenant_id in (select public.current_tenant_ids())
    or tenant_id in (select public.administered_child_tenant_ids())
  );

-- Only salon admins invite people, matching the invite-only model: nobody can
-- self-register as a stylist and start taking bookings.
create policy tenant_members_admin_write on public.tenant_members
  for all using (
    tenant_id in (select public.admin_tenant_ids())
    or tenant_id in (select public.administered_child_tenant_ids())
  )
  with check (
    tenant_id in (select public.admin_tenant_ids())
    or tenant_id in (select public.administered_child_tenant_ids())
  );

-- -----------------------------------------------------------------------------
-- clients — identity layer, deliberately broader than the relationship layer
-- -----------------------------------------------------------------------------
create policy clients_select_self on public.clients
  for select using (profile_id = (select auth.uid()));

create policy clients_update_self on public.clients
  for update using (profile_id = (select auth.uid()))
  with check (profile_id = (select auth.uid()));

-- A stylist sees the identity of clients they actually have a record for.
-- Note this does NOT leak the existence of a relationship with anyone else:
-- the join is scoped to the caller's own tenants.
create policy clients_select_via_record on public.clients
  for select using (
    exists (
      select 1 from public.client_records cr
      where cr.client_id = public.clients.id
        and cr.tenant_id in (select public.current_tenant_ids())
    )
  );

create policy clients_insert_by_staff on public.clients
  for insert with check (
    exists (select 1 from public.tenant_members tm
            where tm.profile_id = (select auth.uid()) and tm.is_active)
  );

-- -----------------------------------------------------------------------------
-- THE FIREWALL: client_records and everything hanging off a tenant
-- -----------------------------------------------------------------------------
-- One shape, applied uniformly: you may touch a row only if its tenant_id is
-- one of YOUR tenants. `administered_child_tenant_ids` is deliberately absent
-- here — administering a salon grants nothing inside a renter's tenant.

create policy client_records_tenant_isolation on public.client_records
  for all using (tenant_id in (select public.current_tenant_ids()))
  with check (tenant_id in (select public.current_tenant_ids()));

-- Clients may read their own relationship rows (data export, Phase 7).
create policy client_records_select_own on public.client_records
  for select using (
    client_id in (select public.current_client_ids())
  );

create policy client_tags_tenant_isolation on public.client_tags
  for all using (tenant_id in (select public.current_tenant_ids()))
  with check (tenant_id in (select public.current_tenant_ids()));

create policy stylist_settings_tenant_isolation on public.stylist_settings
  for all using (tenant_id in (select public.current_tenant_ids()))
  with check (tenant_id in (select public.current_tenant_ids()));

create policy formulas_tenant_isolation on public.formulas
  for all using (tenant_id in (select public.current_tenant_ids()))
  with check (tenant_id in (select public.current_tenant_ids()));

create policy formula_photos_tenant_isolation on public.formula_photos
  for all using (tenant_id in (select public.current_tenant_ids()))
  with check (tenant_id in (select public.current_tenant_ids()));

create policy consents_tenant_isolation on public.consents
  for all using (tenant_id in (select public.current_tenant_ids()))
  with check (tenant_id in (select public.current_tenant_ids()));

create policy inventory_tenant_isolation on public.inventory_items
  for all using (tenant_id in (select public.current_tenant_ids()))
  with check (tenant_id in (select public.current_tenant_ids()));

create policy time_blocks_tenant_isolation on public.time_blocks
  for all using (tenant_id in (select public.current_tenant_ids()))
  with check (tenant_id in (select public.current_tenant_ids()));

-- Payments: tenant-isolated. A renter's revenue is not the landlord's business,
-- so there is no admin carve-out here either.
create policy payments_tenant_isolation on public.payments
  for all using (tenant_id in (select public.current_tenant_ids()))
  with check (tenant_id in (select public.current_tenant_ids()));

create policy payments_select_own on public.payments
  for select using (
    client_id in (select public.current_client_ids())
  );

-- -----------------------------------------------------------------------------
-- Public-facing catalogue
-- -----------------------------------------------------------------------------
-- Services and hours are how a client browses and books, so active rows are
-- readable by any signed-in user. Only the owning tenant may write.
create policy services_public_read on public.services
  for select using (is_active or tenant_id in (select public.current_tenant_ids()));

create policy services_tenant_write on public.services
  for all using (tenant_id in (select public.current_tenant_ids()))
  with check (tenant_id in (select public.current_tenant_ids()));

create policy business_hours_public_read on public.business_hours
  for select using (true);

create policy business_hours_tenant_write on public.business_hours
  for all using (tenant_id in (select public.current_tenant_ids()))
  with check (tenant_id in (select public.current_tenant_ids()));

-- -----------------------------------------------------------------------------
-- Appointments — visible to the owning tenant and to the client themselves
-- -----------------------------------------------------------------------------
create policy appointments_tenant_isolation on public.appointments
  for all using (tenant_id in (select public.current_tenant_ids()))
  with check (tenant_id in (select public.current_tenant_ids()));

create policy appointments_select_own on public.appointments
  for select using (
    client_id in (select public.current_client_ids())
  );

create policy appointment_services_tenant_isolation on public.appointment_services
  for all using (tenant_id in (select public.current_tenant_ids()))
  with check (tenant_id in (select public.current_tenant_ids()));

create policy appointment_services_select_own on public.appointment_services
  for select using (
    exists (
      select 1 from public.appointments a
      where a.id = public.appointment_services.appointment_id
        and a.client_id in (select public.current_client_ids())
    )
  );

create policy waitlist_tenant_isolation on public.waitlist_entries
  for all using (tenant_id in (select public.current_tenant_ids()))
  with check (tenant_id in (select public.current_tenant_ids()));

create policy waitlist_select_own on public.waitlist_entries
  for select using (
    client_id in (select public.current_client_ids())
  );

-- -----------------------------------------------------------------------------
-- Negotiation — both parties see their own thread, nobody else does
-- -----------------------------------------------------------------------------
create policy booking_requests_tenant_isolation on public.booking_requests
  for all using (tenant_id in (select public.current_tenant_ids()))
  with check (tenant_id in (select public.current_tenant_ids()));

create policy booking_requests_client_access on public.booking_requests
  for select using (
    client_id in (select public.current_client_ids())
  );

create policy booking_requests_client_update on public.booking_requests
  for update using (
    client_id in (select public.current_client_ids())
  )
  with check (
    client_id in (select public.current_client_ids())
  );

create policy negotiation_events_tenant_isolation on public.negotiation_events
  for all using (tenant_id in (select public.current_tenant_ids()))
  with check (tenant_id in (select public.current_tenant_ids()));

create policy negotiation_events_client_access on public.negotiation_events
  for select using (
    exists (
      select 1 from public.booking_requests br
      where br.id = public.negotiation_events.request_id
        and br.client_id in (select public.current_client_ids())
    )
  );

create policy negotiation_events_client_insert on public.negotiation_events
  for insert with check (
    actor = 'client'
    and exists (
      select 1 from public.booking_requests br
      join public.clients c on c.id = br.client_id
      where br.id = public.negotiation_events.request_id
        and c.profile_id = (select auth.uid())
    )
  );

-- =============================================================================
-- Grants
-- =============================================================================
-- RLS decides WHICH ROWS a caller may touch. Table-level GRANTs decide whether
-- they may touch the table at all. Both are required: policies alone produce
-- "permission denied for table", which is a confusing way to discover this.
--
-- Granting broadly to `authenticated` is safe precisely because every table
-- above has RLS enabled and a restrictive policy — the grant opens the door,
-- the policy decides what is behind it. `anon` is kept deliberately narrow.

grant usage on schema public to anon, authenticated;

grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;

-- Signed-out visitors may browse the catalogue only. Everything else has no
-- matching policy for anon, but withholding the grant means it cannot even be
-- probed.
grant select on public.services       to anon;
grant select on public.business_hours to anon;

grant execute on function public.current_tenant_ids()             to authenticated;
grant execute on function public.admin_tenant_ids()               to authenticated;
grant execute on function public.administered_child_tenant_ids()  to authenticated;
grant execute on function public.current_client_ids()             to authenticated;

-- Future tables inherit the same posture rather than silently defaulting to
-- no-access and being "fixed" later with an over-broad grant.
alter default privileges in schema public
  grant select, insert, update, delete on tables to authenticated;
alter default privileges in schema public
  grant usage, select on sequences to authenticated;
