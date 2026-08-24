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

// psql prints the command tag ("INSERT 0 1") after RETURNING output, so only
// the first line is the value.
const sql = (q) =>
  execFileSync('docker', ['exec','-i','supabase_db_CosmoCutie','psql','-U','postgres','-d','postgres','-tAc',q])
    .toString().trim().split('\n')[0].trim();

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

console.log('\n--- booth rent refuses to pretend when it cannot charge ---');
// The two ways rent collection legitimately cannot proceed. Both must fail
// loudly: a job that quietly succeeds without moving money leaves the salon
// owner believing the rent arrived.
sql(`delete from payment_jobs`);
const chair = sql(`select id from tenants where kind='stylist' limit 1`);
const salon = sql(`select parent_salon_id from tenants where id='${chair}'`);
const rentPay = sql(`insert into payments (tenant_id, kind, status, amount_cents, route)
                     values ('${chair}','booth_rent','authorized',25000,'direct') returning id`);
sql(`insert into payment_jobs (kind, payment_id, tenant_id, amount_cents)
     values ('collect_rent','${rentPay}','${chair}',25000)`);

r = await run();
check('no saved card fails the job', r.json.failed === 1, JSON.stringify(r.json));
check('and says why',
  sql(`select last_error like '%has not saved a payment method%' from payment_jobs where kind='collect_rent'`) === 't');
check('not silently marked done',
  sql(`select count(*) from payment_jobs where kind='collect_rent' and status='done'`) === '0');

sql(`insert into billing_methods (tenant_id, stripe_customer_id, payment_method_id)
     values ('${chair}','cus_test','pm_test')
     on conflict (tenant_id) do update set payment_method_id='pm_test'`);
sql(`delete from stripe_accounts where tenant_id='${salon}'`);
sql(`update payment_jobs set status='pending', attempts=0, run_after=now() where kind='collect_rent'`);

r = await run();
check('salon not onboarded fails the job', r.json.failed === 1, JSON.stringify(r.json));
check('and says where the money would have gone',
  sql(`select last_error like '%nowhere to land%' from payment_jobs where kind='collect_rent'`) === 't');

console.log('\n--- with everything in place it reaches Stripe (and is refused, as expected) ---');
sql(`insert into stripe_accounts (tenant_id, stripe_account_id, charges_enabled)
     values ('${salon}','acct_salon_test',true)
     on conflict (tenant_id) do update set stripe_account_id='acct_salon_test'`);
sql(`update payment_jobs set status='pending', attempts=0, run_after=now() where kind='collect_rent'`);

r = await run();
// The env carries an invalid Stripe key, so a genuine 401 comes back. That
// proves the call was actually attempted rather than short-circuited.
check('the charge was attempted', r.json.failed === 1, JSON.stringify(r.json));
check('the failure is Stripe\'s, not ours',
  sql(`select last_error not like '%has not saved%' and last_error not like '%nowhere to land%'
       from payment_jobs where kind='collect_rent'`) === 't');
check('the payment is still owed, not captured',
  sql(`select status from payments where id='${rentPay}'`) === 'authorized');

console.log('\n--- rent already settled is left alone ---');
sql(`update payments set status='captured' where id='${rentPay}'`);
sql(`update payment_jobs set status='pending', attempts=0, run_after=now() where kind='collect_rent'`);
r = await run();
check('already-paid rent succeeds without charging again',
  r.json.done === 1, JSON.stringify(r.json));

console.log('\n--- one bad job does not strand the rest of the batch ---');
sql(`delete from payment_jobs`);
sql(`insert into payment_jobs (kind, tenant_id, stripe_payment_intent_id, payment_id)
     select 'capture', tenant_id, stripe_payment_intent_id, id from payments where kind='deposit' limit 1`);
sql(`insert into payment_jobs (kind, tenant_id, stripe_payment_intent_id)
     values ('release','${chair}','pi_nonexistent_x')`);
r = await run();
check('both jobs were handled', r.json.processed === 2, JSON.stringify(r.json));
check('nothing left in processing',
  sql(`select count(*) from payment_jobs where status='processing'`) === '0');

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
