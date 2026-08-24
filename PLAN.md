# CosmoCutie — Salon App Plan

Running spec, built up over conversations with Claude.

**Source material:** `Hair Salon App Features Research.docx`, `Technical Infrastructure and App Store Compliance Research.docx`, `Cosmo Cutie ui and animation suggestions .docx`

## Project details

| | |
|---|---|
| **App name** | CosmoCutie |
| **Business email** | cosmocutiesalon@gmail.com |
| **Apple Developer** | Active (existing account, new app record) |
| **Google Play Console** | Active (existing account, new app record) |

**This is the business email**, serving three roles at once:
1. **Public contact** — the support address on both store listings, and where customer and stylist inquiries land
2. **Published contact information** — satisfies the requirement Apple's UGC guideline imposes once the Phase 8 feed ships
3. **Account of record** — Apple, Google, Supabase, Stripe, domain registrar

🔐 **Secure it accordingly — it is a single point of failure.** Whoever holds this inbox can reset Stripe (the money), Apple and Google (app distribution), and Supabase (every client record in the system). Turn on 2FA with an authenticator app rather than SMS, and record recovery codes somewhere offline. This is the cheapest risk reduction available anywhere in this plan — and it protects the client's data as much as the business.

**One operational distinction:** automated mail (receipts, booking confirmations, pickup-ready notices) must send through a domain-authenticated service like Resend or Postmark — Gmail isn't built for automated volume and lacks the domain authentication that keeps mail out of spam folders. **Set the reply-to on those messages to the business email**, so anyone replying to a receipt still reaches the real inbox. The business email stays the human-facing address; the sending service is just plumbing.

*Optional later: once the domain is registered, Google Workspace lets you run the same inbox as `hello@cosmocutie.com` for a few dollars a month. Purely presentational — the Gmail works fine.*

> **Note on phase numbering:** this plan was renumbered when it was restructured into build phases. Earlier conversation used "Phase 1 = MVP" and "Phase 2 = deferred extras." Those now map to **Phases 0–7 (MVP)** and **Phase 8 (post-launch)**. Same scope, finer granularity.

---

## Locked-in decisions

- **Builder:** solo founder + Claude Code (not an agency, not a hired team)
- **Platforms:** iOS + Android together (React Native/Expo, one codebase)
- **Backend:** Supabase (Postgres + RLS for multi-tenancy, Auth, Storage, Edge Functions)
- **Mobile offline layer:** WatermelonDB (SQLite-backed, offline-first)
- **Payments:** Stripe Connect, Express accounts; Direct Charges for 1099 booth renters, Destination Charges for W-2 commission stylists
- **Design:** "Cyber Magical Girl" palette + glassmorphism (light/dark toggle). Glass is a **client requirement**, not a style preference.
- **MVP scope:** booking + negotiation, multi-tenant stylist profiles/pricing, Stripe Connect payments, patch-test consent, offline sync. Smart-scale IoT, SMS win-back, wallet passes, and physical card readers are post-launch.
- **Deployment scope:** **one salon, one app.** Shipping to the App Store for a single salon. Expansion to multiple salons is a distant maybe, not a near plan — build for one location and keep the tenant-scoped schema, which already supports more if it ever happens.
- **Salon signup is off by default**, controlled by a database setting rather than code, so a delivered app never lets a stranger create a salon inside it — and it can be turned on later without a rebuild.
- **Role is chosen before the account is created**, not discovered afterwards.
- **Salon address is editable** — a salon moves, and a hardcoded address becomes wrong.
- ~~**Deployment scope:** **single salon** for launch~~ — one branded app, no marketplace/discovery layer. Schema stays tenant-scoped anyway, because booth renters are already separate tenants inside one salon, and multi-salon may come later.
- **Client data ownership:** shared identity record, tenant-scoped relationship records — see Reference. Driven by 1099 compliance.
- **Roles are composable:** the salon owner is also a working stylist, holding admin *and* stylist roles on one account, with their own chair scoped as its own tenant.
- **Engagement layer (Phase 8):** deals/featured placement first, then the CosmoCutie Feed — vertical-swipe, stylists/admin post only, service-tagged posts link straight into booking, per-photo client consent required. Mixed photo + video, though see the cost note before committing to video at launch.
- **Featured placement uses round-robin rotation, not admin hand-picking** — the owner approves *what* runs, but can't control *who* runs, since they compete with their own renters.
- **CosmoCutie Shop (Phase 10):** retail, **pickup only — no shipping**. Admin and stylists both list; one vendor per order so each seller's revenue routes to their own account. QR pickup code + receipt + staff release record. Stylist products also appear on their own profile as a storefront.
- **Shop fee: 5% on stylist sales**, owner-configurable, and **not applied to the salon's own products**. Booth/chair rent likewise set by the owner. *Recipient of the shop fee is still open — see Open Question 1.*
- **Client account area** — profile, appointments, likes, following, shop history, settings. Shell built in Phase 2, sections light up as features ship.
- **No free messaging.** One conversational surface only: the **negotiation thread**, which renders as a chat but is button-driven with short notes attached to actions — no text box anywhere. Threads archive with the appointment. No DMs, no feed comments.
- **Review workflow:** one phase at a time, reviewed before the next starts. Preview via **Expo web export deployed to Vercel** — see the Development Workflow section for commands and for what web previews can and can't prove.
- **Shop policies:** 14-day pickup window then auto-refund/restock; unopened returns within 14 days, opened product non-returnable; Stripe Tax for sales tax.
- **Cancellation policy:** tiered window, stylist-configurable within platform bounds, fees capped at the deposit — see Reference.
- **Sensitive health data:** minimize by design — store consent decisions and outcomes, not medical histories. See Reference.
- **Deposits:** the per-stylist "Require deposit" toggle **defaults to OFF** — stylists opt in rather than out.
- **Negotiation timing:** **48-hour hard cap** on the whole negotiation, 12-hour per-step windows inside it.
- **RevenueCat:** not needed (no in-app-purchase subscriptions planned; any salon-owner platform fee gets billed via web/Stripe, not IAP)

---

# DEVELOPMENT WORKFLOW & PREVIEW DEPLOYMENT

> **Read this before starting any phase.** It defines how work gets reviewed. Written for future agents as much as for the project owner — if you are an agent picking this plan up, follow this section rather than inventing your own preview approach.

## The working rhythm

**One phase at a time, built to completion, then reviewed before the next begins.** Phases are ordered by dependency, so skipping ahead means building on a foundation that isn't there yet. Each phase below has an **Exit criteria** line — that's the review checklist.

**✅ Decided: UI arrives phase by phase, attached to real functionality.** A "build all the screens first" prototype pass was considered and rejected. Every screen you review is a working screen backed by real data — nothing is mocked, and nothing gets built twice. The tradeoff accepted: you see the complete picture later than a prototype would show it. *Future agents: do not propose reordering into a UI-first build.*

## ⚠️ The Vercel wrinkle — read this first

This is a **React Native / Expo** app targeting native iOS and Android. **Vercel does not host native apps.** But Expo compiles the same codebase to web via `react-native-web`, and *that* build deploys to Vercel fine. So the preview URL works — with limits worth knowing before relying on it.

**What reviews accurately on the Vercel web build:**
- Screen layouts, navigation, and overall flow
- Booking flow and the negotiation state machine
- Forms, validation, and business logic
- Supabase queries and RLS behavior
- Feed and shop UI, catalog browsing, cart
- Glassmorphism — `expo-blur` maps to CSS `backdrop-filter` on web

**What does NOT work on web, and must be checked on a real device:**
- Push notifications (web push is a separate system entirely)
- Camera capture and photo library behavior
- Tap-to-Pay and Stripe Terminal hardware
- Bluetooth smart scale (Phase 11)
- Apple/Google Wallet passes
- True offline sync behavior — WatermelonDB uses a different storage adapter on web, so offline testing there does not prove the native path works
- Real performance, especially blur and particle animation on budget Android

**Rule of thumb: Vercel proves it *looks and flows* right. Device builds prove it *works*.** Most phases are reviewable on Vercel; Phases 4, 6, and 7 need device verification for the items above.

## Setup

**Vercel project:** connect the git repo and set the build to output Expo's web export. Add a `vercel.json` with an SPA rewrite so client-side routes resolve:

```json
{
  "rewrites": [{ "source": "/(.*)", "destination": "/index.html" }]
}
```

**Build settings in Vercel:**
- Build command: `npx expo export --platform web`
- Output directory: `dist`

*Verify these against the installed Expo SDK version before trusting them — Expo has changed the web export command across major versions, and an older or newer SDK may differ. If the build fails, check the Expo docs for the SDK in `package.json` rather than guessing.*

## Commands

Deploy a preview build:

```bash
npx expo export --platform web && npx vercel deploy --prebuilt
```

Promote to the production preview URL:

```bash
npx expo export --platform web && npx vercel deploy --prebuilt --prod
```

Run locally in a browser before deploying:

```bash
npx expo start --web
```

Preview on a real phone (for the native-only items above):

```bash
npx expo start
```

Then scan the QR code with Expo Go. For a build that's already installed on the device, push an over-the-air update instead:

```bash
eas update --branch preview
```

**Device workflow: EAS, not Expo Go.**

Expo Go cannot run this app — WatermelonDB ships native code, and Expo Go is a fixed prebuilt container. Device testing uses EAS builds instead, which is also the workflow already familiar from previous projects.

Build once, then update instantly:

```bash
eas build --profile development --platform ios
```

That produces an installable app (internal distribution). Afterwards, every JavaScript change ships over the air in seconds:

```bash
eas update --branch development
```

⚠️ **A new build is only needed when a NATIVE dependency is added** — not for ordinary feature work. Upcoming phases that will each require one: expo-notifications (Phase 3), expo-camera (Phase 5), Stripe SDK (Phase 4). Everything between those is `eas update`.

Profiles in `eas.json`: `development` (dev client, internal), `preview` (production-like, internal), `production` (store). Supabase env vars are set per profile; the anon key is public by design and already ships in the web bundle.

**Store-based device testing.** Both developer accounts are already active, so **TestFlight** and **Google Play internal testing** are available as device-review channels from day one — no enrollment wait, no new fees. Use these for the native-only items (push notifications, camera, Tap-to-Pay, offline sync, real performance) rather than treating device testing as a late-stage activity.

Expo Go is faster for day-to-day iteration; TestFlight and internal testing give the closest thing to production behavior. **Push notifications in particular behave differently in Expo Go than in a real build**, so validate the Phase 3 negotiation notifications through TestFlight or an internal-testing build before considering that phase complete.

**Environment variables:** Supabase and Stripe keys must be set in the Vercel project settings, not committed. Use test-mode Stripe keys for every preview deployment — a preview environment must never touch live payment credentials.

## Per-phase review method

| Phase | How to review |
|---|---|
| 0 — Foundation | **First visual review.** Component gallery on Vercel + real devices — approve the palette, glass, and dark/light toggle here |
| 1 — Data model | **Nothing to look at.** Review via SQL: run cross-tenant read attempts and confirm RLS refuses. Ask for the test output. The only phase with no visual deliverable. |
| 2 — Onboarding | **First working app.** Vercel — create two stylists with different menus, confirm isolation |
| 3 — Booking | Vercel — walk the full negotiation flow end to end |
| 4 — Payments | Vercel for flow, **device for Tap-to-Pay**. Stripe test mode + Stripe dashboard to confirm money moved correctly. |
| 5 — Clinical records | Vercel for forms; **device for camera capture** |
| 6 — Offline sync | **Device only.** Airplane mode, then reconnect. Web storage adapter differs and proves nothing. |
| 7 — Compliance | Vercel for deletion flow and consent UI; device for push/SMS |
| 8 — Deals + Feed | Vercel — though video playback performance needs a device |
| 9 — Ecosystem | Vercel |
| 10 — Shop | Vercel for catalog/cart/checkout; device for QR pickup scanning |

---

# BUILD PHASES

## Phase 0 — Foundation & Setup

*Goal: everything needed before a single feature can be written. Nothing user-facing ships here.*

- Create all accounts (see **Accounts** reference below)
- Expo/React Native project scaffold, TypeScript config, repo + git
- Supabase project provisioned (dev + prod environments)
- **Theme tokens built first** — palette, blur radii, border opacities, corner radii as centralized tokens. Cheap now, painful to retrofit.
- Base component library: glass card, button, input, modal — built against the tokens
- **Component gallery screen** — a single screen displaying every component in every state (buttons idle/pressed/disabled, glass cards on both backgrounds, inputs with and without errors, modals) plus the light/dark toggle. Cheap to build, and it's the **first thing you can actually look at and react to**. It also stays useful permanently as a design reference and as the fastest place to catch a broken component after any change.
- EAS Build configured, test builds landing on real devices
- Error/crash monitoring wired up (Sentry or similar) — trivial now, invaluable later
- **Test on real low/mid-range Android hardware immediately.** `expo-blur` is solid on iOS but weaker and device-dependent on Android. Find out now, not in Phase 6.

**Exit criteria:** the component gallery loads on the Vercel preview *and* on a real iPhone and a real budget Android device, with the light/dark glass toggle working in all three. **This is your first visual review — the aesthetic gets approved here, before any features are built on top of it.**

### ✅ Phase 0 status — web complete, devices pending

**Live preview:** https://cosmocutie.vercel.app
**Repo:** https://github.com/kevonmartorell-design/cosmocutie

Done and verified in a browser: design tokens, theme provider (system/light/dark, persisted), GlassCard with Android solid fallback, CCButton with spring physics, CCInput with focus/error states, CCModal, AmbientBackground orbs, component gallery, Supabase client, Vercel deploy with env vars.

**Still outstanding before Phase 0 closes:**
- Load the gallery on a real iPhone and a real budget Android device (`npx expo start`, scan with Expo Go)
- **Confirm the Android glass fallback looks acceptable** — `GlassCard` deliberately renders a tinted solid surface there rather than a weak blur; that decision needs a human eye on real hardware
- Confirm mouse-wheel scrolling on desktop web (the element is textbook-scrollable and scrolls programmatically, but browser automation could not drive a wheel event to verify it end to end)
- Replace the placeholder Expo app icon and splash asset

---

## Phase 1 — Data Model & Multi-Tenancy Spine

*Goal: the schema everything else sits on. Highest-consequence phase in the plan — mistakes here cascade into every later phase.*

- **Build the ERD** — Users, Tenants, Stylists, Clients, Services, Appointments, Formulas, Inventory, Consents, Payments. Actual foreign keys, cascade rules, indexes.
- Shared-table multi-tenant schema — every table carries `tenant_id`
- **Row-Level Security policies on every table**, tested adversarially (can Stylist A query Stylist B's clients? Prove no.)
- `tenant_id` as leading column in composite indexes
- Auth: Supabase Auth for stylists, salon owners, and clients — with distinct roles
- **WatermelonDB schema mirrored client-side, and all screens built against it from day one.** Do not build screens against direct Supabase calls "for now" — retrofitting offline-first is a rewrite, not a refactor.

- **Client data ownership model implemented** — shared identity table + tenant-scoped relationship records (full spec in Reference). RLS must prove Stylist A cannot read Stylist B's relationship record for the same human.
- **Multi-service appointments** — one appointment holds many services. Model this now; retrofitting it later means touching the booking engine, pricing, deposits, and processing windows all at once.
- **Formulas and service notes attach to the appointment, not just the client record** — required so a child's color history doesn't mix into the guardian's, and correct in general since a formula belongs to the service performed
- Time zone strategy — store everything UTC, render local; needed for both appointments and TCPA send windows

**Exit criteria:** schema deployed, RLS verified by attempting cross-tenant reads, local WatermelonDB schema matching.

### 🟡 Phase 1 status — schema and RLS done, two items outstanding

**Done and verified against a local Postgres:** 6 migrations in `supabase/migrations/`, 22 tables, RLS on every one, and 20 adversarial tests in `supabase/tests/` that all pass. Generated TypeScript types wired into the Supabase client.

The headline check: **Dana (holding salon-admin AND stylist roles simultaneously) cannot read Rae's client records, formulas, revenue, appointments, or tags.** Anonymous callers are blocked at the privilege layer before RLS is even consulted.

Two bugs were caught that would otherwise have reached production:
- **Infinite RLS recursion** — the `client_records` policy queried `clients`, whose policy queried `client_records`. Fixed with a `SECURITY DEFINER` helper.
- **Missing table GRANTs** — RLS decides which rows; grants decide table access. Policies alone produce "permission denied for table".

Run the suite any time with:

```bash
npm run db:test
```

✅ **Deployed to the hosted project** (`tihzzdmvjdplmcdscxbh`) and verified live over the REST API: anonymous callers get `401 / 42501` on every private table, the catalogue stays browsable pre-signup, and anonymous writes are refused.

A seventh migration was added after deployment. Hosted Supabase ships default grants giving `anon` table-level SELECT across the public schema, which left RLS as the *only* barrier — behaviourally safe, but one mistaken permissive policy away from exposure. `20250101000007_revoke_anon.sql` restores the two-layer posture the local database had, and revokes default privileges so future tables don't silently inherit anon access.

✅ **WatermelonDB local schema done.** 14 tables mirrored in `src/db/`, models with relations, platform-split adapters, and a smoke test at `/db-check` that proves writes/relations/queries/JSON round-trip actually work in a browser (7/7).

Deliberately **not** mirrored locally: payments (money is server-authoritative), booking requests and negotiation events (deadline-driven and contested — stale local state would show a taken slot as free), feed/shop (network content), and photos (blobs belong in Storage).

⚠️ **Workflow consequence: Expo Go no longer works on device.** WatermelonDB ships native code, so iOS/Android testing now needs a development build:

```bash
npx expo prebuild && npx expo run:ios
```

The Vercel web preview is unaffected — it runs LokiJS over IndexedDB, pure JavaScript. But that also means **web previews cannot validate offline behaviour**: the storage engines genuinely differ, so Phase 6 offline testing must happen on a real device. This supersedes the "scan the QR code with Expo Go" guidance in the Development Workflow section above.

**Phase 1 is complete.**

---

## Phase 2 — Identity & Tenant Onboarding

*Goal: first demoable slice. A stylist can set up a real, complete business profile.*

- Stylist signup → profile → portfolio (photo upload, Instagram link)
- Independent service menu: services, pricing, durations, descriptions — per stylist
- Independent business hours, personal time blocks
- Per-stylist policy settings: cancellation policy, **no-deposit switch** (see Reference below)
**Salon setup (owner's first run):**
- Salon profile — name, address, phone, logo/branding
- **Location matters for three separate systems:** TCPA send-window timezone (Phase 7), sales tax jurisdiction (Phase 10), and maps/directions. Capture it once, properly.
- Salon business hours (defaults; stylists override with their own)
- Chair/station inventory — how many, who's assigned where. Drives the occupancy metrics.
- Salon's own Stripe Connect account — receives booth rent, salon product sales, and the owner's own service revenue
- Deal rotation settings — number of featured slots (Phase 8a)
- **Then the owner sets up their own chair**, running the same stylist onboarding as everyone else. Two-part first run: salon, then chair.

**Stylist invitation flow — stylists do not self-register.** This is a single salon; the owner controls who's in it.
1. Owner sends an invite (email or SMS) to a prospective stylist
2. Owner sets their **classification** (1099 renter / W-2 commission), chair assignment, and **booth rent amount + frequency + start date**
3. Stylist accepts, creates their account, completes their own Stripe Connect onboarding
4. Stylist acknowledges the booth rental agreement and platform terms (including the 10% shop fee) — **capture timestamp and the exact document version shown**
5. Stylist builds out their menu, hours, and portfolio, then goes live

*Invite-only is also a security property: it means nobody can register as a stylist at this salon and start receiving bookings.*

**Stylist offboarding — build this before you need it.** A renter leaving is a legally and practically loaded moment, and improvising it under pressure goes badly.
- Their data **exports with them** — clients, history, formulas, photos (Phase 5). This is the ownership promise made concrete.
- Future appointments need explicit handling: notify affected clients, offer rebooking with another stylist, or cancel with full deposit refunds
- Booth rent collection stops on their end date; settle any outstanding balance
- Products delist from the shop; open orders must still be fulfilled
- Decide the fate of their feed posts — recommend **removing them**, since the portfolio belongs to the stylist and leaving it up advertises someone who no longer works there
- Their client records are deleted from the platform after export (minus tax-mandated retention)
- Their profile is deactivated, not hard-deleted, until the retention window closes

- Facility-wide dashboard shell
- **Roles are composable, not exclusive.** The salon owner is also a working stylist, so one account holds both roles simultaneously — full admin capability *plus* a complete stylist practice (own service menu, pricing, hours, portfolio, calendar, client book, deposit setting). Model this as a set of roles on a user, never as a single `account_type` enum.
- **Explicit context switch in the UI** — "my chair" (stylist view) vs "my salon" (admin view). Keep them separate surfaces rather than one merged super-dashboard; merging is how renter data accidentally leaks into an owner screen.
- Worker classification per stylist: **1099 renter / W-2 commission / owner-operator** — drives payment routing in Phase 4
- Client signup + profile

## Signing Up — role first

**The role is chosen before the account exists, not after.** The earlier flow created an account and then asked what to do with it, which puts the explanation in the wrong order: a person knows who they are before they know what a "tenant" is.

**Three doors on the opening screen:**

| Choice | What happens |
|---|---|
| **I'm booking appointments** | Ordinary client signup. The common case, listed first. |
| **I work at this salon** | Asks for an **invite code**, then signs them up straight into their chair. |
| **I run this salon** | Salon setup — **hidden unless `allow_salon_signup` is on** |

### Salon signup is off by default

A single row of `platform_settings` controls it, defaulting to **false**. This app ships to one salon, and in that context "create your own salon" is not a feature but a way for strangers to appear inside the owner's app.

Kept as a database setting rather than a build flag deliberately: it can be turned on later without a rebuild, and turned off again just as fast if it was a mistake. The salon itself is created once at handover.

### Stylist invite codes

The stylist door has to deliver what it promises, and stylists are invite-only. So an invitation now carries a **short code** alongside the email match:

- The owner invites, and gets a code to pass on however they like
- The stylist enters it at signup and lands directly in their chair
- Email matching stays as a fallback, so an invitation still auto-claims if they happen to sign up with the invited address

The code matters because it survives the common case the email match does not: someone invited at one address signing up with another.

## Invitations — link-first, for both directions

**Every invitation in the app must work as a shareable link, not only as an email.** Two flows, one mechanism:

| Invite | Sent by | Recipient becomes |
|---|---|---|
| **Client invite** | a stylist | a client in *that stylist's* book |
| **Stylist invite** | the salon owner | a stylist with their own chair |

*Status: client invites are built (token links, claim-after-signup). **Stylist invites are currently email-matched only and need the same token-link treatment.***

**Delivery is always "generate a link, the human sends it."** The app copies a link to the clipboard or opens the share sheet; the sender passes it along by text, Instagram DM, WhatsApp — whatever they already use.

⚠️ **This is not just convenience, it sidesteps a real TCPA problem.** If the *app* sent an SMS to someone who never consented, that is an unsolicited commercial message carrying $500–$1,500 per-message exposure. A person texting their own contact is legally unremarkable. App-sent invites would require consent capture *before* sending, which defeats the purpose of inviting someone who isn't on the platform yet.

### The full journey a link has to survive

1. Recipient taps the link on their phone
2. **App installed** → opens straight to the right destination (that stylist's profile, or the chair invitation)
3. **App not installed** → lands on a web page → App Store / Play Store → installs → opens → **still resolves to the right stylist**

Step 3 is the hard part and is where most implementations quietly fail.

### ⚠️ iOS does not carry a URL through an App Store install

This is worth knowing before it's budgeted as a small task. When someone installs from the App Store, the app's first launch has no knowledge of the link that sent them there. Two honest options:

**Option A — "tap the link again" (no third-party dependency).** The web landing page says *"Install the app, then tap this link again."* Once installed, Universal Links (iOS) / App Links (Android) route the second tap straight into the app with the token intact. Costs one extra tap; adds no SDK, no vendor, no tracking.

**Option B — a deferred deep-link service** (Branch, AppsFlyer). Genuinely seamless — install and the app opens on the right screen with no second tap. But it means another vendor, another SDK, and fingerprinting-adjacent matching that carries its own privacy considerations.

**Recommendation: Option A.** The extra tap is a small cost against adding a tracking SDK to an app that holds client health-adjacent consent records. Revisit only if invite conversion measurably suffers.

*On web the token already survives the round trip: it's stashed before sign-up and reapplied afterwards, so a link opened in a browser never loses its destination.*

### Requirements

- **A domain** — Universal Links and App Links both need association files hosted on a domain you control. Not yet registered; this is the main thing gating step 2.
- **Token-based stylist invitations**, matching the client-invite pattern
- **Attribution is not cosmetic**: an invited client must land in the *inviting stylist's* `client_records`. That is what makes the ownership model real rather than nominal.

*The same link mechanism should serve feed posts, deals, and stylist profiles — anything shareable outward must resolve correctly on the way back in.*

**Exit criteria:** two stylists with genuinely different menus/pricing/hours coexist, isolated, in one salon.

---

## Phase 3 — Booking Core

*Goal: the heart of the app. Everything before this was setup.*

- **Smart availability engine + calendar** — unavailable times are never shown (full spec in Reference). Includes the **30-minute buffer** between appointments, slot holds during negotiation, and the Postgres exclusion constraint that makes overlaps structurally impossible.
- "Please arrive 5 minutes early" on confirmations and reminders, editable per stylist
- Client-facing browse → stylist → service → request flow
- **Booking Negotiation state machine** (full spec in Reference below) — accept/decline/reschedule, 2 counter-offers per side, **stylist closes with the final decision**
- Intelligent service bundling (color → prompts finishing service)
- Gap-time double-booking — release processing windows for a second short appointment, with collision validation
- Waitlist + automated matching when a slot opens
- Late-arrival auto-flagging
- **Push notifications** (Expo Push → APNs/FCM) — the negotiation flow is dead without them. Every state transition notifies the other party.
- **Scheduled-job infrastructure** (Supabase `pg_cron` / scheduled Edge Functions) — needed for the negotiation timeouts (both the per-step and global-cap clocks), and reused later for booth rent and reminders

**Sequencing note:** the negotiation flow depends on deposit holds, which are Phase 4. Build Phase 3 with **every stylist defaulting to no-deposit** — the no-deposit switch is a natural stub. Payments layer in cleanly on top in Phase 4 without reworking the state machine.

**Exit criteria:** a client can request, negotiate, and land a confirmed appointment end-to-end, with no money involved yet.

---

## Phase 4 — Payments & Money Movement

*Goal: money flows correctly and legally. Highest-risk phase for real-world consequences.*

- Stripe Connect Express onboarding, embedded in stylist setup
- **Deposit authorize → capture/release**, wired into the negotiation state machine
- Payment routing branch: Direct Charges (1099 renters) vs Destination Charges (W-2, with `on_behalf_of`) vs **owner-operator** — the owner's service revenue routes to the salon's own connected account, since it's the same business entity and they don't pay themselves rent
- **Tag owner revenue by source in reporting** — booth rent collected vs the owner's own service revenue. Rental income and service income are reported differently at tax time, and separating them at the source beats reconstructing it in April.
- Checkout / cardless payment from the chair
- Automated recurring booth-rent collection (flat rate, never a commission split — this is the IRS-compliance firewall)
- Chargeback defense: `charge.dispute.created` webhook → auto-bundle evidence (signatures, check-in logs, photos) → submit within issuer deadline
- Transfer reversal handling for destination-charge disputes
- **Cancellation & refund policy engine** — tiered windows, per-stylist configuration, policy-acknowledgment capture at booking (full spec in Reference)

**Testing note:** this phase deserves genuine automated test coverage. A state machine that moves money, across two worker classifications, with holds that must release — manual testing will miss cases.

**Exit criteria:** a real (test-mode) deposit is held, captured on accept, released on decline. Booth rent auto-collects. Money lands in the right account for both worker types.

---

## Phase 5 — Clinical Records & Consent

*Goal: the salon-specific workflows generic booking apps can't do, plus the sensitive-data handling they require.*

> **Governing principle: collect the minimum.** Store consent decisions and outcomes, never medical histories. Full spec in Reference — read it before building any intake screen.

- Digital patch-test consent forms — auto-triggered pre-appointment for chemical services, blocks completion until signed
- Patch test records store: test date, product/pigment tested, result, signature, timestamp. **Not** the client's medical background.
- Contraindication screening asks the questions but stores only a **boolean outcome + acknowledgment**, not the underlying answers
- Service-safety allergy flag (narrow and specific, e.g. PPD sensitivity) — the one health-adjacent field genuinely worth storing
- Encryption at rest and in transit; Role-Based Access Control so only the treating stylist sees safety flags and notes
- **Digital Color Bar** — formula tracking (gram weights, developer volumes, technique notes)
- Time-stamped before/processing/after photo galleries attached to client profiles
- **Image compression strategy** — high-res photos across thousands of clients is the fastest way to blow past storage tiers; decide compression/thumbnail policy here, not after the bill arrives
- Full data export for booth renters (CSV/JSON) — client records, appointment history, formula notes. Required by the no-lock-in principle.

**Exit criteria:** a stylist can log a color formula with photos, and reproduce it months later. A renter can export everything they own.

---

## Phase 6 — Offline Sync & Design Polish

*Goal: make it feel native, instant, and magical. Two workstreams that both come late.*

**Offline sync engine:**
- Backend `pullChanges` / `pushChanges` endpoints, exact JSON payload contracts
- Timestamp-based delta sync
- **Conflict resolution strategy** for the same record modified on two offline devices — must be explicitly defined, not left to default behavior
- Test against genuine dead zones, not just airplane mode

**Design polish (client-facing screens only):**
- Sparkle trail bursts on tap/toggle/completion
- Holographic shimmer on cards and headers
- Spring-physics bounce on buttons and modals
- Floating ambient particles on dashboards
- Light/dark glass toggle finalized
- **Profile animation performance on budget Android** before committing

*Deferred to post-launch: gyroscope tilt/refraction on glass cards — cosmetic, adds a device-motion dependency.*

**Exit criteria:** app is fully usable with the network off, syncs cleanly on reconnect, and looks like the client asked for it.

---

## Phase 7 — Compliance & Store Readiness

*Goal: legally shippable. Several items here are hard gates — the app cannot launch without them.*

- **TCPA:** immutable consent logs (timestamp, IP, opt-in source, exact disclosure language shown); informational vs promotional message separation; real-time STOP suppression; 8am–9pm recipient-local-time send windows
  - *Note: consent logging must exist before the first SMS ever sends — build it in Phase 3 alongside notifications if messaging starts early*
- **In-app account deletion** (Apple Guideline 5.1.1) — hard delete, not an `is_active` flag. Retain only what tax law requires. Revoke Sign in with Apple tokens via the REST API if SSO is used.
- IAP vs external payment routing split — physical services via Stripe are fine; any purely digital goods must use native IAP
- Privacy Policy + Terms of Service (required for store submission)
- Booth rental agreement template (legal doc between owner and renter — separate from the app, but the app's money flow must match it)
- Accessibility pass — glass + neon on bright backgrounds is a contrast-ratio risk; verify text legibility
- Backup / disaster recovery verified — client history and formula archives are the crown jewels
- App Store + Play Store submission

**Exit criteria:** approved on both stores.

---

## Phase 8 — Engagement Layer (Deals + Feed)

*Two surfaces, one subsystem: curated content that converts into bookings. **Deals should ship first** — they're simpler, need no media pipeline, and drive revenue immediately. The feed follows.*

### 8a — Deals & Featured Placement

A curated strip at the top of the client home screen showing current offers from stylists.

**Deal types:**
- Percentage or dollar off a service
- New-client introductory offers
- **Flash deals for gap-filling** — this is the one that earns its keep. A stylist with a 3pm cancellation posts a same-day discounted slot, and it pushes to the waitlist built in Phase 3. Empty chairs become revenue, and clients get a deal they'd otherwise never see. The infrastructure for this already exists in the plan; deals just give it a front door.
- Seasonal/promotional campaigns from the salon itself

⚠️ **The curation conflict — design around it, don't leave it to goodwill.** The admin is also a competing stylist. If featured placement is hand-picked at the owner's discretion, they can feature themselves and bury their renters, and there's no version of that which stays fair for long. The renters *will* notice, and it directly undermines the "keep stylists wanting to be here" goal.

**Recommended model — rotation with approval, not hand-picking:**
- Fixed number of featured slots (start with 3)
- **Automatic round-robin rotation** — every active stylist cycles through equally, including the owner
- **Admin approves or rejects individual deals** for quality and appropriateness, but does not control ordering or frequency
- Flash/same-day deals can bypass rotation, since they're time-critical and self-limiting
- Surface the rotation openly to stylists ("you're featured Tuesday") — visible fairness is what actually retains people

This gives the owner real editorial control over *what* appears while removing their ability to advantage themselves on *who* appears. It's a better answer to "so it's fair" than discretion, because it's fair by construction rather than by trust.

### 8b — CosmoCutie Feed

**Core build:**
- Vertical swipe feed (TikTok-style navigation), mixed photo and video posts
- Stylist search → profile → that stylist's post grid
- **Service tagging on posts → tap to book**, dropping into the booking flow with stylist and service pre-filled. This is the feature's business justification: see a look, book that look.
- Posting restricted to **stylists + admin**. Clients view, search, like, follow, and book — they don't post.
- Likes/saves. **No comments** — decided, per the Communication Policy. Engagement without a conversation surface to moderate.
- **Follow system.** Clients follow stylists; follower counts appear on stylist profiles as social proof; followed stylists' new posts trigger a notification. This also gives the feed a **"Following" vs "Discover"** split — and a Following feed being naturally small is a feature rather than the density problem below, because everything in it is relevant.
  - Follower lists are visible to the stylist they belong to (legitimate marketing value), **not aggregated for the salon owner** — same firewall as everything else

**Client photo consent (hard requirement):**
- Stylist selects a photo from a client's formula record → "share to feed" → **push notification to the client → client approves or denies → posts only on approval**
- Consent is **per-photo and revocable**. If a client later withdraws it, the post comes down. Wire this into the Phase 7 account-deletion path too — deleting an account must pull their images from the feed.
- Never auto-post from formula records. The Phase 5 clinical photos exist for treatment continuity; promotion is a separate purpose requiring separate permission.

**App Store UGC compliance (Guideline 1.2 — a hard approval gate):**
- Content filtering for objectionable material
- In-app reporting mechanism with timely response
- Ability to block abusive users
- Published contact information
- Revisit the app's age rating — UGC affects it

*This applies even with stylists-only posting. Apple does not care that your posters are vetted.*

**Admin moderation:** the salon owner can remove posts from their salon's feed. Frame this in the booth rental agreement as **content standards for a shared branded space**, not as directing a renter's business — a landlord setting standards for what's displayed in their building is ordinary; an owner dictating how a renter markets is closer to behavioral control. The distinction matters for the same 1099 reasons as everything else.

**Post analytics belong to the posting stylist**, not the owner. Public view counts are public, but "how many bookings this post drove" is revenue-adjacent and therefore the renter's business. Same firewall as everywhere else.

**Architecture notes:**
- **Video needs a dedicated media service** — Mux, Cloudflare Stream, or Bunny. Supabase Storage is not a video delivery platform; it has no transcoding and egress pricing that punishes streaming.
- **Keep the feed out of WatermelonDB.** The offline-first layer is for business data — appointments, formulas, clients. Feed media is network content: cache opportunistically, degrade gracefully offline. Syncing video into the local SQLite database would be a serious mistake.
- **Ranking: reverse-chronological with unseen-first to start.** Do not build a recommendation algorithm. At this content volume it would have nothing to learn from.
- Video autoplay plus glassmorphism is a battery and performance combination worth profiling on the budget Android devices from Phase 0.
- Define a media retention policy early — old low-view video accumulating forever is a slow cost leak.

⚠️ **The honest risk: feed density.** A single salon with five stylists posting twice a week produces ~10 posts weekly. A TikTok-style scroll exhausts that in under two minutes, and an empty feed reads as a dead app. Mitigations: design for "what's new since you last looked" rather than infinite scroll, resurface strong older posts, and let the salon itself post (promos, tips, product features). **This is also the strongest argument for eventually going multi-salon** — the feed gets meaningfully better with more stylists in it, and it's the one feature whose value scales with tenant count.

---

## Phase 9 — Ecosystem & Retention

*Features whose purpose is keeping stylists on the platform and clients coming back. Ordered by my estimate of value-per-effort.*

**Stylist retention — the honest constraint:** client data is deliberately exportable (Phase 5), so renters are never locked in. Retention therefore has to come from the platform being genuinely better to work on, not from making departure painful. That's the right trade, but it means these features are load-bearing rather than nice-to-have.

*✅ Confirmed for build: earnings/tax dashboard, in-salon referrals, hair journey timeline. The rest of this phase remains optional.*

- **Earnings & tax set-aside dashboard — my strongest recommendation here.** Booth renters are self-employed with no HR, no payroll department, and chronic trouble with quarterly estimated taxes. Show them: income to date, a running "set aside X% for taxes" figure, deductible expense logging (booth rent, product, tools, education), and a year-end summary matching Schedule C categories. The data already flows through Stripe, so the marginal build cost is low and the perceived value is enormous. Almost nothing in this market does it well.
  - *Build it as a tracking and organizing tool with a clear disclaimer — never as tax advice.*
- **In-salon stylist referrals.** When a stylist is fully booked, or doesn't offer a service the client wants (extensions, barbering, textured hair specialization), let them refer to another stylist in the building. Keeps the client in the salon instead of losing them to a competitor, and makes renters feel like colleagues rather than isolated competitors sharing an address. Pure ecosystem glue.
- **Open-chair booking.** If chairs sit empty on certain days, let renters claim extra time. Converts unused capacity into rent.

**Client retention:**

- **Hair journey timeline.** A client-facing view of their own photo history over time — the same images already captured for formula records in Phase 5, presented as a personal timeline. Genuinely delightful, and it creates attachment through accumulated value rather than lock-in: leaving means leaving your history behind. Requires the same per-photo consent discipline as the feed.
- **Loyalty program.** Visits accrue toward a reward. Conventional, but conventional because it works.
- **Referral program.** Client refers a friend, both receive credit. Cheapest acquisition channel available, and it compounds.
- **Retail reorder.** One-tap reorder of products previously purchased.

---

## Phase 10 — CosmoCutie Shop

*Retail commerce, pickup-only. Real margin on real goods, and independent of the feed — this could move earlier than its number suggests if product sales matter sooner.*

**Core build:**
- Product catalog with photos, descriptions, pricing, stock counts
- **Two seller types:** the salon (admin-listed) and individual stylists (their own products)
- Cart → checkout → paid → ready for pickup → picked up
- Retail inventory tracking, decremented on purchase, with oversell prevention
- Feeds the Phase 9 retail reorder feature directly

### Stylist storefronts

Each stylist profile carries their own products alongside their portfolio and services, so a client browsing their stylist can buy directly. The profile becomes a single unified storefront: **portfolio → services → products → book**.

- Same catalog infrastructure as the main shop, filtered by seller
- Products can be tagged in feed posts the same way services are ("the mask I used on this")
- A stylist's products surface on their profile *and* in the main shop

### Shop fee — 5% on stylist sales

**Rates are owner-configurable.** The salon owner sets the shop fee percentage and the chair/booth rent amounts rather than these being hardcoded. Current values: **5% shop fee**, booth rent per stylist set at invitation time.

✅ **The fee does not apply to the salon's own product sales** — only to stylist sales. (Resolves the earlier open question.)

⚠️ **Unresolved: who receives the 5%?** See Open Questions — this determines the implementation and has legal consequences.

**✅ Decided: the salon owner receives the 5%.**

### How to implement it — accrue and settle, don't split at checkout

**Do not take the salon's cut out of the transaction itself.** Instead:

1. The client's purchase is a **Direct Charge to the stylist's own Stripe account** — the stylist is merchant of record and receives **100% of the sale**
2. The app **accrues** 5% of that sale as a balance the stylist owes the salon
3. That balance is **collected alongside the booth rent** that's already being charged on a recurring schedule

**Why this structure rather than a point-of-sale split:**

- **It's how the IRS looks at it.** A significant classification factor is who controls the collection of funds. Here the stylist collects everything and later pays a fee — much closer to rent than to a commission split, where the salon takes the money first and hands back a share.
- **It reuses infrastructure you're already building.** Phase 4's recurring booth rent collection becomes rent + accrued shop fee on the same schedule. No new payment plumbing, no connected-account-to-connected-account transfers (which Stripe makes awkward anyway).
- **The salon never touches a client's payment.** No shared ledger, no merchant-of-record ambiguity, nothing new for the data firewall to police.
- **It's cleaner bookkeeping for both sides.** The stylist sees one periodic payment to the salon; the salon sees rental income in one stream rather than thousands of micro-deductions.

**Build it as a visible ledger.** The stylist should see their accrued balance in real time in the Phase 9 earnings dashboard — sales, fee accrued, next settlement date and amount. A fee that appears as a surprise line item on a rent invoice is exactly how goodwill gets lost.

⚠️ **Flag for the attorney consult:** a percentage of a tenant's sales flowing to the landlord is percentage rent, which is ordinary in commercial retail leasing but carries more weight in a salon, where classification is scrutinized. **Ask specifically whether this should be structured as percentage rent in the booth rental agreement, or converted to a flat shelf-space fee.** The accrue-and-settle mechanism above supports either — only the calculation changes — so this can be answered after the build without rework.

**The math at 5%, on a $30 product:**

| | |
|---|---|
| Retail price | $30.00 |
| Shop fee (5%) | −$1.50 |
| Stripe (~2.9% + 30¢) | −$1.17 |
| **Stylist receives** | **$27.33** |
| Wholesale cost (~50% typical) | −$15.00 |
| **Stylist profit** | **$12.33** |

Fees consume **~9% of gross, or ~18% of profit.** Comfortably below the 10% version, and low enough that selling off-app to avoid it isn't worth the hassle — which is the number that actually matters, since a fee stylists route around earns nothing.

*Rate is configurable, so this can be tuned without a code change once there's real sales data.*

**Disclosure is mandatory, and also just good practice:**
- State the fee in the stylist terms of service, agreed at onboarding
- **Show it as an explicit line item in the Phase 9 earnings dashboard** — "gross / platform fee / processing / net." Hidden fees are one of the fastest ways to lose the stylists this ecosystem depends on, and a 10% line item that appears as a surprise is worse than one disclosed up front.
- Decide whether the fee also applies to the salon's own product sales (the salon is a platform tenant too, but likely has a different commercial arrangement) — see Open Questions

### Multi-vendor payment routing — the structural decision

Same 1099 firewall as everywhere else: **a stylist's product revenue is theirs, and must not flow through the salon's account.** Routing a renter's sales through the owner's ledger is precisely the pattern that reads as an employment relationship.

- Salon-listed products → salon's connected account
- Stylist-listed products → that stylist's connected account
- **MVP: one vendor per order.** If a client wants a salon product and a stylist's product, that's two orders. Slightly awkward, but legally clean and dramatically simpler than split-tender.
- Mixed carts, if added later, must use **separate charges per vendor** — never one platform charge with transfers out, which would make the salon merchant of record for the renter's goods and reintroduce the misclassification problem.

*Retail commission (10–15% is the industry norm) applies only to W-2 employees selling salon stock — that's ordinary employment compensation. A 1099 renter receives 100% of their sale at the point of transaction, with the 5% shop fee accrued and settled separately alongside rent, per the mechanism above.*

### Pickup & verification

**Order lifecycle:** Paid → Ready for pickup → Picked up (each state timestamped)

**What the client gets:**
- Receipt — in-app and emailed — with order number, itemization, pickup location, and which stylist or the front desk to ask for
- **A QR code / short pickup code** in the app, scanned or read out at the counter
- Push notification when the order is ready

**What staff gets:**
- Scan or manual code entry to verify
- A "release order" action that records **who handed it over and when**
- Named alternate pickup person, if the buyer sends someone else

**Why the verification matters beyond logistics:** a timestamped pickup confirmation naming the releasing staff member is exactly the evidence that defeats a "never received it" chargeback. Wire it into the Phase 4 dispute-evidence bundle alongside the appointment records — same machinery, new document type.

**Policies — decided:**
- **Pickup window: 14 days.** After that, auto-refund and restock, with reminder notifications at day 3 and day 10. Prevents paid-for stock sitting unsellable indefinitely.
- **Returns: unopened items within 14 days of pickup, full refund. Opened product is non-returnable** for hygiene reasons — standard across salon retail. Defective or incorrect items are always refunded regardless. Displayed at checkout with acknowledgment captured, same mechanism as the cancellation policy.
- **Refunds route back through the selling vendor's account**, so a stylist's refund comes from the stylist's balance. The platform fee is returned proportionally on refund — never keep a fee on a sale that got reversed.

### Shop data firewall

**The simple version: every seller gets their own locked drawer, and the database — not the app — decides who can open which one.**

- A stylist opens their drawer: their products, their sales, their money, their customers.
- The salon owner opens theirs: salon products, salon sales, salon money.
- The salon owner tries to open a stylist's drawer: **refused.**

**Why the database rather than the app.** If the rule lives in app code ("hide this screen from owners"), it holds only until someone forgets one check — and it's one missed `if` statement between working and leaking everything. Postgres Row-Level Security filters every query at the database level, so even a buggy screen, a rushed API route, or a future agent who doesn't know the rules physically cannot retrieve another seller's rows.

**Three rules that make it work:**

1. **Every shop row carries a `tenant_id`** — products, orders, inventory, sales. It records who owns that row.
2. **RLS checks it on every read and write.** No query escapes the check, because the check isn't in the query.
3. **No cross-vendor totals, ever.** With three sellers, "total shop revenue" minus your own equals the other two. An aggregate is a disclosure at this scale.

**Money never mixes either.** Stylist sales route directly to the stylist's own Stripe account (Direct Charges), so the salon's ledger never holds a renter's money. There's no shared pot to leak from — the separation is financial as well as informational.

**Who sees what:**

| | Own products & sales | Other stylists' sales | Salon's sales | Shop-wide totals |
|---|---|---|---|---|
| **Stylist** | ✅ | ❌ | ❌ | ❌ |
| **Salon owner (admin)** | ✅ (salon's) | ❌ | ✅ | ❌ |
| **Owner (as stylist)** | ✅ (own chair) | ❌ | — | ❌ |
| **Platform (you)** | ✅ aggregate, for fee reconciliation | | | ✅ |

*Purchase history lives in the tenant-scoped `client_records`, same as appointment history.*

*The platform row is the one legitimate exception — you need cross-tenant totals to reconcile the 10% fee. Keep that access confined to platform-level tooling that no salon user can reach, and never surface it inside the salon-facing app.*

⚠️ **Sales tax is a new obligation.** Services vary by state, but physical goods are almost always taxable. Use Stripe Tax rather than hand-rolling rates. **Pickup-only is a genuine advantage here that's worth knowing about:** every sale occurs in one physical jurisdiction, so there's no multi-state nexus question and no shipping-destination rate matrix. If shipping is ever added, this becomes substantially harder — which is a good reason to stay pickup-only longer than you might otherwise.

✅ **No IAP required.** Apple's in-app purchase rules exempt physical goods, so Stripe handles this the same as services.

---

## Phase 11 — Later

*Deferred from MVP by explicit decision. Each is independently valuable.*

- **Smart-scale BLE integration** (Vish or similar) — real-time mix weighing, auto backbar deduction, COGS per appointment, auto "extra product" upcharge. *Requires researching GATT service/characteristic UUIDs, payload byte structure, endianness — none of which the source docs provide.*
- **Stripe Terminal SDK** — physical card readers, tap-to-pay hardware, OTA firmware updates
- **SMS win-back automation** — Frequency-of-Visit calculation per client, triggered at the 3-week-past-due window
- **Prioritized call lists** for front-desk reactivation (the source doc rates phone reactivation at 25–40% rebooking vs 2–4x ROI for SMS — highest-value retention channel, lowest tech cost)
- **Memberships/subscriptions** — Stripe Billing, "Blow Dry Club" style recurring plans
- **Digital wallet passes** — Apple/Google Wallet membership passes
- Reviews & ratings with moderation
- Gyroscope tilt/refraction glass effect

---

# OPEN QUESTIONS

*Genuinely undecided things that affect the build. Roughly ordered by how early they need answering.*

*Resolved: client data ownership, deployment scope, cancellation policy, sensitive-data handling, deposit default, and negotiation timeout — see Reference specs and Locked-in decisions.*

1. **What is the app business's own revenue model?** Separate from the salon's internal fees. Since this is being built *for* a client salon, the underlying arrangement — one-time build fee, ongoing SaaS, revenue share — shapes whether the platform takes any cut at all. Doesn't block the build, but the fee plumbing can't be finalized without it.

3. **Legal review before launch** — acknowledged and planned. One consult with a business attorney licensed in your state, covering: the booth rental agreement, client-ownership terms, cancellation policy disclosure language, the stylist terms covering the shop fee, the shop-fee routing question above, and whether the data-minimization approach clears your state's privacy statutes.

   *Also worth five minutes of that consult:* "Cosmo" is strongly associated with Cosmopolitan (Hearst), which licenses into beauty. Plenty of unrelated "Cosmo" businesses coexist fine, but it's cheap to ask and expensive to discover post-launch.

   ✅ *App Store name availability confirmed. Domain still to register.*

---

# REFERENCE

## Booking Negotiation Workflow (detail)

Client and stylist can go back and forth on timing, capped so it can't loop forever.

**State machine:**
1. Client requests appointment at **Time A**.
2. Stylist responds: **Accept** (booked, Time A) *or* **Decline** (request dies, client restarts) *or* **Reschedule** with **Time B**.
3. Client (counter 1) responds to Time B: **Accept** (booked) *or* **Cancel** (request dies) *or* **Counter** with **Time C**.
4. Stylist (offer 2) responds to Time C: **Accept** (booked, Time C) *or* **Decline** *or* **Reschedule** with **Time D**.
5. Client (counter 2, final) responds to Time D: **Accept** (booked) *or* **Cancel** *or* **Counter** with **Time E**.
6. **Stylist (final) responds to Time E: Accept (booked) *or* Decline** — no further countering. On decline, everything resets; client starts a fresh request.

**The stylist always closes the negotiation.** After the initial request, each side gets exactly **2 counter-offers** (stylist: B, D — client: C, E), and the stylist holds the final binary decision on the client's last proposed time. Every stylist turn at steps 2 and 4 has three options (Accept/Decline/Reschedule); step 6 is binary.

*UX note:* because the stylist can accept the client's final counter, the client should understand that proposing Time E commits them to it if accepted. Word the confirmation accordingly.

**Deposit handling:**
- If the stylist requires a deposit, the client's card is **authorized (held, not captured)** at the initial request — before negotiation begins
- The hold rides along through all counters
- Final **Accept** → hold **captured**
- Any terminal **Decline/Cancel/expiry** → hold **released**, nothing charged

**Response deadlines — two clocks:**

1. **Global cap: 48 hours from the initial request.** Hard ceiling on the entire negotiation, start to finish, regardless of how many rounds are used. When it expires, everything auto-expires: hold released, slot freed, client starts over.
2. **Per-step window: 12 hours**, or whatever remains on the global clock, whichever is shorter.

**Don't start a round that can't be answered.** If under **2 hours** remain on the global clock when a round would begin, auto-expire immediately instead. A notification saying "you have 7 minutes to respond" is worse than a clean expiry.

Why 12h per step: it covers a night's sleep, so a request landing at 10pm doesn't expire before the stylist wakes. Most negotiations resolve in one or two rounds anyway — the full six-step flow is the rare worst case, so generous per-step windows optimize the common path while the global cap guarantees the ceiling.

✅ **This resolves the authorization-expiry problem.** 48h sits comfortably inside any card-authorization window (typically ~7 days, shorter on some debit cards), so no re-authorization machinery is needed. It's also just better product design — nobody should wait five days to learn whether they have a hair appointment.

*Edge case to watch:* a Friday-night request against a stylist who doesn't work weekends will expire unanswered. The client can simply re-request, and the stylist's manual waiver covers goodwill, but it's worth revisiting if it shows up in real usage.

**Deposit toggle:**
- Single toggle per stylist, applies to all their services (no per-service override in MVP)
- **Named "Require deposit," and it defaults to OFF — new stylists start with no deposit required** and opt in if they want one. Naming it in the positive avoids the double-negative trap where "no-deposit switch = off" reads backwards in code and in the UI.
- When off, the negotiation flow runs identically minus the authorize/capture/release steps — nothing ever touches the client's card
- Lives alongside the stylist's other autonomous settings, per the multi-tenant model

## Features by Role

*Phase numbers in brackets. The same feature often appears in more than one list with different permissions — that's the point.*

### 👑 Admin (salon owner)

*Remember: the owner is also a working stylist, so they hold **every stylist feature below** in addition to these, with an explicit "my salon" / "my chair" context switch.* [2]

**Facility dashboard**
- Chair/booth occupancy and utilization % [2]
- Booth rent per renter — collected, outstanding, overdue [4]
- Lease/agreement status per renter [2]
- Salon foot traffic and total appointment volume [3]
- Appointment counts per chair [3]
- Peak hours and capacity analysis [3]

**Management**
- Worker classification per stylist — 1099 / W-2 / owner-operator [2]
- Automated booth rent collection [4]
- W-2 employee oversight — full access to their clients, revenue, commissions, formulas [2,4]
- Open-chair booking — offer unused chair time to renters [9]

**Content & commerce**
- Approve/reject stylist deals for quality — but **not** control who gets featured [8a]
- Feed moderation — remove posts from the salon feed [8b]
- Salon product listings, inventory, and sales [10]
- Salon-level promotional posts and campaigns [8]

**❌ Explicitly NOT visible to admin (for 1099 renters)**
- Client names, contacts, or client lists
- Client formulas, notes, photos, service histories
- Renter revenue, average ticket, or earnings
- Renter product sales revenue
- Renter follower lists or post conversion analytics

---

### ✂️ Stylist

**Business setup**
- Profile, portfolio, Instagram link, reviews [2]
- Own service menu — services, pricing, durations, descriptions [2]
- Own business hours and personal time blocks [2]
- Own cancellation policy [2,4]
- "Require deposit" toggle, defaults OFF [2]
- Stripe Connect Express account — their money, their account [4]

**Daily operation**
- Calendar and schedule management [3]
- Booking negotiation — accept / decline / reschedule, and **they close every negotiation** [3]
- Gap-time double-booking during chemical processing windows [3]
- Waitlist management [3]
- Late-arrival flagging [3]
- **Stylist check-in / check-out** — mark arrived, start, end; actual vs. booked duration captured [3]
- **Private client notes** — structured tags that auto-adjust bookings, plus short free text [3]
- Client check-in and chair-side checkout [3,4]
- Their own client book [1,2]

**Clinical**
- Digital Color Bar — formulas, gram weights, developer volumes, technique notes [5]
- Before/processing/after photo galleries [5]
- Patch test and consent form dispatch [5]
- Smart scale integration — real-time weighing, backbar deduction, COGS [11]

**Money & growth**
- Earnings + tax set-aside dashboard with Schedule C categories [9]
- Full data export — clients, history, formulas [5]
- In-salon referrals to other stylists [9]
- Create deals, including flash gap-fill deals [8a]
- Post to the feed — photos, video, service and product tagging [8b]
- Own post analytics and follower list [8b]
- List products, manage inventory, storefront on their profile [10]

---

### 💕 Client

**Booking**
- Browse stylists, menus, portfolios [2,3]
- Request appointments with negotiation — accept / cancel / counter, 2 rounds [3]
- Service bundling prompts [3]
- Join waitlist [3]
- Deposit payment when the stylist requires one [4]
- Self check-in and cardless checkout [3,4]
- Rebooking prompt at checkout [3]

**Records & consent**
- Digital patch test and intake forms [5]
- Hair journey timeline — their photo history over time [9]
- Photo consent management — approve and revoke [8b]

**Social & shopping**
- Browse the feed, search stylists [8b]
- Like, save, follow [8b]
- Tap-to-book directly from a post [8b]
- See featured deals [8a]
- Shop — browse, buy, QR pickup code, order history, receipts [10]
- Loyalty and referral programs [9]
- Memberships and subscriptions [11]

**Account** *(see the section below for detail)*
- Profile, appointments, likes, following, shop orders [2–10]
- Notification preferences — push/SMS/email, marketing opt-in [7]
- Light/dark glass theme toggle [6]
- Data export [7]
- In-app account deletion [7]

## Smart Booking & Availability

**Core rule: an unavailable time is never shown.** Not shown-then-rejected, not selectable-with-an-error — a taken slot simply doesn't render. Neither client nor stylist should ever be in a position to pick something that can't happen.

### ⚠️ Two different concepts, both previously called "gap time"

These were being conflated, and building them as one thing would cause a real bug:

| Term | Meaning | Value |
|---|---|---|
| **Buffer** | Dead time *between* appointments — cleanup, station reset, client transition, running over | **30 minutes** |
| **Processing window** | Idle time *inside* a chemical service where the stylist is free to work on someone else | Per-service (typically 30–60 min) |

The buffer blocks the calendar. The processing window *opens* it. Implementing the buffer under the "gap time" name would have made the calendar double-book every 30-minute slot instead of blocking it.

⚠️ **These two rules collide and need an explicit exception.** A 45-minute processing window with a 30-minute buffer on each side leaves negative usable time — processing-window double-booking becomes mathematically impossible. **Processing-window bookings need their own reduced buffer** (5–10 minutes, or none, since the stylist is already present and set up). Decide the value during Phase 3; the default 30-minute buffer applies only between separate appointments.

### Availability calculation

A slot is offered only if all of these hold:
- Inside the stylist's business hours
- Not overlapping an existing appointment **plus its buffers on both sides**
- Not inside a personal time block
- The full service duration fits before hours end
- Not currently held by a pending booking request

**Service duration drives it.** A client selecting a 2-hour balayage sees only slots where 2 hours *plus buffers* genuinely fit — not every half-hour tick on the clock.

### Slot holds during negotiation

The negotiation runs up to 48 hours, which raises a question the plan hadn't answered: **is the requested time blocked while both sides go back and forth?**

**Yes — held, and this is why the per-step window matters.** A pending request holds its slot for at most one step (12 hours) before the other party must act or it expires. When a stylist counters with a different time, the original slot **releases immediately** and the newly proposed time is held instead. Only one time is ever held per negotiation.

Other clients don't see held slots at all — they're simply not in the list.

### 🔒 Enforce it at the database, not just in code

Availability logic will have bugs, and two clients hitting "request" on the same slot within the same second is an ordinary race condition, not an edge case. **Add a Postgres exclusion constraint** so overlapping appointments for one stylist are physically impossible to insert:

```sql
EXCLUDE USING gist (
  stylist_id WITH =,
  tstzrange(starts_at, ends_at) WITH &&
)
```

The application should still prevent collisions gracefully — this is the backstop that guarantees a bug becomes a caught error rather than two people in one chair.

### Arrival instructions

- **"Please arrive 5 minutes early"** shown at booking confirmation, in the appointment detail, and in reminder notifications
- Ties into the existing late-arrival flagging: arrival expectation is set up front, so the tardiness policy isn't a surprise
- Make the text editable per stylist — some will want different instructions (parking, buzzer codes, where to wait)

## Stylist Check-In / Check-Out & Client Notes

### Service timeline (stylist-side)

Distinct from the client's own "I'm here" tap — this is the stylist's record of what actually happened.

- **Mark arrived** — timestamped, auto-compared against the scheduled time, feeding the late-arrival flag
- **Start service** — the clock that matters for scheduling accuracy
- **End service** → rolls into checkout
- **Actual vs. booked duration captured on every appointment**

That last one earns its keep quietly: after a few months you know that this stylist's "90-minute balayage" actually runs 115 minutes, and bookings can be padded from real data rather than optimism. It also gives the Phase 4 chargeback bundle timestamped proof that a service was delivered.

### Client notes — structured tags first

**Tags do work; free text just sits there.** Prefer tags that actually drive behavior:

| Tag | What it does |
|---|---|
| Needs extra time / talker | Auto-pads their booking duration |
| Runs late | Sends their reminder earlier |
| Punctual | No adjustment |
| Sensitive scalp / product allergies | Surfaces on the service screen (**note: real safety flags belong in the Phase 5 safety field, not here**) |
| Prefers morning / specific days | Weights suggested slots |

✅ **Decided: operational tags only — no free-text notes field.**

This is a cleaner design than it first appears. Every tag maps to a scheduling behavior, so notes stop being a place where opinions accumulate and become an input the system acts on. It also disposes of both risks below outright:

- **Nothing embarrassing can be written**, so the client-data-export question mostly evaporates — operational tags are fine to export ("prefers morning" harms no one)
- **No drift into protected characteristics** — race, health, age, and pregnancy simply have no field to land in, which is a far stronger guarantee than UI guidance asking people not to write them

*If free text is ever added later, revisit both risks — they return with it.*

**Visibility:** tenant-scoped, exactly like formulas and history. Private to the stylist. **Never visible to the salon owner.** Same firewall as everything else.

✅ **Decided: no tip notes or tip labels.** Tip amounts remain in payment history as ordinary transaction records, but there is no tipping tag, rating, or flag anywhere in the client notes. Removes the whole category of risk.

## Communication Policy — Structured Thread, No Free Messaging

**Decision: the app has no open chat or DMs.** There is exactly one conversational surface — **the negotiation thread** — and it is button-driven, not a text box. If a client and stylist need an actual conversation, they use their own channels (Instagram, text, phone).

> **Note for future agents:** the negotiation UI *looks* like a chat. It is not one. There is no free-text input anywhere in this app. Do not add a message box to this screen.

### The negotiation thread

The negotiation renders as a familiar chat thread — bubbles in chronological order — while remaining entirely structured underneath.

- **Each bubble is one negotiation action**: the initial request, an accept, a decline, a reschedule, a counter
- A bubble shows the **proposed time, the action taken, the optional note, and a timestamp**
- **Actions are buttons**, contextual to whose turn it is — Accept / Decline / Reschedule for the stylist, Accept / Cancel / Counter for the client
- **The optional short note (~200 chars) is composed alongside an action**, never on its own. There is no way to send a message without taking an action.
- **System events appear in the thread too**: "Request expired," "Deposit hold released," "This time is no longer available" — so the history explains itself without anyone having to reconstruct it

**Implementation note: the thread is free.** The negotiation state machine already requires an event log for the audit trail — who acted, when, what time was proposed, what happened to the deposit hold. **The thread is that event log, rendered.** One row per action, displayed as bubbles. You are not building a messaging system; you are drawing data you already had to store.

**Thread persistence:**
- Archived with the appointment and **visible to both parties in appointment history** — a durable record of what was actually agreed
- Doubles as **Phase 4 chargeback evidence**: a timestamped, mutually-visible record of the agreed time and any accompanying notes
- Declined and expired negotiations archive too, reachable under past requests rather than vanishing
- Retention follows the general data policy; deletion follows the client's account-deletion path

**Why this is the right call:**
- Chat is a large build — real-time delivery, read state, media, its own notification logic
- It creates a serious liability surface: stored private conversations, harassment reports, disputes about what was said
- It multiplies App Store moderation obligations well beyond what stylist-posted feed content requires
- The structured negotiation flow already solves the actual business problem, which is agreeing on a time

**Short optional notes ride along with each action** — one per action, ~200 characters, attached to that specific accept/decline/reschedule. Without them, a client sees their time rejected and a new one proposed with zero explanation. *"Can't do 2pm — I have a color processing. 4pm works great"* is the difference between the flow feeling human and feeling like a vending machine.

**Downstream consequences of this decision:**
- **Feed comments: skip them.** Same reasoning — likes, saves, and follows give engagement without a conversation surface to moderate. Recorded as decided rather than open (Phase 8b).
- **Contact handoff lives on the stylist profile.** Each stylist chooses what to publish — Instagram, a business phone, nothing at all. Never expose a stylist's personal number by default.
- **Reduced UGC burden.** Guideline 1.2 still applies to stylist-posted feed content, but with no user-to-user messaging the moderation surface is dramatically smaller.

## Client Account Area ("My CosmoCutie")

The client's own hub. **Build the shell in Phase 2 and let sections light up as features ship** — the alternative is bolting a navigation structure onto a finished app, which never comes out clean.

**Sections, with the phase that fills them in:**

| Section | Phase |
|---|---|
| Profile — name, photo, contact | 2 |
| My appointments — upcoming and past, with negotiation status | 3 |
| Payment methods — saved cards | 4 |
| Hair journey timeline — their photo history over time | 9 |
| Likes / saved posts | 8 |
| Following — stylists they follow | 8 |
| Shop orders — history, receipts, active pickup codes | 10 |
| Settings | 2, expanded later |

**Settings, in detail:**
- **Notification preferences** — push, SMS, email, each independently controllable. **Marketing opt-in lives here and is TCPA-load-bearing** (Phase 7): the promotional toggle must be separate from transactional messages, unchecked by default, with every change written to the consent audit log.
- **Photo consent management** — view every photo they've approved for the feed, and revoke any of them. Not optional: Phase 8 makes consent revocable, so there has to be a place to revoke it. Revocation pulls the post down.
- **Theme** — light/dark glass toggle
- **Data export** — their own records, mirroring what stylists get
- **Account deletion** — hard delete per Apple Guideline 5.1.1. Must be genuinely findable; burying it is itself a rejection risk.

**Firewall note:** everything here is scoped to the client's own data. A client following three stylists at the salon still sees one unified account view, while each stylist sees only their own relationship with that client. The account area is a *client-side* aggregation and must not become a backdoor that reassembles cross-tenant data for anyone else.

## Client Data Ownership Model

*Driven by 1099 compliance, not just privacy preference. If the salon owner controls a booth renter's client book, that's evidence of behavioral control, which is exactly what triggers IRS reclassification.*

**Two-layer structure:**

1. **`clients` — identity only, platform-level.** Name, phone, email, auth credentials. One human, one login, one record. A phone number isn't the proprietary asset, so sharing this layer costs nothing legally.
2. **`client_records` — the relationship, tenant-scoped.** Appointment history, formulas, notes, photos, preferences, spend. This is what actually constitutes a stylist's book, and it is isolated per tenant by RLS.

**Ownership follows worker classification:**
- **1099 booth renter** → the renter is the tenant. They own the relationship record. The salon owner cannot read it.
- **W-2 commission stylist** → the salon is the tenant. The owner legitimately owns those client relationships, because that's what an employment relationship means.
- **Owner-operator (the owner's own chair)** → their stylist practice is **its own tenant**, distinct from the salon-admin scope. Their personal book lives there, not in the facility-wide view.

⚠️ **The owner-as-stylist firewall — the highest-risk detail in this model.** Because the owner holds both roles, it is tempting to grant their admin role blanket read access "since they own the place." That would collapse the entire 1099 protection this model exists to provide. The owner is also a *competing stylist* with a direct commercial interest in their renters' client lists, which makes the isolation more important here, not less.

- Admin role → facility metrics only (enumerated below)
- Stylist role → their own book only, exactly like any other stylist
- **Neither role, alone or combined, may read a renter's client records.** Test this explicitly in Phase 1: authenticate as the owner, hold both roles at once, attempt to read a renter's `client_records`, and confirm RLS refuses.

### What the owner can see — three scopes

**1. Their own chair (stylist role):** everything, identical to any other stylist — revenue, clients, formulas, retention, rebooking rate, average ticket.

**2. Facility operations (admin role, covers all stylists):**
- Chair/booth occupancy and utilization %
- Booth rent per renter: collected, outstanding, overdue
- Lease/agreement status per renter
- Total salon foot traffic and appointment volume
- Appointment counts per chair
- Peak hours and capacity analysis

*Appointment counts are fine to expose — a landlord can already see who walks through the door of their own building. Physical presence in a shared space was never private.*

**3. W-2 employees (admin role, if any are hired):** full access — their clients, revenue, commissions, formulas. The salon owns those relationships, so there's nothing to firewall.

### Explicitly NOT visible to the owner for 1099 renters

- Client names, contact details, or client lists
- Client formulas, notes, photos, service histories
- **The renter's revenue, average ticket, or earnings** — a commercial landlord doesn't see their tenant's books, and a flat-rent arrangement gives no legitimate claim to them

⚠️ **Small-N deanonymization.** With only two or three renters, *any* facility-wide revenue rollup lets the owner back out individual figures by subtracting their own. "Total salon revenue" is effectively a private disclosure at this scale. **Do not build revenue rollups that include renter earnings at all** — keep facility metrics to rent, occupancy, and appointment counts, which don't have this problem.

**Consequences to build:**
- If one person books with two different stylists, they get one login and two independent relationship records. Neither stylist sees the other's.
- Renter export (Phase 5) must include their complete relationship records — history, formulas, notes, photos
- When a renter leaves, their records leave with them: export, then delete from the platform (minus tax-mandated retention)
- Owner access must be **technically prevented by RLS**, not merely discouraged by policy. A policy the database doesn't enforce is not a defense in an audit.
- The booth rental agreement must state client ownership in writing, matching what the software does

## Cancellation & Refund Policy

*Per-stylist configuration here is also a 1099 requirement — an owner dictating renters' cancellation terms is the same behavioral-control problem as dictating their prices.*

**Default tiers (each stylist can adjust their own):**

| Timing | Outcome |
|---|---|
| More than 48h before | Full release of deposit, no fee |
| 24–48h before | Deposit forfeited |
| Under 24h, or no-show | Deposit forfeited |
| **Stylist cancels, any time** | **Full refund, always, no exceptions** |

**Platform-enforced bounds (stylists cannot override these):**
- **A cancellation fee can never exceed the deposit already authorized.** Never surprise-charge a card beyond the disclosed hold — this is the single biggest chargeback-avoidance rule, and chargebacks cost more than the fee ever recovers.
- The policy must be displayed and **affirmatively acknowledged** at booking. Store the acknowledgment: timestamp, and the exact policy text shown. This is your primary dispute evidence, and it pairs directly with the Phase 4 chargeback-defense bundle.
- Grace period: free cancellation within 15 minutes of booking, to cover misclicks.

**Also build:**
- **Reschedule ≠ cancel.** One free reschedule outside the 24h window; encourages moving appointments rather than abandoning them.
- **Manual waiver.** The stylist can forgive any fee with one tap. Goodwill is cheaper than a dispute, and real life produces emergencies that no policy tier anticipates.

## Sensitive Data Policy

**Recommendation: don't collect it in the first place.** The safest health data is the health data you never stored.

**On HIPAA:** it almost certainly does not apply. HIPAA binds "covered entities" — healthcare providers who bill electronically for covered transactions, health plans, and clearinghouses — plus their business associates. A hair salon is none of those. *(Not legal advice; confirm in the Open Question 3 consult.)*

**The real exposure is state law, not HIPAA.** Several states regulate consumer health data independently of it, some with a private right of action — meaning individuals can sue directly, without a regulator getting involved. That risk attaches to *holding* the data, which is precisely why minimizing what you hold is the strongest available mitigation.

**What to store instead of medical histories:**

| Instead of | Store |
|---|---|
| Full medical history / medications | Nothing |
| "Client is pregnant" / "on Accutane" | A boolean: contraindications disclosed → consulted → proceeded or declined |
| Detailed allergy background | A narrow service-safety flag (e.g. "PPD sensitivity") |
| Why a patch test reacted | Test date, product tested, result, signature, timestamp |

The stylist still asks every screening question at intake and still discusses it with the client — that conversation just doesn't need a database row. What survives is the consent record and the pass/fail, which is exactly what provides the liability defense the source docs were reaching for.

**Handling for what remains:**
- Encryption at rest and in transit; consider column-level encryption for safety flags and stylist notes
- RBAC — only the treating stylist, never the salon owner, never analytics
- Excluded from logs, analytics pipelines, and any CDC stream
- Honors deletion requests
- **Free-text notes are the leak.** Sensitive details arrive there regardless of form design ("client mentioned she's pregnant"). Treat all stylist notes as sensitive by default and add UI guidance discouraging medical detail.

**Revisit if the business adds medspa services** — injectables, medical-grade peels, anything performed by a licensed medical professional. That could genuinely change the analysis.

## Gap-Fill Workflows

*Added after a review pass. Most of these were referenced elsewhere in the plan but never actually specified — the kind of gap that reads as covered until someone tries to build it.*

### Rescheduling a confirmed appointment

The negotiation flow covers *getting* an appointment. It said nothing about moving one, which is an everyday occurrence.

- **Client-initiated:** request a new time → stylist accepts or declines. **A simplified exchange, not the full 6-step negotiation** — one proposal, one answer. Reusing the full state machine here would be tedious for something that's usually trivial.
- Inside the policy window (>48h): free, and the deposit simply moves with the appointment
- Outside the window: treated as a cancellation under the existing tiers, plus a new booking
- One free reschedule per appointment, per the cancellation policy
- **Stylist-initiated:** propose a new time → client accepts, or cancels with a **full refund regardless of timing** (the stylist changed it, so the client bears no cost)

### Stylist cancellation / sick day

A stylist waking up ill has to clear a whole day, and doing that one appointment at a time is unusable.

- **Bulk-cancel a day or date range** in one action
- Every affected client notified immediately, with **automatic full deposit refunds**
- Each client offered rebooking with suggested alternative slots
- Optionally offer **other stylists at the salon** who have availability — ties directly into the Phase 9 in-salon referrals, and keeps clients in the building on a bad day

### No-show handling

Deposits were specced as no-show *protection*, but the actual workflow wasn't.

- Stylist marks no-show after a grace period (default 15 min past the late-arrival threshold)
- Deposit captured per the cancellation tiers
- Recorded as an operational tag on the client record
- **Repeat no-shows:** after a stylist-configurable count (suggest 2), that client must **prepay in full** to book with them again. Not a ban — a risk adjustment, and it's per-stylist, not salon-wide.
- Stylist can waive at any time; genuine emergencies happen

### Waitlist mechanics

Referenced in three places, never defined.

- Client joins a waitlist for a **stylist + service + preferred date range**
- A slot opening (cancellation, expiry, bulk-cancel) triggers matching
- **Recommended rule:** notify the top 3 matching clients simultaneously with a **30-minute claim window**, first to claim wins. Notifying only one wastes the slot if they're asleep; notifying everyone creates a bad race.
- Auto-remove from the waitlist once booked
- Flash gap-fill deals (Phase 8a) push to this same list

### Multi-service appointments

Service bundling was promised in Phase 3 but the underlying model was never described.

- **One appointment can hold multiple services** — this is a schema decision, so it belongs in the Phase 1 ERD
- Total duration is the sum, plus internal transitions between services
- Total price is the sum; deposit calculates on the total
- **Processing windows apply per-service**, so a color-then-cut appointment has its gap in the middle
- Bundling prompts add to the same appointment rather than creating a second one

### Deposit amount

The plan said "deposit" throughout without ever saying how much.

- **Stylist-configurable: percentage of service price, or a fixed amount**
- Recommend percentage with a floor (e.g. 20%, minimum $20) — scales with service value
- Shown clearly before the client submits a request, never a surprise
- Calculated on the appointment total for multi-service bookings

### Minors — "booking for a child"

**Simplest workable version, and legally the strongest.** No child accounts, no family profile system.

- The booking flow offers **"this appointment is for a child"** — capture first name and age, nothing more
- Everything stays on the guardian's account: payment, notifications, history
- **Guardian must be present for the appointment.** Salon-level policy setting, with a configurable age threshold (a 17-year-old getting a trim isn't a 6-year-old getting one).
- **All consents are signed in person by the guardian** — which is a *stronger* signature than a remote e-signature, not a weaker one
- **No accounts for under-18s means COPPA never enters the picture.** No children's data collection regime to comply with, at all.

⚠️ **One schema consequence — get this right in Phase 1.** Service notes and color formulas must attach to the **appointment**, not solely to the client record. Otherwise a child's color history mixes into the parent's, and a stylist looking up "last formula" gets the wrong one — confusing at best, unsafe on a chemical service. Appointment-level attachment means "Emma's color from March" is retrievable with its own notes while everything else stays on one account.

*This is worth doing regardless of minors: formulas belong to the service performed, not to the person who paid for it.*

### Service redo / adjustment

Standard salon practice, and absent from the plan entirely.

- Stylist-configurable window (commonly 7–14 days) for a free adjustment if a client is unhappy with a result
- Booked as a **zero-price appointment linked to the original**, so it's visible in history and doesn't distort revenue reporting
- Distinct from a refund — this is the remedy most clients actually want, and offering it well prevents chargebacks that cost far more

## Other Workflows (one-line each)

- **Check-in/checkout:** client taps "I'm here" → stylist notified → chair-side checkout → rebook prompt
- **Patch test/consent:** auto-triggered pre-appointment for chemical services → e-sign → blocks completion until signed
- **Gap-time double-booking:** detect processing window → open for short second booking → validate no overlap
- **Color Bar logging:** open client profile → log formula → attach photos → save to history
- **Stylist onboarding:** sign up → connect own Stripe Express account → set menu/pricing/hours → go live
- **Booth rent collection:** scheduled job pulls flat rent from renter's connected account → transfers to owner
- **Payment routing:** at checkout, branch on worker classification (Direct vs Destination charge)
- **Chargeback defense:** dispute webhook → auto-bundle evidence → submit within deadline
- **Offline sync:** writes hit local SQLite first → background push/pull on reconnect → conflict resolution
- **Account deletion:** request in-app → hard-delete personal data (keep only tax-mandated records) → revoke Apple SSO token

## Design System (detail)

**Palette — "Cyber Magical Girl":**
- Hot Pink `#FF1493` — primary/CTA
- Bubblegum Pink `#FF77A9` — accents/cards
- Electric Violet `#9A4DFF` — contrast/shadows
- Laser Cyan `#00F5FF` — pop/highlight
- Starlight White `#FFF5FB` — background/text

**Glass styles (both ship, user-togglable):**
- **Light — "Frosted Strawberry":** white glass 40–60% opacity, ~16px backdrop blur, deep plum/charcoal text, hot pink icon accents
- **Dark — "Cyberpunk Gloss":** deep charcoal/black glass ~50% opacity, white or neon-pink border at 20% opacity, ~20px blur, midnight/obsidian violet `#0F0817` background with glowing hot-pink/cyan orbs
- Both: ~1px semi-transparent (~30%) border for the neon-rimmed edge

**Scope:** full glass/sparkle/shimmer on **client-facing screens only**. Stylist/owner working screens (POS, formula entry, schedule, inventory) use the same palette but toned down — solid or lightly-tinted surfaces, no particle animation. Legibility and speed beat sparkle when someone's mixing color against the clock.

**UI rules:**
- Heavy rounded corners: 24–32px on cards/containers/buttons
- Body text defaults to dark charcoal/deep plum — never pink-on-pink
- Dark mode isn't inverted light mode — hot pink genuinely glows against deep navy, which is the point of the dark variant

**Implementation:**
- Glass blur: `expo-blur` (`BlurView`) — native on iOS, weaker/device-dependent on Android
- Animation: `react-native-reanimated` for spring physics and gesture-driven tilt; **pick one** of `react-native-skia` (custom particles) or Lottie (pre-built After Effects sparkles), not both
- Profile heavy blur + particles on budget Android early

## Architecture Summary

- **Mobile:** React Native + Expo, WatermelonDB offline-first (device is source of truth, syncs deltas on reconnect)
- **Backend/DB:** Supabase Postgres, shared-table multi-tenancy, `tenant_id` on every table, enforced by RLS
- **Payments:** Stripe Connect (Express accounts)
- **Push:** Expo Push Notifications → APNs/FCM. **The primary channel** — booking, negotiation, waitlist, reminders, pickup-ready. Free and unlimited in practice.
- **Email:** Resend or Postmark. Narrow role: **auth recovery** (password reset, magic links — the one case push structurally cannot serve, since a locked-out user can't receive an in-app message) plus receipts. Free tier covers early volume.
- **SMS: deferred.** Twilio remains the eventual choice, but **launch push-only.**
  - Cost: SMS is the expensive channel (~1¢/message + number rental) where push is free
  - **Compliance: TCPA applies only to text messages.** No SMS at launch means the consent audit logs, STOP suppression, and 8am–9pm timezone windows in Phase 7 aren't needed yet — a substantial reduction in MVP scope.
  - Add it when there's evidence no-shows justify the cost and the compliance work. The Phase 7 TCPA spec stays in the plan, dormant until then.
- **Scheduled jobs:** Supabase `pg_cron` / scheduled Edge Functions
- **Build/ship:** Expo EAS Build + Submit → both stores from one codebase

## Costs

*Ballpark, not freshly researched — verify before budgeting hard.*

**One-time / starting: ~$15.** Both developer accounts are already held and paid, so the only new startup cost is a domain. Their renewal is a sunk cost shared with the existing app, making CosmoCutie's marginal store cost effectively zero.

**Build:** mostly your time (2–4 months solo/AI-assisted for MVP); cash outlay likely **under $500**

**Monthly running (early stage):** Supabase free→$25/mo, Apple ~$8/mo amortized, Stripe (per-transaction + small per-active-connected-account fee), Twilio (usage-based), domain/email ~$15–25/mo → **~$60–120/mo floor**, scaling with active stylists and SMS volume

✅ **Cost risk retired:** the earlier warning about HIPAA-tier hosting (higher-tier plan + BAA, potentially an order of magnitude above the figures above) no longer applies under the data-minimization approach — see the Sensitive Data Policy. Standard Supabase tiers are fine. Revisit only if medspa services get added.

⚠️ **Video changes the cost model (Phase 8 feed).** The figures above assume no video. Adding it means a dedicated media service (Mux / Cloudflare Stream / Bunny) whose cost scales with **minutes stored and minutes delivered** — so the bill grows with viewership, not just with how many stylists you have. This is the one line item that can move the monthly floor by a large multiple, and it's usage-driven rather than fixed, which makes it harder to predict.

**Recommendation: launch the feed photo-only, add video once you can see real engagement.** Photos reuse the storage pipeline already planned for Phase 5 formula records at negligible marginal cost. The vertical-swipe interaction you want works fine with photo carousels — the *format* is what makes it feel like TikTok, not the codec. If the feed proves itself, video is a contained addition; if it doesn't, you never paid for the pipeline.

## Accounts Needed

1. ✅ **Apple Developer Program — already held.** CosmoCutie is a new app record under the existing account; no new enrollment or fee.
2. ✅ **Google Play Console — already held.** Same: new app under the existing account.
3. Supabase — DB, Auth, Storage, Edge Functions
4. Stripe + Stripe Connect — platform account + Express connected accounts per stylist
5. ~~Twilio~~ — **deferred.** Launch push-only; add SMS later only if no-shows justify the cost and the TCPA work.
6. Expo/EAS — build & submit
7. Domain registrar
8. Transactional email (Resend/Postmark)
9. Sentry or similar — crash/error monitoring
10. **Mux / Cloudflare Stream / Bunny** — video transcoding + delivery, *only if the Phase 8 feed ships with video*
11. ~~RevenueCat~~ — skip; revisit only if a mobile IAP subscription tier is added later
