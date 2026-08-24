/**
 * The photo pipeline's arithmetic, tested without the native modules.
 *
 * Both of these have already been wrong once. The resize decision capped the
 * wrong edge and upscaled small images — which typechecks perfectly and simply
 * costs storage forever. The base64 decoder is worse: a subtle bug there
 * corrupts every uploaded file while every status code says success.
 */
import { createHash, randomBytes } from 'node:crypto';
import { FULL, THUMB, base64ToBytes, resizeTarget } from '../../src/photos/resize-policy.ts';

let pass = 0, fail = 0;
const check = (name: string, cond: boolean, detail = '') => {
  cond ? pass++ : fail++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : `  -> ${detail}`}`);
};

console.log('--- the LONG edge is what gets capped ---');
// A portrait phone photo. Capping width would leave the height at 2133 and the
// file far above what the policy intends.
check('portrait constrains height',
  JSON.stringify(resizeTarget({ width: 3000, height: 4000 }, 1600)) === '{"height":1600}',
  JSON.stringify(resizeTarget({ width: 3000, height: 4000 }, 1600)));

check('landscape constrains width',
  JSON.stringify(resizeTarget({ width: 4000, height: 3000 }, 1600)) === '{"width":1600}',
  JSON.stringify(resizeTarget({ width: 4000, height: 3000 }, 1600)));

check('square constrains either (width)',
  JSON.stringify(resizeTarget({ width: 2000, height: 2000 }, 1600)) === '{"width":1600}',
  JSON.stringify(resizeTarget({ width: 2000, height: 2000 }, 1600)));

console.log('\n--- an image already small enough is left alone ---');
check('smaller than target is not touched',
  resizeTarget({ width: 800, height: 600 }, 1600) === null);
check('exactly at target is not touched',
  resizeTarget({ width: 1600, height: 900 }, 1600) === null);
check('one pixel over IS resized',
  resizeTarget({ width: 1601, height: 900 }, 1600) !== null);
check('tiny thumbnail source is not upscaled',
  resizeTarget({ width: 300, height: 200 }, THUMB.maxEdge) === null);

console.log('\n--- nonsense dimensions do not crash it ---');
check('zero is ignored', resizeTarget({ width: 0, height: 0 }, 1600) === null);
check('negative is ignored', resizeTarget({ width: -5, height: 100 }, 1600) === null);
check('NaN is ignored', resizeTarget({ width: NaN, height: 100 }, 1600) === null);

console.log('\n--- the policy numbers themselves ---');
check('full is 1600 / 0.70', FULL.maxEdge === 1600 && FULL.quality === 0.7);
check('thumb is smaller and cheaper',
  THUMB.maxEdge < FULL.maxEdge && THUMB.quality < FULL.quality);

console.log('\n--- base64 round-trips byte for byte ---');
// Against Node's own encoder, over random binary, at every padding alignment.
// A decoder that is subtly wrong corrupts uploads while every status says 200.
let allMatch = true;
let mismatchAt = '';
for (let len = 0; len < 200; len++) {
  const raw = randomBytes(len);
  const decoded = Buffer.from(base64ToBytes(raw.toString('base64')));
  if (!decoded.equals(raw)) { allMatch = false; mismatchAt = `length ${len}`; break; }
}
check('every length 0–199 round-trips', allMatch, mismatchAt);

const big = randomBytes(300_000); // roughly a real compressed photo
const bigOut = Buffer.from(base64ToBytes(big.toString('base64')));
check('a photo-sized payload round-trips',
  createHash('sha256').update(bigOut).digest('hex') ===
  createHash('sha256').update(big).digest('hex'));

check('padding characters are ignored',
  Buffer.from(base64ToBytes('YQ==')).toString() === 'a');
check('whitespace and newlines are ignored',
  Buffer.from(base64ToBytes('aGVs\nbG8=')).toString() === 'hello');
check('empty input gives empty output', base64ToBytes('').length === 0);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
