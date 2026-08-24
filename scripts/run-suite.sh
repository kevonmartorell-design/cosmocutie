#!/usr/bin/env bash
# Run one SQL suite against a FRESH database.
#
# Each suite seeds its own auth.users and its own salon. The app allows exactly
# one salon, so running two suites back to back without a reset fails with
# "this app already has a salon" and then cascades into \gset syntax errors as
# every later variable goes unset. Always reset first.
set -euo pipefail
for suite in "$@"; do
  npx supabase db reset >/dev/null 2>&1
  echo "=== ${suite} ==="
  docker exec -i supabase_db_CosmoCutie psql -U postgres -d postgres -q \
    < "supabase/tests/${suite}.sql" 2>&1 | grep -E "PASS|FAIL|ERROR" || true
done
