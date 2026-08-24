-- =============================================================================
-- CosmoCutie · The salon screen could not name who occupies a chair
-- =============================================================================
-- The admin view showed every occupied chair as "Unoccupied · 1099 renter":
-- the classification came through because it lives on `tenant_members`, which
-- an admin can read, but the name did not, because `profiles` is readable only
-- to yourself or to someone who shares a tenant with you. A salon owner is an
-- admin on the SALON tenant while a renter is a stylist on their own CHAIR
-- tenant, so they share none. PLAN.md says the owner should see which chairs
-- exist, who occupies them, and how they are classified, so the name is
-- intended.
--
-- Fixed with a function rather than a new policy on `profiles`, deliberately.
--
-- RLS is row-level, not column-level, so any SELECT policy wide enough to
-- expose `full_name` also exposes `phone`, `email` and `avatar_url` on the same
-- row. The owner probably does need a way to contact their renter — but that is
-- a product decision worth making on purpose, not a side effect of fixing a
-- missing name. This returns the name and nothing else, and leaves the
-- `profiles` firewall exactly as it was.
--
-- It also matches how identity is resolved everywhere else here: through a
-- SECURITY DEFINER helper, never by widening a policy on the table itself.
create or replace function public.chair_occupants()
returns table (
  tenant_id      uuid,
  profile_id     uuid,
  full_name      text,
  classification public.worker_classification
)
language sql
stable
security definer
set search_path = ''
as $$
  select tm.tenant_id, tm.profile_id, p.full_name, tm.classification
  from public.tenant_members tm
  join public.profiles p on p.id = tm.profile_id
  where tm.role = 'stylist'
    and tm.is_active
    -- Caller-scoped: administered_child_tenant_ids() resolves through
    -- admin_tenant_ids(), which requires an ACTIVE ADMIN membership held by
    -- auth.uid(). A renter calling this gets an empty set, not their
    -- neighbours — SECURITY DEFINER bypasses RLS, so this clause is the only
    -- thing standing between the caller and every profile in the database, and
    -- it is doing that job on purpose.
    and tm.tenant_id in (select public.administered_child_tenant_ids());
$$;

comment on function public.chair_occupants is
  'Who occupies each chair in the salon the caller administers: name and
   classification, nothing more. Grants no access to a renter''s clients,
   formulas, revenue, payments, or contact details — administering a salon
   still grants nothing inside a renter''s tenant.';

revoke all on function public.chair_occupants() from public;
grant execute on function public.chair_occupants() to authenticated;
