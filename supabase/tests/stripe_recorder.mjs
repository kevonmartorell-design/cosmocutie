/**
 * A stand-in for Stripe that records what we sent it.
 *
 * An invalid API key gets a 401 from Stripe before any parameter is looked at,
 * so "we called Stripe and were refused" says nothing about whether the request
 * was shaped correctly — a mistyped parameter name fails identically to a bad
 * key. This answers the other half: what exactly did we send.
 *
 * Started by request_shape_test.mjs; not a server anyone runs by hand.
 */
import { createServer } from 'node:http';

export function startRecorder(port = 8799) {
  const calls = [];
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      calls.push({
        path: req.url,
        headers: req.headers,
        params: Object.fromEntries(new URLSearchParams(body)),
        raw: body,
      });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      // Enough of a Stripe object for the caller to carry on.
      res.end(JSON.stringify({
        id: 'pi_recorded_1',
        object: 'payment_intent',
        status: 'succeeded',
        url: 'https://checkout.stripe.test/session',
      }));
    });
  });
  return new Promise((resolve) => {
    server.listen(port, () => resolve({ calls, close: () => server.close() }));
  });
}
