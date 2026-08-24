-- =============================================================================
-- CosmoCutie · Phase 4 · Paying the balance at checkout
-- =============================================================================
-- `record_checkout` (migration 17) already works out what is owed at the end of
-- a service and nets a captured deposit off it. What it could not do is take
-- the money: it writes a payment row and nothing ever carries it to Stripe.
--
-- Same division as everywhere else — this decides the amount, the edge function
-- carries it, the webhook records the result.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- What is still owed on a checkout payment
-- -----------------------------------------------------------------------------
-- Tip included: it is charged with the balance, even though it is reported
-- separately. Folding a tip into the total would lose the distinction that
-- matters at tax time; keeping it in its own column and adding it here is how
-- both stay true.
create or replace function public.checkout_amount_due(p_payment_id uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select greatest(coalesce(p.amount_cents, 0) + coalesce(p.tip_cents, 0), 0)
  from public.payments p
  where p.id = p_payment_id;
$$;

-- -----------------------------------------------------------------------------
-- Recording that an owed payment was paid
-- -----------------------------------------------------------------------------
-- The webhook's counterpart to `settle_deposit`, for a payment that was taken
-- outright rather than authorised first. Kept separate because there is no hold
-- to settle: it goes from owed to paid in one step.
--
-- Keyed on the payment id rather than the intent, because the caller knows
-- which row it is settling — it put the id in the Stripe metadata itself. Used
-- by the closing balance at checkout and by booth rent, which are the two
-- payments that are owed before they have an intent.
create or replace function public.settle_payment_by_id(
  p_payment_id uuid,
  p_payment_intent_id text,
  p_amount_cents integer,
  p_charge_id text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.payments
  set status                   = 'captured',
      stripe_payment_intent_id = coalesce(stripe_payment_intent_id, p_payment_intent_id),
      stripe_charge_id         = coalesce(p_charge_id, stripe_charge_id),
      captured_at              = coalesce(captured_at, now())
  where id = p_payment_id
    -- Only an outstanding balance settles, so a redelivered webhook finds
    -- nothing to do rather than re-stamping a payment that is already paid.
    and status = 'authorized';
end;
$$;

-- `record_checkout` marks the appointment completed and increments the client's
-- visit count. Both are correct, but it also needs to say where the money is
-- meant to land so the edge function does not have to work it out again.
alter table public.payments
  add column if not exists stripe_checkout_session_id text;

revoke all on function public.settle_payment_by_id(uuid, text, integer, text) from public;
grant execute on function public.settle_payment_by_id(uuid, text, integer, text) to service_role;

revoke all on function public.checkout_amount_due(uuid) from public;
grant execute on function public.checkout_amount_due(uuid) to authenticated, service_role;
