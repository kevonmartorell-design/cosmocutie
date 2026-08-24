import { callerClient, json } from '../_shared/auth.ts';
import { stripeV1 } from '../_shared/stripe.ts';

const APP_URL = Deno.env.get('APP_URL') ?? 'https://cosmocutie.vercel.app';

/**
 * Saves the payment method a chair pays its booth rent with.
 *
 * This is the opposite direction from `stripe-connect`: that sets up how a
 * stylist gets PAID, this sets up how they PAY. They are kept apart on purpose,
 * because putting a renter's personal card alongside their payout account
 * invites exactly the conflation the tenant model exists to prevent.
 *
 * A hosted setup session, so no card detail passes through the app. Nothing is
 * charged here — Stripe stores the instrument and hands back a token.
 */
Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);

  const { tenant_id } = await req.json().catch(() => ({}));
  if (!tenant_id) return json({ error: 'tenant_id is required' }, 400);

  const supabase = callerClient(req);
  const { data: user } = await supabase.auth.getUser();
  if (!user?.user) return json({ error: 'not signed in' }, 401);

  // RLS decides this: the select returns nothing unless the caller belongs to
  // the tenant, so we never have to ask who they are.
  const { data: membership } = await supabase
    .from('tenant_members')
    .select('tenant_id')
    .eq('tenant_id', tenant_id)
    .eq('profile_id', user.user.id)
    .eq('is_active', true)
    .maybeSingle();
  if (!membership) return json({ error: 'not your chair' }, 403);

  const { data: existing } = await supabase
    .from('billing_methods')
    .select('stripe_customer_id')
    .eq('tenant_id', tenant_id)
    .maybeSingle();

  let customerId = existing?.stripe_customer_id ?? null;

  if (!customerId) {
    const { data: tenant } = await supabase
      .from('tenants')
      .select('name')
      .eq('id', tenant_id)
      .maybeSingle();

    const created = await stripeV1<{ id: string }>(
      '/customers',
      {
        email: user.user.email ?? '',
        name: tenant?.name ?? 'Chair',
        // Carried so an incoming webhook can be traced back to the chair
        // without a lookup table on our side.
        'metadata[tenant_id]': tenant_id,
      },
      { idempotencyKey: `rent-customer-${tenant_id}` },
    );
    if (!created.ok) return json({ error: created.error }, 502);

    customerId = created.data.id;
    const { error } = await supabase
      .from('billing_methods')
      .upsert({ tenant_id, stripe_customer_id: customerId }, { onConflict: 'tenant_id' });
    if (error) return json({ error: error.message }, 500);
  }

  const session = await stripeV1<{ id: string; url: string }>('/checkout/sessions', {
    mode: 'setup',
    customer: customerId,
    // setup_intent_data, NOT payment_intent_data — a setup session creates a
    // SetupIntent and nothing else, and passing payment_intent_data here is a
    // 400. The SetupIntent it creates is already `usage=off_session`, which is
    // what lets rent be charged later with nobody present.
    'setup_intent_data[metadata][tenant_id]': tenant_id,
    'setup_intent_data[description]': 'Booth rent payment method',
    'metadata[tenant_id]': tenant_id,
    success_url: `${APP_URL}/stripe/rent-saved?tenant=${tenant_id}`,
    cancel_url: `${APP_URL}/stripe/rent-cancelled?tenant=${tenant_id}`,
  });
  if (!session.ok) return json({ error: session.error }, 502);

  return json({ setup_url: session.data.url, customer_id: customerId });
});
