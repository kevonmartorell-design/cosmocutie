/**
 * Photo storage, end to end against the running storage service.
 *
 * The policies on `storage.objects` are enforced by the storage service, not by
 * Postgres alone, so psql cannot prove them. This uploads and downloads real
 * bytes as two real stylists in different tenants and checks who can reach
 * what.
 *
 * This is the half of the tenant firewall that is easiest to leave open: the
 * `formula_photos` ROW is isolated by RLS from day one, but the FILE lives in a
 * different subsystem. Without these policies anyone holding a path could fetch
 * another stylist's client photos while every database check still passed.
 */
import { execFileSync } from 'node:child_process';

const API = 'http://127.0.0.1:54321';
const BUCKET = 'formula-photos';
const status = JSON.parse(execFileSync('npx', ['supabase', 'status', '-o', 'json']).toString());
const ANON = status.ANON_KEY;

const sql = (q) =>
  execFileSync('docker', ['exec','-i','supabase_db_CosmoCutie','psql','-U','postgres','-d','postgres','-tAc',q])
    .toString().trim().split('\n')[0].trim();

let pass = 0, fail = 0;
const check = (name, cond, detail = '') => {
  cond ? pass++ : fail++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : `  -> ${detail}`}`);
};

const post = async (path, body, token = ANON) => {
  const res = await fetch(API + path, {
    method: 'POST',
    headers: { apikey: ANON, 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, json: text ? JSON.parse(text) : null };
};

// A real 1x1 JPEG. Small, but genuinely image/jpeg so the bucket's MIME filter
// is exercised rather than sidestepped.
const JPEG = Buffer.from(
  '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0a' +
  'HBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAA' +
  'AAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==', 'base64');

const upload = (path, token, body = JPEG, type = 'image/jpeg') =>
  fetch(`${API}/storage/v1/object/${BUCKET}/${path}`, {
    method: 'POST',
    headers: { apikey: ANON, Authorization: `Bearer ${token}`, 'Content-Type': type },
    body,
  });

const download = (path, token) =>
  fetch(`${API}/storage/v1/object/${BUCKET}/${path}`, {
    headers: { apikey: ANON, Authorization: `Bearer ${token}` },
  });

// ---------------------------------------------------------------- fixture ---
// Two stylists in DIFFERENT tenants, both real users with real sessions.
const signUp = async (email, name) => {
  const r = await post('/auth/v1/signup', { email, password: 'Testing12345!', data: { full_name: name } });
  return r.json.access_token;
};

const ownerTok = await signUp('owner@photo.test', 'Owner');
const raeTok = await signUp('rae@photo.test', 'Rae');

await post('/rest/v1/rpc/create_salon', { salon_name: 'Photo Salon', salon_timezone: 'UTC' }, ownerTok);
await post('/rest/v1/rpc/invite_stylist', {
  p_display_name: 'Rae', p_email: 'rae@photo.test',
  p_classification: 'contractor_1099', p_booth_rent_cents: 25000,
}, ownerTok);
await post('/rest/v1/rpc/claim_stylist_invitation', {}, raeTok);

const raeChair = sql(`select id from tenants where kind='stylist' and name like 'Rae%' limit 1`);
const ownerChair = sql(`select id from tenants where kind='stylist' and name not like 'Rae%' and kind='stylist' limit 1`);
const apptId = '00000000-0000-0000-0000-0000000000aa';

const rae = `${raeChair}/${apptId}/before.jpg`;
const owner = `${ownerChair}/${apptId}/before.jpg`;

console.log('--- a stylist can store and retrieve their own photo ---');
let r = await upload(rae, raeTok);
check('upload into own tenant folder', r.ok, `HTTP ${r.status} ${await r.text().catch(()=> '')}`);

r = await download(rae, raeTok);
const bytes = r.ok ? Buffer.from(await r.arrayBuffer()) : null;
check('download it back', r.ok, `HTTP ${r.status}`);
check('bytes come back intact', bytes !== null && bytes.equals(JPEG),
  bytes ? `${bytes.length} vs ${JPEG.length}` : 'no body');

console.log('\n--- THE FIREWALL: another tenant cannot reach it ---');
// The whole point. A path is not a secret — it is derivable from ids the other
// stylist may legitimately have seen. Knowing it must not be enough.
r = await download(rae, ownerTok);
check('salon owner downloads a renter photo', !r.ok, `HTTP ${r.status} — LEAK`);

r = await upload(`${raeChair}/${apptId}/planted.jpg`, ownerTok);
check('salon owner writes INTO a renter folder', !r.ok, `HTTP ${r.status} — LEAK`);

r = await upload(owner, ownerTok);
check('owner can still use their own folder', r.ok, `HTTP ${r.status}`);

r = await download(owner, raeTok);
check('renter downloads the owner photo', !r.ok, `HTTP ${r.status} — LEAK`);

console.log('\n--- anonymous gets nothing ---');
r = await download(rae, ANON);
check('anon downloads a photo', !r.ok, `HTTP ${r.status} — LEAK`);

r = await fetch(`${API}/storage/v1/object/public/${BUCKET}/${rae}`);
check('bucket is not served publicly', !r.ok, `HTTP ${r.status} — LEAK`);

console.log('\n--- the bucket refuses what it should ---');
r = await upload(`${raeChair}/${apptId}/notes.pdf`, raeTok, Buffer.from('%PDF-1.4 fake'), 'application/pdf');
check('a PDF is refused', !r.ok, `HTTP ${r.status}`);

r = await upload(`${raeChair}/${apptId}/huge.jpg`, raeTok, Buffer.alloc(3 * 1024 * 1024, 1));
check('an over-size image is refused', !r.ok, `HTTP ${r.status}`);

console.log('\n--- deleting is scoped the same way ---');
r = await fetch(`${API}/storage/v1/object/${BUCKET}/${rae}`, {
  method: 'DELETE', headers: { apikey: ANON, Authorization: `Bearer ${ownerTok}` },
});
check('owner deletes a renter photo', !r.ok, `HTTP ${r.status} — LEAK`);

r = await fetch(`${API}/storage/v1/object/${BUCKET}/${rae}`, {
  method: 'DELETE', headers: { apikey: ANON, Authorization: `Bearer ${raeTok}` },
});
check('stylist deletes their own photo', r.ok, `HTTP ${r.status}`);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
