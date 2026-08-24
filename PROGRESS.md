# Progress

Status file for whoever picks this up next.

**[PLAN.md](./PLAN.md) is the spec.** Read it before changing behaviour — it records *why* decisions were made, and several look arbitrary until you know the reason (the data firewall, the negotiation caps, the no-free-messaging rule, flat-only booth rent).

---

## Where things stand

| Phase | Status |
|---|---|
| 0 — Foundation, design tokens, component gallery | ✅ done |
| 1 — Schema, RLS, WatermelonDB | ✅ done |
| 2 — Identity, onboarding, invitations | ✅ done |
| 3 — Booking, negotiation, notifications | ✅ done |
| 4 — Payments | 🟡 plumbing + Connect onboarding done; intents, capture, webhook remain |
| 5 — Clinical records | 🟡 forms + colour bar done, photos deferred |
| 6 — Offline sync | ⬜ not started |
| 7 — Compliance & store readiness | ⬜ not started |
| 8+ — Deals, feed, ecosystem, shop | ⬜ not started |

**Live:** https://cosmocutie.vercel.app · **Repo:** https://github.com/kevonmartorell-design/cosmocutie
**Supabase:** `tihzzdmvjdplmcdscxbh` · **EAS:** `@vonalmighty/cosmocutie` · **Bundle:** `com.cosmocutie.app`

20 migrations, all pushed to the hosted project. ~120 assertions across 14 SQL suites in `supabase/tests/`.

---

## Do this first

```bash
npm install
npm run db:start          # local Supabase (excludes services that fail healthchecks)
npm run db:test           # 20 adversarial RLS checks — must pass before you change anything
```

Docker Desktop must be running. If `db:start` fails with a daemon error, `open -a Docker` and wait ~30s.

---

## Commands

```bash
npm run db:reset          # re-apply all migrations locally
npm run db:types          # regenerate src/lib/database.types.ts AFTER any migration
npm run typecheck
npx supabase db push      # apply migrations to the hosted project
npm run push:preview "Phase 6 - offline sync"   # ship JS to the phone, OTA
npm run push:list:preview # what has actually shipped
npm run build:preview     # only when a NATIVE dependency changes
```

Run individual test suites with:
```bash
docker exec -i supabase_db_CosmoCutie psql -U postgres -d postgres < supabase/tests/phase3_test.sql
```

---

## What to do next

### 1. Finish Phase 4 — keys are in, unblocked

**Stripe is live in sandbox.** `STRIPE_SECRET_KEY` is set in Supabase secrets; the publishable key is in `.env` and all three `eas.json` profiles.

Done and verified against the real sandbox:
- Routing by worker classification, deposit lifecycle, idempotent `settle_deposit`, flat booth rent cron, checkout netting off deposits, `dispute_evidence`
- **`stripe-connect` edge function** — creates a per-chair Stripe account and returns a hosted onboarding URL. Confirmed end to end.

Still to build:
- Payment intents with routing (direct charges via the `Stripe-Account` header so a 1099 renter stays merchant of record; `application_fee_amount` for the platform cut)
- Capture on acceptance / release on any terminal outcome, wired to the existing `notification_queue` signals from `on_request_resolved`
- A webhook edge function reconciling back through `settle_deposit` (verify the signature; set `STRIPE_WEBHOOK_SECRET` in Supabase secrets)
- Checkout UI + a Connect onboarding button on the chair screen

**`@stripe/stripe-react-native` is native.** Batch it with `expo-image-picker` (Phase 5 photos) so both phases finish with **one** rebuild.

#### Stripe specifics discovered the hard way — do not re-derive these
- **This account requires Accounts v2.** `POST /v1/accounts` is refused outright for new Connect integrations. Use `POST /v2/core/accounts`.
- **v2 endpoints REQUIRE an explicit `Stripe-Version` header.** Omitting it is a 400, not a default. Pinned to `2026-07-29.dahlia` in `supabase/functions/_shared/stripe.ts`.
- **Merchant accounts must set `dashboard`.** We use `express`, so Stripe hosts payouts and tax documents.
- **Account links are `/v2/core/account_links`** with a `use_case` body, not the v1 shape.
- Payment intents are still v1 form-encoded. The `stripeV1` helper takes `stripeAccount` and `idempotencyKey` — **always pass an idempotency key on anything that moves money.**

### 2. Phase 5 leftovers
Photo capture for before/processing/after galleries. `formula_photos` table and per-photo consent columns already exist.

### 3. Known cleanup
`src/app/(app)/setup-salon.tsx` is now orphaned — salon creation moved into the sign-up flow. Nothing links to it.

---

## Gotchas that cost real time

**Toolchain**
- **Metro caches inlined env vars.** After editing `.env`, always export with `--clear` or you ship a bundle pointing at the wrong Supabase. This looked like a broken signup form for an hour.
- **Port 8081 is taken** by another project on this machine. CosmoCutie is pinned to **8083**.
- **Expo Go cannot run this app** (WatermelonDB is native). Use the **preview** build — it is standalone. The `development` profile needs Metro tethered and will not open on its own.
- **`supabase/functions` is excluded from tsconfig.** Edge functions are Deno.

**Postgres**
- **PL/pgSQL locals shadow column names.** Bit twice: `weekday` broke `available_slots`, `id` broke `record_deposit_intent`. Prefix every local `v_`.
- **A statement sees one snapshot.** Calling a function and checking the row it changed *in the same statement* reads the pre-change value. Split them. Produced three false failures.
- **`search_path = ''` means schema-qualify every type** (`public.my_enum`). The empty search_path is a deliberate privilege-escalation guard.
- **Enum columns need explicit casts from `CASE`.**
- **`CREATE OR REPLACE` cannot change a return type**, and adding a defaulted parameter creates an *overload*. Drop first.
- **RLS policies can recurse.** `client_records` → `clients` → `client_records` deadlocked. Resolve identity through `SECURITY DEFINER` helpers (`current_tenant_ids()`, `current_client_ids()`), never by joining the other table inside a policy.
- **RLS and GRANTs are separate layers.** Policies alone give `permission denied for table`.
- **Never seed `auth.users` by hand** — GoTrue fails with an opaque "Database error querying schema" at sign-in. Create users through `/auth/v1/signup`, then attach roles with SQL.

**React**
- **`refreshMemberships` must read the live session**, not the closure. Right after sign-up the auth change has not reached provider state, so `session` is null. Use `supabase.auth.getUser()`. This routed a freshly-claimed stylist to the client screen and **no unit test would have caught it** — only walking the flow did.
- **Browser automation cannot drive react-native-web.** `form_input` sets DOM values without updating React state; synthetic clicks often miss `Pressable`. Use the native value setter plus an `input` event, and ask the user to verify real taps.

**Ops**
- **Testing Connect against production consumes the one-salon slot.** Verifying `stripe-connect` required creating a real salon, which blocked the owner from ever creating hers. It was cleaned up with a scoped throwaway edge function. If this bites again, add a test-mode-only bypass rather than hand-cleaning.
- **Edge function directories starting with `_` are treated as shared code, not functions**, and will not deploy or route.
- **Hosted Supabase sends ~3 emails/hour.** Real signups need Resend, which needs a domain. Not yet registered.
- **The `send-push` edge function needs a schedule** (every minute) in the Supabase dashboard, or notifications queue silently.

---

## The one rule not to break

A salon owner holds **both** an admin membership on the salon and a stylist membership on their own chair. Those must stay separate. Neither role, alone or combined, may read a 1099 renter's clients, formulas, revenue, notes, or payments — and that is enforced by **RLS in Postgres**, not by screens choosing not to ask.

This is not a privacy preference. If the owner controls a renter's client book, that is evidence of behavioural control, which is what triggers IRS reclassification of a contractor as an employee. The whole tenant architecture exists for it.

`npm run db:test` proves it. **If a change makes those tests fail, the change is wrong.**
