import { createHmac } from 'node:crypto';
import { execFileSync } from 'node:child_process';

const SECRET = 'whsec_local_only_for_testing';
const URL = 'http://127.0.0.1:54321/functions/v1/stripe-webhook';
const REQ = process.argv[2];

const sql = (q) =>
  execFileSync('docker', ['exec','-i','supabase_db_CosmoCutie','psql','-U','postgres','-d','postgres','-tAc',q])
    .toString().trim();

let pass = 0, fail = 0;
const check = (name, cond, detail = '') => {
  cond ? pass++ : fail++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : `  -> ${detail}`}`);
};

async function post(event, { badSig = false, staleTs = false } = {}) {
  const body = JSON.stringify(event);
  const ts = staleTs ? Math.floor(Date.now()/1000) - 900 : Math.floor(Date.now()/1000);
  const sig = badSig ? 'f'.repeat(64) : createHmac('sha256', SECRET).update(`${ts}.${body}`).digest('hex');
  const res = await fetch(URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Stripe-Signature': `t=${ts},v1=${sig}` },
    body,
  });
  return { status: res.status, json: await res.json().catch(() => ({})) };
}

const session = (id) => ({
  id, type: 'checkout.session.completed',
  data: { object: {
    id: 'cs_1', payment_intent: 'pi_live_1', amount_total: 6000,
    metadata: { booking_request_id: REQ },
  }},
});

console.log('--- signature enforcement ---');
let r = await post(session('evt_bad'), { badSig: true });
check('forged signature refused', r.status === 400, `status ${r.status}`);
check('nothing recorded from a forged event', sql(`select count(*) from payments`) === '0');

r = await post(session('evt_stale'), { staleTs: true });
check('replayed old timestamp refused', r.status === 400, `status ${r.status}`);

console.log('\n--- checkout.session.completed records the deposit ---');
r = await post(session('evt_1'));
check('accepted', r.status === 200, JSON.stringify(r.json));
check('payment row created', sql(`select count(*) from payments where stripe_payment_intent_id='pi_live_1'`) === '1');
check('status is authorized', sql(`select status from payments where stripe_payment_intent_id='pi_live_1'`) === 'authorized');
check('routed as a direct charge', sql(`select route from payments where stripe_payment_intent_id='pi_live_1'`) === 'direct');
check('connected account recorded', sql(`select stripe_account_id from payments where stripe_payment_intent_id='pi_live_1'`) === 'acct_local_test');
check('intent attached to the request', sql(`select stripe_payment_intent_id from booking_requests where id='${REQ}'`) === 'pi_live_1');

console.log('\n--- redelivery is dropped by the ledger ---');
r = await post(session('evt_1'));
check('replay acknowledged', r.status === 200);
check('replay flagged duplicate', r.json.duplicate === true, JSON.stringify(r.json));
check('still exactly one payment', sql(`select count(*) from payments where stripe_payment_intent_id='pi_live_1'`) === '1');

console.log('\n--- a mismatched amount is refused ---');
r = await post({ id: 'evt_cheap', type: 'checkout.session.completed',
  data: { object: { id: 'cs_2', payment_intent: 'pi_cheap', amount_total: 1, metadata: { booking_request_id: REQ } } } });
check('under-amount event errors', r.status === 500, `status ${r.status}`);
check('no cheap payment recorded', sql(`select count(*) from payments where stripe_payment_intent_id='pi_cheap'`) === '0');
check('failed event un-claimed so Stripe retries', sql(`select count(*) from stripe_events where id='evt_cheap'`) === '0');

console.log('\n--- capture reconciles back ---');
r = await post({ id: 'evt_cap', type: 'payment_intent.succeeded',
  data: { object: { id: 'pi_live_1', amount_received: 6000, latest_charge: 'ch_live_1' } } });
check('accepted', r.status === 200, JSON.stringify(r.json));
check('marked captured', sql(`select status from payments where stripe_payment_intent_id='pi_live_1'`) === 'captured');
check('charge id stored for dispute defence', sql(`select stripe_charge_id from payments where stripe_payment_intent_id='pi_live_1'`) === 'ch_live_1');
check('captured_at set', sql(`select captured_at is not null from payments where stripe_payment_intent_id='pi_live_1'`) === 't');

console.log('\n--- refund returns the fee proportionally ---');
sql(`update payments set fee_cents=600 where stripe_payment_intent_id='pi_live_1'`);
r = await post({ id: 'evt_ref', type: 'charge.refunded',
  data: { object: { payment_intent: 'pi_live_1', amount_refunded: 3000 } } });
check('accepted', r.status === 200);
check('refunded_cents recorded', sql(`select refunded_cents from payments where stripe_payment_intent_id='pi_live_1'`) === '3000');
check('fee halved with the refund', sql(`select fee_cents from payments where stripe_payment_intent_id='pi_live_1'`) === '300');

console.log('\n--- a dispute queues its evidence ---');
r = await post({ id: 'evt_disp', type: 'charge.dispute.created',
  data: { object: { id: 'dp_live_1', charge: 'ch_live_1' } } });
check('accepted', r.status === 200);
check('dispute recorded', sql(`select stripe_dispute_id from payments where stripe_charge_id='ch_live_1'`) === 'dp_live_1');
check('evidence job queued', sql(`select count(*) from payment_jobs where kind='submit_evidence'`) === '1');

console.log('\n--- unknown event types are acknowledged, not retried ---');
r = await post({ id: 'evt_unknown', type: 'invoice.created', data: { object: {} } });
check('acknowledged', r.status === 200, `status ${r.status}`);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
