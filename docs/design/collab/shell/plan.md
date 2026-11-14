# Shell implementation plan (Phase A, for review)

Author: `shell` (Agent 2). Scope: app shell and navigation, dashboard, account/settings, auth screens, light/dark/system
theme, not-found/error pages, `/preview/dashboard`. Based on `audit.md` (finding IDs in brackets) and `research.md`.
This plan fixes **structure, behaviour, states, accessibility and tests**. Every visual treatment (colour, type, surface,
radius, motion) comes from `brand`'s design system once approved at Checkpoint B; where I need a component I list it as
a request (§9), not a choice. No backend, auth-flow, schema, env or action changes: only existing queries and actions.

---

## 0. Principles for my screens
1. **Answer "what needs me?" first** on the dashboard; everything else is secondary [D1].
2. **One primary action per screen**, one `h1`, headings in order [S4].
3. **Register, not card grid** for collections; cards only for the object being acted on [D3, D4].
4. **Stage and concrete blockers, not a percentage** [D5].
5. **Never lose the user's place**: active nav everywhere, focus never dropped, errors recoverable with a real retry [S1, L1, E1].
6. **Every state designed**: loading, empty (first run), all caught up, partial failure, error, success.
7. **Pure logic, tested**: grouping, CTA/next-step mapping, nav matching and theme resolution are pure functions with
   `node:test` unit tests; components stay thin.

---

## 1. App shell and navigation

### 1.1 Desktop (≥ lg, 1024+)
Persistent left sidebar (keep the quiet, paper-toned idea; width and surface from brand), top to bottom:
1. **Wordmark** (link to `/dashboard`).
2. **Primary**: `Handovers` (the dashboard, renamed in the nav only; page title stays brand/lead copy) and
   `New handover`. `Handovers` is **active on `/dashboard` and every `/handover/[id]/*`**; `New handover` on
   `/handover/new` [S1]. Matching moves into a pure `isNavActive(pathname, item)` with a `match` list per item.
3. **Open handovers** (new): up to 5 handovers that need the viewer or are in progress, title + small stage label,
   the current one marked `aria-current="page"` when inside `/handover/[id]/*`, "All handovers" link after [S2].
   Streamed in its own `<Suspense>` (skeleton rows), so the static shell still prerenders. **Needs lead OK** (one
   extra `listMyHandovers` per navigation; see Risks R1). Fallback if declined: show only the current handover's
   title, read from the same request the handover header already makes.
4. **Foot**: identity block (initial, display name, email truncated with `title`) opening a menu: `Account`,
   `Appearance` (Light / Dark / System radio items), `Sign out` (POST form, unchanged route) [S3, S8]. Same menu
   component as the public header's `AccountMenu` (request B-4); Sign out returns to `/` from both places [S7].
   The separate icon theme toggle beside the logo goes away (the menu and Account page carry it).

5. **Collapsible to a narrow rail** (icons + tooltips, identity initial at the foot) with a labelled toggle
   (`aria-expanded`), remembered per device like the theme. The rail is the default between 1024 and 1279px on the
   wide tool routes (`/handover/[id]/review`, `/processing`), because handover's audit (R-1) found the review's main
   pane gets the least space at 1440 with a 240px sidebar beside readiness and detail columns. The choice is read
   before paint (same blocking-script approach as the theme) so the layout doesn't jump.

### 1.2 Mobile and tablet (< lg)
- Opaque top bar (no translucency/blur, D2) [S6]: wordmark left; right: identity/menu button only.
- Drawer from the left, same content and order as the sidebar (primary, open handovers, identity + appearance +
  sign out at the foot). Keep current behaviour that is already right: focus to first link on open, Esc closes,
  focus returns to the trigger, closes on navigation (verified) [S5].
- Inside a handover, the bar shows a compact "Handovers / <title>" back link so the drawer is not the only way up.
- Bottom tab bar: **not** planned (two destinations do not justify it).

### 1.3 Layout primitives (`components/layout/`)
- Keep `PageContainer` widths (`prose / narrow / default / wide / full`) and gutters; add `PageBand` (full-bleed band
  with the same gutters/max-width, for the handover header band and any page header band) so
  `handover/[id]/layout.tsx` stops hard-coding `max-w-[90rem]` (offer to `handover`, H-4) [S10].
- `SkipLink` component used by `AppShell`, `SharedLinkShell` (and offered to brand for `SiteHeader`) [S9].
- `AppShell` takes optional props (`nav`, `identity`, `banner`) so `/preview/**` and, if `demo` wants it, the demo can
  render the real shell with synthetic data and no account controls.
- `SharedLinkShell`: keep "Private link" pill and theme control (as a compact Appearance menu); align its header
  width with the narrow token pages [E6].

### 1.4 Files
`components/layout/{app-shell,app-sidebar,mobile-header,mobile-nav,workspace-nav,workspace-nav-list,workspace-navigation,page-container,shared-link-shell}.tsx`,
new `components/layout/{page-band,skip-link,open-handovers,identity-menu,nav-match}.ts(x)`,
`app/(workspace)/layout.tsx`, `config/navigation.ts` (**ownership request**, unowned today: `workspaceNav`/`accountNav`
to me, `handoverNav` to `handover`, who asked for it; or handover moves its tabs into `components/handover/`).

---

## 2. Dashboard

### 2.1 Information hierarchy
```
Handovers                                   [New handover]   ← one primary (hidden in first-run empty state)
<needs-you summary line: "3 things need you · 1 creatorship offer · 2 handovers to review">

NEEDS YOU            (rows; why + one action each)
  ○ CodeCell technical lead · CodeCell · Reviewer   Review · 14 to review · 1 conflict      Continue review →
  ○ Photography Club secretary · Offered to you                                            Review offer →
  ○ Literary Club magazine · Processing failed: 1 source couldn't be read                  See what failed →
  ○ E-Cell sponsorship lead · Handed over to you                                            Read handover →
DRAFTS               (resume rows: saved sources, next named step, Continue; discard in an overflow menu)
IN PROGRESS          (processing, waiting on contributors' gap answers, waiting for an incoming member)
HANDED OVER TO YOU   (received, published; provenance: version, published date)
FILED                (approved/acknowledged you prepared; collapsed by default with a count)
```
- Each group hides when empty. Order inside a group: urgency then `updatedAt` desc.
- **Row anatomy** (desktop): title (link, the row's accessible name includes the action, e.g. "Continue review:
  CodeCell technical lead") · team · your role (+ creator) · **stage track** (Draft · Processing · Review · Published
  · Acknowledged, current stage named in text, not colour alone) · **needs line** (plain counts from
  `ReadinessReport.blockers`) · updated (absolute `<time>`, relative rendered client-side only, see R4) · one action.
  At < md the row stacks: title, meta line, needs line, action full width. Discard draft moves to an overflow menu with
  the existing confirm dialog [D7].
- **Find**: when the viewer has more than 8 handovers, a filter row appears: text filter (title/team), side
  (All / Preparing / Receiving), and team; client-side over already-loaded rows, state in the URL query so it
  survives refresh and back [D4]. Optional table density at ≥ xl (columns Title · Team · Role · Stage · Needs ·
  Updated), only if brand's table primitive supports it well; otherwise rows only.
- **Readiness %** leaves the row; the score stays available inside review (handover's call) [D5].

### 2.2 Classification (pure, tested): `components/dashboard/model.ts`
`buildDashboard(queries: BatonQueries): Promise<DashboardModel>` uses only existing queries:
`listMyHandovers`; per draft the viewer manages `listSources` (as today); per review-role non-draft
`getReadiness` (as today; now also `blockers`, `canPublish`); per `processing` handover `getProcessingStatus`
(new read, bounded to processing items) [D2, D11]. Then pure `classify(summary, extras) → { group, reason, cta,
href, stage }`:

| Situation | Group | Reason line | CTA → href |
|---|---|---|---|
| `pendingCreatorTransfer` to the viewer | Needs you | "Offered to you by …" | Review offer → settings |
| `processing`, run failed/partial | Needs you (creator/outgoing) | run error summary (mapped, never raw) | See what failed → processing |
| `processing`, running | In progress | "Reading sources · stage n of m" | View progress → processing |
| `in_review`, `canPublish`, viewer is creator | Needs you | "Ready to publish" | Publish → review |
| `in_review`, pending points / conflicts / inferred / privacy review | Needs you | counts from blockers | Continue review → review |
| `in_review`, only `open_required_gaps` / `no_incoming_recipient` | In progress | "Waiting for 2 gap answers" / "Invite the incoming member" | Open gaps / Open settings |
| `draft` managed by viewer, no parsed sources | Drafts | next named step | Continue → wizard `?draft=` |
| `draft` not managed by viewer | In progress | "Being set up by the creator" | Open → processing |
| incoming/lead, published | Handed over to you | "Version n, published …" (if cheaply available) | Read handover → published |
| `approved` / `acknowledged`, review role | Filed | "Published …" / "Acknowledged" | Open → published |

Readiness or status failing for one row degrades that row only ("Status unavailable, open to check") [partial
failure]. Copy is placeholder; final wording with lead/brand. Step names and the dashboard "next" wording come from
`WIZARD_STEPS` in `components/wizard/steps.ts` (handover agreed, H-5); derived from the list, never a hard-coded 4
(the wizard may gain a fifth "Check and start" step).

**Preview parity** [D10]: `/preview/dashboard` calls the same `buildDashboard(createMockQueries(...))` and renders the
same component; query flags select fixtures: `?state=empty|error|caught-up|many|partial`. Draft fixtures stay local to
the preview page (no `lib/mocks` change needed; if one is needed I will ask `handover`/lead first).

### 2.3 States
| State | Behaviour |
|---|---|
| Route loading | `loading.tsx` skeleton shaped like header + 2 groups of rows (replaces the card skeleton) |
| Streaming | header renders immediately; list in `<Suspense>` with the same skeleton |
| First run (0 handovers) | empty state with **one** primary "Start a handover" and secondary "Explore the demo"; header button hidden [S4] |
| All caught up | "Nothing needs you right now" line above the remaining groups |
| Partial failure | per-row degraded status (above) |
| Load error | inline error panel (no raw message) [D9] with a Retry that re-runs the server render (`router.refresh()` inside a small client button) |
| After discard | toast + refresh (keep) ; focus moves to the group heading |
| Processing failed | Needs you row (above) [D2] |

### 2.4 Data gap (request to lead, not a UI change)
Incoming rows cannot show "acknowledged by you" or first-week progress: `HandoverSummary` has neither [D8]. Options:
(a) accept; (b) call `getPublishedHandover` per received item (heavy); (c) a future summary field (backend, off limits
now). I'll do (a) and note it.

### 2.5 Files
`app/(workspace)/dashboard/{page,loading}.tsx`, `components/dashboard/*` (new `model.ts`, `handover-row.tsx`,
`stage-track.tsx`, `needs-summary.tsx`, `dashboard-filter.tsx`, `dashboard-list.tsx`; keep `draft-row.tsx` path and
`DraftRow` export; delete `HandoverCardSkeleton`, unused `isDemo`) [D12], `app/(preview)/preview/dashboard/page.tsx`.
`tests/integration/r3-render-determinism.test.ts` imports `DraftRow` and the `HandoverCardData` shape: I will keep
both exports compatible, or hand the lead a one-line test update if the type changes (lead owns tests infra).

---

## 3. Account and settings
Single narrow column, sections separated by rules (not four equal cards) [A1], in this order, each with an `h2`
of one style [A3]:
1. **Your account**: summary-list rows: Email (+ verified), Account created, Last sign-in, Handovers (counts).
2. **Sign-in methods**: rows Google (Linked/Not linked + explanation), Email and password (Set/Not set +
   Set/Change password link via `routes.accountPassword`) [A7].
3. **Appearance** (new): Light / Dark / System radio group; note "Saved on this device" [A2, T5].
4. **Creatorship offers**: rows with Accept/Decline; pending state per offer and per button (Decline shows
   "Declining…") [A6]; empty line when none.
5. **Sign out** (button, POST route) [A9].
6. **Delete account** as a visually separate danger annex at the end: what is deleted / what is kept; created
   handovers list where each checkbox's accessible name includes the handover title, ≥ 24px targets; disabled delete
   button `aria-describedby` the blocker count [A4]; the type-DELETE dialog unchanged in behaviour.
- Load failures: one consistent inline alert per section with Retry, no raw server messages [A5].
- `loading.tsx` and the Suspense fallback use the **same** skeleton.
- `/account/password`: success state offers "Back to account" (primary) and dashboard (secondary); form width
  consistent with the column [A8]. Action call unchanged.
- Files: `app/(workspace)/account/{page,loading}.tsx`, `account/password/{page,set-password-form}.tsx`,
  `components/account/*` (new `appearance-settings.tsx`), `lib/routes.ts` additive `accountPassword` (**request**).

---

## 4. Auth screens (`/login`; UI only, actions untouched)
- **Layout**: centred sheet on mobile; at ≥ lg a two-part page: the sign-in sheet plus a short context column (what
  Baton is in one line, the privacy promise in one line, and "You'll continue to <destination>" when `?next=` is
  present) [L4]. No glow/gradient [L5]; Appearance control in the corner as a compact menu.
- **Hierarchy**: one visually primary path; Google stays first and follows Google's branding rules; brand decides the
  exact treatment [L2]. "Create an account" visible from the start as a secondary link that opens the email panel in
  sign-up mode [L4].
- **No nested card** once the email panel opens: the panel expands inside the same sheet [L3].
- **Focus**: opening the email panel moves focus to the Email field; switching mode (sign in / create / reset)
  moves focus to the panel heading (`tabIndex={-1}`) and announces it [L1]. Field errors: message linked from the
  offending field with `aria-describedby`, `aria-invalid` kept [L9]; a polite live region announces "Signing in…",
  "Check your inbox" [L10].
- **Shared block**: `components/auth/sign-in-options.tsx` (Google + email panel) reused by `/h/[token]` if
  `handover` agrees (H-6) [L6]. The invite page keeps its own explainer copy.
- Remove dead `components/auth/magic-link-form.tsx` [L7] (the live magic-link form stays behind
  `EMAIL_LOGIN_ENABLED`).
- `(auth)/error.tsx` keeps a safe way home; uses `retry()` (§6).
- Files: `app/(auth)/{layout,error}.tsx`, `app/(auth)/login/{page,login-form}.tsx`, `components/auth/*`.
  `app/(auth)/login/actions.ts` is **not touched**.

---

## 5. Theme: light / dark / system, no flash, persistence

### 5.1 Behaviour
- Preference values: `"light" | "dark" | "system"`. Storage key unchanged (`baton-theme`); what an absent or
  unknown value means is the default, and that is a **decision for the lead/user**: today it is light.
  Recommendation: absent = **System** for new visitors (dark-OS users currently get a cream page [T1]); anyone who already saved "dark" keeps
  it; a saved "light" keeps light.
- Resolved theme still applied as the `dark` class on `<html>` (every token depends on it; no rename, D5). Also set
  `data-theme-preference` for debugging/tests.
- In System mode the hook listens to `matchMedia('(prefers-color-scheme: dark)')` changes and re-applies live;
  cross-tab `storage` sync kept.
- Controls: Appearance radio group (Account), Appearance submenu (identity menu, mobile drawer, auth corner, shared
  link header). `ThemeToggle` keeps its export and props so brand's public header keeps working; it becomes a
  compact menu button with the three options (label "Appearance: System (dark)"), not a cycle button.

### 5.2 No flash
- Keep the blocking `public/theme-init.js` (generated from `lib/theme.ts`, byte-identity test kept). New logic: stored
  `dark` → dark; stored `light` → light; else `matchMedia` dark → dark. Still tiny, still try/catch.
- Request to brand for `app/layout.tsx` (T2): `viewport.colorScheme: "light dark"` and
  `themeColor: [{ media: "(prefers-color-scheme: light)", color: light }, { media: "(prefers-color-scheme: dark)",
  color: dark }]`; the init script overrides `theme-color` only for an explicit choice that differs from the OS.
- `global-error.tsx`: apply the resolved theme synchronously from the same function before first paint where
  possible (inline effect order) [T4].

### 5.3 Tests (extend `components/shared/__tests__/theme.test.ts`)
`parseThemePreference` for every value; init script in the VM sandbox with a fake `matchMedia` for all 9 combos
(stored light/dark/none × OS light/dark × storage throws); resolved theme function; public file identical to source;
static check that `app/layout.tsx` still loads the script blocking in `<head>`. Browser check (headless, not in `npm
test`): first-paint screenshot with OS dark + no storage shows dark; OS dark + stored light shows light.

### 5.4 Files
`lib/theme.ts`, `public/theme-init.js` (theme bootstrap; I treat these as part of "theme behaviour": **please confirm
ownership**, `public/**` is brand's), `hooks/use-theme.ts` (unowned; request), `components/shared/theme-toggle.tsx`,
new `components/shared/theme-menu.tsx` or inside `components/layout/identity-menu.tsx`.

---

## 6. Not-found and errors
- `app/not-found.tsx`: `metadata.title = "Page not found"` [E2]; logo links home; actions: "Baton home" and
  "Your handovers" with neutral weight (the page cannot know cheaply whether the visitor is signed in) [E3].
- Error boundaries use Next 16 `retry()` (re-fetch + re-render), `error: unknown` narrowed [E1]. Needs
  `components/shared/route-error.tsx` updated by brand or handed to me (request B-1). Workspace boundary keeps the
  shell and uses `PageContainer` [E4].
- Add `app/error.tsx` as the catch-all for segments with no group boundary (`(preview)`, `(design-lab)`).
- Suggest `app/(workspace)/handover/[id]/error.tsx` to `handover` so a tab failure keeps the header and tabs (H-2).
- `global-error.tsx`: keep self-contained buttons (router may be broken), align their look with brand's tokens [E5].

---

## 7. Accessibility checklist (my screens)
- Landmarks: one `main`, `nav aria-label="Workspace"`, drawer `nav` same label, identity menu is a menu button; one
  `h1` per page, groups `h2`, rows `h3` or list items with a linked title (decide with brand: rows as `<li>` with
  title link, no heading per row, to keep the outline short).
- Focus: visible on every interactive element (keep the current 100% pass), never dropped on disclosure/mode change,
  moved to a sensible heading after destructive actions and route changes inside the dashboard filter.
- Names: row links include the action; icon-only buttons labelled; purge checkboxes named per handover.
- Status conveyed in text, never colour alone (stage track names the stage; blockers as words).
- Targets ≥ 24px (WCAG 2.5.8), ≥ 40px for primary touch actions on mobile.
- Reduced motion: any row/drawer motion has a no-motion equivalent (D6).
- Contrast: text 4.5:1, UI boundaries and progress fills 3:1 against their surface in both themes (checked with a
  script over brand's tokens at Checkpoint A/B).

---

## 8. Tests I will add / keep
**Keep green**: `components/shared/__tests__/theme.test.ts` (extended), `account-deletion.test.ts`,
`tests/integration/r3-render-determinism.test.ts` (DraftRow stays timezone-stable: relative dates client-only),
`r2-header-account`, `r2-password-auth`, `r2-google-oauth`, `r2-account-deletion` (they import actions I do not touch).
**Add** (`components/dashboard/__tests__/`, `components/layout/__tests__/`, run under `test:ui`; the script glob
needs `components/dashboard/__tests__/*.test.ts` and `components/layout/__tests__/*.test.ts` added: **request to lead**,
`package.json` is lead-owned):
- `dashboard-model.test.ts`: every row of the §2.2 table; ordering; partial failure; empty / caught-up; preview and
  production produce the same groups for the same mock data.
- `nav-match.test.ts`: active item for `/dashboard`, `/handover/new`, `/handover/x/review`, `/account`,
  `/account/password`, unknown paths, trailing slashes.
- `theme.test.ts` additions (§5.3).
- Render-determinism style test for the new row/stage components (no block inside `<p>`, stable across TZ).
**Browser** (headless, against dev): `/preview/dashboard` with each `?state=`, `/login` (email panel focus),
drawer open/close, 404 status, at 390/1024/1440 in light/dark/system; uses `tests/browser/run.mjs` routes (lead runs)
plus my local scripts in `.claude/ui3/` (not committed).

---

## 9. Requests to `brand` (needs, not choices)
1. **Dark surface steps** with visible separation between page, sidebar, sheet, raised row/hover and selected row;
   borders/rules that read in dark (today 1.04–1.25:1) [T3].
2. **List/register row** primitive (or guidance): comfortable and compact densities, hover/selected/focus states,
   a slot for a trailing action and an overflow menu.
3. **Table** guidance for the optional ≥ xl density (sticky header, sortable header button, numeric alignment, mono
   headers, row link pattern) — `components/ui/table.tsx` exists; needs Dossier styling and states.
4. **Stage track / routing-slip** treatment for five lifecycle stages (current, done, upcoming; text-labelled;
   works at 390 as a compact label) and a **state label** style consistent across all five states (H-7).
5. **Summary list / description list** (label, value, trailing action) for account and handover metadata.
6. **Section with rule** (heading + optional description + action) as the default page section, and a **danger
   annex** treatment for destructive sections.
7. **Menu** primitive wrapping `@base-ui/react/menu` (radio items for Appearance, link items, destructive item) —
   today hand-rolled in `account-menu.tsx`; plus **segmented control / radio group** for the Account Appearance.
8. **Identity block** (initial avatar + name + email) shared by public header and app shell (B-4).
9. **Alert with action** (Retry) and **EmptyState** variants: first-run (one primary + one secondary), caught-up
   (quiet, no illustration), error (retry), no-results (clear filters).
10. **Skeleton row** matching the row primitive.
11. **Compact PageHeader** variant (title + one action, optional summary line) for app pages; current one is
    marketing-tall [D14].
12. **Sidebar** surface, active/hover/current-handover item styles, section label style; **opaque** mobile top bar.
13. **Focus ring, target sizes, tabular numerals, relative-time tooltip** guidance.
14. Auth page composition guidance (sheet + context column) that stays in the Dossier family.

## 10. Other requests
- **lead**: ownership of `config/navigation.ts` and `hooks/use-theme.ts`; additive `routes.accountPassword` in
  `lib/routes.ts`; confirm `lib/theme.ts` + `public/theme-init.js` sit with theme behaviour (me); add my test globs to
  `test:ui`; decision on default theme (System vs Light); OK for the sidebar "Open handovers" read (R1).
- **handover**: agreed H-1…H-6 (reply 2026-11-15): role/state-aware tabs, `[id]/error.tsx`, title de-dup, uses my
  `PageBand` (send export name), exports `WIZARD_STEPS`, switches `/h/[token]` to `SignInOptions` (props: invite copy,
  `startGoogleInviteSignIn.bind(null, token)`, `requestInviteLink`). H-7 is brand's (Badge tone).
- **demo**: `AppShell` will accept a demo mode if the demo wants the real chrome.

---

## 11. Risks
| # | Risk | Mitigation |
|---|---|---|
| R1 | Sidebar "Open handovers" adds a `listMyHandovers` per workspace navigation; layouts persist across navigations but streaming segments re-run. | Own `<Suspense>`, request-time (`connection()`), only first 5; fall back to current-handover-only if the lead declines. |
| R2 | Dashboard reads grow (readiness per review row + processing status per processing row). | Bounded to items that need it; parallel; per-row failure isolation; measure against baton-dev with the fixture set. |
| R3 | Cache Components/PPR: anything reading session/time must sit behind `connection()` inside Suspense (existing pattern). | Keep the existing pattern; nav active state stays in the Suspense-wrapped client nav. |
| R4 | Relative dates cause hydration mismatches and break the TZ determinism test. | Server renders absolute `<time>`; relative text rendered client-side after mount. |
| R5 | Default-theme change surprises users. | Lead/user decision; stored choices respected; easy switch in Account. |
| R6 | Design system not final until Checkpoint B. | Build structure, logic and tests first behind current tokens; apply visuals after approval. |
| R7 | Files outside my list (`config/navigation.ts`, `hooks/use-theme.ts`, `lib/routes.ts`, `public/theme-init.js`, `route-error.tsx`, `app/layout.tsx`, `package.json` test globs). | Explicit requests (§10); no edits until confirmed. |
| R8 | `/h/[token]` and `/login` share a sign-in block across two owners. | Only if `handover` agrees; otherwise I align visually via brand's components. |
| R9 | Preview parity: mock data lacks failed-processing or offer cases. | Preview-local fixture overrides; any `lib/mocks` change agreed with handover + lead first. |

## 12. Order of work (Phase C, after Checkpoint B)
1. Pure logic + tests: `nav-match`, `dashboard/model`, theme preference (no visual change).
2. Theme System mode + no-flash (after brand applies the `app/layout.tsx` viewport change).
3. Shell: sidebar/drawer structure, identity menu, active states, skip link, `PageBand`.
4. Dashboard rows, groups, states, filter; preview parity.
5. Account restructure + a11y fixes; password page.
6. Auth layout, focus fixes, shared sign-in block.
7. 404 / error boundaries (`retry()`).
8. Browser pass at 390/1024/1440 × light/dark/system, keyboard + SR spot checks; `graphify update .`.
