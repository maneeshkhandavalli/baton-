# Checkpoint B package: brand (landing, brand identity, design system)

Branch `ui3/agent1-brand` (local, not pushed), worktree `.claude/worktrees/ui3-agent1-brand`. Commits on top of
`fc5651a`: `0c937cb` tokens/fonts/evidence primitives · `55a7336` spec draft · `8f401c2` Checkpoint A revisions ·
`a1f605c` landing · `6fdd253` research + timing. Preview: http://localhost:3101/ (landing) and
http://localhost:3101/design/system (specimen; dev only). **Not final: the user approves the system here.**

## What changed

### Design system (contract: `docs/design/design-system.md`)
- **Material**: parchment paper `#f2ede3`, warm-white sheets `#fbf9f4`, deep ink `#1a1915`, one restrained cobalt
  `#2b48a0`. **Dark, designed**: "the archive at night", graphite `#12110e` → sheet `#201e19` → popover `#2a2721`,
  parchment ink `#ede7da`, cobalt `#93a7f2`; wider surface steps than light; faint top highlights instead of shadows.
- **Type**: Newsreader (serif, optical sizing) to READ · Instrument Sans to OPERATE · IBM Plex Mono to RECORD. New roles
  `type-display-xl`, `type-lede`, `type-reading`, `type-meta`, `type-quote-reading`, `type-exhibit`; `type-quote` is sans
  in the app; `type-eyebrow` is mono.
- **Evidence vs system**: evidence hues moved apart (verdigris/ochre/madder/slate vs leaf green/burnt orange/brick/
  cobalt), checked with a colour-blind simulation (warning darkened after it). Every status also has a shape
  (`EvidenceMark`), an edge style (`StatusBadge` tag, `EvidenceStamp`) and a word.
- **New tokens** (all existing names kept): `sunken`, `track`, `faint-foreground`, `mask`/`mask-quiet` (+ foregrounds),
  `highlight`, `shadow-sheet`, `--duration-*`, `ease-exit`, `--header-height`, `--sticky-offset`.
- **Utilities**: `focus-ring` / `focus-ring-within` (solid, ≥ 7:1), `paper-grain`, `ruled`, `leader`, `redact` (quiet) /
  `redact-strong` (ink), `quote-match`, `crop-marks`, `stamp`. Scoped `.light` class for side-by-side specimens.
- **Primitives updated**: Button (`ink` variant; solid focus), Badge (neutral dot fix), Input (solid 2px focus edge),
  Tabs/Dialog/Card/ChoiceCard (focus), Progress + ProgressIndicator + ReadinessRing (`track`; ring at 100% uses
  `success`, no longer evidence green), StatusBadge (filed tag + mark), new EvidenceMark/EvidenceStamp, MaskedText
  (`variant`, accessible token names), RouteError (Next 16 `retry`, `error: unknown`), BatonLogo (serif wordmark).
- Reduced motion now also zeroes animation/transition **delays** (found during verification).
- Checkpoint A: reviews from `shell`, `handover`, `demo` all answered and accepted (`review-responses.md`); spec §11
  holds the app/review/report/demo patterns they asked for.

### Landing (`app/(marketing)/page.tsx`, `components/marketing/*`)
1. **Hero, the cover of a handover file**: serif display headline with the cobalt italic; three layered sheets (the
   chat export as received, a conflict card, an approved point with its quote, checks and a Sourced stamp) that settle
   on arrival; promises as a numbered ruled list; ink "Start a handover" + serif "Try the demo".
2. **How it works, one file in five states** (`HandoverStory`): sticky stage + stepping chapters (stage sticks at the
   top on mobile). Scenes: Sources + scope (excluded dates, the opted-out person) → Masking (as received, struck
   through → as stored, redaction wipes in) → AI draft with quote check and support check → the four evidence labels
   stamping in → the published handover (contents with leaders, signature drawing). Chapter rail shows progress and
   jumps.
3. **Evidence specimen**: each label with its meaning and a real CodeCell point/quote; plus an **interactive publish
   gate** (labelled illustration) that unlocks "Publish handover" only when the four review gates are cleared.
4. **Privacy band**: exhibit of one message as received vs as stored (scroll-driven strike + redaction), §1–§3 clauses.
5. **For the nerds as an appendix**: manifest with leaders + numbered notes (all statements unchanged and still
   mirrored to the code, per the file header).
6. **Close**: the receipt the incoming person signs (signature draws on scroll) + CTAs.
- Header: opaque paper + double rule (no blur), serif wordmark, mono section links; footer colophon. `/demo`,
  `/login`, Sign in, Demo, theme toggle and the header account menu keep working (account menu code unchanged except the
  focus class).
- **Content**: only real claims; every example mirrors the demo scenario (Kabir Shah → Neha Kulkarni, Priya Raman
  reviewing) word for word from `lib/demo/scenario` on `ui3/agent4-demo`. No credential-like tokens. TODO for the lead:
  point `components/marketing/landing-content.ts` at `@/lib/demo/scenario` at integration.

## Files
`app/globals.css`, `app/(marketing)/page.tsx`, `app/(design-lab)/design/system/page.tsx` (new, dev only), `lib/fonts.ts`,
`lib/theme.ts` (2 hex values), `lib/utils.ts`, `public/theme-init.js` (regenerated),
`components/ui/{button,badge,card,choice-card,dialog,input,progress,tabs}.tsx`,
`components/shared/{baton-logo,masked-text,mask-tokens,progress-indicator,readiness-ring,route-error,status-badge,stepper}.tsx|ts`,
new `components/shared/{evidence-mark,evidence-stamp}.tsx`, `components/shared/__tests__/mask-tokens.test.ts`,
`components/layout/{site-header,site-footer,account-menu}.tsx`,
`components/marketing/{for-the-nerds,hero-dossier,handover-story,evidence-specimen,publish-gate,landing-content}.tsx|ts`,
`components/marketing/landing.css` (new), `components/marketing/product-preview.tsx` (deleted),
`docs/design/design-system.md` (rewritten), `docs/history/design/research/ui3-research.md` (new).

## Screenshots (git-ignored, `<repo>/.claude/ui3/shots/brand/`)
- Landing contact sheets: `landing/_final-1440-light.jpg`, `_final-1440-dark.jpg`, `_final-1024-light.jpg`,
  `_final-390-light.jpg`, `_final-390-dark.jpg`; individual frames `landing/home-<width>-<theme>-s<n>.jpg`.
- Reduced motion: `landing/home-1440-light-rm-s0..4.jpg`, `home-390-light-rm-s0..4.jpg`.
- Other routes: `landing/demo-1440-light-s0.jpg`, `landing/login-1440-light-s0.jpg`.
- Specimen: `system/system-1440-light-full.jpg` (light + dark columns), `system/system-1440-dark-s0.jpg` (page in dark
  mode; light column stays light).
- Research: `research/_sheet1..10.jpg` (34 sites; Land-book and Field Notes blocked by bot checks).
- Baseline for comparison: `baseline/_baseline.jpg` (Concept B and the previous landing).

## Research highlights (`docs/history/design/research/ui3-research.md`)
Sticky stage + stepping chapters (Pudding, Attio, Apple) for showing one object change state; one UI fragment per step
(Linear, Granola); exhibits framed with crop marks and rules (Hex, Monocle); paper depth without gradients (Mercury,
Craft); editorial hierarchy (Shape Up, Every, Anthropic); CSS scroll timelines with a complete static fallback (Apple).
Rejected: glass, gradients, floating cards, WebGL, logo walls, dark-by-default.

## Verification (run in the brand worktree)
- `npm run lint`: clean. `npx tsc --noEmit -p .`: clean.
- `npm test`: **2,103 tests, 2,102 pass, 0 fail, 1 todo** (pre-existing, Docker-only Tier E). Baseline was 2,102;
  +1 is my new `maskTokenLabel` test. Nothing regressed.
- Screenshots at 390 / 1024 / 1440, light and dark, plus reduced motion at 390 and 1440: **no horizontal overflow and no
  console errors** on every capture (checked programmatically per capture). `/`, `/demo`, `/login`, `/design/system`
  return 200.
- Contrast: all text pairs ≥ 4.5:1 (most ≥ 6:1), control borders ≥ 3.5:1, focus ring ≥ 7:1 (numbers in spec §2, §9).
- Not verified: Safari/Firefox rendering (headless Chrome only; Firefox lacks scroll timelines and gets the static
  final states by design), real touch devices, screen-reader pass beyond semantics review, the signed-in header menu
  (no session in headless runs; its code is unchanged apart from the focus class).

## Open questions for the user
1. Typefaces: Newsreader + Instrument Sans + IBM Plex Mono. Keep, or try another UI face?
2. The story is long by design (five chapters, about four screens of scrolling on desktop). Keep that pace or shorten?
3. Hero headline is large (up to 92px, four lines at 1440). Keep the drama or step down to `type-display`?
4. Cobalt `#2b48a0` is deliberately restrained; would you like it a touch brighter?
5. The publish-gate toy is the one interactive element besides the story. Keep it?
6. Phase C items not built yet (spec'd): Menu, RadioGroup, Toggletip, compact PageHeader, EmptyState variants,
   SkeletonRow, print stylesheet.
