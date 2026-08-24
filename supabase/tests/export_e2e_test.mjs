/**
 * Data export, end to end.
 *
 * The no-lock-in principle only counts if the file actually opens. So the
 * fixture is deliberately hostile: a client whose name contains a comma and an
 * apostrophe, technique notes containing quotes and a newline. Those are not
 * edge cases — they are Tuesday — and a naive CSV writer corrupts them
 * silently, into a file the stylist only discovers is broken after they have
 * left the salon.
 */
import { execFileSync } from 'node:child_process';

const API = 'http://127.0.0.1:54321';
const status = JSON.parse(execFileSync('npx', ['supabase','status','-o','json']).toString());
const ANON = status.ANON_KEY;

const sql = (q) => execFileSync('docker',['exec','-i','supabase_db_CosmoCutie','psql','-U','postgres','-d','postgres','-tAc',q])
  .toString().trim().split('\n')[0].trim();

let pass = 0, fail = 0;
const check = (name, cond, detail = '') => {
  cond ? pass++ : fail++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : `  -> ${detail}`}`);
};

const post = async (path, body, token) => {
  const res = await fetch(API + path, {
    method: 'POST',
    headers: { apikey: ANON, 'Content-Type': 'application/json', Authorization: `Bearer ${token || ANON}` },
    body: JSON.stringify(body),
  });
  const t = await res.text();
  return { status: res.status, json: t ? JSON.parse(t) : null };
};

/** Independent RFC 4180 parser, so a bug in the writer cannot hide behind itself. */
function parseCsv(text) {
  const rows = [];
  let row = [], cell = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++; } else quoted = false;
      } else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\r' && text[i + 1] === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; i++; }
    else if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

// ---------------------------------------------------------------- fixture ---
const signUp = async (email, name) =>
  (await post('/auth/v1/signup', { email, password: 'Testing12345!', data: { full_name: name } })).json.access_token;

const ownerTok = await signUp('owner@exp.test', 'Owner');
const raeTok = await signUp('rae@exp.test', 'Rae');

await post('/rest/v1/rpc/create_salon', { salon_name: 'Export Salon', salon_timezone: 'UTC' }, ownerTok);
await post('/rest/v1/rpc/invite_stylist', {
  p_display_name: 'Rae', p_email: 'rae@exp.test',
  p_classification: 'contractor_1099', p_booth_rent_cents: 25000 }, ownerTok);
await post('/rest/v1/rpc/claim_stylist_invitation', {}, raeTok);

const chair = sql(`select id from tenants where kind='stylist' and name like 'Rae%' limit 1`);

// The hostile bits.
const NASTY_NAME = `O'Brien, Sam "Jr."`;
const NASTY_NOTES = `Root smudge, 20vol\nthen glossed — client said "warmer next time"`;
sql(`insert into clients (full_name, phone, email) values ($$${NASTY_NAME}$$, '+15125550100', 'sam@x.test')`);
sql(`insert into client_records (tenant_id, client_id) select '${chair}', id from clients limit 1`);

// A formula belongs to an appointment, not just a client — the schema enforces
// what PLAN.md requires, so the fixture has to honour it too.
const raeProfile = sql(`select profile_id from tenant_members where tenant_id='${chair}' and role='stylist' limit 1`);
sql(`insert into appointments
       (tenant_id, stylist_id, client_id, client_record_id, starts_at, ends_at,
        buffer_starts_at, buffer_ends_at, status, total_price_cents)
     select '${chair}', '${raeProfile}', c.id, cr.id,
            now() - interval '2 days', now() - interval '2 days' + interval '2 hours',
            now() - interval '2 days' - interval '30 minutes',
            now() - interval '2 days' + interval '2 hours 30 minutes',
            'completed', 30000
     from client_records cr join clients c on c.id = cr.client_id limit 1`);

sql(`insert into formulas (tenant_id, appointment_id, client_record_id, components, developer_volume, technique_notes)
     select '${chair}', a.id, cr.id, '[{"product":"Shades EQ 09V","grams":40}]'::jsonb, '20', $$${NASTY_NOTES}$$
     from client_records cr join appointments a on a.tenant_id = cr.tenant_id limit 1`);

console.log('--- the export runs, and only for your own chair ---');
let r = await post('/functions/v1/export-data', { tenant_id: chair }, raeTok);
check('stylist exports their own chair', r.status === 200, JSON.stringify(r.json).slice(0, 200));
check('it reports what it found', r.json?.counts?.clients === 1 && r.json?.counts?.formulas === 1,
  JSON.stringify(r.json?.counts));
check('it returns downloadable files', (r.json?.files ?? []).length >= 6, `${(r.json?.files ?? []).length} files`);

// Signed URLs are built from the SUPABASE_URL the FUNCTION sees, which inside
// Docker is http://kong:8000 — unreachable from the host. In production that
// variable is the real project URL, so this rewrite is purely a local-testing
// accommodation and not papering over a bug.
const reachable = (u) => (u ?? '').replace('http://kong:8000', API);
const files = Object.fromEntries((r.json?.files ?? []).map((f) => [f.name, reachable(f.url)]));
check('everything.json is there', !!files['everything.json']);
check('clients.csv is there', !!files['clients.csv']);
check('formulas.csv is there', !!files['formulas.csv']);

console.log('\n--- THE FIREWALL: the landlord cannot export the book ---');
// The whole reason the export exists is that the book belongs to the renter.
// It would be a poor joke if the export itself handed it to the owner.
r = await post('/functions/v1/export-data', { tenant_id: chair }, ownerTok);
check('owner exports a renter chair', r.status !== 200, `HTTP ${r.status} — LEAK`);

console.log('\n--- the awkward characters survive ---');
const clientsCsv = await (await fetch(files['clients.csv'])).text();
const rows = parseCsv(clientsCsv);
const nameCol = rows[0].indexOf('name');
check('the CSV parses as one header + one row', rows.length === 2, `${rows.length} rows`);
check('a name with a comma and quotes round-trips',
  rows[1]?.[nameCol] === NASTY_NAME, JSON.stringify(rows[1]?.[nameCol]));

const formulasCsv = await (await fetch(files['formulas.csv'])).text();
const frows = parseCsv(formulasCsv);
const notesCol = frows[0].indexOf('technique_notes');
check('notes containing a NEWLINE stay in one cell', frows.length === 2, `${frows.length} rows`);
check('notes round-trip exactly', frows[1]?.[notesCol] === NASTY_NOTES,
  JSON.stringify(frows[1]?.[notesCol]));

const mixCol = frows[0].indexOf('mix');
check('the mix reads the way a stylist writes it',
  frows[1]?.[mixCol] === 'Shades EQ 09V 40g', JSON.stringify(frows[1]?.[mixCol]));

console.log('\n--- the JSON is complete and valid ---');
const everything = JSON.parse(await (await fetch(files['everything.json'])).text());
check('JSON parses', typeof everything === 'object');
check('client book is in it', everything.clients?.[0]?.name === NASTY_NAME);
check('contact details come too', everything.clients?.[0]?.phone === '+15125550100');
check('formula notes are in it', everything.formulas?.[0]?.technique_notes === NASTY_NOTES);

console.log('\n--- an export is not readable by another tenant ---');
const path = new URL(files['clients.csv']).pathname;
r = await fetch(`${API}${path}`); // no token, no signature
check('unsigned fetch of the export path', !r.ok, `HTTP ${r.status} — LEAK`);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
