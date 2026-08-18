// Guards `npm run push:dev`.
//
// Update bundling reads the local .env, so if it is pointing at a local test
// database the published update ships a phone build that silently cannot reach
// anything — which presents as a broken app rather than a wrong config.
import { readFileSync } from 'node:fs';

const env = readFileSync(new URL('../.env', import.meta.url), 'utf8');
const url = (env.match(/EXPO_PUBLIC_SUPABASE_URL=(.*)/) || [])[1]?.trim() ?? '';

if (!url) {
  console.error('\n  ✗ EXPO_PUBLIC_SUPABASE_URL is not set in .env\n');
  process.exit(1);
}
if (/127\.0\.0\.1|localhost|0\.0\.0\.0/.test(url)) {
  console.error(`\n  ✗ .env points at a LOCAL database (${url}).`);
  console.error('    Publishing this would give the phone a build that cannot reach anything.');
  console.error('    Restore the hosted URL in .env, then retry.\n');
  process.exit(1);
}
console.log(`  ✓ targeting ${url}`);
