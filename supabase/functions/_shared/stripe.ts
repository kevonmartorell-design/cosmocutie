/**
 * Thin Stripe client.
 *
 * Deliberately not the official SDK: edge functions run on Deno, the surface we
 * need is small, and the v2 API is plain JSON. Fewer moving parts to break on a
 * runtime that is not the SDK's primary target.
 *
 * The API version is pinned. Stripe's v2 endpoints REQUIRE an explicit version
 * header — omitting it is a 400, not a default — and pinning means a Stripe
 * release cannot silently change behaviour underneath us.
 */
export const STRIPE_VERSION = '2026-07-29.dahlia';

const key = () => {
  const k = Deno.env.get('STRIPE_SECRET_KEY');
  if (!k) throw new Error('STRIPE_SECRET_KEY is not set');
  return k;
};

export type StripeResult<T> = { ok: true; data: T } | { ok: false; error: string; status: number };

async function parse<T>(res: Response): Promise<StripeResult<T>> {
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    return {
      ok: false,
      status: res.status,
      error: json?.error?.message ?? json?.message ?? `Stripe returned ${res.status}`,
    };
  }
  return { ok: true, data: json as T };
}

/** v2 endpoints: JSON bodies, mandatory version header. */
export async function stripeV2<T>(path: string, body: unknown): Promise<StripeResult<T>> {
  return parse<T>(
    await fetch(`https://api.stripe.com/v2${path}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key()}`,
        'Content-Type': 'application/json',
        'Stripe-Version': STRIPE_VERSION,
      },
      body: JSON.stringify(body),
    }),
  );
}

/**
 * v1 endpoints: form-encoded. Payment intents still live here.
 *
 * `stripeAccount` sets the Stripe-Account header, which makes the call act AS
 * the connected account — that is what keeps a 1099 renter merchant of record
 * rather than routing their takings through the platform.
 *
 * `idempotencyKey` matters on anything that moves money: a retried request
 * with the same key returns the original result instead of charging twice.
 */
export async function stripeV1<T>(
  path: string,
  params: Record<string, string>,
  opts: { stripeAccount?: string; idempotencyKey?: string; method?: 'POST' | 'GET' } = {},
): Promise<StripeResult<T>> {
  const headers: Record<string, string> = { Authorization: `Bearer ${key()}` };
  if (opts.stripeAccount) headers['Stripe-Account'] = opts.stripeAccount;
  if (opts.idempotencyKey) headers['Idempotency-Key'] = opts.idempotencyKey;

  const method = opts.method ?? 'POST';
  if (method === 'GET') {
    const qs = new URLSearchParams(params).toString();
    return parse<T>(await fetch(`https://api.stripe.com/v1${path}${qs ? `?${qs}` : ''}`, { headers }));
  }

  headers['Content-Type'] = 'application/x-www-form-urlencoded';
  return parse<T>(
    await fetch(`https://api.stripe.com/v1${path}`, {
      method,
      headers,
      body: new URLSearchParams(params),
    }),
  );
}
