# Plan: handover screens (UI3, Phase C)

Owner: `handover`. Inputs: `audit.md` (finding IDs), `research.md` (patterns), D1–D7. **No colours, fonts or
component treatments are chosen here.** Every visual need is written as a request to `brand` (§10). Backend,
schema, auth, `lib/actions`, `lib/db` and `lib/contracts` are untouched. Every screen uses the existing actions and
queries as they are; the one new server entry point is a thin read wrapper (§2.3), which needs `main`'s approval.

Principle: **Baton's output is a document with provenance.** The review is an editor's desk, the published
handover is a dossier, and every claim carries its evidence slip. Hierarchy comes from composition and type, not
from boxing everything (X-15).

---

## 1. Information architecture of the handover report

### 1.1 Shared document model (review and published use the same order)

```
Handover dossier
├─ Cover: team · role · title · version · published by/date · reader ("reading as Neha, incoming")
├─ Summary (publisher's note, optional)
├─ At a glance: fixed tiles in a fixed order (Decisions · Ownership · Open work · Open questions); 0 is shown, never dropped (PB-1)
├─ First 7 days (published only; a checklist built from open work, owners, access)
├─ Sections (HANDOVER_SECTIONS order, unchanged):
│    Decisions · Ownership · Open work (tasks, next actions, blockers) · Risks & dependencies · Contacts · Accounts & access
│    └─ Point: stamp (evidence state) · category · heading · statement · key facts (summary list)
│             · evidence slips (numbered ①②…) · notes (inferred confirmation / conflict resolution as a signed note)
├─ Open questions (known gaps): a separate register, never mixed with facts
├─ Legend: what the four stamps mean (statusConfig descriptions)
└─ Acknowledgement: a signature block plus receipt
```

The groupings stay exactly as `HANDOVER_SECTIONS` defines them, so `demo`, the dashboard and the tests keep their
vocabulary. Owners and blockers are not new sections. They show up as **key facts** (assignee, due, status) and as
the **Open work summary line** ("5 to pick up · 2 unassigned · 1 without a date"), which already exists.

### 1.2 Published route frame (with `shell`, H-3)
- Inside the workspace, the layout `h1` is the title, so `PublishedHandoverView` takes `showCover?: boolean`
  (default true for `/demo`) and drops its duplicate `h2` title. The header shows the **publication version**, not
  the lifecycle badge.
- Margin evidence (research §3) at ≥1280 px: a three-column document grid (TOC · text · margin), where the slips for
  the focused point sit in the margin. Below 1280, slips use inline disclosure (as today). The TOC gets
  scroll-spy and an `aria-current="location"` item (PB-2).
- Print stylesheet (`@media print`): hide nav, TOC, toggles and ack controls; expand all evidence; include the
  legend, version and ack receipt (PB-5).

## 2. Evidence and source-preview pattern

### 2.1 Evidence slip (one component, five variants)
Replaces the visual layer of `EvidenceQuote` while keeping its props and file path (it4 test, brand's
`product-preview.tsx` import):

| Part | Content (existing data) |
|---|---|
| Marker | ①②③ evidence number within the point (stable: `evidence` order is `sentAt DESC`) |
| Quote | `quote` through `MaskedText`; clamped to 3 lines **only in lists**, with an explicit "Show full quote" toggle (`aria-expanded`); never clamped in dialogs or the source viewer (R-3) |
| Metadata line | `authorLabel` · `sentAt` · `sourceTitle` · `location` (p. / heading / line), as a single line of metadata that wraps cleanly (no orphaned separators, R-11) |
| Verification | "Found word for word · supports the point" (`quoteCheck` + `supportVerdict`); PI-11 guard variant; stale-verdict note |
| Access | `AccessBadge` when not Everyone |
| Action | **"View in source"** (review roles, non-testimony): opens the source viewer (§2.2) |

Variants: `supports`, `contradicts`, `excluded` (muted, with reason), `testimony` (Gap Interview answer, author and
date, no verification line), `redacted` (published `{ redacted: true }`, a notice only).

### 2.2 Source viewer (closes X-3, R-4)
- **Where**: at ≥1280 it replaces the detail pane's lower half as a stacked panel ("Source" tab beside "Point"); at
  <1280 it is a right sheet over the review; on mobile, a full-height sheet. Esc closes it and focus returns to the
  "View in source" button.
- **What**: `SourceMessageContext`: header (source title, kind, access, "raw file deleted on …" from
  `SourceSummary`), then the messages (`seq`, author, time, body through `MaskedText`), with the quoted message
  marked (`isQuoted`) and scrolled into view. "Show earlier" and "Show later" load up to `MESSAGE_CONTEXT_MAX` (10)
  each when `hasMoreBefore` or `hasMoreAfter` is true. For documents: page, heading and line from `location`.
- **States**: loading (skeleton lines), `available: false` ("The original message is no longer stored. The quote
  above is what was checked."), `not_found` for testimony (the action is hidden), error (inline retry), and
  "excluded or erased messages simply don't appear" explained once in the footer.
- **Data path**: a read-only server function `app/(workspace)/handover/[id]/review/source-context.ts`
  (`"use server"`, `loadSourceContext(pointEvidenceId, window)` → `getQueries().getSourceMessageContext(...)`).
  It sits in my folder, calls the read facade only, and RLS applies, so no `lib/**` change. **Needs `main`'s OK**
  (new server entry point, read-only). The mock implementation already exists (`lib/mocks/queries.ts`), so the
  preview and demo get it for free through the view seam (§9).

### 2.3 Masked text and redaction (X-6; a request to brand for the look)
- `MaskedText` keeps its contract (the it4 test depends on it). The changes: the rendered token gets an accessible
  name ("masked phone number 1") through visually hidden text, the raw token stays visible as monospace type
  label, and the explanation is reachable on keyboard and touch (a toggletip, not a `title`).
- `[EXCLUDED_PARTICIPANT]` keeps its distinct "excluded participant" treatment (never a mask).
- A one-line key on first use per page: "Masked values such as phone numbers are replaced before anything is stored."

## 3. Review workspace and conflict UX

### 3.1 Layout (R-1, R-2)
```
≥1440:  [sections rail 13rem] [point list (flexible, widest)] [decision pane 26rem: point · evidence · source]
1024–1439: [point list] [decision pane]; the sections rail becomes a collapsible "Sections" drawer in the toolbar
<1024: point list; selecting opens the decision pane as a full sheet with the decision bar pinned at its bottom
```
- The **point list becomes compact rows**: stamp · category · title · lead quote (1 line) · review signature ·
  evidence count. No per-row action buttons. Conflict and gap rows get a recognisable edge (brand). A
  "Comfortable / Compact" density toggle (stored per viewer in localStorage).
- The **decision pane** holds everything about the selected point. At the top, a **decision bar** that is always
  in the same place: Approve (label adapts: Confirm & approve / Resolve & approve / Approve as gap), Edit, Reject,
  Resolve (conflicts), Ask in Gap Interview (gaps), Undo (decided). A counter, "Point 3 of 14 to review", sits
  inside it (research: Linear).
- `PointCard` stays as a component (it4 test imports it) but becomes the row and pane renderer. Its exported
  props stay compatible for `demo`.

### 3.2 Readiness and publish gates (X-1, X-2, R-6, R-7, R-8, R-14)
- The readiness rail becomes a **task list of gates** (research: GOV.UK task list): each `READINESS_BLOCKERS` kind
  is a row with a count and a **working "Go there"** action:
  - pending_points / unconfirmed_inferred / unresolved_conflicts / open_required_gaps → filter plus select the first matching point (`pointIds` from the blocker)
  - privacy_review_required → filter to held points and open the privacy review (§3.4)
  - no_incoming_recipient → link to `settings#members` (invite form focused)
  - no_approved_points → filter "To review"
  - processing_incomplete → link to processing
- The score is shown as small secondary text ("10 of 24 decided"), not a ring as the hero (R-14). Brand decides
  whether any visual stays.
- **Publish lives in the page header action area on every breakpoint** (never inside a collapsed `<details>`).
  It is disabled with the gate list as its description while blocked.
- **Publish review dialog** (research: GitHub "submit review", GOV.UK check answers): what will be published
  (approved n by section, known gaps n, rejected n left out, inferred n shown as inferred), who is asked to
  acknowledge (incoming members and pending invites, from `listMembers`, which the review page will also load), the
  version number (current publication version + 1 when known, otherwise "a new version"), and the optional summary.
  On success: **navigate to `/published`** with a persistent "Published version N on <date>" notice, not just a
  toast (X-5).

### 3.3 Conflict ledger (R-3)
- In the pane: two columns **Supports | Contradicts**, each newest first, full quotes, every slip with "View in
  source". On narrow widths they stack, with sticky column labels.
- The Resolve flow is an inline composer in the pane (not a modal over clamped quotes): "What is true now?"
  (resolution note) plus an optional "Exclude the outdated side" shortcut that opens the existing
  `exclude_evidence` reason step. The resolved conflict collapses to a signed note ("Resolved by Arjun, 12 Mar:
  …"), and the ledger stays expandable.
- Approve on an unresolved conflict jumps to the composer instead of opening a separate dialog (same action:
  `approve` + `resolutionNote`).

### 3.4 Privacy review (new UI on the existing action, X-1, R-5)
- Points with `privacyReview === "required"` get a **hold** marker in the list and a banner in the pane:
  "Some evidence was removed at a participant's request on <privacyReviewFlaggedAt>. Review what remains before
  publishing." (reason from `privacyReviewReason`).
- "Review privacy hold" opens a focused flow listing `privacySurfaces`: point, revisions, review notes, evidence, gap
  questions and answers, with each surface's current `fields`. The point gets a decision from
  `PRIVACY_REVIEW_DECISIONS`, and each other surface gets one from `PRIVACY_SURFACE_DECISIONS` (redact → a
  replacement text field). It submits `resolve_privacy_review` with `surfacesDigest = privacyReviewDigest` and
  `expectedRevisionId`. A `conflict` (digest changed) → "This hold changed while you were reviewing it. Reload it."
  The withdraw rule (every revision must be removed) is enforced in the form before submit, with the
  server's message as backup.
- Exact enum values and copy will be checked against `lib/contracts/enums.ts` and `schemas.ts` at implementation
  time. If the decision semantics are unclear, I ask `main` before building rather than guessing.

### 3.5 Other review changes
- Edit (R-13, R-16): inline in the pane, with "What changed" showing the previous revision's title and statement
  as a word-level difference (computed client-side from `revisions`). Array attributes become a token input.
  Errors are linked.
- Ask in Gap Interview (R-12): a small composer prefilled with today's generated wording and priority, editable,
  then `createGapQuestion`. The pane then shows "In the Gap Interview · waiting for an answer" with a link to that
  question (`/gaps#q-<id>`).
- Deep links (X-9): `?point=<id>` selects and scrolls to a point on load (it never auto-scrolls without it).
  Gaps, readiness and the published "view in review" link use it.
- Errors (X-4): `loadReview` returns `{ kind: "error" }` when `listPoints` fails and reports missing details as
  `partial`. The page renders an error state with Retry, or a "Some points couldn't be loaded" alert.
- Stale write: on a `conflict` from `reviewPoint` (expected revision mismatch), show "This point changed since you
  opened it" with Reload in the pane, not a toast.
- Filters (R-10): one toolbar, with Section (select or drawer), Evidence (4 stamps), Review (To review / Approved /
  Rejected), "Holds" (privacy), and counts that agree with the gate list. The duplicate Conflicts and Gaps rail
  items go.

## 4. Wizard flow

Steps (canonical list exported from `components/wizard/steps.ts` for `shell`'s dashboard, H-5):

1. **Details**: unchanged fields. Invite links get the same copy field as Settings, with a "shown once" notice (W-3).
   After the draft is created, an "Invite the incoming member" link opens a lightweight invite dialog using
   `inviteMember` (allowed on a draft; the action already runs right after `createHandover` today). This removes
   the "only after processing" dead end (W-4). If `inviteMember` refuses on a draft, I fall back to today's copy.
2. **Privacy & consent**: the provider disclosure becomes its own clearly separated notice above the three
   statements. The statement version moves to a quiet "Statement v…" metadata line (W-7).
3. **Sources**: one combined drop area with two clear inputs (chats / documents). It is compact when files exist,
   so the file list stays above the fold (W-9). Per-file states unchanged. "Cancel" for an in-flight upload aborts
   locally and calls `removeSource` once the id exists.
4. **Scope & access**: per source, the access level as a compact segmented choice; "Apply this level to all
   sources"; conversations with Select all / none, a count, and a scrollable list after 8; people as a list with
   message counts, where leaving someone out asks for a one-line confirmation because it is permanent (W-8).
   The masking table shows only the kinds found, with "none found" for the rest collapsed.
5. **Check and start** (new, W-1 and W-2): a GOV.UK-style check-answers summary (details, sources, dates kept,
   conversations and people left out, access per source, masking counts, consent statement), each with "Change"
   → that step. Participant exclusions and identity-match questions are saved and answered **on leaving step 4**,
   so step 5 has a single button, "Start processing", that does exactly that.

- The Stepper becomes a **status stepper**: each step shows done, needs attention or locked, with the locked
  reason on the step itself (W-5). The mobile summary is "Step 3 of 5 · Sources · 1 file needs attention".
- "Discard draft" moves to a draft menu in the header, away from the save status (W-6).
- No glass: a solid footer surface (X-11, W-11). The focus flag becomes a per-instance ref (W-12).
- Time zone: the preview shows "Dates shown in <zone>" (W-10).

## 5. Processing
- A **pure `ProcessingStatusView`** (demo seam) plus a connected `ProcessingView` that polls and nudges. The preview
  uses the pure view, so it never calls `continueProcessing` (X-12, P-7).
- Role-aware copy for people who can't start (P-2). Confirm before cancel, explaining that the sources stay and the
  run can be restarted (P-3).
- The failure alert de-duplicates its title and reason (P-1). "Queued for more than N minutes" hint.
- Zero points: CTA "Add a point yourself" (opens the review with Add a point; the review empty state keeps the
  Add a point button when the state is `in_review`) and "Add or change sources" (draft) (P-6).
- Brand decides how stages read as a transformation (masking → extraction → verification): motion with a
  reduced-motion equivalent (D6). I need only a stage-row component with five states.

## 6. Gaps manager and Gap Interview

**Manager** (`/handover/[id]/gaps`): counts become a quiet header line, not big numbers (G-1). There are three
registers, "Answers to review", "Open" and "Closed", each question a document-style entry. `privacyHeld` questions
and answers are shown as held, with Accept disabled and an explanation (G-2). Accept previews where the answer
lands ("Becomes evidence on: <point>"). Reject asks for an optional note, client-side only, since the action has no
reason field, so it is copy only: "The question opens again" (G-4). A panel lists existing interview links from
`listAccessTokens({ purpose: "gap_interview" })` (the page adds that read for review roles) with status and expiry
(G-5). A notice when published: "This handover is published. Start a revision to change gaps." (G-6). Labels unified
(G-7). Field errors shown and linked (G-8). Each question has an `id` anchor for deep links.

**Gap Interview** (`/g/[token]`, no account), research §5:
- Intro: what this is, who it's for (the handover title), how answers are used ("A reviewer reads every answer
  before it is added, and your name is shown with it"), the privacy reassurance, and the name field.
- One question per screen. The question is the heading; "Question 2 of 5" as text plus a bar. Cmd/Ctrl+Enter =
  Next. No `autoFocus` on touch devices: focus the heading and let the user tap (I-3). "Required" wording to match
  the manager (I-4).
- Check answers, then Send, then Done (as today), plus a **"Clear my answers from this device"** link on every
  screen and an explicit line: "Your unsent answers are kept on this device until you send them." (I-1).
- `draftStorageKey` prop (demo seam).
- Invalid link: explain the three causes (expired, turned off, all answered) and that only the sender can make a
  new one (I-5).

## 7. Publish, published report, acknowledge, invitation
- Publish: §3.2.
- Published (§1): fixed at-a-glance tiles, TOC scroll-spy, margin evidence, legend, print, `textRedacted` notice
  ("Part of this point was redacted at a participant's request", PB-6), reduced-motion progress (PB-8),
  "Not published yet" with a link to the review for review roles (PB-9).
- **Acknowledgement as a signature block** (PB-4): the statement, the checkbox, the "Acknowledge" button, then a
  **receipt** in place: "Acknowledged by Neha · version 2 · 15 Nov 2026 · statement 2026-11-ack-v1". Non-incoming
  roles see who is asked to acknowledge (from `listMembers().ackRequired`). Whether they have done so is a data gap,
  so it's shown as "asked", not "done". Raised with `main` as a possible additive read later; not built now.
- Invitation `/h/[token]`: the visible title becomes the h1 (H-1). Honest copy about why the handover isn't named
  yet (H-2). It uses `shell`'s shared `SignInOptions` (H-3, shell H-6), keeping the invite-bound actions.
- `handover/[id]/error.tsx` keeps the header and tabs when one tab fails (shell H-2).
- Settings: confirm clearance changes with a small dialog naming the effect (S-1); show the `ErasureReport`
  after an erase, including same-name participants elsewhere (S-2); visible labels on the invite form (S-3);
  "Start a revision" also reachable from the review's read-only notice (S-4); grouped into Lifecycle, People &
  access, Sources & privacy, Danger (S-5).

## 8. States, accessibility and tests

**States matrix** (each screen designs all of them; previews added for each, X-13):

| Screen | Empty | Loading | Error | Partial | Success | Read-only / role |
|---|---|---|---|---|---|---|
| Wizard | no files | skeleton, per-file phases | per file, autosave, start | some files failed | started → processing | resumed draft, creator locked fields |
| Processing | no sources | skeleton, running | run failed, source failed | stage partial | complete → review | non-starter copy |
| Review | no points (3), filtered | skeleton | load error + retry | some points missing | decided, advance | processing, published, demo |
| Source viewer | — | lines | error + retry | `available:false` | — | testimony hidden |
| Privacy review | — | — | digest conflict | — | resolved | non-creator? (per server) |
| Gaps | none (2) | skeleton | load error | held items | accepted | published, non-review |
| Gap Interview | nothing left | skeleton | invalid link, send failed | some skipped | done | — |
| Published | not yet | document skeleton | error boundary | redacted items | acknowledged receipt | non-incoming |
| Settings | no links/sources | form skeleton | read failed (not "none") | — | toasts plus inline results | non-creator |

**Accessibility**:
- Review shortcuts: keep J/K/A/E/R, add a "Keyboard shortcuts on/off" toggle (persisted per viewer) and only fire
  when focus is in the review region (WCAG 2.1.4). J/K **moves focus** to the selected row, so the selection is
  announced (R-9).
- Skip link "Skip to points" inside the review. The list is a `listbox`-style structure *or* plain list plus buttons
  (to be decided with an axe pass; I lean towards a list plus a button per row, which is simpler and robust).
- Every dialog or sheet returns focus to its trigger; the source viewer is labelled by its source title.
- Errors linked by `aria-describedby` everywhere (X-14). Masked tokens named (X-6). Visible labels (S-3).
- Reduced motion: no slide transitions (keep fades ≤150 ms or none), no width animations without
  `motion-reduce` (PB-8).
- Tap targets ≥40 px at 390 (route-verification G4). The current probe counts 43 smaller targets on review at
  390, mostly key-fact and metadata links; each gets checked.
- Dark mode: no evidence-tint opacity hacks (`/60`). Use the tokens brand provides for each state on each surface.

**Tests to keep** (audit list): all of them, especially `it04-ui-escaping`, which imports `EvidenceQuote`,
`PointCard` and `PublishedHandoverView` from their current paths and checks that those files use `MaskedText`.
I keep the paths and named exports stable.

**Tests to add** (`npm run test:ui` style, node test runner, pure helpers):
- `components/review/__tests__/gates.test.ts`: every `READINESS_BLOCKERS` kind maps to a non-empty action (X-2 regression).
- `components/review/__tests__/privacy-review.test.ts`: the form builder produces exactly one decision per non-point surface, enforces the withdraw rule, and passes the digest (pure builder against `reviewPointInput.safeParse`).
- `components/review/__tests__/source-context.test.ts`: window clamping and the merging of "earlier"/"later" pages without duplicate `seq`.
- `components/review/__tests__/load-review.test.ts`: error versus empty versus partial, using the mock queries with an injected failure.
- `components/review/__tests__/revision-diff.test.ts`: word difference on masked text keeps tokens whole.
- `components/wizard/__tests__/check-summary.test.ts`: summary rows from the draft (exclusions, ranges, access).
- `components/gap-interview/__tests__/draft-storage.test.ts`: key namespacing, clear, null key means no persistence.
- `components/shared`-style static test (I own the files it checks): the demo-facing view modules
  (`*-view.tsx`, `*-actions.ts`) never import `@/lib/actions|db|supabase|ai|pipeline|data` (shared with `demo`).
- Preview guard: new preview routes are covered by the existing `r3-preview-guard` pattern (each page repeats the
  dev-only guard).
- Browser checks (`tests/browser/run.mjs`, run by the lead): add the new preview routes at 1440, 1024 and 390.

## 9. Coordination

**`demo`** (agreed in messages; recorded here):
- View/connected split with action interfaces in action-free files: `components/review/review-actions.ts`
  (`reviewPoint`, `createGapQuestion`, `publishHandover`, `createManualPoint?`, `loadSourceContext?`),
  `components/published/published-actions.ts` (`acknowledgePublication`), `components/gap-interview/gap-interview-actions.ts`
  (`submitGapAnswers`), `components/gaps/gaps-actions.ts` (`createGapQuestion`, `createGapInterviewLink`, `reviewGapAnswer`).
  The signatures are identical to the server actions. Views have no router calls; navigation goes through optional
  callbacks (`onPublished`).
- `ProcessingStatusView` (pure). Wizard steps in action-free modules (`steps.ts`, `details-step.tsx`, `matches-section.tsx`).
- Props: `draftStorageKey` (Gap Interview), `storageNamespace` (first-week ticks), `linkMode: "live" | "demo"`
  (Gaps link dialog), `showCover` (published).
- Stable `data-tour` anchors: `readiness`, `publish`, `point-actions`, `evidence-quote`, `point-detail`,
  `source-viewer`, `ack-form`, `gap-question`, `gap-answer-review`.
- `readOnly` and `preview` props stay until `demo` switches over.
- Order: the seams land **first** in Phase C (they are mostly moves), so `demo` can build on them in parallel.

**`shell`** (agreed in messages): role- and state-aware `HandoverNav` (needs ownership of `config/navigation.ts#handoverNav`,
or I move the tabs into `components/handover/`); `handover/[id]/error.tsx`; no duplicate published title; shell's
band helper in `handover/[id]/layout.tsx`; a canonical `WIZARD_STEPS` export for the dashboard; shared `SignInOptions`
for `/h/[token]`; dashboard deep links into `?draft=&step=` and `/review?point=` stay supported. Shell confirmed:
`PageBand` (`components/layout/page-band.tsx`); the workspace sidebar collapses to a narrow rail, defaulting to the
rail at 1024–1279 px on `/review` and `/processing`, which gives the review list its width back (R-1). Shell has
asked `main` to split `config/navigation.ts` (`handoverNav` to handover).

**`main`**: (1) add `components/gap-interview/**` and `config/navigation.ts` (handover tabs) or `config/status.ts`
to the ownership map; (2) approve the read-only server function for source context (§2.2); (3) note the data gaps
for later (acknowledgement status per member, publication changelog, gap-link expiry on `/g`). None of them block
the plan.

## 10. Requests to `brand` (needs, not choices)

1. **Evidence slip**: a quote surface with a metadata line, verification line, access mark and five variants
   (supports, contradicts, excluded, testimony, redacted), readable for quotes from 1 to 25 lines, in light and dark.
2. **Evidence stamps** for sourced, inferred, conflicting and missing, distinct from **review signatures**
   (approved/rejected by whom and when) and from **system tones** (D5). They must work at small row size and in the
   pane header.
3. **Typed redaction** for mask tokens, plus the separate excluded-participant mark. It must work inline at body,
   quote and heading sizes, in both themes, and in print.
4. **Document layout primitives**: cover block, section heading with count, summary list (key facts), margin
   column, legend, signature block plus receipt.
5. **Dense list row** and **decision bar** (sticky inside a pane) for the review. A two-column ledger for conflicts.
   A hold marker for privacy review.
6. **Sheet/side panel** primitive (right sheet, full-height mobile sheet) with header, scroll body and pinned
   footer.
7. **Status stepper** (done, current, needs attention, locked with reason). **Task-list rows** for gates.
8. **Stage row** (queued, running, succeeded, partial, failed) and a quiet progress bar. Reduced-motion spec.
9. **Toggletip** (keyboard and touch accessible explanation) for stamps, masks and access marks.
10. **Copy-once link field** (read-only URL, Copy, "shown once" note), used in the wizard, Settings and Gaps.
11. Print styles for document surfaces. Dark-mode treatments for every evidence tint on card and paper.
12. Solid sticky footer and header surfaces (no blur).

## 11. Files I will touch (Phase C)

- `app/(workspace)/handover/**`: all pages; new `[id]/error.tsx`, `[id]/review/source-context.ts` (with approval).
- `app/(token)/g/[token]/page.tsx`, `app/(token)/h/[token]/page.tsx` (+ `actions.ts` unchanged).
- `components/review/**`: `review-workspace.tsx` (split into `review-view.tsx` plus the connected wrapper),
  `point-card.tsx`, `point-detail-panel.tsx`, `evidence-quote.tsx` (same path and props), `readiness-panel.tsx`
  (→ gates), `review-dialogs.tsx`, `add-point-dialog.tsx`, `load-review.ts`, new `source-viewer.tsx`,
  `privacy-review.tsx`, `gates.ts`, `revision-diff.ts`, `review-actions.ts`.
- `components/wizard/**`: `new-handover-wizard.tsx` (slimmed), new `steps.ts`, `details-step.tsx`,
  `matches-section.tsx`, `check-step.tsx`, `check-summary.ts`; `consent.tsx`, `sources-step.tsx`, `scope-step.tsx`.
- `components/processing/**`: new `processing-status-view.tsx`; `processing-view.tsx` becomes the wrapper.
- `components/gaps/**`, `components/gap-interview/**` (+ `gap-interview-actions.ts`, `draft-storage.ts`).
- `components/published/**` (+ `published-actions.ts`), `components/settings/**`, `components/handover/**`
  (`handover-nav.tsx`, `handover-header.tsx`, `badges.tsx`, `labels.ts`: additive labels only).
- `app/(preview)/preview/**` (new: gaps, settings, interview, invitation, review states, published states),
  `components/preview/**`.
- Not touched: `components/ui/**`, `components/shared/**` (brand: I request `MaskedText` accessibility changes
  and stamp components from brand, or brand approves me editing `masked-text.tsx`), `components/layout/**`
  (shell), `lib/**`.

## 12. Risks

| Risk | Mitigation |
|---|---|
| Privacy review semantics are complex (surface decisions, digest, withdraw rule) | Build from `schemas.ts` refinements with a pure builder plus tests. Ask `main` if a rule is unclear. Ship behind the existing blocker (no new state). |
| Source viewer needs a new server entry point | Read-only wrapper over the facade, RLS enforced, in my folder. Lead approval first. Fallback: render context server-side per selected point via `?point=` (slower, no new function). |
| Splitting view and connected modules churns files that `demo`, tests and brand import | Keep the paths and named exports of `ReviewWorkspace`, `PublishedHandoverView`, `EvidenceQuote`, `PointCard` and `loadReview`. The split happens behind them. The seams land first, with `demo` reviewing. |
| A wizard step-5 change affects dashboard resume (`resumeStep`, `?step=n`) | Bump `steps.ts`, map old step numbers in `resumeStep` (step 3 → 3), and add a draft-state test. Tell `shell`. |
| `MaskedText` is brand-owned (`components/shared`) but central to my screens | A request in `requests.md`. Brand owns the look, and I supply the accessibility requirement and tests. |
| Dense review rows could hide information that reviewers need | Comfortable density stays the default. The decision pane shows everything, and the row always shows the stamp, signature and evidence count. |
| Design system not approved yet (D3) | Phase C starts only after Checkpoint B. The layout and behaviour work (seams, gates, privacy review, source viewer data path) is token-independent and can go first. |
