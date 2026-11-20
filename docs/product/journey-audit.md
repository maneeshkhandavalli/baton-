# Round 4 · Application journey audit (Worker 02)

Scope: the signed-in application only (the marketing landing is Worker 01's). Audited against the code at
`d7790bd` (Round 4 integration) and, where possible, the dev-only previews (`/preview/*`, synthetic `lib/mocks`
data) and the public `/demo` workspace. The local Supabase stack was down during the audit, so the **real
signed-in journeys could not be walked in a browser** (BLOCKED); every finding below is from the code paths
and the previews, which render the same components.

Legend: **Who** · **Goal** · **Communicates now** · **Confusing / missing** · **Primary action → next** ·
**States**. Findings marked **[fixed]** are resolved in this branch; **[onboarding]** means the new onboarding
system covers it; **[open]** is left for later with a reason.

---

## 1. Creator / lead journey

### 1.1 First visit → sign-in / registration (`/login`)
- **Who:** a student who heard about Baton, or someone following an invitation link.
- **Goal:** get into a workspace.
- **Now:** "Sign in to Baton · Continue with Google, or use your email and password." Account creation is a
  small link under the form. The layout offers the demo ("Want to look around first?").
- **Confusing:** a first-time visitor is told only to *sign in*; nothing says an account can be created here,
  so new users hunt for "Sign up". Someone arriving from an invitation (`?next=/h/…`) is not told that signing
  in brings them back to their invitation. **[fixed]** heading reads "Sign in or create an account", and an
  invitation return path adds "You'll come back to your invitation afterwards."
- **Primary:** Continue with Google / email → `next` or `/dashboard`.
- **States:** errors are inline (Alert), pending labels on buttons; "Check your inbox" success. Good.

### 1.2 Demo entry (`/demo`, `/demo/workspace`)
- **Now:** a per-visitor synthetic workspace with its own guide (`components/demo/demo-guide.ts`).
- **Fine as is.** The signed-in onboarding never duplicates the demo; the dashboard's empty state still links to it.

### 1.3 Dashboard (`/dashboard`)
- **Who:** everyone signed in (creators, reviewers, incoming and lead members).
- **Goal:** which project, where it stands, what needs me, what to do next.
- **Now:** "Your handovers" header with **New handover**; "Up next" (one row per handover, its most urgent
  action); "Drafts to finish"; "Preparing and reviewing"; "Handed over to you". First run: "No handovers yet"
  with three plain steps and **New handover** / **Explore the demo**.
- **Confusing / missing:**
  1. **A first-time user gets no orientation** beyond the empty state, and no persistent sense of the whole
     journey (create → sources → consent/processing → review → resolve → invite → publish).
     **[onboarding]** welcome dialog, role tour and a Getting Started checklist driven by real data.
  2. **Publishing needs an incoming recipient** (`no_incoming_recipient` readiness blocker), but the dashboard
     never said so: a handover whose only blocker was "nobody invited" read "In review" with no action, so the
     creator could not tell why Publish never unlocked. **[fixed]** classify() adds an "Invite" attention item
     ("Publishing needs an incoming person…") linking to Settings → Members, and the status line says so.
  3. **A reviewer who is not the creator was offered "Publish"** as the card CTA once readiness allowed it,
     but only the creator can publish (`review-workspace.tsx` `canPublishNow`). **[fixed]** non-creators see
     "Ready · the creator publishes" and "Open review".
  4. Metrics are not overwhelming (cards show one status line and at most one meter). No change.
- **Primary:** the first "Up next" row, else **New handover**.
- **States:** skeleton (`DashboardBodySkeleton`), load error (EmptyState tone=error, "Nothing you saved is
  lost"), empty (FirstRun). Good.

### 1.4 New handover wizard (`/handover/new`)
- **Who:** the creator (outgoing member, or someone setting it up for them).
- **Goal:** describe the handover, consent, add sources, scope what Baton reads, start processing.
- **Now:** four-step stepper (Details · Consent · Sources · Scope), autosave indicator, sticky Back/Continue
  footer with the reason the button is disabled ("Tick every statement…").
- **What information is needed:** title, team, optional role and description, "Are you the person leaving?"
  (decides the creator's role), optional invitations, consent statements, files (WhatsApp exports without
  media, documents; 10 files × 25 MB), per-chat date range / exclusions / access level.
- **Confusing / missing:** "consent" and "access level" are explained in step copy but there was no short
  definition at the point of decision; the sources step did not mention that live channels (Slack, Discord,
  Telegram, GitHub) can be connected later in Settings. **[fixed]** contextual help on the consent and sources
  headings (`consent`, `source_connections`).
- **States:** save indicator (saving/saved/failed + retry), upload rows with per-file status, blocked reasons,
  "Processing didn't start" alert. Good.

### 1.5 Connect sources: uploads + Connected channels (Settings → Sources / Connected channels, `/connect`)
- **Now:** per-source rows with version history and "Upload a new version"; the Connected channels panel
  (provider not configured → says so without touching connector tables); `/connect` confirms a bot's link.
- **Confusing:** "new version" vs "new source" and what happens to the handover after a newer version arrives
  (Living Handover) was only explained on the processing page. **[fixed]** `living_handover` help on the
  Sources heading and on the version upload; `source_connections` help on Connected channels.

### 1.6 Source-level consent (wizard step 2, processing page "Confirm consent first", version upload)
- **Now:** a checklist of statements; nothing is uploaded or read before every box is ticked; consent is
  recorded per source and per AI provider (re-consent when the provider changes).
- **Fine**; added the `consent` help topic where consent is asked.

### 1.7 Processing & coverage (`/handover/[id]/processing`)
- **Now:** headline from `processingHeadline()` which never says "complete" while a newer source version is
  unprocessed/unchecked or has changes to decide; per-stage list (Done / In progress / Partly done / Failed /
  Waiting); failure reasons in plain language with a support reference; extraction coverage summary.
- **Distinguishable states (verified in `processing-headline.test.ts` and `run-status.test.ts`):**
  processing in progress · processing complete · source update needs processing · processed, changes to review
  · failed · cancelled · ready to process. Change detection pending is "processed; Baton hasn't yet checked how
  it changes the handover" (`sourceUpdateStateLabel`). Ready to publish / published are review-page and
  dashboard states (readiness `canPublish`, `currentPublicationId`). No new states were invented.
- **Missing:** a short definition of what the stages mean. **[fixed]** `processing_status` help on the run heading.

### 1.8 Review & evidence (`/handover/[id]/review`)
- **Who:** review roles (outgoing, reviewer).
- **Goal:** decide every extracted point using its evidence.
- **Now:** left readiness panel (score, blockers, sections), centre point cards with filters, right detail
  panel with quotes, quote check and AI judgement chips (each with help).
- **Confusing / missing:**
  1. Nothing on the page says **what a decision does** (approve → goes into the published handover; reject →
     left out; edit → saved as a new revision; nothing is published until Publish). **[fixed]** one-line
     orientation above the points ("Approve what the evidence supports…") with the `review_decisions` topic.
  2. Clicking the readiness blocker "No incoming member has been invited" did nothing useful (it only reset
     the filters). **[fixed]** it opens Settings → Members (creator) where the invitation is made.
  3. A reviewer who is not the creator saw "Ready to publish" but no button, with no explanation.
     **[fixed]** "Ready. Only the creator can publish." under the readiness list.
  4. Publish has no definition of what publishing does. **[fixed]** `publishing` help next to Readiness'
     publish action.
- **States:** read-only alert with reason; "Nothing matches these filters" with Clear; preview toasts. Good.

### 1.9 Gaps & contradictions (`/handover/[id]/gaps`, conflicts in review)
- **Now:** Gap Interview manager (questions, contributor links); conflicts are a review section.
- **Fine.** Covered by checklist item "Resolve what's outstanding" (conflicts, required gaps, privacy checks,
  source updates, change decisions), each counted from readiness blockers.

### 1.10 Publish (review → Publish dialog)
- **Now:** creator only, enabled when readiness allows; extraction gaps must be acknowledged explicitly.
- **Fine**; help added (see 1.8).

### 1.11 Invite incoming teammate (Settings → Members and access; wizard details)
- **Now:** email + role + clearance form; the invite result shows the link once and the email delivery outcome.
- **Confusing:** nothing said that publishing **requires** an incoming person (member or pending invitation).
  **[fixed]** `invitations` help on "Members and access", plus the dashboard/readiness fixes above. The
  checklist orders **Invite** before **Publish** because the database gate does.

### 1.12 Living-handover updates (source versions, `/handover/[id]/changes`)
- **Now:** a new source version is processed in a scoped run, change detection proposes change-review items,
  every item waits for a decision; publishing waits for all of it (`source_updates_pending`,
  `change_reviews_open`). Help topic `change_reviews` already exists.
- **Added:** `living_handover` topic (what a version is, what happens next) on the version upload.

---

## 2. Incoming teammate journey

### 2.1 Invitation link (`/h/[token]`)
- **Who:** the person taking over, from an email or a pasted link.
- **Now:** one focused card per state (sign in required, ready to accept, wrong account, unconfirmed email,
  already member, expired / revoked / used / invalid, rate limited, error), with the invitation's facts (title,
  inviter, role, expiry, masked address) and numbered "What happens next" steps. Accepting is an explicit form
  submit; rendering never redeems.
- **Confusing:** the card does not say what Baton *is* for someone who has never heard of it. The invitation
  copy (`invitationCopy`) explains the steps; Worker 02 kept that contract untouched (token screens are frozen
  contract §4) and instead explains Baton in the welcome shown right after accepting. **[onboarding]**

### 2.2 Accept → sign-up / sign-in → the intended handover
- **Now:** Google or email sign-in returns to the invitation; accept redirects incoming and lead members to
  `/handover/[id]/published`, review roles to review.
- **Missing:** after landing, nothing welcomes them or explains what they are expected to do. **[onboarding]**
  incoming welcome (what a handover is, what to do: read, start the first week, acknowledge), incoming tour on
  the published page, checklist (join → published → read → acknowledge).

### 2.3 Published view (`/handover/[id]/published`)
- **Now:** editorial document: summary + at a glance, First 7 days (local ticks), sections with quotes, open
  questions, acknowledgement (incoming only). Not yet published → "Not published yet · The team is still
  reviewing…".
- **Fine.** Tour anchors added (header, first week, sections, open questions, acknowledgement).

### 2.4 Incoming navigation (role-based tabs)
- **Now:** `visibleHandoverNav()` hides review-only tabs from incoming and lead members (only "Published").
  Dashboard groups their handovers under "Handed over to you". Good; guidance never mentions review tabs to them.

### 2.5 What they must review / acknowledge
- **Now:** incoming members acknowledge each published version; lead members read only ("Only incoming
  members acknowledge a handover"). The checklist and tour include **Acknowledge** only for incoming members.

---

## 3. Top usability issues and resolutions

| # | Issue | Resolution |
|---|-------|------------|
| 1 | No first-run orientation or sense of the whole journey | Welcome (role-aware), interactive tour per role, Getting Started checklist from real data, Help menu |
| 2 | "Nobody invited" silently blocks publishing | Dashboard attention + status, readiness blocker links to Settings → Members, checklist orders Invite before Publish |
| 3 | Non-creator reviewers offered "Publish" | Dashboard CTA/status corrected; readiness says only the creator publishes |
| 4 | Review page doesn't say what decisions do | One-line orientation + `review_decisions` help |
| 5 | Login looks sign-in only; invite return not explained | Heading and invitation note |
| 6 | Key terms (consent, connections, processing, versions, invitations, publishing, evidence) undefined at the point of use | Eight new contextual help topics placed at those headings |
| 7 | Incoming member lands on a document with no explanation | Incoming welcome + tour + checklist |

Open (not changed, with reason): invitation token screens (frozen contract; no copy change without Main);
dashboard "Published · waiting for the incoming person" could name who (needs members per card: one more query
per published card; left for Main to decide).
