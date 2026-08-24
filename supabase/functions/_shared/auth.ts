import { createClient, type SupabaseClient } from 'jsr:@supabase/supabase-js@2';

/** Client bound to the caller's JWT, so RLS applies exactly as it would in-app. */
export function callerClient(req: Request): SupabaseClient {
  const auth = req.headers.get('Authorization') ?? '';
  return createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: auth } },
  });
}

/**
 * Service-role client, bypassing RLS.
 *
 * Only for work no user is present for — webhooks, scheduled jobs. Never use it
 * to serve a user request: that would step around the tenant firewall the whole
 * architecture depends on.
 */
export function serviceClient(): SupabaseClient {
  return createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );
}

export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
