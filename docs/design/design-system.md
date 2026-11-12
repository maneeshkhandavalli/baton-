# Baton design system (Round 3)

Owner: Agent 1 (UI/UX). Status: **milestone 2 — every route moved onto the system (first pass); lead reviews asynchronously from pushed commits**.
Tokens live in `app/globals.css`; primitives in `components/ui/**`; product-level building blocks in
`components/shared/**`; frames in `components/layout/**`. This document is the contract every page follows
in milestone 2.

---

## 1. Audit (baseline `24320e1` + plan commit)

### What already works
- A real token layer existed (warm paper, navy ink, four evidence-status colours, Instrument Serif +
  Inter + JetBrains Mono). No raw hex in components. Masked-text rendering, reduced-motion `FadeIn`,
  skip link, `aria-current` in nav, and live regions on loading are in place.
- Copy is unusually good: plain, specific, privacy-honest. The redesign keeps the words and fixes the frame.

### What is generic or inconsistent
| Area | Finding |
|---|---|
| Surfaces | "Card soup": 38 hand-rolled `rounded-xl border bg-card shadow-soft` boxes across 20 files. Page sections, stats, side panels and forms are all boxed the same way, so nothing is primary. The processing aside is three stacked cards; settings is one card per section; the gap interview, login and empty states are cards inside a padded page. |
| Type | 9 arbitrary sizes (`text-[0.6875rem]` ×19, `text-[0.9375rem]` ×4, `text-[2.75rem]`, `text-[4.25rem]`…), 6 different eyebrow trackings (0.12–0.26em). `font-heading` mapped to the serif, so `CardTitle`/`AlertDialogTitle` rendered a 16px serif. Dialog titles were 24px serif, alert-dialog titles 16px — two different dialogs. |
| Colour | Evidence colours doubled as system colours (`status-sourced` = "saved", `status-inferred` = "in review" and "warning"). Conflicting (red) was indistinguishable from destructive (red): a conflict read as an error. No warning/success/info tokens, no dark palette. Input borders were 1.6:1 against white (fails WCAG 1.4.11). |
| Controls | Buttons 32px tall by default (24px `xs`), inputs 32px: small for touch and visually timid. Four hand-styled `<select>`s with different classes. Radio "cards" re-implemented three times. `FilterChip`, `Stat`, `Kbd`, `Field`, `DropZone` are private one-offs inside feature files. `destructive` button was a pale tint (weak for "Delete account"). No Tabs primitive (demo hand-rolls one). |
| Navigation | A heavy navy sidebar — the most "generic admin dashboard" element in the app — fighting the editorial paper aesthetic. On mobile the nav was a horizontally scrolling row inside the header. **No sign-out anywhere in the UI** (the POST route exists). Account sat beside primary actions. |
| Feedback | Save state only in the wizard and only as a line of grey text; errors shown as `text-destructive` sentences in five different shapes; tinted boxes hand-built per use (`bg-status-sourced-soft` "saved" banner, `bg-status-inferred-soft` warning). Toast is the only feedback in review. |
| Wizard | Step indicator is four bars with numbers (labels hidden on mobile); details become read-only after creation ("can't be edited yet"); upload rows have one generic error line — duplicate, too-large, unsupported and network failure look identical; retry is a ghost button. |
| Review | Three panes but equal visual weight; approve/reject live in a card footer with similar-looking buttons; conflicting and missing differ only by a small badge colour; read-only notices are plain text. |
| Responsive | Review left panel becomes a `<details>` card at < lg; dashboard grid fine; marketing fine; tables absent; many rows rely on `truncate` without a title. |

### Per-route notes
| Route | Primary today | Problem |
|---|---|---|
| `/` | Hero + product preview | Good bones. Dark band used sidebar tokens. CTA sizes hand-patched (`h-10 px-4`). |
| `/demo` | Tabs: review / incoming | Hand-rolled tabs; incoming view boxed in another rounded card. |
| `/login` | Card with form | Card-in-centre is fine, but the form is visually thin (32px input), errors are bare text. |
| `/dashboard` | Card grid | Everything is a card of equal weight; drafts needing action look like finished handovers; "Discard draft" floats under a card. |
| `/handover/new` | Wizard | See above; plus three nested boxes in the scope step. |
| `/handover/[id]/processing` | Run card + 3 aside cards | Failure state is a sentence in the header; retry button is generic. |
| `/handover/[id]/review` | Point list | Hierarchy flat; actions not decisive; conflict vs gap weakly distinguished. |
| `/handover/[id]/gaps` | Question cards | Hand-styled selects; status of each question low-contrast. |
| `/handover/[id]/settings` | One card per section | Long, uniform; destructive actions not separated. |
| `/handover/[id]/published` | Editorial document | Closest to the target; first-week block and acknowledge band are cards inside a document. |
| `/g/[token]` | Question card | Card inside a narrow page; progress unclear. |
| `/h/[token]` | Empty-state card | Fine; uses EmptyState for everything (errors look like empty states). |
| `/account` | Two cards | Fine; destructive zone not visually separated. |
| not-found | Centred text | Fine; no error boundary for workspace routes (`error.tsx` missing). |

---

## 2. Direction

**Editorial clarity on warm paper.** Baton is a document product — its output is a handover someone reads
on their first day. The app should feel like a calm, well-set publication with precise tools around it,
not a dashboard.

Principles
1. **One primary thing per screen.** Every page has exactly one h1 and at most one primary button. Hierarchy
   comes from type scale and whitespace before borders and colour.
2. **Sheets, not boxes.** White sheets (cards) sit on paper only when they are objects you act on (a
   handover, a point, a question) or a document/form. Sections are separated by space and hairlines.
3. **Serif for meaning, sans for mechanics.** Instrument Serif for titles people read (page titles,
   section titles, handover/point headlines in the published view); Inter for everything operated.
4. **Colour carries meaning, never decoration.** Three families that never mix: ink/surfaces, system
   tones (primary, success, warning, danger, info), evidence status (sourced, inferred, conflicting,
   missing). The accent indigo marks the one primary action and the current location.
5. **State is always visible.** Saved, saving, failed, conflict, processing, read-only — each has a
   designed, persistent inline state. Toasts only confirm.
6. **Restraint in motion.** Short, eased, purposeful; nothing moves under reduced motion.

---

## 3. Tokens

### 3.1 Colour — light (default)

| Token | Value | Use |
|---|---|---|
| `background` | `#f7f4ee` | Page paper |
| `card` / `popover` | `#ffffff` | Sheets, dialogs, menus |
| `muted` / `secondary` | `#efeae1` | Quiet fills, secondary buttons, code chips |
| `accent` | `#ebe5da` | Hover fill on paper |
| `foreground` | `#151c33` | Ink (15.4:1 on paper) |
| `muted-foreground` | `#5a6177` | Secondary text (5.6:1 on paper, 5.1:1 on muted) |
| `border` | `#e6e0d5` | Hairlines, card edges (decorative) |
| `border-strong` | `#d4cbbb` | Outline buttons, dashed drop zones, emphasis rules |
| `input` | `#9d9483` | Form control borders — 3.0:1 on card (WCAG 1.4.11) |
| `ring` | `#2c42c9` | Focus (7:1 on paper) |
| `overlay` | ink @ 32% | Dialog backdrop |
| `inverse` / `inverse-foreground` / `inverse-muted` | `#151c33` / `#eef0f6` / `#a3abc2` | Dark bands (marketing privacy band, acknowledge band) |
| `sidebar*` | paper `#f2eee6`, hairline `#e3dccf` | Workspace sidebar (light, quiet) |

System tones — each has `base`, `-fg` (text on paper/soft), `-soft` (tint); solid tones also `-hover`, `-foreground`:

| Tone | base | fg | soft | Meaning |
|---|---|---|---|---|
| primary / info | `#2c42c9` | `#2335a6` | `#eaedfb` | The primary action; current location; neutral guidance |
| success | `#127a58` | `#0b6146` | `#e3f2eb` | Saved, approved, done |
| warning | `#c25e0c` | `#8e4307` | `#fcecdc` | Needs attention, reversible risk, "in review" |
| danger (`destructive`) | `#c2364b` | `#9f2638` | `#f9e5e8` | Failure, irreversible, reject/delete |

Evidence status (only for evidence; logo uses all four):

| Status | base | fg | soft | Note |
|---|---|---|---|---|
| sourced | `#0e8a62` | `#0a6b4c` | `#e4f3ec` | green |
| inferred | `#b8780c` | `#865606` | `#f8eedb` | ochre |
| conflicting | `#b0336f` | `#8e2659` | `#f8e6ef` | **berry — changed from red** so a conflict reads "decide", not "error" |
| missing | `#6b7590` | `#4c556c` | `#eceef3` | slate; gaps are absence, not failure |

All `-fg` on `-soft` pairs are ≥ 5.4:1; solid buttons ≥ 5.3:1 with white text.

### 3.2 Colour — dark

Complete parallel set in `.dark` (deep navy `#0f1320` paper, `#161b2b` sheets, `#e9ebf2` ink, lifted tones
e.g. primary `#8d9cf7` with ink text, conflicting `#e06aa6`, all fg/soft pairs ≥ 7:1). **Opt-in** (class
on `<html>`), not switched on in Round 3: turning it on needs every route checked in dark plus a theme
toggle — proposed for after milestone 2.

### 3.3 Typography

Fonts: Instrument Serif 400 (+italic) = display; Inter = UI; JetBrains Mono = quotes, numerals, tokens.
Use the role utilities (defined with `@utility` in `globals.css`), not ad-hoc size/leading/tracking stacks.

| Role | Utility | Spec | Use |
|---|---|---|---|
| Display | `type-display` | serif, clamp 44→72px, lh 1.02, −0.02em | Homepage hero only |
| Page title | `type-page-title` | serif, clamp 34→46px, lh 1.06 | The h1 of every page (via `PageHeader`) |
| Section title | `type-section-title` | serif, clamp 26→32px | Published sections, wizard step titles, marketing sections |
| Title | `type-title` | serif 24px | Dialog titles, empty-state titles, point headline in focus panes |
| Heading | `type-heading` | Inter 15px/600 | Card titles, list-group headings, panel headings |
| Subheading | `type-subheading` | Inter 14px/600 | Dense panels |
| Body large | `type-body-lg` | 17px/1.65 | Marketing lead, published summary |
| Body | `type-body` | 15px/1.6 | Page descriptions, reading copy |
| UI text | `text-sm` | 14px | Default UI |
| Caption | `type-caption` / `text-caption` | 13px | Hints, meta lines, small buttons |
| Eyebrow | `type-eyebrow` | Inter 11px/600, 0.14em, uppercase | Labels above titles, table heads |
| Badge | `text-2xs` | 11px | Badges only |
| Quote | `type-quote` | mono 13px/1.6 | Raw excerpts (conversation previews, the group notice). Evidence quotes use sans 14px with a serif open-quote for readability |
| Numerals | `type-numeric` | mono tabular | Counts, percentages |

Measure: running text ≤ 70ch (`max-w-2xl` for descriptions, `prose` width for documents).
`text-wrap: balance` on titles, `pretty` on body.

### 3.4 Spacing & layout

4px base (Tailwind). Rhythm: 8 / 12 / 16 / 24 / 32 / 48 / 64.
- Inside a component: 8–16. Between related blocks: 24. Between page sections: 48 (`space-y-12`), 32 on mobile.
- Gutters (`PageContainer`): 16px (<640) · 24px (≥640) · 40px (≥1024) · 48px (≥1280). Vertical: 32 → 40 → 48.
- Widths: `prose` 42rem (reading) · `narrow` 48rem (forms, wizard, settings, account) · `default` 72rem
  (dashboard) · `wide` 90rem (review, processing) · `full`.
- Grid: 12-column mental model; real layouts use explicit `grid-cols-[…]` tracks:
  review `15.5rem | 1fr | 23rem` (xl), `15.5rem | 1fr` (lg); processing `1fr | 22rem` (lg).

### 3.5 Radii & elevation
- Radii: controls `rounded-md` (8px) · badges/tags `rounded-full` / `rounded-sm` · cards & panels `rounded-xl`
  (12px) · dialogs/sheets `rounded-2xl` (16px). Nothing else.
- Elevation: `shadow-xs` controls · `shadow-soft` resting cards · `shadow-raised` hover, toasts, popovers ·
  `shadow-overlay` dialogs. Warm-tinted, low. No shadows on sections.

### 3.6 Motion
- Durations: 150ms (hover/press), 200ms (dialogs, tabs), 250ms (sheets/drawers), 300–500ms (progress
  bars, entrance). Easing: `ease-emphasized` (cubic-bezier(.22,1,.36,1)) for entrances, `ease-standard`
  for state changes.
- Allowed: fade/rise 6–8px on step change and first paint, progress bar width, ring/dot pulse for live
  processing, 1px press. Not allowed: parallax, looping decoration, layout-shifting animation.
- `prefers-reduced-motion`: a global rule zeroes animations/transitions; spinners keep turning (slowly)
  because they carry meaning; `FadeIn` and the wizard's `AnimatePresence` render statically.

---

## 4. Components

All in `components/ui/**` unless noted. **Rule: feature code composes these; it does not restyle them.**

### Buttons (`Button`, `buttonVariants`)
| Variant | Use |
|---|---|
| `default` (primary, indigo) | The one primary action of a view ("Continue", "Start processing", "Publish") |
| `outline` | Secondary actions next to a primary |
| `secondary` | Low-emphasis filled (toolbar toggles) |
| `ghost` | Tertiary/inline ("Back", "Shortcuts", icon buttons) |
| `success` / `success-outline` | Approve (review) — the decisive positive outcome |
| `destructive` / `destructive-outline` / `destructive-ghost` | Delete/discard confirm (solid, in dialogs only) · Reject (outline) · Remove-in-row (ghost) |
| `link` | Inline text actions |

Sizes: `xs` 28px · `sm` 32px · `default` 36px · `lg` 40px · `xl` 48px (hero) · `icon-*` 28/32/36/40.
Touch: on < sm, primary flow buttons use `lg` and stretch (`w-full sm:w-auto`). Loading: keep the label,
set `aria-busy`, swap the verb ("Saving…"); never disable without saying why nearby.

### Forms
- `Input`, `Textarea`, `NativeSelect` share `controlClassName`: 36px, 8px radius, `border-input` (3:1),
  16px text on mobile (no iOS zoom), 3px soft focus ring, `aria-invalid` → danger border + ring.
- `Field` (label + control + hint + error) and `fieldDescribedBy(id, {hint, error})` wire
  `aria-describedby`. Hints stay visible under errors. "Optional" is marked, required is the default.
- `FieldGroup` = `fieldset` + `legend` for grouped choices. `ChoiceCard` = selectable card wrapping a real
  radio/checkbox (who is leaving, access level).
- Validation: on submit, then live per field once touched; first invalid field receives focus; summary
  `Alert tone="danger"` above the form when > 2 errors.

### Badges & status
- `Badge` (`tone`, `size` sm|md, `shape` pill|tag, `dot`, `pulse`) — server-safe.
- Pills = state: `HandoverStateBadge` (draft neutral · processing primary+pulse · in review warning ·
  approved success · acknowledged inverse), `StatusBadge` (evidence), review outcome.
- Tags = metadata: `AccessBadge`, `OutdatedBadge`, category.
- Never rely on colour alone: every badge has a label; evidence badges keep their dot + word.

### Lists & tables
- Objects with actions → `<ul>` rows separated by hairlines inside one sheet (`divide-y`), 56px+ rows,
  primary text + caption meta + trailing actions; on mobile, actions wrap below.
- Real tabular data (members, links, masking counts) → `Table` (`components/ui/table.tsx`), eyebrow
  headers, ≤ 3 columns on mobile or a stacked variant.
- Figures → `Stat` in a `<dl>` grid separated by hairlines (not one card per number).

### Tabs
`Tabs`/`TabsList`/`TabsTab`/`TabsPanel` (`variant` underline | segmented). Underline = page-level views
(demo); segmented = small in-section switches (review filters). Route-level sub-navigation
(`HandoverNav`) uses links with the same underline look.

### Dialogs & sheets
- `Dialog` (`side` center | right | left) — center for forms/confirm, right for the point-detail sheet on
  < xl, left for the mobile nav drawer. 16px radius, `shadow-overlay`, serif `type-title`, footer bar
  with actions right-aligned (stacked, primary on top, on mobile).
- `AlertDialog` / `ConfirmDialog` for consequential actions: title is the question ("Discard this
  draft?"), confirm button repeats the verb ("Discard draft"), destructive confirm is solid danger.

### Feedback
- **Alert** (`components/ui/alert.tsx`): inline, persistent; tones neutral/info/success/warning/danger;
  optional title + action (e.g. Retry). Danger is `role="alert"`; others `status`; static notices `live="none"`.
- **Toast** (Sonner, bottom-right): confirms an action just taken; tone shown by icon colour only; never
  the only carrier of an error.
- **SaveIndicator** (`components/shared/save-indicator.tsx` + pure `save-state.ts`): `unsaved` · `dirty`
  · `saving` · `saved · just now / 4 min ago` · `error` (+Retry, role=alert) · `conflict` ("Updated
  elsewhere — we loaded the latest version"). Always visible in the wizard header.
- **Upload states** (`components/shared/upload-status.ts`): `hashing → uploading → verifying → consent →
  previewing` (busy, "step n of 5") · `ready` · `needs_input` (date order) · `failed` (Retry) ·
  `duplicate` (server `conflict`) · `too_large` · `empty` · `unsupported`. Each row shows icon + label +
  explanation + the only valid action; only `failed` is retryable.
- **Stepper** (`components/shared/stepper.tsx`): numbered steps with labels ≥ sm, "Step 2 of 4 · Label"
  + segmented bar on mobile; completed steps are clickable, upcoming never.
- **ProgressIndicator** (vertical stages) for processing.

### Loading / empty / error / success patterns
| State | Pattern |
|---|---|
| Loading (page) | Skeleton of the real layout (same grid, `Skeleton` blocks) inside `Suspense`; `LoadingState` only when the shape is unknown. Never a blank page. |
| Loading (action) | Button keeps label + `aria-busy`, verb changes; row-level spinners for per-item work. |
| Empty | `EmptyState variant="page"` (dashed frame, icon, serif title, one primary action). Inside lists `variant="inline"`. Filters-empty offers "Clear filters". |
| Error (load) | `EmptyState tone="error"` with what happened + what to do + retry/back link. Route errors: `error.tsx` boundaries per route group (milestone 2). |
| Error (action) | Inline `Alert tone="danger"` next to the thing that failed + toast; field errors under fields. |
| Locked (role) | `EmptyState tone="locked"` + the route the viewer *can* use. |
| Success | Inline `Alert tone="success"` when the state persists (published, answers sent); toast when transient. |
| Read-only | `Alert tone="neutral"` banner at the top of the workspace with the reason and the way out. |

---

## 5. Layout shell & navigation
- **Workspace (≥ lg):** 240px paper sidebar, hairline right border: logo → Dashboard, New handover →
  (bottom) Account, Sign out (POST form to `/auth/signout`). Active item = white pill with indigo icon.
- **Workspace (< lg):** 56px translucent top bar with logo + menu button → left drawer with the same nav.
  The drawer closes on navigation; focus is trapped by the dialog; Esc closes.
- **Handover pages:** header (team eyebrow, serif title, role + state badge) above underline tabs
  Processing · Review · Gaps · Settings · Published. Tabs scroll horizontally on mobile without a scrollbar.
- **Marketing:** sticky translucent header, one primary CTA ("Open workspace" ≥ sm).
- **Token pages:** minimal header ("Private link shared with you"), no workspace nav.

---

## 6. Responsive rules (verified widths 1440 / 1024 / 390)
| Width | Rules |
|---|---|
| 1440 | Sidebar + content. Review: 3 panes (sections · points · evidence). Dashboard: 3 columns. Processing: main + 22rem aside. Wizard/settings centred at 48rem. |
| 1024 | Sidebar stays (lg). Review: 2 panes; evidence opens in a right sheet. Dashboard: 2 columns. Processing: aside drops below the run. |
| 390 | Top bar + drawer. Single column everywhere. Page titles clamp to 34px. Actions stack full-width under titles; dialogs keep 16px margins; tables become stacked rows; tap targets ≥ 36px (primary flow 40px); no horizontal page scroll (only tab strips and code blocks scroll). Wizard stepper collapses to "Step n of 4". |

Breakpoints: Tailwind defaults (`sm` 640, `md` 768, `lg` 1024, `xl` 1280, `2xl` 1536).

---

## 7. Accessibility rules
- Contrast: text ≥ 4.5:1 (all text tokens pass, see §3.1), UI boundaries ≥ 3:1 (`input`, focus ring).
- Focus: always visible. Components draw a 3px `ring-ring/40`; anything else gets a 2px `outline` from
  the base layer. Never `outline-none` without a replacement.
- Keyboard: every action reachable; dialogs trap focus and restore it; review shortcuts (J/K/A/E/R/?)
  are documented in-app and disabled while a dialog is open.
- Semantics: one `h1` per page; headings in order; `nav` landmarks labelled; lists are lists; status
  changes in `role="status"` (polite), failures in `role="alert"`; `aria-current` for location and steps.
- Forms: visible labels (no placeholder-as-label), `aria-describedby` hints/errors, `aria-invalid`.
- Colour is never the only signal (badges carry words; diff/supports/contradicts carry labels).
- Motion respects `prefers-reduced-motion`. Mobile text inputs ≥ 16px.

---

## 8. Page hierarchy (milestone 2 target)

| Route | Primary | Secondary | Tertiary |
|---|---|---|---|
| `/` | Hero promise + "Start a handover" | Evidence-status explainer, 3 steps, privacy band | Demo CTA, footer |
| `/demo` | Review workspace (read-only) | Tab to incoming view | Context note, "Start your own" |
| `/login` | Email field + "Email me a sign-in link" | Sent / error states | Back to home |
| `/dashboard` | **Needs your action** (drafts to finish, reviews waiting, offers) with the next-step CTA on each | All handovers (preparing / receiving) as compact rows or cards | New handover button, demo link when empty |
| `/handover/new` | Current step's form + Continue | Stepper, SaveIndicator, editable details | Discard draft (ghost, confirm) |
| `…/processing` | Run status + overall progress (or failure + Retry) | Stage list | Sources + masking summary (aside, no cards per block) |
| `…/review` | Selected point: statement, evidence quote, **Approve / Reject** | Point list with filters | Readiness + sections panel, publish when ready |
| `…/gaps` | Open questions + "Send to contributor" | Answered awaiting review | Waived / closed |
| `…/settings` | Members & access | Sources, links, participants | Danger zone (separated, bottom) |
| `…/published` | The handover document (summary → sections → first week) | Section nav (sticky on desktop) | Acknowledge band (bottom), source footnotes |
| `/g/[token]` | One question at a time + answer | Progress ("2 of 5") | Review & send |
| `/h/[token]` | Invitation action (sign in / accept) | Explanation | Error states with next step |
| `/account` | Creatorship offers | — | Delete account (danger zone) |
| not-found / errors | What happened + one way forward | — | — |

Conflict vs gap (review + published): **conflict** = berry, two columns "Supports / Contradicts", primary
action "Resolve"; **gap** = slate, dashed outline, question icon, primary action "Ask in Gap Interview".
They never share a colour, icon or action label.

---

## 9. Implemented in milestone 1
- `app/globals.css` — full token set (light + dark), type roles, radii, elevation, motion, focus, reduced motion.
- `lib/utils.ts` — `cn` configured for custom sizes/shadows (prevents `text-caption` from silently
  removing text colours). All `components/ui/*` import `cn` from here.
- `components/ui`: `button` (variants/sizes above), `input` (+`controlClassName`), `textarea`,
  `native-select` (new), `field` (new: `Field`, `FieldGroup`, `fieldDescribedBy`), `choice-card` (new),
  `label`, `badge` (tones/shapes, server-safe), `card` (sizes, `interactive`), `dialog` (left side,
  `DialogBody`), `alert-dialog`, `alert` (new), `tabs` (new), `kbd` (new), `table` (new), `sonner`.
- `components/shared`: `page-header` (back, meta), `section-heading` (eyebrow, count), `empty-state`
  (tones, variants), `status-badge` (on `Badge`), `stepper` (new), `save-indicator` + `save-state` (new),
  `upload-status` (new), `steps` (new), `stat` (new), `progress-indicator` (shared step logic).
- `components/layout`: light sidebar with account + **sign-out**, mobile top bar + drawer (`mobile-nav`),
  wider gutters, translucent marketing header, token-page header.
- `components/handover`: `HandoverStateBadge`/`AccessBadge`/`OutdatedBadge` on `Badge`; header + tabs on
  type roles. `handoverStateMeta` now carries a system tone instead of evidence classes.
- Tests: `components/shared/__tests__/design-states.test.ts` (save state, upload phases, steps).

Pages were not restructured in milestone 1; they inherit the new tokens, controls and shell.

## 10. Milestone 2 (pages) — what changed where
| Area | Commit subject prefix | Notes |
|---|---|---|
| Shell, errors | `feat(ui): shell error boundaries…` | `error.tsx` for workspace + token groups, 404 |
| Dashboard | `feat(ui): dashboard…` | Drafts-to-finish rows (last saved, next step, Continue, discard) above the card grid; offers/reviews first |
| Wizard | `feat(ui): new-handover wizard…`, `…upload robustness…` | Editable details with debounced single-flight autosave (`use-details-autosave.ts`, `details-save.ts`), SaveIndicator, clickable Stepper, sticky action bar with the reason Continue is disabled, per-file phases incl. duplicate/too large/unsupported, confirm retries, cleanup errors, .txt chat vs plain text |
| Review | `feat(ui): review workspace…` | Evidence-status rail, conflict block vs gap block, success Approve / destructive-outline Reject, decided pills + Undo |
| Published | `feat(ui): published handover…` | Editorial document, at-a-glance, first week, one sheet per section, open questions, inverse acknowledge band |
| Processing | `feat(ui): processing…` | Live eyebrow, failure Alert, one summary sheet |
| Gaps, interview, settings, account | `feat(ui): gaps manager…` | NativeSelect, tags/pills, hairline settings groups, framed danger zone |
| Marketing, demo, login, token | `feat(ui): homepage…` | type-display hero, shared Tabs, Alerts in login |
| Sweep | `refactor(ui): app-wide token sweep…` | No `text-[…]` sizes left except the masked-token `em` chips |

## 11. Hardening (round 3, after milestone 2)
- **Touch:** below `sm` every button, input, select, segmented tab, filter chip and jump link is ≥ 40px tall (`max-sm:h-10`); drawer items ≥ 40px below `lg`.
- **Overflow:** `body { overflow-wrap: break-word }`; titles, quotes, file errors and previews use `[overflow-wrap:anywhere]`; `Table` stacks rows below `sm` (`label` per cell).
- **Sticky bars:** `scroll-padding-top/bottom` keep focused fields clear of the mobile top bar and the wizard action bar; the action bar respects `env(safe-area-inset-bottom)`.
- **Decisions & action items:** `keyFacts()` + `KeyFactsStrip` (owner · due · status, flags Unassigned / No date / overdue) on review cards and published points; Open work shows "N items · M unassigned".
- **Loading/error:** layout-matched skeletons (`components/shared/skeletons.tsx`) as `loading.tsx` and Suspense fallbacks on every route; `error.tsx` for workspace, token and marketing groups.
- **A11y:** one h1 per page (published document title is h2 under the page h1; invitation page has an sr-only h1); SaveIndicator is a live status (alert for errors/conflicts); upload transitions announced once in a polite live region; focus moves to the new step heading (wizard, gap interview) and to the next point after approve/reject; Base UI dialogs restore focus to their trigger; JS smooth scrolling honours reduced motion.
