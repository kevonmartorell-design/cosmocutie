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
| 4 — Payments | 🟢 built, deployed, and live — no real money has moved through it yet |
| 5 — Clinical records | 🟡 forms, colour bar, and photos done — needs an `eas build`; data export outstanding |
| 6 — Offline sync | ⬜ not started |
| 7 — Compliance & store readiness | ⬜ not started |
| 8+ — Deals, feed, ecosystem, shop | ⬜ not started |

**Live:** https://cosmocutie.vercel.app · **Repo:** https://github.com/kevonmartorell-design/cosmocutie
**Supabase:** `tihzzdmvjdplmcdscxbh` · **EAS:** `@vonalmighty/cosmocutie` · **Bundle:** `com.cosmocutie.app`

**25 migrations — 24 on the hosted project, migration 25 (photo storage) is local only and still needs `npx supabase db push`.** ~230 assertions across 17 SQL suites,
plus 71 edge-function assertions and 19 on the exact request bodies sent to Stripe.

---

## What is shipped

Everything below is **live on the hosted project** as of 24 Aug 2026. Nothing in
this list is waiting on a deploy.

| | Status |
|---|---|
| Migrations 1–24 | ✅ all applied to `tihzzdmvjdplmcdscxbh` |
| `send-push`, `stripe-connect` | ✅ deployed |
| `stripe-checkout`, `stripe-webhook`, `payment-worker`, `stripe-billing` | ✅ deployed |
| Stripe webhook destinations (×2) | ✅ Active in `acct_1U7mD6I7PIoulqv7` |
| `STRIPE_WEBHOOK_SECRET` | ✅ set — both secrets, confirmed parsed |
| `pg_net` extension | ✅ installed |
| Cron: `drain-payment-jobs` (1 min) | ✅ running, verified |
| Cron: `drain-notification-queue` (1 min) | ✅ running |
| Cron: expiry, waitlist, booth rent (SQL) | ✅ running |
| App JS on the phone | ✅ OTA `Phase 4 payments — deposits, checkout, booth rent` |
| Photo capture | ⚠️ **built but NOT on the phone — needs `npm run build:preview`** |

⚠️ **An `eas build` IS now outstanding.** Phase 5 photos added two native
modules — `expo-image-picker` and `expo-image-manipulator` — so photo capture
cannot reach the phone over the air. Everything else on the phone is current.

```bash
npx supabase db push        # migration 25 first, or the app queries a bucket that does not exist
npm run build:preview       # then the build
```

The build also picks up the iOS camera and photo-library usage strings added to
`app.json`. Without those iOS kills the app the moment the camera opens, and it
is a native crash no JS error handler can catch.

### What is NOT shipped, and why

| | Why |
|---|---|
| **No real payment has ever run** | The hosted database has no salon yet, and creating one burns the single salon slot. The owner's own sign-up is the first real test. |
| **Connected-accounts webhook secret unproven** | It is set, but no event has ever been delivered to that destination — that needs a stylist who finished Connect onboarding. See below. |
| **`PLATFORM_FEE_BPS` is 0** | Nobody has decided the rate. The platform currently takes nothing. |
| **`collect_rent` never charged anything** | Rent is raised daily by cron, but no chair has saved a card yet. |
| **PaymentSheet (in-app card entry)** | Deliberate — it is a native module. The hosted Stripe page does the same job and ships OTA. |
| **Phase 5 data export** | Not started. Renters must be able to export their client book — the no-lock-in principle in PLAN.md. |
| **Real transactional email** | Needs a domain + Resend. Hosted Supabase sends ~3/hour, which is fine for testing and not for users. |
| **v2 Connect account events** | Not subscribed. They use thin payloads the handler cannot read yet — see the gotcha. |

---

## Do this first

```bash
npm install
npm run db:start          # local Supabase (excludes services that fail healthchecks)
npm run db:test           # 22 adversarial RLS checks — must pass before you change anything
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

```bash
npm run db:suite phase4c_test        # one or more SQL suites, each on a fresh database
npm run functions:serve              # edge functions locally (needs supabase/functions/.env)
npm run test:edge                    # 67 assertions against the running functions

# What we actually send Stripe. Needs functions:serve:recorded in another
# terminal, which points STRIPE_API_BASE at a local recorder.
npm run functions:serve:recorded
npm run test:shapes                  # 19 assertions on the request bodies
```

⚠️ **Every SQL suite needs its own `db reset` first.** Each one seeds its own users and its
own salon, and the app allows exactly one salon — so running two back to back fails with
`this app already has a salon` and then cascades into a wall of `syntax error at or near ":"`
as every later `\gset` variable goes unset. `npm run db:suite` handles the reset; running
`psql < suite.sql` by hand does not.

---

## What to do next

### 1. Phase 4 — deployed. One decision left, and one thing only a real booking can prove

**Stripe is live in sandbox.** `STRIPE_SECRET_KEY` is set in Supabase secrets; the publishable key is in `.env` and all three `eas.json` profiles.

Built and tested:
- Routing by worker classification, deposit lifecycle, flat booth rent cron, checkout netting off deposits, `dispute_evidence`
- **`stripe-connect`** — per-chair Stripe account + hosted onboarding URL. Confirmed against the real sandbox.
- **`stripe-checkout`** — hosted payment page for the deposit (manual capture) and for the closing balance (immediate). Routes direct / destination / salon off the database.
- **`stripe-webhook`** — signature verified, event ledger for replays, reconciles deposits, captures, releases, failures, refunds, disputes, and Connect readiness.
- **`payment-worker`** — drains `payment_jobs` (capture / release / refund / evidence) with backoff and an attempt cap.
- **`stripe-billing`** — saves the card a chair pays its booth rent with, and **`collect_rent`** charges it. Rent comes off the renter's OWN saved card and settles to the salon's account; it is never withheld from their takings, because that would be a commission split rather than a tenancy. The outcome is mirrored onto `booth_rents`, which both parties can read, so the owner learns whether rent arrived without seeing anything else about the renter's business.
- Checkout UI, deposit hold in the negotiation thread, payouts onboarding and booth-rent card on the chair screen, rent status per chair on the salon screen.

**Not done: PaymentSheet.** Deliberately. It is a native module; the hosted page does the same job and ships OTA. Batch it with `expo-image-picker` if you ever want in-app card entry.

**What has and has not touched real Stripe.**

*Verified live:* the **webhook**. Two real `payment_intent.succeeded` events were
delivered to the platform destination and returned 200 — signature verified,
event ledger claimed, handler ran. A forged signature returned 400.

*Not verified live:* **creating** anything — payment intents, captures, refunds,
rent charges. Those are asserted on the wire instead (`npm run test:shapes`
points the functions at a local recorder and checks the exact parameters), which
is the only thing that actually proves request shape: an invalid key gets a 401
from Stripe *before* parameters are validated, so "we called Stripe and were
refused" proves nothing.

The gap closes the first time someone books with a deposit.

#### Deployment record

**a) ✅ Migrations pushed** — all 24 on the hosted project.

**b) ✅ Functions deployed** — all six. Redeploy any of them with:
```bash
npx supabase functions deploy stripe-checkout stripe-webhook payment-worker stripe-billing
```

**c) ✅ Two webhook destinations exist in Stripe**

In sandbox **CosmoCutie sandbox** = `acct_1U7mD6I7PIoulqv7`, which is the account
the app's keys belong to. Both point at
`https://tihzzdmvjdplmcdscxbh.supabase.co/functions/v1/stripe-webhook`:

| Destination | Scope | Events | ID |
|---|---|---|---|
| CosmoCutie platform | Your account | 10 — booth rent, rent card setup, Connect readiness | `we_1U85ZXI7PIoulqv7zjrzIX1Z` |
| CosmoCutie connected accounts | Connected accounts | 6 — deposits, capture, release, refunds, disputes | `we_1U85bPI7PIoulqv7oMa60gbD` |

⚠️ **Check the account id before touching anything in the Stripe dashboard.**
This org has more than one sandbox — "CosmoCutie" (`acct_1U7mCwIt3hk81Wm1`) and
"CosmoCutie sandbox" (`acct_1U7mD6I7PIoulqv7`). Navigating to
`dashboard.stripe.com/test/...` without an account id drops you into whichever
was last active, and both are titled plausibly. The app's account is the one
encoded in its own publishable key:

```bash
grep -o 'pk_test_[A-Za-z0-9]*' eas.json | head -1 | cut -c10-25   # -> 1U7mD6I7PIoulqv7
```

A first pass created both destinations in the wrong sandbox
(`acct_1U7mCwIt3hk81Wm1`); those have been deleted and that account's webhook
list is empty again.

⚠️ **Two destinations, not one, and this is not optional.** Deposits and the
closing balance are DIRECT charges on the stylist's own connected account —
that is what keeps a 1099 renter merchant of record — so those events fire on
the connected account and are only delivered to a "Connected accounts"
destination. Booth rent is charged on the platform, so it fires there. A single
platform-scope endpoint would have reconciled rent and silently ignored every
deposit.

✅ **`STRIPE_WEBHOOK_SECRET` is set**, comma-separated, one secret per
destination. Verified live:

- Two real Stripe events (`stripe trigger payment_intent.succeeded`) delivered
  to the **platform** destination and returned **200 OK** — signature verified,
  event ledger claimed, handler ran.
- A deliberately forged signature returned **400** and logged
  `rejected: signature mismatch (tried 2 configured secrets)` — confirming BOTH
  secrets parsed, not just one.

⚠️ **The connected-accounts secret is present but not yet proven correct.**
Firing an event on a connected account needs a stylist who has completed Connect
onboarding, and none has. `stripe trigger --stripe-account …` does NOT work for
this — the Workbench shell ignores the flag and the event lands on the platform
destination instead. The first real deposit is the test. If it fails, the
webhook log will say `tried N configured secrets` and the delivery will show
400 rather than 200.

**d) ✅ Done — both workers are scheduled** (`Integrations → Cron`):
- `drain-payment-jobs` — every minute → `payment-worker`. Verified booting once a minute.
- `drain-notification-queue` — every minute → `send-push`. **This had never been scheduled**, so every push notification since Phase 3 has been queuing with nothing draining it.

Both needed the `pg_net` extension, which was not installed — that is why
`send-push` could never be scheduled. It is installed now.

#### The first real test — what to watch, in order

Nothing has moved money yet, and the hosted database has no salon. The owner's
own sign-up is therefore the first end-to-end run. Do it in this order and each
step proves the one before it:

1. **Owner signs up and picks "I run this salon".** Burns the single salon slot —
   this is the real one, not a test.
2. **Owner invites a stylist; stylist claims the code.** Chair tenant exists.
3. **Stylist opens their chair → "Set up payouts".** Completes Stripe Connect.
   Watch `stripe_accounts.charges_enabled` flip to true — if it stays false, the
   `account.updated` webhook is not landing.
4. **Stylist turns on "Require deposit"** — the toggle is disabled until step 3
   succeeds, which is itself a useful signal.
5. **Client books.** Request thread shows "$X deposit" with a *Secure this
   booking* button.
6. **Client pays on the hosted Stripe page** (test card `4242 4242 4242 4242`,
   any future expiry, any CVC). **This is the moment the connected-accounts
   webhook secret is finally proven.** The thread should flip to "$X held".
   - If it does not: check that destination's **Event deliveries** for a 400, and
     the `stripe-webhook` logs for `tried N configured secrets`.
7. **Stylist accepts.** A `capture` job appears in `payment_jobs`; the worker
   drains it within a minute.
8. **Stylist checks out** with a tip. Balance nets the deposit off.

**e) ⬜ STILL OPEN — decide the platform fee.** `PLATFORM_FEE_BPS` on the edge functions, in basis points, currently **0** — the platform takes nothing. PLAN.md mentions 10% as a line item but never fixed a booking rate, so shipping a silent cut seemed worse than shipping none. When you decide: `npx supabase secrets set PLATFORM_FEE_BPS=1000` for 10%. It is charged on the service, never on the tip.

#### Stripe specifics discovered the hard way — do not re-derive these
- **This account requires Accounts v2.** `POST /v1/accounts` is refused outright for new Connect integrations. Use `POST /v2/core/accounts`.
- **v2 endpoints REQUIRE an explicit `Stripe-Version` header.** Omitting it is a 400, not a default. Pinned to `2026-07-29.dahlia` in `supabase/functions/_shared/stripe.ts`.
- **Merchant accounts must set `dashboard`.** We use `express`, so Stripe hosts payouts and tax documents.
- **Account links are `/v2/core/account_links`** with a `use_case` body, not the v1 shape.
- Payment intents are still v1 form-encoded. The `stripeV1` helper takes `stripeAccount` and `idempotencyKey` — **always pass an idempotency key on anything that moves money.**
- **A Checkout Session's `payment_intent` may be null at creation.** So the deposit is recorded by the *webhook* on `checkout.session.completed`, not when the session is opened — which is more honest anyway: a session that was opened is not a deposit that was authorised.

### 2. Phase 5 leftovers
Photo capture for before/processing/after galleries. `formula_photos` table and per-photo consent columns already exist.

### 3. Known cleanup
- `src/app/(app)/setup-salon.tsx` is orphaned — salon creation moved into the sign-up flow. Nothing links to it.
- **The owner cannot see a renter's phone or email.** `chair_occupants()` returns the name and classification only. Contact details were left out on purpose rather than by accident — see the gotcha below — so if the owner should be able to phone their renter, that is a deliberate decision to make, not a bug to fix.
- `payments` has a `fee_cents` column that is now written on refunds but never set on capture, because the platform fee is zero. When `PLATFORM_FEE_BPS` becomes non-zero, set it from the webhook so reporting can show "gross / platform fee / net" as PLAN.md asks.

---

## Gotchas that cost real time

**Toolchain**
- **Metro caches inlined env vars.** After editing `.env`, always export with `--clear` or you ship a bundle pointing at the wrong Supabase. This looked like a broken signup form for an hour.
- **Port 8081 is taken** by another project on this machine. CosmoCutie is pinned to **8083**.
- **Expo Go cannot run this app** (WatermelonDB is native). Use the **preview** build — it is standalone. The `development` profile needs Metro tethered and will not open on its own.
- **`supabase/functions` and `supabase/tests` are excluded from tsconfig.** Edge functions are Deno; the test harnesses are Node and import them. `npm run typecheck` covers the app only.
- **The edge inspector defaulted to port 8083 too** — the same port Metro is pinned to. Moved to 8084 in `config.toml`; they collided if the app and `functions serve` both ran.

**Postgres**
- **PL/pgSQL locals shadow column names.** Bit twice: `weekday` broke `available_slots`, `id` broke `record_deposit_intent`. Prefix every local `v_`.
- **A statement sees one snapshot.** Calling a function and checking the row it changed *in the same statement* reads the pre-change value. Split them. Produced three false failures.
- **`search_path = ''` means schema-qualify every type** (`public.my_enum`). The empty search_path is a deliberate privilege-escalation guard.
- **Enum columns need explicit casts from `CASE`.**
- **`CREATE OR REPLACE` cannot change a return type**, and adding a defaulted parameter creates an *overload*. Drop first.
- **RLS is row-level, not column-level.** A SELECT policy exposes the WHOLE row. The salon screen showed every occupied chair as "Unoccupied" because the owner could not read the renter's `profiles` row — but a policy wide enough to show `full_name` would also have handed over `phone`, `email` and `avatar_url`. Fixed with a SECURITY DEFINER function returning the two columns the screen needs (`chair_occupants()`), leaving the `profiles` policies untouched. When the fix for "show one field" is "open the row", reach for a function.
- **RLS policies can recurse.** `client_records` → `clients` → `client_records` deadlocked. Resolve identity through `SECURITY DEFINER` helpers (`current_tenant_ids()`, `current_client_ids()`), never by joining the other table inside a policy.
- **RLS and GRANTs are separate layers.** Policies alone give `permission denied for table`.
- **New functions are granted EXECUTE to PUBLIC automatically.** `revoke ... from authenticated` does nothing about it — `authenticated` still gets in through PUBLIC. The revoke has to name `public`. Two money functions were wide open because of this.
- **Supabase's default privileges grant new tables to `authenticated`.** Migration 7 turned that off for `anon` only. Any new machinery table needs an explicit `revoke all ... from anon, authenticated` or RLS is the only thing standing in front of it.
- **Assert on `has_function_privilege` / `has_table_privilege`, not just on behaviour.** Both of the above returned zero rows in a behavioural test — RLS was doing its job — and only showed up when the tests asked about the grant directly.
- **`psql -tAc` prints the command tag after `RETURNING` output.** `insert ... returning id` gives you the id *and* `INSERT 0 1`. Take the first line.
- **Never seed `auth.users` by hand** — GoTrue fails with an opaque "Database error querying schema" at sign-in. Create users through `/auth/v1/signup`, then attach roles with SQL.

**React**
- **`refreshMemberships` must read the live session**, not the closure. Right after sign-up the auth change has not reached provider state, so `session` is null. Use `supabase.auth.getUser()`. This routed a freshly-claimed stylist to the client screen and **no unit test would have caught it** — only walking the flow did.
- **Browser automation cannot drive react-native-web.** `form_input` sets DOM values without updating React state; synthetic clicks often miss `Pressable`. Use the native value setter plus an `input` event, and ask the user to verify real taps.
- **`Pressable` needs pointer events, not a click.** Dispatching `pointerdown, mousedown, pointerup, mouseup, click` in sequence works where a bare `click()` silently does nothing.

**Ops**
- **Testing Connect against production consumes the one-salon slot.** Verifying `stripe-connect` required creating a real salon, which blocked the owner from ever creating hers. It was cleaned up with a scoped throwaway edge function. If this bites again, add a test-mode-only bypass rather than hand-cleaning.
- **Edge function directories starting with `_` are treated as shared code, not functions**, and will not deploy or route.
- **Hosted Supabase sends ~3 emails/hour.** Real signups need Resend, which needs a domain. Not yet registered.
- **`send-push` and `payment-worker` both need a cron schedule**, or notifications queue silently and deposits are authorised but never captured or released. Both are scheduled now (`drain-notification-queue`, `drain-payment-jobs`, every minute) — but `send-push` went unscheduled from Phase 3 until Phase 4 shipped, so every push in between was queued and never delivered.
- **Stripe Connect needs TWO webhook destinations.** Direct charges live on the connected account and are only delivered to a "Connected accounts" destination; platform charges go to a "Your account" one. Each gets its own signing secret, so `STRIPE_WEBHOOK_SECRET` is a comma-separated list and the verifier tries each. A single-secret verifier silently rejects every event from the other destination — an endpoint that looks healthy and reconciles half the money.
- **v2 account events use "thin payloads"** — an ID, not the object. The handler must never default a missing field: an earlier version turned a missing `charges_enabled` into `false`, which would have DISABLED a working stylist. Every field is now conditional on being present, and the v2 account events are deliberately NOT subscribed until the fetch-on-thin-payload path is built.
- **`pg_net` is required to schedule an edge function from cron**, and it was not installed. That is the real reason `send-push` had no schedule. Cron timeout maxes at 5000ms — that is only how long pg_net waits for a response, not a limit on the function.
- **Supabase gateways enforce a JWT on edge functions by default, and Stripe has no JWT to send.** Every webhook delivery came back 401 before the function was reached — an endpoint that looks healthy in the dashboard while reconciling nothing. Fixed with `[functions.stripe-webhook] verify_jwt = false` in `config.toml` rather than a deploy flag, so it cannot be forgotten. Authentication there is the signature check, which is stronger than a bearer token anyway.
- **Test the app against LOCAL Supabase, not production**, and the one-salon slot is never at risk:
  ```bash
  EXPO_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321 \
  EXPO_PUBLIC_SUPABASE_ANON_KEY=$(npx supabase status -o json | python3 -c "import sys,json;print(json.load(sys.stdin)['ANON_KEY'])") \
  npx expo start --web --port 8083 --clear
  ```
  Shell vars win over `.env`, so nothing in the repo changes. Seed users through `/auth/v1/signup`, never by hand.
- **The whole Stripe-to-database path is testable without Stripe.** The webhook authenticates by a signature we can produce ourselves, so `npm run test:edge` drives the real Deno runtime and the real database with no key involved.
- **A 401 from Stripe proves nothing about your request.** An invalid key is rejected *before* any parameter is validated, so a mistyped parameter name and a bad key fail identically. `STRIPE_API_BASE` points the functions at a local recorder so the request body itself can be asserted — that is what `npm run test:shapes` does. Caught a `payment_intent_data` on a setup-mode session, which is a 400 at Stripe and looks like nothing locally.
- **`supabase functions serve --env-file` REPLACES the environment.** Shell variables do not reach the Deno container, so a test-only override has to live in its own env file (`supabase/functions/.env.recorded`), not be exported before the command.

---

## The one rule not to break

A salon owner holds **both** an admin membership on the salon and a stylist membership on their own chair. Those must stay separate. Neither role, alone or combined, may read a 1099 renter's clients, formulas, revenue, notes, or payments — and that is enforced by **RLS in Postgres**, not by screens choosing not to ask.

This is not a privacy preference. If the owner controls a renter's client book, that is evidence of behavioural control, which is what triggers IRS reclassification of a contractor as an employee. The whole tenant architecture exists for it.

`npm run db:test` proves it. **If a change makes those tests fail, the change is wrong.**
