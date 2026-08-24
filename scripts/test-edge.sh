#!/usr/bin/env bash
# End-to-end edge function tests against the LOCAL stack.
#
# Needs `npx supabase functions serve --env-file supabase/functions/.env`
# running in another terminal. No Stripe key is required: the webhook is
# authenticated by a signature we can produce ourselves, so the whole
# Stripe-to-database path is exercised without touching Stripe.
set -euo pipefail
cd "$(dirname "$0")/.."

echo "Resetting local database..."
npx supabase db reset >/dev/null 2>&1

REQ=$(docker exec -i supabase_db_CosmoCutie psql -U postgres -d postgres -q \
  < supabase/tests/edge_seed.sql 2>&1 | grep REQUEST_ID | sed 's/.*REQUEST_ID=//' | tr -d ' ')

if [ -z "$REQ" ]; then echo "seed failed"; exit 1; fi

echo "=== webhook signature (unit) ==="
node --experimental-strip-types supabase/tests/webhook_signature_test.ts 2>&1 \
  | grep -v "ExperimentalWarning\|--trace-warnings"

echo ""
echo "=== webhook end to end ==="
node supabase/tests/webhook_e2e_test.mjs "$REQ"

echo ""
echo "=== payment worker ==="
node supabase/tests/worker_e2e_test.mjs "$REQ"
