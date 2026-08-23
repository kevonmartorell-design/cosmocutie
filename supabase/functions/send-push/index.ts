/**
 * Drains the notification queue to Expo's push service.
 *
 * Runs on a schedule rather than inline: a database trigger cannot make an HTTP
 * call, and a slow push service must never be able to hold up a booking
 * transaction. Queue on write, deliver out of band.
 */
import { createClient } from 'jsr:@supabase/supabase-js@2';

const EXPO_PUSH = 'https://exp.host/--/api/v2/push/send';
const BATCH = 100;

Deno.serve(async () => {
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    // Service role: this function must read across every tenant to deliver.
    // It is server-side only and never reaches the app bundle.
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  const { data: pending, error } = await supabase
    .from('notification_queue')
    .select('id, profile_id, title, body, data')
    .is('sent_at', null)
    .lt('attempts', 5)
    .order('created_at')
    .limit(BATCH);

  if (error) return new Response(error.message, { status: 500 });
  if (!pending?.length) return Response.json({ sent: 0 });

  const { data: tokens } = await supabase
    .from('push_tokens')
    .select('profile_id, token')
    .in('profile_id', [...new Set(pending.map((n) => n.profile_id))]);

  const byProfile = new Map<string, string[]>();
  for (const t of tokens ?? []) {
    byProfile.set(t.profile_id, [...(byProfile.get(t.profile_id) ?? []), t.token]);
  }

  const messages: Record<string, unknown>[] = [];
  const delivered: string[] = [];
  // A queued notification for someone with no registered device is not an
  // error — they simply have not opened the app on a phone yet. Mark it done
  // rather than retrying forever.
  const skipped: string[] = [];

  for (const n of pending) {
    const targets = byProfile.get(n.profile_id) ?? [];
    if (!targets.length) {
      skipped.push(n.id);
      continue;
    }
    for (const to of targets) {
      messages.push({ to, title: n.title, body: n.body, data: n.data, sound: 'default' });
    }
    delivered.push(n.id);
  }

  if (messages.length) {
    const res = await fetch(EXPO_PUSH, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept-Encoding': 'gzip, deflate' },
      body: JSON.stringify(messages),
    });
    if (!res.ok) {
      const text = await res.text();
      await supabase
        .from('notification_queue')
        .update({ attempts: 1, last_error: text.slice(0, 500) })
        .in('id', delivered);
      return new Response(text, { status: 502 });
    }
  }

  const done = [...delivered, ...skipped];
  if (done.length) {
    await supabase
      .from('notification_queue')
      .update({ sent_at: new Date().toISOString() })
      .in('id', done);
  }

  return Response.json({ sent: delivered.length, skipped: skipped.length });
});
