# Progress

Status file for whoever picks this up next. **[PLAN.md](./PLAN.md) is the spec** — it records *why* decisions were made, several of which look arbitrary and are not. Read it before changing behaviour.

_Last updated: Phase 2 in progress._

---

## Where things stand

| Phase | Status |
|---|---|
| 0 — Foundation, design tokens, component gallery | ✅ done |
| 1 — Schema, RLS, WatermelonDB | ✅ done, deployed |
| 2 — Identity & tenant onboarding | 🟡 core done, see below |
| 3+ | not started |

**Live:** https://cosmocutie.vercel.app · **Repo:** https://github.com/kevonmartorell-design/cosmocutie
**Supabase:** `tihzzdmvjdplmcdscxbh` · **EAS:** `@vonalmighty/cosmocutie` · **Bundle:** `com.cosmocutie.app`

### Phase 2 — done
Auth (sign in/up, session + membership resolution), route guards, salon first-run, stylist invitations, invitation claiming on signup, salon admin view, stylist chair view, service menu creation, deposit toggle.

Verified end to end: signup → create salon → lands on staff screen with **both** workspaces (admin on the salon, stylist on their own chair).

### Phase 2 — remaining
Business hours, portfolio/photos, client account area (likes/following/orders/settings), stylist offboarding, deep-link client invitations.

---

## Commands

```bash
npm run db:start      # local supabase (excludes services that fail healthchecks)
npm run db:test       # reset + seed + 20 adversarial RLS checks
npm run db:types      # regenerate src/lib/database.types.ts after a migration
npm run typecheck
npx expo export --platform web --clear && npx vercel deploy --prod --yes
eas update --branch development   # ship JS to the installed device build
```

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
- **Hosted Supabase sends ~3 emails/hour** on the built-in SMTP. Real signups need a custom SMTP provider (Resend) before anyone else uses the app.

---

## The one rule not to break

A salon owner holds **both** an admin membership on the salon and a stylist membership on their own chair. Those must stay separate. Neither role, alone or combined, may read a 1099 renter's clients, formulas, revenue, or notes — and that is enforced by RLS in Postgres, not by screens choosing not to ask.

`npm run db:test` proves it. If a change makes those tests fail, the change is wrong.
