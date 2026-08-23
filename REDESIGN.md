# Redesign — "Editorial Glass"

monopo saigon's editorial structure, carrying CosmoCutie's pink and glass.
Supersedes PLAN.md → Design System.

Sources: `Cosmocutie-design1.md` (monopo saigon) + the existing "Cyber Magical
Girl" palette and "Frosted Strawberry / Cyberpunk Gloss" glass.

**Status:** plan only, nothing implemented.

---

## 0. The governing idea

This is a hybrid, and hybrids fail when they average two systems into mush. The
rule that keeps it coherent:

> **monopo's real constraint is not "no color" — it is "color is rationed and never
> decorative."** Pink is kept, but it submits to that discipline.

Which means pink appears in exactly **three** places — the CTA fill, the active/
selected state, and the hero gradient — and nowhere else. Body copy, borders,
labels, dividers, icons and surfaces are all monochrome. Cyan and yellow leave the
UI entirely and survive only inside the gradient.

The second load-bearing decision: **what makes the current cards read as bubbly is
the 24–32px rounding, not the frost.** Frosted glass at **0px radius** with a
hairline border reads architectural and editorial. So monopo's radius rule survives
completely intact *and* the glass survives. They were never actually in conflict —
the rounding was.

### Declared deviations from the source spec

Stated plainly so nobody later mistakes them for drift:

1. **Chromatic UI color.** The spec forbids it. We use hot pink for CTA fill and
   active states. Rationed to three roles.
2. **Elevation / blur.** The spec forbids it. We keep frosted glass panels — but at
   0px radius, with hairline borders and no drop shadows. Shadows stay banned.
3. **Dark theme.** The spec is light-only. We keep the shipped light/dark/system
   toggle; dark is the Obsidian inverse band, which the source system already uses.

Everything else in the source spec is followed.

---

## 1. What actually changes

| | Now | After |
|---|---|---|
| **Radius** | 12 / 18 / 24 / 32 / 999 | **0** (cards, glass, images, inputs) or **75** (buttons, tags). Nothing between |
| **Type** | System font, 12–32px, negative tracking | Inter 300/400/600, 11–64px, tracking 0, whisper-weight headlines |
| **Color use** | Pink, violet, cyan, yellow throughout | Monochrome UI + pink in 3 rationed roles |
| **CTA label** | White on pink — **3.64:1, fails WCAG AA** | **Black on pink — 5.77:1, passes** |
| **Layout** | Centered stacks, even spacing | Left-aligned editorial, 46px section gaps, one hero gesture per screen |
| **Motion** | Bouncy springs, squash-and-stretch | `cubic-bezier(0.19, 1, 0.22, 1)` glides, 800–1250ms |
| **Ambient** | 3 drifting orbs on every screen | One iridescent backdrop, client screens only |
| **Glass** | Kept | Kept, at 0px radius |
| **Shadows** | None | None |

Still a **JS-only change** — ships via `eas update`, no rebuild.

---

## 2. Color tokens

### Monochrome spine (from monopo)
```
obsidian    #000000   primary text, borders on light, inverse canvas, CTA label
paper       #ffffff   primary canvas, text on dark
inkstone    #181818   long-form body copy
feltGray    #6d6d6d   muted helper text, timestamps, legal
slatePill   #636363   utility fill (consent, dismissals)
ashMist     #9a9a9a   disabled surfaces
pewter      #808080   muted state layer
```

### The rationed accent
```
hotPink       #FF1493   CTA fill · active/selected state · gradient
electricViolet #9A4DFF  gradient only
bubblegum     #FF77A9   gradient only
laserCyan     #00F5FF   gradient only — REMOVED from UI
sunshineYellow #FFDD00  REMOVED entirely
```

**Contrast, measured:**

| Pairing | Ratio | |
|---|---|---|
| White on `#FF1493` | 3.64:1 | ✗ fails AA — **this is what ships today** |
| **Black on `#FF1493`** | **5.77:1** | ✓ passes AA — the new CTA |
| `#FF1493` on obsidian | 5.77:1 | ✓ passes — pink text, dark theme only |
| `#FF1493` on paper | 3.64:1 | ✗ — pink is never body text on light |

So `primaryText` flips from white to obsidian. This fixes a live accessibility
failure and is simultaneously the more editorial treatment: black on a saturated
pill is monopo's register, white-on-pink is candy.

### Iridescent gradient (media only, never a UI fill)
Pink-shifted from the source's sage→amber→oxblood, keeping the oil-on-water sweep:
```
#FFD9E8 → #FF1493 (40%) → #9A4DFF (75%) → #00F5FF
```
This is the single move that meshes the two systems most directly — monopo's liquid
hero gesture rendered in CosmoCutie's palette.

### Glass
Retained from the current theme, at 0px radius, hairline borders, no shadow.
- **Light — Frosted Strawberry:** white glass 60% over paper, `rgba(0,0,0,0.14)` rim
- **Dark — Cyberpunk Gloss:** black glass 50% over obsidian, `rgba(255,255,255,0.3)` rim
  (the rim value is monopo's own dark-surface border)

---

## 3. Type ramp

The source is a 1078px desktop site — a 225px headline is 58% of an iPhone's width.

**Key observation: the spec's small end is already app-scale.** 11 / 12 / 16 / 18px
are correct on a phone as-is. Only 39px and above needs compressing (~÷2.2). So we
keep the bottom of the ramp *literally* and remap only display sizes, preserving the
monumental-vs-whisper ratio the style depends on.

RN `lineHeight` is absolute px, not a multiplier — these are precomputed.

| Token | Size | Weight | Line height | Source | Use |
|---|---|---|---|---|---|
| `display` | 64 | 400 | 59 (0.92) | 225px | One per screen, max |
| `headingLg` | 44 | 400 | 36 (0.82) | 94px | Statement blocks |
| `heading` | 34 | **300** | 36 (1.05) | 78px | **Screen titles** — the signature whisper weight |
| `subheadingLg` | 26 | 300 | 30 (1.15) | 45px | Section leads |
| `subheading` | 22 | 400 | 26 (1.19) | 39px | Card titles, stylist names |
| `body` | 18 | 400 | 22 (1.21) | 18px ✓ | Primary reading text |
| `bodySm` | 16 | 400 | 18 (1.15) | 16px ✓ | Dense rows |
| `caption` | 12 | 400 | 14 (1.19) | 12px ✓ | Prices, timestamps, hints |
| `micro` | 11 | 400 | 15 (1.36) | 11px ✓ | Eyebrow labels, legal |

**Font:** Inter 300/400/600 via `@expo-google-fonts/inter` — the substitute the spec
itself names for Roobert. Pure JS, so **no rebuild**. Loaded with `useFonts` behind
`expo-splash-screen` to avoid a system-font flash.

**Raleway is skipped** — one 54px desktop context with no mobile equivalent, and the
spec bars it from body and nav anyway.

**Tracking → 0** everywhere (current `-0.5`/`-0.3` removed). Sole exception:
uppercase `micro` eyebrows get `+0.5px`. Judgment call, not spec.

⚠️ **Weight 300 is capped at `subheadingLg` and above**, and never over the hero
gradient — light type on a moving chromatic backdrop is the legibility trap in this
system. Over the gradient: weight 400 minimum, plus a scrim.

---

## 4. Settled decisions

- **Primary CTA** — hot pink `#FF1493` fill, **obsidian label**, 75px pill.
  Secondary: ghost pill, 1px border. Destructive: ghost pill in Felt Gray.
  Disabled: Ash Mist. Utility/dismiss: Slate Pill.
- **Booking status → monochrome.** States (pending / your turn / expiring /
  confirmed / declined) encode through 11px eyebrow labels and fill inversion —
  "YOUR TURN" as a filled micro pill, "EXPIRED" in Felt Gray. Works for colorblind
  users, which a hue-only system fails.
- **One semantic red survives**, for form validation and irreversible-action
  confirmation only. Losing it on "this cancels a confirmed appointment" would be a
  safety regression, not a style win.
- **Dark mode kept** — light / dark / system, both with glass, both with pink.
- **Hero backdrop** — static iridescent image via `expo-image` (already a
  dependency) with slow Reanimated drift. No rebuild, and it gives the liquid
  oil-on-water texture that a linear gradient literally cannot.

---

## 5. Implementation phases

### Phase A — token layer
1. Rewrite `src/constants/theme.ts`: monochrome spine + rationed pink,
   `radius = { sharp: 0, pill: 75 }`, the type ramp above, spacing
   `4/8/12/14/28/34/40/46/48/64/68/152`, layout constants (max-width 1078,
   section gap 46, card padding 34, element gap 14). Keep the glass tokens.
2. Replace `springs` with `easing`: signature `Easing.bezier(0.19, 1, 0.22, 1)` at
   800/1250ms, plus `micro` = ease at 400ms.
3. `npm i @expo-google-fonts/inter`; load in `src/app/_layout.tsx` behind the splash.
4. Hold the `ThemeTokens` shape close to current so screens keep compiling.

*Gate:* `npm run typecheck` clean. No visual review yet.

### Phase B — primitives
5. `glass-card.tsx` — keep the blur, drop the rounding to 0, hairline border,
   34px padding. Export name unchanged so 21 screens don't break at once.
6. `ambient-background.tsx` → **`hero-media.tsx`**: iridescent image + slow drift,
   one per screen, client-facing only. Working screens get flat paper/obsidian.
   Retains PLAN.md's client-vs-working distinction rather than dissolving it.
7. `cc-button.tsx`: 75px radius, remove spring/squash, animate border and fill at
   400ms, new variant set from §4.
8. `cc-input.tsx`: 0px radius, hairline border, remove the stray hex literal
   at line 36 (the only one in the codebase).
9. `cc-modal.tsx`, `loading.tsx`: 0px radius, flatten.
10. New: `frame.tsx` (1078px max-width — matters on the Vercel web build),
    `eyebrow.tsx` (11px uppercase micro label, used heavily by the new hierarchy),
    `status-pill.tsx` (the monochrome booking-state chip).

*Gate:* rebuild `src/app/gallery.tsx` as the reference sheet and review it.
**This is the real sign-off point** — approve the look here before Phase C.

### Phase C — screens (21 files)
Grouped so each commit is reviewable:
- **Auth + join** (5): `sign-in`, `sign-up`, `join/[token]`, `index`, `db-check`
- **Client-facing** (4): `book`, `client`, `request/[id]`, `requests` — these carry
  the display type and the one hero gradient each
- **Stylist/owner** (8): `chair`, `salon`, `staff`, `hours`, `profile`,
  `service-new`, `setup-salon`, `account`
- **Invites** (2): `invite`, `invite-client`

Per screen: swap the 8 direct `radius.md`/`radius.lg` call sites to `sharp`, apply
the new hierarchy (one whisper-weight title, 11px eyebrows for sections, left-aligned
throughout), and convert selected-state pink *tints* into pink *fills or borders* —
the rationing rule means no more 12–15% pink washes on card backgrounds.

### Phase D — motion
11. Screen transitions: `Stack` from `fade` to transform-based slide, signature
    curve, 800ms.
12. Press states at 400ms — border and fill only, no scale.
13. Hero gradient drift on a long slow loop.

### Phase E — cleanup
14. Delete dead tokens (cyan/yellow UI roles, spring presets).
    `expo-blur` stays — glass is retained.
15. Update PLAN.md → Design System and PROGRESS.md.

---

## 6. Verification

- `npm run typecheck` after each phase.
- `gallery.tsx` as the visual reference sheet (Phase B gate).
- Web build + browser pass over the booking flow.
- **PROGRESS.md gotcha applies:** browser automation cannot drive react-native-web —
  `form_input` sets DOM values without updating React state, and synthetic taps miss
  `Pressable`. Real interaction must be verified by hand on the preview build.
- `npm run db:test` must still pass — untouched by this, but it's the tripwire.

## 7. Risks

- **Weight 300 over glass over a moving gradient** is the main legibility risk.
  Capped to ≥26px, never over the hero, scrim required. Needs a real-device check.
- **Keeping glass keeps the web blur caveat.** The PROGRESS.md ghosting bug came
  from a *full-screen* `backdrop-filter`; per-card `BlurView` is scoped and the
  ambient layer already uses the CSS `filter` workaround. Both workarounds stay.
- **0px radius on tap targets** can read as unfinished on iOS if the hairline is too
  faint — needs a device check, not a simulator one.
- **Density.** 46px section gaps and 34px card padding make every screen noticeably
  longer to scroll. Correct for the style; worth seeing on device before Phase C.
- **Scope.** Phases A + B are ~10 files and reversible. Phase C is 21 screens and is
  where the time goes.
