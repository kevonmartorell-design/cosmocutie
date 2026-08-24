import { serviceClient, json } from '../_shared/auth.ts';
import { verifyStripeSignature } from '../_shared/stripe.ts';

/**
 * Reconciles Stripe back into the database.
 *
 * The database is the source of truth for what SHOULD happen to money; Stripe
 * is the record of what DID. This is the only path by which the second becomes
 * the first, which is why `settle_deposit` and friends carry no grant to
 * `authenticated` — nobody holding a user JWT gets to assert that money moved.
 *
 * Every handler is safe to run twice. Stripe delivers at least once, retries on
 * any non-2xx, and will redeliver an hour-old event; the event ledger drops a
 * replay before any handler runs, and the handlers themselves are written so
 * that a replay that slips past is still a no-op.
 */
Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);

  const secret = Deno.env.get('STRIPE_WEBHOOK_SECRET');
  if (!secret) {
    console.error('[stripe-webhook] STRIPE_WEBHOOK_SECRET is not set');
    return json({ error: 'webhook not configured' }, 500);
  }

  // Raw text, not req.json(). The signature covers the exact bytes Stripe sent,
  // so parsing first and re-serialising would break verification.
  const raw = await req.text();
  const verified = await verifyStripeSignature(raw, req.headers.get('Stripe-Signature'), secret);
  if (!verified.ok) {
    // 400, not 500: a bad signature is not a transient failure and Stripe
    // should not retry it.
    console.error('[stripe-webhook] rejected:', verified.error);
    return json({ error: 'signature verification failed' }, 400);
  }

  const event = JSON.parse(raw);
  const supabase = serviceClient();

  // First delivery wins; every replay short-circuits here.
  const { data: claimed, error: claimError } = await supabase.rpc('claim_stripe_event', {
    p_event_id: event.id,
    p_type: event.type,
  });
  if (claimError) return json({ error: claimError.message }, 500);
  if (!claimed) return json({ received: true, duplicate: true });

  try {
    await handle(supabase, event);
  } catch (err) {
    // Un-claim so Stripe's retry gets a real second attempt rather than being
    // waved through as a duplicate.
    await supabase.from('stripe_events').delete().eq('id', event.id);
    console.error(`[stripe-webhook] ${event.type} failed:`, err);
    return json({ error: String(err) }, 500);
  }

  return json({ received: true });
});

async function handle(supabase: ReturnType<typeof serviceClient>, event: Record<string, any>) {
  const object = event.data?.object ?? {};

  switch (event.type) {
    // The client finished the hosted payment page. This is the first point at
    // which a deposit genuinely exists, which is why the session is not
    // recorded when it is merely opened.
    case 'checkout.session.completed': {
      const paymentIntent = object.payment_intent;

      // The closing balance at the end of a service. Taken outright, so it goes
      // straight to captured — there was no hold to settle.
      const paymentId = object.metadata?.payment_id;
      if (paymentId && paymentIntent) {
        const { error } = await supabase.rpc('settle_payment_by_id', {
          p_payment_id: paymentId,
          p_payment_intent_id: paymentIntent,
          p_amount_cents: object.amount_total ?? 0,
          p_charge_id: null,
        });
        if (error) throw new Error(error.message);
        break;
      }

      const requestId = object.metadata?.booking_request_id;
      if (!requestId || !paymentIntent) break;

      const { error } = await supabase.rpc('record_deposit_intent_internal', {
        p_request_id: requestId,
        p_payment_intent_id: paymentIntent,
        // Stripe's own figure, not one this function works out. If it disagrees
        // with the amount disclosed at booking the function refuses it.
        p_amount_cents: object.amount_total,
      });
      if (error) throw new Error(error.message);
      break;
    }

    // A hold was placed. Nothing is owed yet; the row already says `authorized`.
    case 'payment_intent.amount_capturable_updated':
      break;

    // A chair saved the card its booth rent will be charged to. Recorded
    // against the customer rather than the tenant, because that is what the
    // event carries — the tenant is on the row already.
    case 'setup_intent.succeeded': {
      if (!object.customer || !object.payment_method) break;
      const { error } = await supabase
        .from('billing_methods')
        .update({ payment_method_id: object.payment_method })
        .eq('stripe_customer_id', object.customer);
      if (error) throw new Error(error.message);
      break;
    }

    // Fills in what the app shows the stylist — "Visa ending 4242". Separate
    // from the event above because only this one carries the card details, and
    // we never see or store the number itself.
    case 'payment_method.attached': {
      if (!object.customer) break;
      const card = object.card ?? {};
      const { error } = await supabase
        .from('billing_methods')
        .update({
          brand: card.brand ?? object.type ?? null,
          last4: card.last4 ?? null,
          exp_month: card.exp_month ?? null,
          exp_year: card.exp_year ?? null,
        })
        .eq('stripe_customer_id', object.customer);
      if (error) throw new Error(error.message);
      break;
    }

    // A saved card was removed at Stripe. Clearing it here means the rent
    // screen tells the truth rather than showing a card that no longer exists.
    case 'payment_method.detached': {
      const { error } = await supabase
        .from('billing_methods')
        .update({ payment_method_id: null, brand: null, last4: null,
                  exp_month: null, exp_year: null })
        .eq('payment_method_id', object.id);
      if (error) throw new Error(error.message);
      break;
    }

    // Captured. `latest_charge` is what a dispute arrives against later, so it
    // gets recorded now while we have it.
    case 'payment_intent.succeeded': {
      // Booth rent and the closing balance are owed before they have an intent,
      // so the worker puts the payment id in the metadata and they settle by
      // that. A deposit already has its intent on the row and settles by it.
      const owedPaymentId = object.metadata?.payment_id;
      if (owedPaymentId) {
        const { error } = await supabase.rpc('settle_payment_by_id', {
          p_payment_id: owedPaymentId,
          p_payment_intent_id: object.id,
          p_amount_cents: object.amount_received ?? 0,
          p_charge_id: object.latest_charge ?? null,
        });
        if (error) throw new Error(error.message);
        break;
      }

      const { error } = await supabase.rpc('settle_deposit', {
        p_payment_intent_id: object.id,
        p_outcome: 'captured',
        p_captured_cents: object.amount_received ?? null,
        p_charge_id: object.latest_charge ?? null,
      });
      if (error) throw new Error(error.message);
      break;
    }

    // The hold was let go without a charge.
    case 'payment_intent.canceled': {
      const { error } = await supabase.rpc('settle_deposit', {
        p_payment_intent_id: object.id,
        p_outcome: 'released',
        p_captured_cents: null,
        p_charge_id: null,
      });
      if (error) throw new Error(error.message);
      break;
    }

    case 'payment_intent.payment_failed': {
      const reason = object.last_payment_error?.message ?? null;
      const owedPaymentId = object.metadata?.payment_id;

      // Matched by id for rent and balances, by intent for deposits. The update
      // trigger on `payments` mirrors a rent failure onto booth_rents, so the
      // salon owner learns the rent did not arrive without being shown anything
      // else about the renter.
      const query = supabase
        .from('payments')
        .update({ status: 'failed', failure_reason: reason })
        .eq('status', 'authorized');

      const { error } = owedPaymentId
        ? await query.eq('id', owedPaymentId)
        : await query.eq('stripe_payment_intent_id', object.id);
      if (error) throw new Error(error.message);
      break;
    }

    // Money going back out. Stripe reports the running total, so this is
    // idempotent by construction: a replay writes the same figure.
    case 'charge.refunded': {
      const { error } = await supabase.rpc('record_refund', {
        p_payment_intent_id: object.payment_intent,
        p_refunded_cents: object.amount_refunded ?? 0,
      });
      if (error) throw new Error(error.message);
      break;
    }

    // A chargeback. `dispute_evidence` already assembles the bundle from what
    // the app captured for its own reasons; this starts the clock on sending it.
    case 'charge.dispute.created': {
      const { error } = await supabase.rpc('record_dispute', {
        p_charge_id: object.charge,
        p_dispute_id: object.id,
      });
      if (error) throw new Error(error.message);
      break;
    }

    // Connect onboarding progressed. Mirrored so the app can gate booking on
    // readiness without an API round trip on every screen.
    case 'account.updated':
    case 'v2.core.account.updated': {
      const capabilities = object.capabilities ?? {};
      const { error } = await supabase
        .from('stripe_accounts')
        .update({
          details_submitted: object.details_submitted ?? false,
          charges_enabled: object.charges_enabled ?? capabilities.card_payments === 'active',
          payouts_enabled: object.payouts_enabled ?? false,
          requirements_due: object.requirements?.currently_due ?? [],
          onboarded_at: object.charges_enabled ? new Date().toISOString() : null,
        })
        .eq('stripe_account_id', object.id);
      if (error) throw new Error(error.message);
      break;
    }

    default:
      // Unhandled types are still claimed in the ledger and acknowledged.
      // Returning non-2xx would make Stripe retry something we will never act
      // on, and a noisy retry queue hides the failures that matter.
      console.log(`[stripe-webhook] ignoring ${event.type}`);
  }
}
