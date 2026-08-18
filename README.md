# CosmoCutie

Multi-tenant salon management app — booking, negotiation, payments, clinical records, feed, and shop.

**[PLAN.md](./PLAN.md) is the spec.** Read it before changing anything: it records not just what to build but why, including several decisions that look arbitrary and are not (the data firewall, the negotiation caps, the no-free-messaging rule).

## Stack

| | |
|---|---|
| App | React Native + Expo (SDK 57), Expo Router, TypeScript |
| Backend | Supabase — Postgres + Row-Level Security, Auth, Storage, Edge Functions |
| Payments | Stripe Connect (Express accounts) — *Phase 4* |
| Preview | Expo web export → Vercel |

## Getting started

```bash
npm install
```

Copy the environment template and fill in the Supabase project values:

```bash
cp .env.example .env
```

Run it:

```bash
npx expo start
```

Add `--web` to open in a browser, or scan the QR code with Expo Go for a device.

## Preview builds

Export the web build and deploy it:

```bash
npx expo export --platform web && npx vercel deploy --prebuilt --prod
```

**What web previews can and cannot prove** is documented in PLAN.md → Development Workflow. Short version: Vercel confirms layout and flow; push notifications, camera, Tap-to-Pay, and real offline behaviour need a device build.

## Project layout

```
src/
  app/          Expo Router routes (file-based)
  components/   Shared UI — glass card, button, input, modal
  constants/    Design tokens: colour, glass, radius, spacing, type
  lib/          Supabase client and other integrations
  theme/        Theme provider (light/dark glass, persisted)
docs/           Source research documents
```

## Conventions

- **Never hardcode a colour or blur value.** Import from `src/constants/theme.ts` — the light/dark glass swap depends on everything going through tokens.
- **The anon key is public by design.** Access control is Row-Level Security in Postgres, not key secrecy. The `service_role` key must never enter this bundle.
- Glass blur is iOS/web only; Android falls back to a tinted solid surface. Use `<GlassCard solid />` on dense working screens where legibility beats effect.

## Phase status

- ✅ **Phase 0** — foundation, design tokens, component gallery
- ⬜ **Phase 1** — data model, multi-tenancy, RLS
- ⬜ Phases 2–10 — see PLAN.md
