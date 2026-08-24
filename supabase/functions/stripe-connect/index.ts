import { callerClient, json } from '../_shared/auth.ts';
import { stripeV2 } from '../_shared/stripe.ts';

const APP_URL = Deno.env.get('APP_URL') ?? 'https://cosmocutie.vercel.app';

/**
 * Connect onboarding for one stylist's chair.
 *
 * Each chair gets its OWN Stripe account. A 1099 renter's money must never pass
 * through the salon's — routing it through the owner is the pattern that reads
 * as employment, which is what the whole tenant model exists to avoid.
 *
 * Returns a hosted onboarding URL. Stripe collects identity, bank details and
 * tax information; we never see or store any of it.
 */
Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);

  const { tenant_id } = await req.json().catch(() => ({}));
  if (!tenant_id) return json({ error: 'tenant_id is required' }, 400);

  const supabase = callerClient(req);
  const { data: user } = await supabase.auth.getUser();
  if (!user?.user) return json({ error: 'not signed in' }, 401);

  // RLS decides this, not us: the select returns nothing unless the caller
  // belongs to the tenant.
  const { data: membership } = await supabase
    .from('tenant_members')
    .select('tenant_id')
    .eq('tenant_id', tenant_id)
    .eq('profile_id', user.user.id)
    .eq('is_active', true)
    .maybeSingle();
  if (!membership) return json({ error: 'not your chair' }, 403);

  const { data: existing } = await supabase
    .from('stripe_accounts')
    .select('stripe_account_id, charges_enabled')
    .eq('tenant_id', tenant_id)
    .maybeSingle();

  let accountId = existing?.stripe_account_id ?? null;

  if (!accountId) {
    const { data: tenant } = await supabase
      .from('tenants')
      .select('name')
      .eq('id', tenant_id)
      .maybeSingle();

    const created = await stripeV2<{ id: string }>('/core/accounts', {
      contact_email: user.user.email,
      display_name: tenant?.name ?? 'Stylist',
      identity: { country: 'us', entity_type: 'individual' },
      // Stripe hosts the dashboard: the stylist gets payouts and tax documents
      // without us building or maintaining any of that.
      dashboard: 'express',
      configuration: {
        merchant: { capabilities: { card_payments: { requested: true } } },
      },
      defaults: {
        currency: 'usd',
        responsibilities: { fees_collector: 'application', losses_collector: 'application' },
      },
      include: ['configuration.merchant', 'requirements'],
    });
    if (!created.ok) return json({ error: created.error }, 502);

    accountId = created.data.id;
    const { error } = await supabase
      .from('stripe_accounts')
      .upsert({ tenant_id, stripe_account_id: accountId }, { onConflict: 'tenant_id' });
    if (error) return json({ error: error.message }, 500);
  }

  const link = await stripeV2<{ url: string }>('/core/account_links', {
    account: accountId,
    use_case: {
      type: 'account_onboarding',
      account_onboarding: {
        configurations: ['merchant'],
        refresh_url: `${APP_URL}/stripe/refresh?tenant=${tenant_id}`,
        return_url: `${APP_URL}/stripe/return?tenant=${tenant_id}`,
      },
    },
  });
  if (!link.ok) return json({ error: link.error }, 502);

  return json({ account_id: accountId, onboarding_url: link.data.url });
});
