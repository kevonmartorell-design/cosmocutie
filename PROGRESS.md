# Progress

Status file for whoever picks this up next. **[PLAN.md](./PLAN.md) is the spec** — it records *why* decisions were made, several of which look arbitrary and are not. Read it before changing behaviour.

_Last updated: Phase 5 in progress._

---

## Where things stand

| Phase | Status |
|---|---|
| 0 — Foundation, design tokens, component gallery | ✅ done |
| 1 — Schema, RLS, WatermelonDB | ✅ done, deployed |
| 2 — Identity & tenant onboarding | ✅ done, deployed |
| 3 — Booking & negotiation | ✅ done |
| 4 — Payments | 🟡 plumbing done, Stripe integration blocked on account keys |
| 5 — Clinical records | 🟡 forms + colour bar done, photos deferred |
| 6+ | not started |

**Live:** https://cosmocutie.vercel.app · **Repo:** https://github.com/kevonmartorell-design/cosmocutie
**Supabase:** `tihzzdmvjdplmcdscxbh` · **EAS:** `@vonalmighty/cosmocutie` · **Bundle:** `com.cosmocutie.app`

### Phase 3 — done
Availability engine (`available_slots`) honouring hours, buffers, time blocks and held slots · full negotiation state machine (`create_booking_request`, `respond_to_request`) with caps enforced in SQL · expiry via `pg_cron` every 5 min · client booking flow (stylist → services → day → time) · negotiation thread UI · request inbox for both sides.

Verified: 12 SQL checks on the state machine, 6 on expiry, plus a full two-party run through the browser — Nina requests, Dana sees "Your turn" and Accept/Suggest/Decline, accepts, and a real appointment appears with 30-min buffers, a snapshotted price, and the slot removed from availability.

Also: reschedule/cancel of confirmed appointments with policy tiers · no-show marking with repeat-offender prepay · waitlist offers fired by a trigger on cancellation (top 3, 30-min claim window) · gap-time booking inside chemical processing windows · push notifications end to end (queue table, trigger, Edge Function, device registration).

⚠️ **Phase 3 needs a NEW BUILD, not an update** — `expo-notifications` is native. Run `npm run build:preview`, then `npm run push:preview` for everything after.

**Before notifications actually deliver:** schedule the `send-push` Edge Function (already deployed) to run every minute — Supabase dashboard → Edge Functions → send-push → Schedules.

### Phase 2 — done
Auth and route guards · salon first-run · stylist invitations + claim-on-signup · salon admin view · stylist chair view · service menu · deposit toggle · **business hours** · **stylist profile (bio, headline, Instagram, publish toggle)** · **client invite links with claim-after-signup** · **client account area (stylists, theme, data export)** · **stylist offboarding**.

Verified end to end in a browser plus 9 SQL checks. Notably: offboarding deactivates a chair and cancels future appointments but **does not delete the renter's book** — that data is theirs and must be exported first.

**Deferred to Phase 5 (needs `expo-image-picker`, a native module → new EAS build):** portfolio photo upload. Bio and Instagram link ship now.
**Deferred to Phase 7:** in-app account deletion (compliance phase, required before store submission).
**Follow-up, not yet built:** stylist invitations are email-matched only — they need the same **token-link** treatment client invites already have, so an owner can copy a link and send it any way they like. See PLAN.md → Invitations. Universal/App Links also need a domain.

---

## Commands

```bash
npm run db:start      # local supabase (excludes services that fail healthchecks)
npm run db:test       # reset + seed + 20 adversarial RLS checks
npm run db:types      # regenerate src/lib/database.types.ts after a migration
npm run typecheck
npx expo export --platform web --clear && npx vercel deploy --prod --yes
npm run build:preview                      # one-time: standalone app for the phone
npm run push:preview "Phase 4 - payments"  # ship JS to that app, with a readable title
npm run push:list:preview                  # what has actually been pushed
```

**Always pass a short title.** A bare `eas update` takes the entire multi-line commit body as the message, which makes the update list unreadable and impossible to tell apart later.

Migrations live in `supabase/migrations/`, tests in `supabase/tests/`.

---

## Gotchas that cost real time

- **Metro caches inlined env vars.** After editing `.env`, always export with `--clear` or you will ship a bundle pointing at the wrong Supabase. This looked like a broken signup form for a while.
- **Expo Go cannot run this app.** WatermelonDB ships native code. Use EAS builds; `eas update` covers JS-only changes, so a rebuild is only needed when a *native* dependency is added.
- **RLS and GRANTs are separate layers.** Policies alone produce `permission denied for table`. Both are required.
- **RLS policies can recurse.** `client_records` querying `clients` (whose policy queries `client_records`) deadlocked as "infinite recursion detected in policy". Resolve identity through `SECURITY DEFINER` helpers — `current_tenant_ids()`, `current_client_ids()` — never by joining the other table inside a policy.
- **Don't add INSERT policies to `tenants`.** Salon/chair creation goes through the `create_salon` / `invite_stylist` RPCs. A broad insert policy would let anyone mint a chair inside someone else's salon.
- **Avoid full-screen `backdrop-filter` on web.** It ghosts on resize in Chromium and reads as the screen rendering twice. The ambient layer uses a CSS `filter` on web instead.
- **Browser automation cannot drive react-native-web.** `form_input` sets DOM values without updating React state, and synthetic clicks/scrolls often do not reach Pressable. Use the native value setter + `input` event, and ask the user to verify real interaction.
- **`gen_random_bytes` is not portable.** Locally pgcrypto lands in `public`; on hosted Supabase it lives in `extensions` and is not on the search_path for a DDL default, so a migration passes locally and fails on push. Prefer `gen_random_uuid()`.
- **`refreshMemberships` must read the live session, not the closure.** Straight after sign-up the auth change has not reached provider state, so `session` is still null — loading memberships for `undefined`, returning empty, and routing a freshly-claimed stylist to the client screen. Use `supabase.auth.getUser()`.
- **`CREATE OR REPLACE FUNCTION` cannot change a return type**, and adding a defaulted parameter creates an *overload* rather than replacing. Drop first when either changes.
- **PL/pgSQL locals shadow column names — this has bitten twice.** A local called `weekday` broke `available_slots`; one called `id` broke `record_deposit_intent` with "column reference is ambiguous". Prefix every local `v_`.
- **A statement sees one snapshot.** Calling a function and checking the row it changed *in the same statement* reads the pre-change value. Split into two statements — this has produced three false failures in tests so far.
- **`search_path = ''` in SECURITY DEFINER functions means every type must be schema-qualified** (`public.my_enum`, not `my_enum`). The empty search_path is a deliberate privilege-escalation guard, so this is the price of it.
- **`supabase/functions` must be excluded from tsconfig.** Edge functions are Deno, with different globals and module resolution; typechecking them against the app config produces noise, not signal.
- **Two build profiles, and they behave completely differently.** `development` is a dev-client shell that will not open on its own — it expects `npx expo start --dev-client` running on the Mac. `preview` is a standalone app: tap the icon and it runs, pulling OTA updates from the `preview` branch. **Use preview for reviewing phases**; development only when live-reloading against a local server.
- **`fallbackToCacheTimeout` was 0 by default**, meaning a published update only appeared the *second* time the app opened. Set to 8000ms so what you just pushed is what you see on first launch.
- **Never seed `auth.users` by hand.** GoTrue reads its token columns as text and fails on NULL, producing an opaque "Database error querying schema" at sign-in. Create test users through `/auth/v1/signup`, then attach roles with SQL.
- **PL/pgSQL variables shadow column names.** A local named `weekday` makes `bh.weekday = weekday` ambiguous. Prefix locals (`v_weekday`).
- **Enum columns need explicit casts from `CASE`.** Postgres infers enums for bare literals but not for a CASE result.
- **Hosted Supabase sends ~3 emails/hour** on the built-in SMTP. Real signups need a custom SMTP provider (Resend) before anyone else uses the app.

---

## The one rule not to break

A salon owner holds **both** an admin membership on the salon and a stylist membership on their own chair. Those must stay separate. Neither role, alone or combined, may read a 1099 renter's clients, formulas, revenue, or notes — and that is enforced by RLS in Postgres, not by screens choosing not to ask.

`npm run db:test` proves it. If a change makes those tests fail, the change is wrong.
