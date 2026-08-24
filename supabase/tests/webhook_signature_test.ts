import { createHmac } from 'node:crypto';
import { verifyStripeSignature } from '../functions/_shared/stripe.ts';

const SECRET = 'whsec_testsecret_abcdef123456';
const body = JSON.stringify({ id: 'evt_1', type: 'payment_intent.succeeded', data: { object: { id: 'pi_1' } } });

// Signed independently, with Node's HMAC rather than the code under test.
const sign = (ts: number, payload: string, secret = SECRET) =>
  createHmac('sha256', secret).update(`${ts}.${payload}`).digest('hex');

const now = Math.floor(Date.now() / 1000);
let pass = 0, fail = 0;
const check = async (name: string, got: Promise<any>, wantOk: boolean) => {
  const r = await got;
  const ok = r.ok === wantOk;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `  (got ${JSON.stringify(r)})`}`);
  ok ? pass++ : fail++;
};

await check('valid signature accepted',
  verifyStripeSignature(body, `t=${now},v1=${sign(now, body)}`, SECRET), true);

await check('forged signature rejected',
  verifyStripeSignature(body, `t=${now},v1=${'a'.repeat(64)}`, SECRET), false);

await check('wrong secret rejected',
  verifyStripeSignature(body, `t=${now},v1=${sign(now, body, 'whsec_wrong')}`, SECRET), false);

// The classic bug: parsing and re-serialising changes byte order, and the
// signature silently stops matching.
const reserialised = JSON.stringify(JSON.parse(body.replace('"id":"evt_1"', '"id":"evt_1" ')));
await check('body tampering rejected',
  verifyStripeSignature(reserialised + ' ', `t=${now},v1=${sign(now, body)}`, SECRET), false);

await check('old timestamp rejected (replay)',
  verifyStripeSignature(body, `t=${now - 900},v1=${sign(now - 900, body)}`, SECRET), false);

await check('future timestamp rejected',
  verifyStripeSignature(body, `t=${now + 900},v1=${sign(now + 900, body)}`, SECRET), false);

await check('missing header rejected',
  verifyStripeSignature(body, null, SECRET), false);

await check('malformed header rejected',
  verifyStripeSignature(body, 'garbage', SECRET), false);

await check('no v1 entry rejected',
  verifyStripeSignature(body, `t=${now}`, SECRET), false);

// Stripe sends several v1 values while an endpoint secret is being rotated.
await check('accepts when one of several v1 matches',
  verifyStripeSignature(body, `t=${now},v1=${'b'.repeat(64)},v1=${sign(now, body)}`, SECRET), true);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
