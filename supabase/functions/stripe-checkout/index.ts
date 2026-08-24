import { callerClient, json } from '../_shared/auth.ts';
import { stripeV1 } from '../_shared/stripe.ts';

const APP_URL = Deno.env.get('APP_URL') ?? 'https://cosmocutie.vercel.app';

/**
 * Opens a hosted Stripe payment page for a booking request's deposit.
 *
 * Hosted rather than an in-app PaymentSheet on purpose: PaymentSheet is a
 * native module, and adding one means a new EAS build. This ships over the air
 * and Stripe hosts the card form, so no card detail ever touches the app or
 * this function. PaymentSheet remains a later polish step, batched with the
 * other native additions.
 *
 * The session is created with manual capture. The client's card is authorised
 * at booking and nothing is taken until the stylist accepts — which is the
 * whole point of the deposit, and what the 48h negotiation cap exists to keep
 * inside a card authorisation's lifetime.
 */
Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);

  // Two things get paid for through this function: the deposit that secures a
  // booking, and the balance at the end of the service. They differ in one way
  // that matters — a deposit is authorised and captured later, a balance is
  // taken outright — so they share everything except capture_method.
  const { request_id, payment_id } = await req.json().catch(() => ({}));
  if (!request_id && !payment_id) {
    return json({ error: 'request_id or payment_id is required' }, 400);
  }

  const supabase = callerClient(req);
  const { data: user } = await supabase.auth.getUser();
  if (!user?.user) return json({ error: 'not signed in' }, 401);

  if (payment_id) return await balanceSession(supabase, payment_id);

  // RLS decides whether this request is visible to the caller. A client who
  // does not own it gets nothing back, and we never have to ask who they are.
  const { data: request } = await supabase
    .from('booking_requests')
    .select(
      'id, tenant_id, status, deposit_required, deposit_amount_cents, ' +
        'stripe_payment_intent_id, stripe_checkout_session_id',
    )
    .eq('id', request_id)
    .maybeSingle();

  if (!request) return json({ error: 'no such request' }, 404);
  if (!request.deposit_required || request.deposit_amount_cents <= 0) {
    return json({ error: 'this booking does not take a deposit' }, 400);
  }
  if (!['awaiting_stylist', 'awaiting_client'].includes(request.status)) {
    return json({ error: 'that request is closed' }, 409);
  }
  if (request.stripe_payment_intent_id) {
    return json({ error: 'a deposit is already held for this booking' }, 409);
  }

  // Where the money lands is decided by worker classification, in the database,
  // not by this function. A 1099 renter is merchant of record on their own
  // account; a W-2 stylist is settled to theirs from the platform's.
  const { data: route } = await supabase.rpc('route_for_tenant', {
    p_tenant_id: request.tenant_id,
  });

  const { data: account } = await supabase
    .from('stripe_accounts')
    .select('stripe_account_id, charges_enabled')
    .eq('tenant_id', request.tenant_id)
    .maybeSingle();

  if (!account?.stripe_account_id || !account.charges_enabled) {
    // Worth being explicit: this is the stylist's onboarding being incomplete,
    // not anything the client did wrong.
    return json({ error: 'this stylist cannot take payments yet' }, 409);
  }

  const amount = request.deposit_amount_cents;
  const feeBps = Number(Deno.env.get('PLATFORM_FEE_BPS') ?? '0');
  // Integer maths throughout: a fee is a whole number of cents or it is a
  // rounding bug waiting to be reconciled by hand.
  const fee = Math.floor((amount * feeBps) / 10_000);

  const params: Record<string, string> = {
    mode: 'payment',
    'line_items[0][price_data][currency]': 'usd',
    'line_items[0][price_data][product_data][name]': 'Booking deposit',
    'line_items[0][price_data][unit_amount]': String(amount),
    'line_items[0][quantity]': '1',
    // Authorise now, take it only if the stylist accepts.
    'payment_intent_data[capture_method]': 'manual',
    // The webhook reads these back. They are how a completed session is tied to
    // the booking it paid for, so they must survive the round trip.
    'metadata[booking_request_id]': request.id,
    'metadata[tenant_id]': request.tenant_id,
    'payment_intent_data[metadata][booking_request_id]': request.id,
    success_url: `${APP_URL}/stripe/deposit-done?request=${request.id}`,
    cancel_url: `${APP_URL}/stripe/deposit-cancelled?request=${request.id}`,
  };

  const opts: { stripeAccount?: string; idempotencyKey: string } = {
    // One key per booking request: a double-tapped button returns the original
    // session instead of opening a second hold on the same card.
    idempotencyKey: `deposit-session-${request.id}`,
  };

  if (route === 'direct' || route === 'salon') {
    // Direct charge: the call acts AS the connected account, which is what
    // keeps the stylist merchant of record rather than routing their takings
    // through the platform.
    opts.stripeAccount = account.stripe_account_id;
    if (fee > 0) params['payment_intent_data[application_fee_amount]'] = String(fee);
  } else {
    // Destination charge: the platform is merchant of record and the funds
    // settle to the stylist's account. `on_behalf_of` puts them on the
    // statement and makes their account the settlement merchant.
    params['payment_intent_data[transfer_data][destination]'] = account.stripe_account_id;
    params['payment_intent_data[on_behalf_of]'] = account.stripe_account_id;
    if (fee > 0) params['payment_intent_data[application_fee_amount]'] = String(fee);
  }

  const session = await stripeV1<{ id: string; url: string; payment_intent: string | null }>(
    '/checkout/sessions',
    params,
    opts,
  );
  if (!session.ok) return json({ error: session.error }, 502);

  await supabase
    .from('booking_requests')
    .update({ stripe_checkout_session_id: session.data.id })
    .eq('id', request.id);

  // Deliberately NOT recording the payment here. Stripe may not have created
  // the PaymentIntent yet, and more to the point a session that was opened is
  // not a deposit that was authorised. The webhook records it when the client
  // actually pays.
  return json({ checkout_url: session.data.url, session_id: session.data.id });
});

/**
 * The closing balance at the end of a service.
 *
 * `record_checkout` has already worked out what is owed — services, less any
 * deposit that was captured, plus the tip — and written it as a payment row.
 * This only carries that figure to Stripe.
 *
 * Taken outright rather than authorised: the service has happened, so there is
 * nothing left to hold the money against.
 */
async function balanceSession(
  supabase: ReturnType<typeof callerClient>,
  paymentId: string,
): Promise<Response> {
  // RLS scopes this to the caller's own tenant, so a stylist can only close out
  // their own chair's appointments.
  const { data: payment } = await supabase
    .from('payments')
    .select('id, tenant_id, status, amount_cents, tip_cents, kind, stripe_payment_intent_id')
    .eq('id', paymentId)
    .maybeSingle();

  if (!payment) return json({ error: 'no such payment' }, 404);
  if (payment.kind !== 'service') return json({ error: 'not a checkout payment' }, 400);
  if (payment.status !== 'authorized') return json({ error: 'that balance is already settled' }, 409);
  if (payment.stripe_payment_intent_id) {
    return json({ error: 'payment already in progress' }, 409);
  }

  const due = (payment.amount_cents ?? 0) + (payment.tip_cents ?? 0);
  if (due <= 0) return json({ error: 'nothing left to pay' }, 400);

  const { data: route } = await supabase.rpc('route_for_tenant', {
    p_tenant_id: payment.tenant_id,
  });

  const { data: account } = await supabase
    .from('stripe_accounts')
    .select('stripe_account_id, charges_enabled')
    .eq('tenant_id', payment.tenant_id)
    .maybeSingle();

  if (!account?.stripe_account_id || !account.charges_enabled) {
    return json({ error: 'this chair cannot take payments yet' }, 409);
  }

  const feeBps = Number(Deno.env.get('PLATFORM_FEE_BPS') ?? '0');
  // The platform fee is charged on the service, never on the tip. A tip is the
  // client's money for the stylist, and taking a cut of it is indefensible.
  const fee = Math.floor(((payment.amount_cents ?? 0) * feeBps) / 10_000);

  const params: Record<string, string> = {
    mode: 'payment',
    'line_items[0][price_data][currency]': 'usd',
    'line_items[0][price_data][product_data][name]': 'Salon services',
    'line_items[0][price_data][unit_amount]': String(payment.amount_cents ?? 0),
    'line_items[0][quantity]': '1',
    'metadata[payment_id]': payment.id,
    'payment_intent_data[metadata][payment_id]': payment.id,
    success_url: `${APP_URL}/stripe/paid?payment=${payment.id}`,
    cancel_url: `${APP_URL}/stripe/payment-cancelled?payment=${payment.id}`,
  };

  // A separate line so the client sees what they tipped rather than one opaque
  // total, and so the receipt Stripe emails them matches the app.
  if ((payment.tip_cents ?? 0) > 0) {
    params['line_items[1][price_data][currency]'] = 'usd';
    params['line_items[1][price_data][product_data][name]'] = 'Tip';
    params['line_items[1][price_data][unit_amount]'] = String(payment.tip_cents);
    params['line_items[1][quantity]'] = '1';
  }

  const opts: { stripeAccount?: string; idempotencyKey: string } = {
    idempotencyKey: `checkout-${payment.id}`,
  };

  if (route === 'direct' || route === 'salon') {
    opts.stripeAccount = account.stripe_account_id;
    if (fee > 0) params['payment_intent_data[application_fee_amount]'] = String(fee);
  } else {
    params['payment_intent_data[transfer_data][destination]'] = account.stripe_account_id;
    params['payment_intent_data[on_behalf_of]'] = account.stripe_account_id;
    if (fee > 0) params['payment_intent_data[application_fee_amount]'] = String(fee);
  }

  const session = await stripeV1<{ id: string; url: string }>(
    '/checkout/sessions',
    params,
    opts,
  );
  if (!session.ok) return json({ error: session.error }, 502);

  await supabase
    .from('payments')
    .update({ stripe_checkout_session_id: session.data.id })
    .eq('id', payment.id);

  return json({ checkout_url: session.data.url, session_id: session.data.id });
}
