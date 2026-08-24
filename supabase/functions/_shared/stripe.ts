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

/**
 * Verifies a Stripe webhook signature.
 *
 * Hand-rolled because the official SDK's verifier expects Node crypto. The
 * scheme is documented and small: sign `${timestamp}.${rawBody}` with the
 * endpoint secret and compare against the `v1=` entries in the header.
 *
 * Three things here are load-bearing, and each is a way people get this wrong:
 *
 *   - The RAW body must be hashed, byte for byte. Parsing the JSON and
 *     re-serialising it changes key order and whitespace, and the signature
 *     stops matching for reasons that look like a Stripe bug.
 *   - The comparison is timing-safe. A byte-by-byte early return leaks how much
 *     of a forged signature was correct, which is enough to forge one.
 *   - The timestamp is checked. Without it a valid old event can be replayed
 *     forever by anyone who captured it once.
 */
export async function verifyStripeSignature(
  rawBody: string,
  signatureHeader: string | null,
  secret: string,
  toleranceSeconds = 300,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!signatureHeader) return { ok: false, error: 'missing Stripe-Signature header' };

  const parts = new Map<string, string[]>();
  for (const piece of signatureHeader.split(',')) {
    const [k, v] = piece.split('=', 2);
    if (!k || !v) continue;
    parts.set(k.trim(), [...(parts.get(k.trim()) ?? []), v.trim()]);
  }

  const timestamp = parts.get('t')?.[0];
  const signatures = parts.get('v1') ?? [];
  if (!timestamp || signatures.length === 0) {
    return { ok: false, error: 'malformed Stripe-Signature header' };
  }

  const age = Math.abs(Math.floor(Date.now() / 1000) - Number(timestamp));
  if (!Number.isFinite(age) || age > toleranceSeconds) {
    return { ok: false, error: 'timestamp outside tolerance' };
  }

  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const mac = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(`${timestamp}.${rawBody}`),
  );
  const expected = [...new Uint8Array(mac)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

  // Stripe sends more than one v1 when an endpoint secret is being rotated, so
  // any match counts. Every candidate is compared in full.
  const match = signatures.some((candidate) => timingSafeEqual(candidate, expected));
  return match ? { ok: true } : { ok: false, error: 'signature mismatch' };
}

/** Constant time for equal-length inputs; length alone is not a secret here. */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
