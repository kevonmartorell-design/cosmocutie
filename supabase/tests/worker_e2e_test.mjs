/**
 * Payment worker, end to end against the local stack.
 *
 * The env file carries a deliberately invalid Stripe key, so every call to
 * Stripe returns a real 401. That is the point: what needs proving here is not
 * that a capture succeeds — Stripe's sandbox proves that — but that a FAILING
 * job is handled correctly. A worker that strands jobs in `processing`, or
 * retries them hot, or marks them done anyway, is how a deposit silently never
 * gets taken.
 */
import { execFileSync } from 'node:child_process';

const URL = 'http://127.0.0.1:54321/functions/v1/payment-worker';

// Read from the running stack rather than hard-coded. The local one is the same
// well-known development value on every machine, but no key belongs in the repo
// — including the ones that are not secret, because the habit is what matters.
const SERVICE_KEY = JSON.parse(
  execFileSync('npx', ['supabase', 'status', '-o', 'json']).toString(),
).SERVICE_ROLE_KEY;

const sql = (q) =>
  execFileSync('docker', ['exec','-i','supabase_db_CosmoCutie','psql','-U','postgres','-d','postgres','-tAc',q])
    .toString().trim();

let pass = 0, fail = 0;
const check = (name, cond, detail = '') => {
  cond ? pass++ : fail++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : `  -> ${detail}`}`);
};

const run = async () => {
  const res = await fetch(URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' },
  });
  return { status: res.status, json: await res.json().catch(() => ({})) };
};

console.log('--- an empty queue is not an error ---');
sql(`delete from payment_jobs`);
let r = await run();
check('idle run succeeds', r.status === 200, JSON.stringify(r.json));
check('reports nothing processed', r.json.processed === 0, JSON.stringify(r.json));

console.log('\n--- a failing job backs off instead of vanishing ---');
// Real payment, real connected account, invalid key: Stripe answers 401.
sql(`insert into payment_jobs (kind, tenant_id, stripe_payment_intent_id, payment_id)
     select 'capture', tenant_id, stripe_payment_intent_id, id from payments limit 1`);
r = await run();
check('run completes', r.status === 200, JSON.stringify(r.json));
check('job counted as failed', r.json.failed === 1, JSON.stringify(r.json));
check('not left stranded in processing',
  sql(`select count(*) from payment_jobs where status='processing'`) === '0');
check('returned to pending for retry',
  sql(`select status from payment_jobs limit 1`) === 'pending');
check('the reason was recorded',
  sql(`select last_error is not null from payment_jobs limit 1`) === 't');
check('attempts incremented',
  sql(`select attempts from payment_jobs limit 1`) === '1');
check('backed off rather than retried hot',
  sql(`select run_after > now() from payment_jobs limit 1`) === 't');

console.log('\n--- a backed-off job is not picked up again immediately ---');
r = await run();
check('second run finds nothing', r.json.processed === 0, JSON.stringify(r.json));

console.log('\n--- one bad job does not strand the rest of the batch ---');
sql(`update payment_jobs set run_after = now()`);
sql(`insert into payment_jobs (kind, tenant_id, stripe_payment_intent_id)
     select 'collect_rent', tenant_id, 'pi_rent_x' from payments limit 1`);
r = await run();
check('both jobs were handled', r.json.processed === 2, JSON.stringify(r.json));
check('nothing left in processing',
  sql(`select count(*) from payment_jobs where status='processing'`) === '0');
check('unimplemented rent fails loudly, not silently done',
  sql(`select count(*) from payment_jobs where kind='collect_rent' and status='done'`) === '0');
check('rent failure names the reason',
  sql(`select last_error like '%not implemented%' from payment_jobs where kind='collect_rent'`) === 't');

console.log('\n--- a job gives up after six attempts ---');
sql(`update payment_jobs set attempts=5, run_after=now(), status='pending' where kind='capture'`);
await run();
check('sixth failure marks it failed',
  sql(`select status from payment_jobs where kind='capture'`) === 'failed');
sql(`update payment_jobs set run_after=now() where kind='capture'`);
r = await run();
check('a failed job is never claimed again',
  sql(`select count(*) from payment_jobs where kind='capture' and status='processing'`) === '0');

console.log('\n--- the worker never writes the outcome itself ---');
// Capturing at Stripe AND marking the payment captured here would make the
// worker a second source of truth that can disagree with Stripe. It sends the
// instruction; the webhook records what happened. So whatever state the payment
// was in before this run, it is in the same state after.
sql(`update payment_jobs set status='pending', attempts=0, run_after=now()`);
const before = sql(`select status || '/' || refunded_cents from payments limit 1`);
await run();
const after = sql(`select status || '/' || refunded_cents from payments limit 1`);
check('payment row untouched by the worker', before === after && before !== '',
  `before=${before} after=${after}`);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
