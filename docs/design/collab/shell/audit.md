# Shell audit (Phase A)

Author: `shell` (Agent 2). Baseline: `ui3/agent2-shell` at `fc5651a` (= production `c781620` + design lab).
Method: code read in the shell worktree, plus headless Chrome against the running dev server at `http://localhost:3000`
(not signed in, no forms submitted), 390x844 (mobile), 1024x900 and 1440x900, light and dark (`localStorage
baton-theme=dark`), keyboard Tab walk, `prefers-color-scheme: dark` emulation. Screenshots: 
`C:/Users/manee/Documents/programing/baton/.claude/ui3/shots/shell/` (git-ignored; `x_*` = interaction shots).
Zero console errors on every route checked. No horizontal overflow on any product route (one 6px overflow on the
dev-only `/design/b` at 390).

Severity: **H** = broken or misleading behaviour / accessibility failure, **M** = clear UX or consistency problem,
**L** = polish. "Verified" means checked in the running app; everything else is from code and cites the file.

---

## 1. Every route in `app/`

### Pages
| Route | File | Purpose | Owner | Guard |
|---|---|---|---|---|
| `/` | `app/(marketing)/page.tsx` | Landing | brand | public |
| `/demo` | `app/(marketing)/demo/page.tsx` (+ `loading.tsx`) | Synthetic CodeCell demo (review / incoming tabs) | demo | public |
| `/login` | `app/(auth)/login/page.tsx`, `login-form.tsx`, `actions.ts` | Google, email+password (sign in / create / reset), magic link behind flag | **shell** (UI only; actions off limits) | public; `/dashboard`, `/account` redirect here with `?next=` (verified) |
| `/dashboard` | `app/(workspace)/dashboard/page.tsx` (+ `loading.tsx`) | Drafts, preparing/reviewing, handed over to you | **shell** | signed in (proxy) |
| `/account` | `app/(workspace)/account/page.tsx` (+ `loading.tsx`) | Account details, creatorship offers, account deletion | **shell** | signed in |
| `/account/password` | `app/(workspace)/account/password/page.tsx`, `set-password-form.tsx`, `actions.ts` | Set or change password (also the landing for reset emails) | **shell** (UI) | signed in |
| `/handover/new` | `app/(workspace)/handover/new/page.tsx` | Wizard (details, consent+sources, uploads, scope) | handover | signed in |
| `/handover/[id]/processing` | `.../processing/page.tsx` | Run progress | handover | member |
| `/handover/[id]/review` | `.../review/page.tsx` | Review workspace | handover | review roles |
| `/handover/[id]/gaps` | `.../gaps/page.tsx` | Gap questions + Gap Interview links | handover | review roles |
| `/handover/[id]/settings` | `.../settings/page.tsx` | Members, links, creatorship, danger zone | handover | member |
| `/handover/[id]/published` | `.../published/page.tsx` | Current publication + acknowledge | handover | member |
| `/g/[token]` | `app/(token)/g/[token]/page.tsx` | Contributor Gap Interview | handover (page), **shell** (frame `SharedLinkShell`) | token |
| `/h/[token]` | `app/(token)/h/[token]/page.tsx` | Handover invitation → sign in → accept | handover (page), **shell** (frame) | token, then session |
| `/preview` | `app/(preview)/preview/page.tsx` | Dev-only index of mock previews | handover | dev only (`notFound()` in prod) |
| `/preview/dashboard` | `app/(preview)/preview/dashboard/page.tsx` | Dashboard on `lib/mocks`; `?empty=1` empty state | **shell** | dev only |
| `/preview/wizard`, `/processing`, `/review`, `/published`, `/sample-data` | `app/(preview)/preview/*/page.tsx` | Mock previews | handover | dev only |
| `/design`, `/design/a`–`/design/d` | `app/(design-lab)/**` | Four landing directions (B = Dossier, chosen) | lead (preserved lab) | dev-only per commit `fc5651a` |

### Route handlers (backend, off limits; listed for completeness)
`/auth/callback` (`app/auth/callback/route.ts`, OAuth/email return), `/auth/signout` (`app/auth/signout/route.ts`, POST only;
no `next` → `/login`), `/api/pipeline/drain` (`app/api/pipeline/drain/route.ts`, worker).

### Special files
| File | Scope | Owner | Notes |
|---|---|---|---|
| `app/layout.tsx` | root: fonts, metadata, viewport, blocking `/theme-init.js`, `<Toaster>` | brand (theme markup touches shell) | `viewport.colorScheme: "light"` hard-coded |
| `app/not-found.tsx` | global 404 | **shell** | no `metadata` (title falls back to the site default, verified) |
| `app/global-error.tsx` | root layout failure | **shell** | re-applies saved theme, hand-styled buttons |
| `app/error.tsx` | — | **shell** (per ownership) | **does not exist**; group boundaries cover `(auth)`, `(marketing)`, `(token)`, `(workspace)`; `(preview)` and `(design-lab)` have none |
| `app/(workspace)/error.tsx`, `app/(auth)/error.tsx` | group boundaries | **shell** | both render `components/shared/route-error.tsx` (brand) |
| `app/(marketing)/error.tsx`, `app/(token)/error.tsx` | group boundaries | brand / handover | same `RouteError` |
| `loading.tsx` | dashboard, account, demo, every handover sub-route, token pages | per route owner | `/account/password` has none (static page, fine) |
| Layouts | `(workspace)` → `AppShell`; `(preview)` → `AppShell` + `PreviewBanner`; `(auth)` → centred card; `(token)` → `SharedLinkShell`; `(marketing)` → `SiteHeader`/`SiteFooter`; `handover/[id]/layout.tsx` → `HandoverHeader` + `HandoverNav` | shell owns `(workspace)/layout.tsx`, `app-shell`, `shared-link-shell`; handover owns `[id]/layout.tsx` | |

---

## 2. App shell and navigation (shell)

Files: `components/layout/app-shell.tsx`, `app-sidebar.tsx`, `mobile-header.tsx`, `mobile-nav.tsx`, `workspace-nav*.tsx`,
`workspace-navigation.tsx`, `page-container.tsx`, `config/navigation.ts` (not in my ownership list; see plan §Files).

| # | Sev | Finding | Evidence |
|---|---|---|---|
| S1 | **H** | **No active nav item on any handover page.** `isActive()` matches only `href` or `href/…`; on `/handover/[id]/*` neither Dashboard nor New handover is current, so the global nav loses the user exactly where they spend most time. | `workspace-nav-list.tsx:17`; verified on `/preview/review`: `Dashboard:-, New handover:-, Account:-` |
| S2 | M | **Sidebar is nearly empty.** Two links on top, Account + Sign out at the bottom, ~600px of blank paper between (1440 and in the mobile drawer). No recent/open handovers, no sense of "where am I" inside a handover, no signed-in identity. | `x_mobile_drawer_390.png`, `_preview_dashboard_1440_light.png` |
| S3 | M | **Signed-in identity is never shown in the workspace.** The public header has `AccountMenu` (name, email); the app shell has only an "Account" link. A user with two Google accounts cannot tell which one they are in. | `app-sidebar.tsx`, `header-account.tsx` (brand-owned, public only) |
| S4 | M | **"New handover" is a primary button on the dashboard and a nav item at the same time**, and the empty state adds a third (header button + empty-state button both primary, verified `x_empty_1440.png`). Breaks "at most one primary per screen". | `dashboard/page.tsx:22-27,96-108`, `config/navigation.ts` |
| S5 | M | Mobile: theme toggle and menu sit in the top bar, but the drawer itself has no theme control and no account identity; drawer is 320px of mostly empty paper. Drawer focus lands on the first link (good), Esc closes and focus returns to the trigger (verified). | `mobile-nav.tsx`, `x_mobile_drawer_390.png` |
| S6 | M | Mobile header is `bg-background/75 backdrop-blur` (translucent, "glass"); D2 rules out glassmorphism. | `mobile-header.tsx:11` |
| S7 | L | Sign-out from the workspace goes to `/login` (no `next`), the public header's sign-out goes to `/`. Two different post-sign-out destinations. | `workspace-nav-list.tsx:58`, `account-menu.tsx:89`, `tests/integration/r2-header-account.test.ts:57` |
| S8 | L | Theme toggle is a 2-state icon button labelled "Dark theme" with `aria-pressed`; it is fine for SR, but on a 1440 sidebar it is a lone 28px icon beside the logo with no visible label. | `theme-toggle.tsx`, `app-sidebar.tsx:20` |
| S9 | L | Skip link markup is copy-pasted in three shells (`app-shell`, `shared-link-shell`, `site-header`). | — |
| S10 | L | `PageContainer` widths are good and should stay; `default` is `max-w-6xl` but the handover layout hard-codes `max-w-[90rem]` + its own gutters instead of using `PageContainer` (two sources of truth for gutters). | `page-container.tsx`, `handover/[id]/layout.tsx:9` |
| S11 | L | The preview banner wraps to three lines at 390 and pushes the page down ~100px; preview-only. | `_preview_dashboard_390_light.png` (handover owns `preview-chrome.tsx`) |

Keyboard (verified, `/preview/dashboard` 1440): Tab order is Skip link → logo → theme → Dashboard → New handover →
Account → Sign out → page. Every stop shows a ring or outline. Desktop order puts the 4 sidebar stops before content,
which the skip link mitigates. Sidebar bottom group (Account, Sign out) comes before page content in DOM; fine.

---

## 3. Dashboard (shell)

Files: `app/(workspace)/dashboard/page.tsx`, `components/dashboard/{handover-card,draft-row,discard-draft-button}.tsx`,
`app/(preview)/preview/dashboard/page.tsx`, `components/shared/skeletons.tsx` (`DashboardSkeleton`, brand).

| # | Sev | Finding | Evidence |
|---|---|---|---|
| D1 | **H** | **No "what needs me" layer.** The page answers "what exists", not "what should I do next". The data to say it is already fetched: `getReadiness()` returns `blockers[]` (`unresolved_conflicts`, `open_required_gaps`, `privacy_review_required`, `no_incoming_recipient`, …) and `canPublish`, but the dashboard reads only `score`. A handover at 100% that can be published looks identical to one that is waiting on nothing. | `dashboard/page.tsx:77`; `lib/contracts/dto.ts:319-337` |
| D2 | **H** | **Failed processing is invisible.** Every `processing` card says "Baton is reading the sources." with a spinner, even if the run failed. `getProcessingStatus()` (existing query) exposes `run.status` and `run.error`. | `handover-card.tsx:67-75` |
| D3 | M | **"Preparing and reviewing" mixes five states** (draft-with-sources, processing, in review, approved, acknowledged) in one equal-weight grid. Approved and acknowledged handovers sit beside work in progress; the CTA for everything not in review is just "Open". | `x_dashboard_full_1440.png`; `dashboard/page.tsx:67-75` |
| D4 | M | **Cards do not scale.** Each card is ~240px tall for ~5 facts; 3 per row at 1440, 2 at 1024, 1 at 390. Ten handovers = several screens of scrolling with no search, filter, sort or grouping by team. Typical users (club leads) will accumulate a handover per role per year. | screenshots; `handover-card.tsx` |
| D5 | M | **Readiness bar is misleading and hard to see.** "0%" for an in-review handover reads as "nothing done"; the score is informational only (`ReadinessReport.score` "never gates publication"). In dark the track is `--muted` on `--card` = **1.08:1** (0% bar invisible). Mono `0%` vs sans label mixes fonts on one line. | `handover-card.tsx:76-93`; contrast computed from `globals.css` |
| D6 | M | "Still being set up. Readiness appears once points are extracted." shows for a **reviewer** on a draft (Photography Club, "Offered to you"): it is not their job to set it up, and the primary CTA "Open" leads to processing. The offer CTA ("Review the offer") only appears if the viewer is not creator; badge text is the only signal. | preview; `dashboard/page.tsx:70-71` |
| D7 | M | Draft rows: the 4-segment progress bar is `aria-hidden` and hidden below `md`; the step names in `DRAFT_STEPS` duplicate wizard logic (`components/wizard/draft-state.ts`, handover-owned). Discard is a 40px red trash icon next to Continue (destructive action adjacent to primary, easy to hit on touch). | `draft-row.tsx:11,39-55` |
| D8 | M | **Incoming handovers have no state** beyond "Published and ready to read." Nothing says whether the viewer has acknowledged, how far through the first week they are, or who handed it over. (Needs data not in `HandoverSummary`; `getPublishedHandover` per card would be heavy; flag as a data request, not a UI fix.) | `handover-card.tsx:88-91`; `lib/contracts/dto.ts:44-60` |
| D9 | M | Error state interpolates `result.error.message` into the copy; the boundary component deliberately never shows raw messages, the page does. Inconsistent and potentially leaks server wording. Same on `/account` (A5). | `dashboard/page.tsx:89` |
| D10 | M | **Preview duplicates the page logic.** `/preview/dashboard` re-implements grouping, ranking and CTA mapping by hand (and differs: no rank sort, different CTAs), so the preview can drift from production silently. | `preview/dashboard/page.tsx:72-121` vs `dashboard/page.tsx:44-78,128-133` |
| D11 | L | N+1 server reads: `listSources` per draft + `getReadiness` per review handover, sequential per card inside `Promise.all`. Fine at 10, slow at 50. Adding processing status for D2 makes it worse unless bounded. | `dashboard/page.tsx:44-78` |
| D12 | L | Dead code: `HandoverCardSkeleton` (never imported), `isDemo` field (set, never read), `DraftRow` re-export "for older importers". | grep |
| D13 | L | Whole-card link uses `after:absolute after:inset-0`; the "Offered to you" badge and text inside are not separately actionable (OK), but the card's accessible name is only the title; the CTA verb ("Continue review") is not part of the link name. | `handover-card.tsx:45-49,94-99` |
| D14 | L | `PageHeader` eyebrow "Workspace" + title "Your handovers" + description: three lines of preamble above the first actionable item; at 390 the first draft starts ~520px down (below the fold with the preview banner). | `_preview_dashboard_390_light.png` |
| D15 | L | Dates are absolute ("Updated 9 Nov 2026"); recency would scan faster ("2 days ago") with absolute on hover/`<time>`. Draft row uses `suppressHydrationWarning`, card does not, though both format the same timestamp. | `draft-row.tsx:31`, `handover-card.tsx:95` |

States: loading = route `loading.tsx` + Suspense `DashboardSkeleton` (good, matches layout only for the card grid,
not the drafts list); empty = `EmptyState` with demo link (good copy, but two primaries, S4); error = `EmptyState
tone="error"` with raw message (D9) and no retry button ("Refresh the page"); success after discard = toast +
`router.refresh()` (good). Missing: processing-failed (D2), "all caught up" (nothing needs you), offer-expired.

---

## 4. Account and settings (shell)

Files: `app/(workspace)/account/page.tsx`, `account/password/*`, `components/account/*`.

| # | Sev | Finding | Evidence |
|---|---|---|---|
| A1 | M | **Three equal cards in a narrow column** (details, offers, deletion), each `rounded-xl border bg-card shadow-soft`; the destructive section looks identical to the informational ones until you read it. No in-page navigation. | `account-details.tsx:22`, `creator-offers.tsx:31`, `account-deletion.tsx:74` |
| A2 | M | **No appearance/theme preference on the account page.** The only theme control is the icon toggle; there is no "System" option anywhere (see T1). Account is the natural home for it. | — |
| A3 | M | Heading inconsistency: "Account details" uses `type-heading`, the other two use `text-base font-semibold`; the sign-in methods `h3` is `text-sm font-semibold`. | same files |
| A4 | M | Deletion purge checkboxes: 14px (`size-3.5`) inputs, every label reads "Delete permanently" with no handover name in the accessible name (SR users hear the same label N times). The disabled "Delete account" button has no `aria-describedby` to the "N handovers still block deletion" text. | `account-deletion.tsx:136-149,165` |
| A5 | M | Load failures render as a grey sentence with the raw server message ("Creatorship offers couldn't be loaded: {message}"); no retry, no consistent error treatment. | `account/page.tsx:52-64` |
| A6 | M | Creator offers: one shared `isPending` disables every button; only Accept shows "Saving…", Decline shows nothing while pending. | `creator-offers.tsx:15-25,66-73` |
| A7 | L | `/account/password` link and back link are hard-coded strings (`"/account/password"`, `"/account"`), not `routes.*`; `routes.ts` has no entry. | `account-details.tsx:96`, `password/page.tsx:17` |
| A8 | L | Set-password success replaces the form with an Alert + "Go to your dashboard" but no link back to Account; the form card is `max-w-md` inside a `narrow` container (left-aligned 28rem card in a 48rem column). | `set-password-form.tsx:20-31,35` |
| A9 | L | No sign-out on the Account page (only in the sidebar bottom); no "sign out of other devices" (backend, out of scope). | — |
| A10 | L | Deletion "what happens" uses two tinted boxes (`bg-destructive/5`, `bg-muted/40`) — good content; visual weight is low for the most consequential action in the app. | `account-deletion.tsx:83-102` |

Account loading: `loading.tsx` shows `FormSkeleton fields={2}` while the Suspense fallback is `ListSkeleton rows={3}`: two
different skeletons for the same page within one navigation.

---

## 5. Auth screens (shell UI; flows off limits)

Files: `app/(auth)/layout.tsx`, `login/page.tsx`, `login/login-form.tsx`, `components/auth/*`.

| # | Sev | Finding | Evidence |
|---|---|---|---|
| L1 | **H** | **Focus is lost when the email panel opens.** "Continue with email and password" unmounts itself; focus falls to `<body>` (verified: `activeElement = BODY`). Keyboard and SR users must start again from the top. Same pattern when switching sign in / create / reset modes (the mode button unmounts). | `login-form.tsx:72-77,229-241`; `inter.json` |
| L2 | M | **No primary action.** Google and email are both outline buttons of equal weight; the page has no hierarchy and no hint which is recommended. | `x_login_*` |
| L3 | M | **Card inside card** once email opens (`rounded-2xl` sheet containing a `rounded-xl` bordered section). | `login/page.tsx:15`, `login-form.tsx:147` |
| L4 | M | **No context.** A visitor redirected from `/dashboard` sees "Sign in to Baton" with nothing about where they are going (`?next=` is known), what Baton is, or the privacy promise. A new user cannot find "Create an account" without first opening the email panel. | `login/page.tsx` |
| L5 | M | Radial primary glow behind the card (a gradient, D2) and a lone corner theme toggle. | `(auth)/layout.tsx:9-15` |
| L6 | M | **Auth screens diverge across owners**: `/h/[token]` invitation uses a numbered 3-step explainer, Google outline + plain text "Sign in with email and password"; `/login` uses two outline buttons. Same task, two designs. | `_h_not_a_real_token_390_light.png` vs `_login_390_light.png` |
| L7 | L | Dead code: `components/auth/magic-link-form.tsx` (114 lines) is never imported; the live magic-link form is inlined in `login-form.tsx`. | grep |
| L8 | L | "Try the demo" link is 16px tall (below 24px target size, WCAG 2.5.8 has an inline-text exception, but it is the main escape hatch). | report |
| L9 | L | Errors: callback errors use `Alert tone="danger"` above everything (good); field errors set `aria-invalid` but the message is one Alert below all fields, linked only from the email input. Password `aria-describedby` points at the hint only. | `login-form.tsx:162-215` |
| L10 | L | Pending: the submit button text changes and `aria-busy` is set (good); no live region announces "Signing in…"/"Check your inbox" for SR users other than via the Alert. | — |

---

## 6. Theme behaviour (shell)

Files: `lib/theme.ts`, `public/theme-init.js`, `hooks/use-theme.ts`, `components/shared/theme-toggle.tsx`, `app/layout.tsx`
(brand), `components/ui/sonner.tsx` (brand), `components/shared/__tests__/theme.test.ts`.

What works (keep): blocking `<script src="/theme-init.js">` before paint (no flash for a saved choice, verified);
`useSyncExternalStore` + MutationObserver keeps every toggle and the toaster in sync; cross-tab sync via `storage`;
transitions frozen during a switch; icon chosen by CSS so it is right before hydration; storage failures fall back
safely; tests run the init script in a VM sandbox and keep `public/theme-init.js` byte-identical to the source.

| # | Sev | Finding | Evidence |
|---|---|---|---|
| T1 | **H** | **The OS preference is ignored.** Only an explicit `"dark"` in localStorage switches; a visitor whose system is dark gets a cream page (verified with `prefers-color-scheme: dark` emulation: no `dark` class). There is no "System" option, so a user can never return to "follow my OS" once they toggle. | `lib/theme.ts:27-29`; `inter.json.systemDark` |
| T2 | M | `viewport.colorScheme: "light"` and a single light `themeColor` are emitted for everyone; the dark theme-color is patched on `DOMContentLoaded`. With a system mode these should be media-query pairs (`themeColor: [{media, color}]`, `colorScheme: "light dark"`), which Next 16 supports, so the browser chrome and canvas are right before any script. | `app/layout.tsx:20-24` |
| T3 | M | Dark surfaces have almost no separation: card on background 1.08:1, sidebar on background 1.04:1, border on card 1.25:1 (light: 1.10, 1.05, 1.31). Cards are defined by a faint border only; dark mode reads as one flat navy plane. A dense dashboard needs more surface steps. (Tokens are brand's; recorded here for Checkpoint A.) | `globals.css:241-301` |
| T4 | L | The 404 page (`app/not-found.tsx`) and `global-error.tsx` have no theme toggle; fine, but `global-error` re-applies the stored theme only after hydration (one light frame for dark users, root-failure only). | — |
| T5 | L | Theme choice is per device (localStorage). Documented and intentional; with an account-level preference it could follow the user, but that needs a DB column (off limits). Keep device-local. | `lib/theme.ts:4` |

---

## 7. Errors, 404, shared-link frame (shell)

| # | Sev | Finding | Evidence |
|---|---|---|---|
| E1 | **H** | **"Try again" calls `reset()`, which in Next 16 re-renders without re-fetching.** Next 16 error boundaries receive `retry()` ("re-fetch and re-render the error boundary's children"); `reset()` is the special case. For a failed server read (the usual cause in the workspace) "Try again" will re-render the same failure. Also `error` should be typed `unknown` and narrowed. | `components/shared/route-error.tsx` (brand), `app/(workspace)/error.tsx`, `app/(auth)/error.tsx`; `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/error.md` §retry/§reset |
| E2 | M | 404 has no `metadata` → tab title "Baton — Source-backed knowledge handovers" (verified). Next 16 supports `metadata` in `app/not-found.tsx`. | `app/not-found.tsx`; docs `not-found.md` §Metadata |
| E3 | M | 404 always offers "Go to your dashboard" as primary, even to a signed-out visitor who followed a dead public link (it then bounces to login). The logo is not a link. | `app/not-found.tsx:15-21` |
| E4 | M | Workspace error boundary renders inside the shell (good) but loses `PageContainer` gutters (own `max-w-3xl` wrapper). Handover sub-routes have no closer boundary: an error in review replaces the handover header and tabs too. | `route-error.tsx:28`; no `handover/[id]/error.tsx` (handover) |
| E5 | L | `global-error.tsx` hand-styles its buttons with copied class strings (can't import the router-dependent primitives safely; acceptable, but they will drift from `Button`). | `app/global-error.tsx:31-48` |
| E6 | L | `SharedLinkShell`: logo is not a link (deliberate for tokens?), "Private link shared with you" pill is good; header uses `max-w-6xl` while token pages are narrow. | `shared-link-shell.tsx` |

---

## 8. Responsive summary (390 / 1024 / 1440)

- No horizontal overflow on any product route at any width (verified). `/design/b` overflows 6px at 390 (lab, lead).
- 390: dashboard header + preview banner push the first item below the fold (D14); draft rows stack well; cards
  single-column; sidebar → top bar + drawer (works, S5). Login card fits; email panel makes it ~720px tall.
- 1024: sidebar (240px) + 2-column grid; card titles wrap to 2 lines ("Treasurer handover, Robotics Society 2026–27").
  Review at 1024 (handover) is three narrow panes.
- 1440: 3-column grid ends at `max-w-6xl` (1152px content) with ~150px dead margin on the right of a 1200px main area.
- Touch targets under 24px (report): preview banner links (20px, preview-only), "Try the demo" (16px), inline title
  links in draft rows (19px, but the row has a 40px Continue button), account purge checkboxes (14px).

## 9. Light/dark summary
Dark is a designed navy palette (not inverted) and is consistent across routes, but (T3) surfaces are too close,
the readiness track disappears (D5), the "Acknowledged" badge is a solid ink pill while every other state badge is tinted
(`handover/labels.ts` tone via `handover/badges.tsx`, handover), and the auth glow is a gradient. No
component was found hard-coding a light-only colour in my areas.

---

## 10. Cross-cutting flags for other agents (messaged)

**handover**
- H-1 `HandoverNav` (`components/handover/handover-nav.tsx`) shows all five tabs to every role and state
  (Published before any publish, Processing/Gaps/Settings to incoming members); at 390 the tab row scrolls with the
  last tab cut ("Publish…", `_preview_published_390_light.png`) and no scroll affordance. Active match is exact
  (`pathname === target`).
- H-2 No `app/(workspace)/handover/[id]/error.tsx`: a failure in one tab replaces the handover header and tabs; the
  workspace boundary's "Try again" uses `reset()` (E1).
- H-3 Published view repeats the title (layout `h1` + document `h2` with the same text) and shows the header's
  "In review" state badge above a published document (`/preview/published`).
- H-4 Handover layout hard-codes `max-w-[90rem]` gutters instead of `PageContainer` (S10); I will expose a shared
  "full-bleed band" helper so the header band and content align.
- H-5 `DRAFT_STEPS` in `components/dashboard/draft-row.tsx` duplicates wizard step names; I'd like a single exported
  list from `components/wizard/draft-state.ts` (or `components/shared/steps.ts`).
- H-6 `/h/[token]` invitation sign-in differs from `/login` (L6). Propose we share one `SignInOptions` block (mine, in
  `components/auth/`) that both use.
- H-7 "Acknowledged" badge style differs from the other state badges (`components/handover/badges.tsx`).

**brand**
- B-1 `components/shared/route-error.tsx`: switch to Next 16 `retry()` and `error: unknown` (E1) — or hand it to me.
- B-2 Dark surface separation (T3) and the progress track contrast (D5).
- B-3 `app/layout.tsx`: viewport `colorScheme`/`themeColor` need media-query pairs for a System mode (T2); the
  theme bootstrap script stays mine (`lib/theme.ts`, `public/theme-init.js`).
- B-4 `AccountMenu`/`HeaderAccount` (public header) and the workspace identity block should be one component.
- B-5 Mobile header translucency (S6) and the auth radial glow (L5) conflict with D2.

**demo**
- `/demo` renders the review workspace and incoming view outside any shell; if the demo wants to show "the app", it
  should reuse `AppShell` in a demo mode (no sign-out, no account) rather than a look-alike. I will keep `AppShell`
  props-driven so that is possible.

**lead**
- `/design/b` (lab) has no `<main>` landmark and overflows 6px at 390; dev-only, low priority.
- `config/navigation.ts` and `lib/routes.ts` are not in anyone's ownership list; I need to edit both (nav model,
  `routes.accountPassword`). Requesting ownership of `config/navigation.ts` and agreement for an additive edit to
  `lib/routes.ts`.
