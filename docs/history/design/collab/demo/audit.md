# Demo audit (Phase A)

Agent `demo`, 2026-11-15. Baseline: `ui3/agent4-demo` at `fc5651a` (same as production `c781620` for these files).
I checked every claim below against the code. Screenshots and the captured page text are in
`.claude/ui3/shots/demo/` (git-ignored): `01-demo-top-1440.png`, `02-demo-full-1440.png`, `03-demo-incoming-1440.png`,
`04-demo-390.png`, `demo-review.json`, `demo-incoming.json`. The page logged no console errors.

## 1. How the demo is wired today

| Piece | File | What it does |
|---|---|---|
| Route | `app/(marketing)/demo/page.tsx` | A server component. It shows the header copy and three "look for" tips, then `DemoContent` inside `Suspense`. |
| Data | same file, `DemoContent` | `loadReview(createMockQueries(PROFILES.arjun.id), CODECELL_ID)`, plus `createMockQueries(PROFILES.neha.id).getPublishedHandover(CODECELL_ID)`. The review is read as Arjun (reviewer) and the published handover as Neha (incoming). |
| Mock store | `lib/mocks/store.ts` | A server-side, in-memory `globalThis.__batonMockStore` seeded from `lib/mocks/fixtures/*`. Every visitor shares it. `createMockQueries` calls `connection()`, so the page renders on each request. |
| Fixture | `lib/mocks/fixtures/codecell.ts`, `profiles.ts` | The CodeCell handover: 5 sources, 24 points, 4 gap questions, 5 tokens, and a v1 publication built at seed time from `CODECELL_V1_POINT_NUMBERS`. |
| Tabs | `components/marketing/demo-tabs.tsx` | A client component with Base UI Tabs: "Review workspace" and "Incoming handover". |
| Review UI | `components/review/review-workspace.tsx` | The real product component with `readOnly`, `readOnlyReason="Demo mode: review actions are turned off."`, `gapsHref={null}` and `publishedHref={null}`. |
| Incoming UI | `components/published/published-handover-view.tsx` | The real component with `preview`. The acknowledgement area shows "In the real handover, the incoming member confirms here…". |
| Loading | `app/(marketing)/demo/loading.tsx` | `PageContainer width="wide"` + `WorkspaceSkeleton`. The page itself does not use `PageContainer` (it has its own `max-w-[90rem]`), so the skeleton and the page differ in width and padding. |

What is read-only and why:
- `ReviewWorkspace` with `readOnly` hides the approve, edit, reject, resolve, reopen and "Ask in Gap Interview" buttons, the
  evidence exclude and restore controls, the access selector, "Add a point" and "Fill with sample data". `act()` returns early,
  so A, E and R do nothing. Only J, K, the filters and the details sheet work.
- `PublishedHandoverView` with `preview` replaces the acknowledgement form with explanatory text. The first-week checkboxes
  still work and save to `localStorage` under `baton:first-week:<publicationId>` for good. No reset clears them.
- No server action can fire today, but only because of the read-only flags. `review-workspace.tsx`, `add-point-dialog.tsx`
  and `published-handover-view.tsx` import the real `@/lib/actions/*` server functions (Supabase-backed, not mocks), so the
  public demo's client bundle holds live action references. Nothing in the code structure keeps the demo away from them.

## 2. Two CodeCell stories that contradict each other

There are two separate synthetic CodeCell datasets. They share names and contradict each other. The
`lib/prototype/sample-data/codecell.ts` header claims it is "the same cast as the read-only /demo". It is not.

| Fact | `/demo` (lib/mocks/fixtures/codecell.ts) | Prototype samples (lib/prototype/sample-data/codecell.ts) |
|---|---|---|
| Who is leaving | **Priya Raman** hands over to Neha (page copy, `description`, member roles) | **Kabir Shah** hands over to Neha (chat: "Neha is taking over as technical lead") |
| Lead brief for UI3 | n/a | Says Kabir → Neha |
| Sponsor owner | Kabir ("Kabir is POC for all sponsors") | Priya ("Priya is responsible for the sponsor relationship") |
| DevForge format | Two daytime days. The 24-hour format was **abandoned** after a 14–3 vote | "24-hour hackathon instead of 36 hours" |
| Sponsor and contact | Unnamed "DevForge title sponsor", contact "Meera" | "DevForge Labs" (the same name as the hackathon), contact "Ms. Farah Khan" |
| Faulty projector | Lab 3, overheats after 90 minutes | Lab 2, disconnects when a laptop is plugged in |
| Domain | `codecell.dev` (a plausible real domain) expires 30 Nov | `codecell.example.org` renews 12 January |
| Judging rubric | Unassigned, no date | Arjun, due 25 Nov 2026 |
| Email pattern | `name@example.edu` | `@example.org` (the pattern in the brief) |
| Chat timeline | Jan–Oct 2026, about 4,800 messages | 21 lines over 13–14 Nov 2026. The group is "created" the day before, and every line is a complete, extractable sentence ("We decided to…"), so it reads like a script, not a chat |

A visitor who uses "Use sample data" in the wizard after viewing `/demo` sees a different club with the same people.

## 3. Inconsistencies inside the `/demo` fixture

1. **The upload predates the content.** All sources record consent on 20 Sep 2026 and raw deletion at 07:15 that day
   (`src()` defaults). Yet the core chat runs to 28 Oct, the leads chat to 21 Oct, and `infra-notes.md` is dated 5 Oct.
   An export uploaded on 20 Sep cannot contain October messages.
2. **v1 (published 2 Oct) quotes messages written after 2 Oct.** The v1 snapshot is built at seed time from the current
   evidence. So Neha's 2 Oct version shows quotes dated after its own publication: point 1 (Kabir, 12 Oct), point 5 (14 Oct),
   point 9 ("domain expires 30 nov!!", 21 Oct), point 11 (14 Oct), point 13 (3 Oct) and point 20 (10 Oct).
3. **Approvals predate their evidence.** Point 1 was approved on 1 Oct, but one of its quotes is from 12 Oct. Point 20 was
   approved on 1 Oct with a 10 Oct quote.
4. **The page doesn't explain its state.** The review tab shows `in_review`, 33% readiness and 16 points to review. The
   incoming tab shows "Version 1 · published 2 Oct". Nothing tells the visitor that a revision is in progress after v1, and
   v1 contains points that are pending again (3, 7, 9, 11, 13, 18, 21).
5. **The task owner is the person leaving.** v1 tells Neha "Renew the codecell.dev domain · Assignee Priya Raman · due
   30 Nov", and her first-week list says the same. The handover never moves the task to anyone.
6. **The mitigation is already too late.** Point 13 says "Pair-deploy with Neha before handover", but the handover was
   published on 2 Oct.
7. **A Gap Interview answer comes from the wrong person.** Gap question 3 was answered by Priya, the creator, through the
   public contributor token (`viaToken: CODECELL_GAP_TOKEN`). A creator answers in the app. The Gap Interview link is meant
   for people outside the review.
8. **The story leans on credentials.** The core chat's masking counts include `password: 3, api_key: 2, secret: 1`, and the
   quotes rely on credential situations: "master password is [PASSWORD]" and "Key [API_KEY] rotated Oct". Masking works, but
   the brief and the prototype file both rule out credential-like content. The token style is also mixed: numbered `[UPI_1]`
   next to unnumbered `[PASSWORD]`. The masker does that by design, but it looks inconsistent in a demo.
9. **A real-looking domain.** `codecell.dev` and the "Bitwarden" vault names point at real-looking services. Use an
   `example.org` domain and a generic "club password manager".
10. **Fine, but noisy.** The "Possibly outdated" badge on the Lab 3 projector point (July evidence, `evidenceAsOf` 28 Oct) is
    deliberate, but it reaches Neha with no explanation of what "outdated" means for a workaround.

## 4. Interactions: dead, misleading or missing

- **Missing journey steps.** Of the six steps the user asked for, the demo shows only parts of two: the review (read-only)
  and the incoming view (read-only). There is no sources or conversations step (no masking before and after, no consent, no
  exclusion), no AI-drafting or processing step, no corrections (approve, edit, resolve a conflict, confirm an inferred point,
  reject, exclude evidence), no publish, no acknowledgement, no Gap Interview from the contributor's side and no gap-answer
  review.
- **Nothing a visitor does changes anything.** Approve, edit and reject are hidden, so the visitor learns the review model
  only from labels. The A, E and R shortcuts fail silently; the shortcuts dialog says so in small print.
- **"Switch to Incoming handover to see what Neha receives"** shows a version older than the review on screen (see 3.4).
- **First-week ticks persist on the public demo** (`localStorage`) with no reset. A repeat visitor sees old ticks.
- **"Start your own handover"** goes to `/handover/new`, which needs sign-in. That is fine, but it is the only call to action
  and it sits above the demo. The page never invites the visitor to try the review.
- **Mobile (390).** The tabs and the review stack work, but the page opens with about 700px of copy before the demo, and the
  three-column review collapses into a long list with readiness behind a `<details>`. There is no step-by-step path through it.
- **No "this is a preview" labelling** beyond "Public demo · read only" and "Everyone and everything here is fictional". The
  incoming view reuses the reviewer-preview acknowledgement text, which says "In the real handover…" but doesn't say why.

## 5. Risks found in components the demo would reuse (reported to `handover`, accepted)

- `components/processing/processing-view.tsx`: while a run is active, it calls `router.refresh()` and the **real**
  `continueProcessing` server action every `NUDGE_MS`. `/preview/processing?state=running` therefore already calls a real
  action on the dev server. The demo must never mount it with an active run. `handover` will split out a pure
  `ProcessingStatusView` and fix the preview.
- `components/wizard/new-handover-wizard.tsx` exports `DetailsStep`, `MatchesSection`, `STEPS` and `StepHeading` from a module
  that imports seven server actions. `components/preview/wizard-preview.tsx` imports them, so its bundle holds the actions.
- `lib/mocks/actions.ts` is `"use server"` and mutates the shared server store. No runtime code uses it (only
  `lib/actions/__tests__/boundaries.test.ts` reads it). The demo must not use it from the client: every visitor would write
  to the same server memory.
- `lib/mocks/queries.ts` imports `connection` from `next/server`, so client code cannot import its pure DTO builders
  (`toHandoverSummary`, the published-handover and gap-interview assembly). `derive.ts`, `builders.ts`, `ids.ts` and
  `exclusions.ts` are pure and can be reused on the client.
- `components/gap-interview/**` is not listed in `agent-ownership.md`. `handover` confirmed it is theirs and asked `main` to
  add it.

## 6. What is worth keeping

- The real `ReviewWorkspace`, `PointCard`, `EvidenceQuote`, `PointDetailPanel`, `ReadinessPanel`, `PublishedHandoverView`
  and the first-week builder already show the product's honest labels. Reusing them is the right call.
- `lib/mocks/derive.ts` (status, readiness, snapshot) uses the canonical `lib/contracts/status.ts`. If the demo's client
  engine reuses it, the labels match production.
- The fixture already covers every evidence status, a conflict, a stale edit, excluded evidence, restricted sources and
  gap questions. The scenario keeps that coverage and fixes the timeline and the cast.
