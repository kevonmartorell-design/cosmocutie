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
        const { error } = await supabase.rpc('settle_checkout_payment', {
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

    // Captured. `latest_charge` is what a dispute arrives against later, so it
    // gets recorded now while we have it.
    case 'payment_intent.succeeded': {
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
      const { error } = await supabase
        .from('payments')
        .update({ status: 'failed', failure_reason: object.last_payment_error?.message ?? null })
        .eq('stripe_payment_intent_id', object.id)
        .eq('status', 'authorized');
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
