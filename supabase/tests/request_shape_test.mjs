/**
 * Asserts the exact request our money paths send to Stripe.
 *
 * Needs the edge functions served with STRIPE_API_BASE pointed at the recorder:
 *   npm run functions:serve:recorded
 */
import { execFileSync } from 'node:child_process';
import { startRecorder } from './stripe_recorder.mjs';

const WORKER = 'http://127.0.0.1:54321/functions/v1/payment-worker';
const SERVICE_KEY = JSON.parse(
  execFileSync('npx', ['supabase', 'status', '-o', 'json']).toString(),
).SERVICE_ROLE_KEY;

const sql = (q) =>
  execFileSync('docker', ['exec','-i','supabase_db_CosmoCutie','psql','-U','postgres','-d','postgres','-tAc',q])
    .toString().trim().split('\n')[0].trim();

let pass = 0, fail = 0;
const check = (name, cond, detail = '') => {
  cond ? pass++ : fail++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : `  -> ${detail}`}`);
};

const recorder = await startRecorder();
const runWorker = () =>
  fetch(WORKER, { method: 'POST', headers: { Authorization: `Bearer ${SERVICE_KEY}` } })
    .then((r) => r.json());

const chair = sql(`select id from tenants where kind='stylist' limit 1`);
const salon = sql(`select parent_salon_id from tenants where id='${chair}'`);

sql(`delete from payment_jobs`);
sql(`insert into billing_methods (tenant_id, stripe_customer_id, payment_method_id)
     values ('${chair}','cus_rae','pm_rae') on conflict (tenant_id)
     do update set stripe_customer_id='cus_rae', payment_method_id='pm_rae'`);
sql(`insert into stripe_accounts (tenant_id, stripe_account_id, charges_enabled)
     values ('${salon}','acct_salon',true) on conflict (tenant_id)
     do update set stripe_account_id='acct_salon', charges_enabled=true`);
sql(`insert into stripe_accounts (tenant_id, stripe_account_id, charges_enabled)
     values ('${chair}','acct_rae',true) on conflict (tenant_id)
     do update set stripe_account_id='acct_rae', charges_enabled=true`);

console.log('--- booth rent ---');
const rentPay = sql(`insert into payments (tenant_id, kind, status, amount_cents, route)
                     values ('${chair}','booth_rent','authorized',25000,'direct') returning id`);
sql(`insert into payment_jobs (kind, payment_id, tenant_id, amount_cents)
     values ('collect_rent','${rentPay}','${chair}',25000)`);
await runWorker();

const rent = recorder.calls.find((c) => c.path === '/v1/payment_intents');
check('a payment intent was created', !!rent, JSON.stringify(recorder.calls.map(c => c.path)));

if (rent) {
  check('charges the flat rent amount', rent.params.amount === '25000', rent.params.amount);
  check('against the RENTER\'s saved card', rent.params.payment_method === 'pm_rae', rent.params.payment_method);
  check('on the renter\'s customer record', rent.params.customer === 'cus_rae', rent.params.customer);
  check('settled to the SALON\'s account',
    rent.params['transfer_data[destination]'] === 'acct_salon',
    rent.params['transfer_data[destination]']);

  // The firewall, asserted on the wire. If rent were ever charged ON the
  // renter's connected account, it would be coming out of their takings.
  check('NOT charged on the renter\'s own account',
    rent.headers['stripe-account'] === undefined,
    `Stripe-Account: ${rent.headers['stripe-account']}`);
  check('the platform takes no cut of rent',
    rent.params['application_fee_amount'] === undefined,
    rent.params['application_fee_amount']);

  check('off-session, because the cron runs with nobody present',
    rent.params.off_session === 'true', rent.params.off_session);
  check('confirmed immediately', rent.params.confirm === 'true', rent.params.confirm);
  check('carries the payment id so the webhook can settle it',
    rent.params['metadata[payment_id]'] === rentPay,
    rent.params['metadata[payment_id]']);
  check('sent with an idempotency key',
    typeof rent.headers['idempotency-key'] === 'string',
    JSON.stringify(rent.headers['idempotency-key']));
}

console.log('\n--- deposit capture on a 1099 renter ---');
recorder.calls.length = 0;
sql(`delete from payment_jobs`);
const dep = sql(`select id from payments where kind='deposit' limit 1`);
const depIntent = sql(`select stripe_payment_intent_id from payments where id='${dep}'`);
sql(`update payments set stripe_account_id='acct_rae', route='direct' where id='${dep}'`);
sql(`insert into payment_jobs (kind, payment_id, tenant_id, stripe_payment_intent_id, amount_cents)
     values ('capture','${dep}','${chair}','${depIntent}',null)`);
await runWorker();

const cap = recorder.calls.find((c) => c.path.includes('/capture'));
check('a capture was sent', !!cap, JSON.stringify(recorder.calls.map(c => c.path)));
if (cap) {
  check('against the right intent', cap.path === `/v1/payment_intents/${depIntent}/capture`, cap.path);
  // A direct charge lives ON the connected account; without this header Stripe
  // looks on the platform and 404s an intent that exists.
  check('acts AS the renter\'s account, keeping them merchant of record',
    cap.headers['stripe-account'] === 'acct_rae', cap.headers['stripe-account']);
  check('full capture sends no partial amount',
    cap.params.amount_to_capture === undefined, cap.params.amount_to_capture);
}

console.log('\n--- partial capture for a cancellation fee ---');
recorder.calls.length = 0;
sql(`delete from payment_jobs`);
sql(`insert into payment_jobs (kind, payment_id, tenant_id, stripe_payment_intent_id, amount_cents)
     values ('capture','${dep}','${chair}','${depIntent}',4000)`);
await runWorker();
const partial = recorder.calls.find((c) => c.path.includes('/capture'));
check('capped amount is sent', partial?.params.amount_to_capture === '4000',
  partial?.params.amount_to_capture);

console.log('\n--- refund returns the platform fee too ---');
recorder.calls.length = 0;
sql(`delete from payment_jobs`);
sql(`insert into payment_jobs (kind, payment_id, tenant_id, stripe_payment_intent_id, amount_cents)
     values ('refund','${dep}','${chair}','${depIntent}',6000)`);
await runWorker();
const refund = recorder.calls.find((c) => c.path === '/v1/refunds');
check('a refund was sent', !!refund);
if (refund) {
  check('for the right intent', refund.params.payment_intent === depIntent, refund.params.payment_intent);
  check('never keeps a fee on a reversed sale',
    refund.params.refund_application_fee === 'true', refund.params.refund_application_fee);
}

recorder.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
