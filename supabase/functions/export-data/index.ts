import { callerClient, serviceClient, json } from '../_shared/auth.ts';

const BUCKET = 'data-exports';

/**
 * "Take everything you own and go."
 *
 * PLAN.md's no-lock-in principle, made real. A stylist whose client book is
 * trapped inside their landlord's app is a stylist whose landlord controls
 * their business — which is the behavioural-control problem the entire tenant
 * model exists to avoid. So this has to work, and it has to produce something
 * a person can actually open.
 *
 * Output is both JSON (complete, re-importable) and CSV (openable in
 * Numbers/Excel by someone who is not a developer, which is the realistic
 * case).
 */
Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);

  const { tenant_id } = await req.json().catch(() => ({}));
  if (!tenant_id) return json({ error: 'tenant_id is required' }, 400);

  const supabase = callerClient(req);
  const { data: user } = await supabase.auth.getUser();
  if (!user?.user) return json({ error: 'not signed in' }, 401);

  // Assembled AS THE CALLER, so `export_tenant_data` refuses a tenant they do
  // not belong to. The service-role client below only writes the result.
  const { data: payload, error } = await supabase.rpc('export_tenant_data', {
    p_tenant_id: tenant_id,
  });
  if (error) return json({ error: error.message }, 403);

  const exportId = crypto.randomUUID();
  const base = `${tenant_id}/${exportId}`;
  // Writes go through service_role: the app should not be able to place
  // arbitrary files in a bucket whose name implies they are authoritative.
  const admin = serviceClient();

  const files: { name: string; body: string; type: string }[] = [
    { name: 'everything.json', body: JSON.stringify(payload, null, 2), type: 'application/json' },
    { name: 'clients.csv', body: toCsv(payload.clients ?? []), type: 'text/csv' },
    { name: 'appointments.csv', body: toCsv((payload.appointments ?? []).map(flattenAppointment), ), type: 'text/csv' },
    { name: 'formulas.csv', body: toCsv((payload.formulas ?? []).map(flattenFormula)), type: 'text/csv' },
    { name: 'consents.csv', body: toCsv(payload.consents ?? []), type: 'text/csv' },
    { name: 'payments.csv', body: toCsv(payload.payments ?? []), type: 'text/csv' },
  ];

  for (const f of files) {
    const up = await admin.storage
      .from(BUCKET)
      .upload(`${base}/${f.name}`, new Blob([f.body], { type: f.type }), {
        contentType: f.type,
        upsert: true,
      });
    if (up.error) return json({ error: up.error.message }, 500);
  }

  // The image files themselves are not bundled — zipping them in Deno is a lot
  // of machinery for a rare operation. Instead every photo gets its own signed
  // link, valid long enough to actually download them.
  const photoPaths = (payload.photos ?? []).map((p: { storage_path: string }) => p.storage_path);
  const { data: photoLinks } = photoPaths.length
    ? await admin.storage.from('formula-photos').createSignedUrls(photoPaths, 60 * 60 * 24 * 7)
    : { data: [] };

  if (photoLinks?.length) {
    const manifest = toCsv(
      photoLinks.map((l) => ({ path: l.path ?? '', download_url: l.signedUrl ?? '', error: l.error ?? '' })),
    );
    await admin.storage.from(BUCKET).upload(`${base}/photo-links.csv`, new Blob([manifest], { type: 'text/csv' }), {
      contentType: 'text/csv',
      upsert: true,
    });
    files.push({ name: 'photo-links.csv', body: manifest, type: 'text/csv' });
  }

  // Signed so the app can hand them straight to a browser. A bearer token
  // cannot ride along on a plain download link, which is exactly why the
  // bucket is private and these are short-lived instead.
  const { data: signed, error: signErr } = await admin.storage
    .from(BUCKET)
    .createSignedUrls(files.map((f) => `${base}/${f.name}`), 60 * 60);
  if (signErr) return json({ error: signErr.message }, 500);

  return json({
    export_id: exportId,
    counts: {
      clients: (payload.clients ?? []).length,
      appointments: (payload.appointments ?? []).length,
      formulas: (payload.formulas ?? []).length,
      photos: (payload.photos ?? []).length,
      consents: (payload.consents ?? []).length,
      payments: (payload.payments ?? []).length,
    },
    files: (signed ?? []).map((s) => ({
      name: (s.path ?? '').split('/').pop(),
      url: s.signedUrl,
    })),
  });
});

/** Flattened so a spreadsheet shows services instead of a JSON blob. */
function flattenAppointment(a: Record<string, any>) {
  return {
    id: a.id,
    starts_at: a.starts_at,
    status: a.status,
    client: a.client,
    total_cents: a.total_cents,
    for_child: a.is_for_child ? a.child_first_name ?? 'yes' : '',
    services: (a.services ?? []).map((s: { name: string }) => s.name).join('; '),
  };
}

function flattenFormula(f: Record<string, any>) {
  return {
    id: f.id,
    created_at: f.created_at,
    appointment_id: f.appointment_id,
    // "Shades EQ 09V 40g + 9V 20g" reads back the way a stylist would write it.
    mix: (f.components ?? [])
      .map((c: { product: string; grams?: number }) => (c.grams ? `${c.product} ${c.grams}g` : c.product))
      .join(' + '),
    developer_volume: f.developer_volume,
    processing_time_minutes: f.processing_time_minutes,
    technique_notes: f.technique_notes,
  };
}

/**
 * Minimal RFC 4180 CSV.
 *
 * Quoting is the whole job. Technique notes contain commas and newlines as a
 * matter of course, and a client called O'Brien or "Sam, Jr." breaks a naive
 * join — silently, into a file the stylist only opens after they have left.
 */
function toCsv(rows: Record<string, unknown>[]): string {
  if (!rows.length) return '';
  const headers = [...new Set(rows.flatMap((r) => Object.keys(r)))];

  const cell = (v: unknown) => {
    if (v === null || v === undefined) return '';
    const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
    // Quote when it could otherwise break the row, and double any inner quote.
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };

  return [
    headers.join(','),
    ...rows.map((r) => headers.map((h) => cell(r[h])).join(',')),
  ].join('\r\n');
}
