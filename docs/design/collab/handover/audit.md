# Audit: the handover workflow, end to end (UI3 Phase A)

Owner: `handover`. Baseline: `ui3/agent3-handover` at `fc5651a` (= production `c781620` plus the design lab).
Method: I read every file I own (about 8,800 lines), checked the contracts in `lib/contracts/{dto,queries,schemas}.ts`
and the actions in `lib/actions/*`, and captured the running app (`/preview/*`, `/demo`, token error states) at
1440, 1024 and 390, light and dark. I ran a CDP probe for the heading outline, overflow, small targets, keyboard
order and network calls. Screenshots are in `.claude/ui3/shots/handover/` (git-ignored). Global checks passed on
every captured route: one `h1`, no horizontal overflow, no console errors.

Severity: **P0** blocks a real task or misrepresents data; **P1** serious UX or accessibility problem; **P2**
polish or consistency. IDs (W-, P-, R-, G-, I-, H-, PB-, S-, X-) are referenced from `plan.md`.

---

## 0. Workflow map (as built)

```
/dashboard ──► /handover/new  (wizard: Details → Privacy & consent → Sources → Scope & access)
                   │  createHandover, inviteMember, createSourceUpload → storage → confirmSourceUploaded,
                   │  recordSourceConsent, previewSource, addExclusion, confirmIdentityMatch, removeSource,
                   │  updateHandoverDetails (autosave), deleteHandover, startProcessing
                   ▼
/handover/[id]/processing   getHandover, getProcessingStatus │ startProcessing, continueProcessing (20s nudge),
                   │                                          │ cancelProcessing, recordSourceConsent (re-consent)
                   ▼
/handover/[id]/review       loadReview = getHandover, listPoints, getPoint×N, getReadiness, listGapQuestions,
                   │        listSources │ reviewPoint (approve/reject/reopen/edit/resolve_conflict/
                   │        exclude_evidence/restore_evidence/change_access), createManualPoint,
                   │        createGapQuestion, publishHandover
                   ├──► /handover/[id]/gaps   getHandover, listGapQuestions, listPoints │ createGapQuestion,
                   │          │                createGapInterviewLink, reviewGapAnswer
                   │          └──► /g/[token] (no account)  getGapInterview │ submitGapAnswers
                   ├──► /handover/[id]/settings  getHandover, listMembers, listSources, listAccessTokens,
                   │          listParticipants, listExclusions │ inviteMember, updateMemberClearance, removeMember,
                   │          revokeAccessToken, removeSource, eraseParticipant, startRevision,
                   │          offerCreatorTransfer, respondToCreatorTransfer, deleteHandover
                   ▼
/h/[token] (invitation) ── sign in ── acceptInvitation ──► /handover/[id]/published
                   getHandover, listMembers, getPublishedHandover │ acknowledgePublication
```

Frame: `app/(workspace)/handover/[id]/layout.tsx` renders `HandoverHeader` (h1 = title, role, state badge) and
`HandoverNav` (5 fixed tabs from `config/navigation.ts#handoverNav`). Token routes use `SharedLinkShell`
(shell-owned). Every route has a `loading.tsx` skeleton and a group `error.tsx`.

**Unused capabilities that already exist in the contract** (no backend change needed to use them):
- `queries.getSourceMessageContext(pointEvidenceId, {before, after})`: the messages around a quote, masked, with
  `hasMoreBefore`/`hasMoreAfter` and `available`. **No screen calls it.** The detail panel instead says "Only the
  quoted passage is shown here, not the messages around it."
- `reviewPoint({ action: "resolve_privacy_review", … })` with `PointDetail.privacySurfaces`, `privacyReviewDigest`,
  `privacyReviewReason` and `privacyReviewFlaggedAt`: **never called or rendered.**
- `GapQuestionSummary.privacyHeld`, `GapAnswerSummary.privacyHeld`, `PublishedPointContent.textRedacted`,
  `PointRevisionSummary.redaction`, `ErasureReport` (returned by `eraseParticipant`): **never rendered.**

---

## X. Cross-cutting findings

| ID | Sev | Finding | Evidence |
|---|---|---|---|
| X-1 | P0 | **The privacy review is a dead end.** After `eraseParticipant`, affected points get `privacyReview = "required"` and readiness adds the `privacy_review_required` blocker. No UI shows which points are held or lets anyone resolve them (`resolve_privacy_review` is never called). Publishing stays blocked forever, and the blocker button does nothing (X-2). | grep: no use of `privacySurfaces`, `resolve_privacy_review`, `privacyReviewFlaggedAt` in `components/**`. `review-workspace.tsx#onBlocker` has no branch for it. |
| X-2 | P1 | **Half the readiness blockers are dead buttons.** `onBlocker` handles 4 of 8 kinds. `processing_incomplete`, `no_incoming_recipient`, `no_approved_points` and `privacy_review_required` only reset the status and review filters, which looks like nothing happened. `no_incoming_recipient` should go to Settings → Invite. | `review-workspace.tsx` L211–225 against `READINESS_BLOCKERS` (dto.ts). |
| X-3 | P1 | **No source context anywhere.** Reviewers judge a quote without the surrounding conversation, even though `getSourceMessageContext` exists. This is the biggest gap against Baton's promise ("every quote checked … you can check"). | dto.ts `SourceMessageContext`. `point-detail-panel.tsx` "Only the quoted passage is shown". |
| X-4 | P1 | **Errors are shown as empty states.** `loadReview` drops a failed `listPoints` or `getPoint` and the page says "No points found". Settings turns failed `listMembers`/`listSources`/token reads into empty lists ("No invitations yet"). Gaps turns a failed `listPoints` into `[]`. | `load-review.ts` L28–36; `settings/page.tsx` L39–46; `gaps/page.tsx` L51. |
| X-5 | P1 | **Important outcomes only get a toast.** Publish: the dialog closes with a toast "Published version N", the review turns read-only, and there is no navigation or lasting confirmation. Erase participant: the whole `ErasureReport` is discarded, including `sameNameParticipantsElsewhere`, which the creator is told to review separately (§12.8). Ask in Gap Interview: the question is created with auto-written wording and only a toast. | `review-workspace.tsx` L459–466; `participants-panel.tsx` L76; `review-workspace.tsx` L176–187. |
| X-6 | P1 | **Masked text is not accessible.** Screen readers read `[PHONE_1]` literally ("left bracket PHONE underscore one"). The explanation is a `title` only (not available to keyboard or touch). The same chip style is used in quotes, headings and option lists. | `masked-text.tsx`. |
| X-7 | P1 | **Privacy holds are invisible.** `privacyHeld` on gap questions and answers is ignored, so a held answer looks like a normal "Waiting for review" answer with Accept/Reject. `textRedacted` and revision `redaction` are never shown. | grep: zero uses. |
| X-8 | P1 | **Role- and state-blind navigation.** All five tabs show for every role and state. An incoming member sees Processing, Review and Gaps, which lead to lock screens. "Published" shows before any publication. "Processing" stays first after publication. Nothing marks where the handover is in its lifecycle. | `config/navigation.ts`, `handover-nav.tsx`. |
| X-9 | P2 | **No deep links to a point.** "Linked point" on the Gaps page and the readiness blockers can only open the review at the top. The review ignores any `?point=` parameter. | `gaps-manager.tsx` L150; `review/page.tsx`. |
| X-10 | P2 | **Labels drift.** Access levels are "Everyone on the handover" / "Leads and reviewers only" in Add a point but "Everyone" / "Leads only" elsewhere. Gap priority is "Required" (manager) but "Important" (interview). The published tab is called "Open the incoming view" in one place and "Published" in another. Question status shows the raw enum ("open", "answered"). | `add-point-dialog.tsx` L23; `gap-interview.tsx` L161; `gaps-manager.tsx` L139. |
| X-11 | P2 | **Glass effect.** The wizard's sticky footer and the preview banner use `backdrop-blur`, which D2 rules out. | `new-handover-wizard.tsx` L833; `preview-chrome.tsx`. |
| X-12 | P1 | **The dev preview calls a real server action.** `/preview/processing?state=running` renders the real `ProcessingView`, which POSTs `continueProcessing` every 20 s (confirmed by a CDP network probe). Also flagged by `demo`. | probe output; `processing-view.tsx` L51. |
| X-13 | P2 | **Preview coverage gaps.** There are no previews for Gaps, Settings, the Gap Interview (`/g`), invitation states (`/h`), review read-only/empty/privacy-review, or published acknowledged/lead/redacted. Those screens can't be screenshotted or reviewed without signing in. | `app/(preview)/preview/*`. |
| X-14 | P2 | **Field errors aren't linked.** The review dialogs, Add a question and the Edit dialog render errors as loose `<p>` elements without `aria-describedby`. Add a question shows no error text at all (only `aria-invalid` on the question). | `review-dialogs.tsx#FieldError`; `gaps-manager.tsx#AskDialog`. |
| X-15 | P2 | **Card soup and weak hierarchy.** Points, gap questions, consent rows, scope sections, processing panes and the published list are all `rounded-xl border bg-card shadow-soft`. Nothing tells you which surface is primary. | screenshots `review-vp.png`, `wizard-4-1440-light.png`. |

---

## W. Wizard: `/handover/new` (`components/wizard/**`, 1,134-line `new-handover-wizard.tsx`)

What works: four steps with focus moving to each step heading; autosave with a truthful `SaveIndicator`; the draft
and step live in the URL (refresh-safe, resumable from the dashboard); detailed per-file upload phases with a live
region; duplicate, too-large, unsupported, empty and needs-date-order are distinct states; good privacy copy;
`startError` kept on the page.

| ID | Sev | Finding |
|---|---|---|
| W-1 | P1 | **There is no "check before processing" step.** "Start processing" is irreversible (it consumes AI quota and starts masking and deleting raw files), yet you go straight from a long scope form to Start. A summary of sources, dates kept, conversations and people left out, access level per source and masking counts would catch mistakes. |
| W-2 | P1 | **The finish button takes two clicks and is confusing.** If people are unticked, the button reads "Save and review". It saves the exclusions, refreshes the previews and *returns without starting* (`saveParticipantExclusions` returns `false`). The user has to press again, now labelled "Start processing". Nothing explains that the first click did not start anything. |
| W-3 | P1 | **Invite links are shown once with no copy control.** After Create draft, the success alert shows the raw invite URLs in `<code>`, with no Copy button. They are shown only once (`CreatedLink`), and the text says nothing about that. Settings has a proper copy field; this should match. |
| W-4 | P2 | **Incoming invites are only possible before the draft exists.** Afterwards the step says "Invite the incoming member from Settings once processing starts". But publish needs `no_incoming_recipient` cleared, and there is no link to Settings from the wizard (the wizard is outside the `[id]` layout). |
| W-5 | P2 | **The Stepper shows position, not status.** Steps are clickable but say nothing about *why* a later step is locked (`maxStepFor`). The blocked reason sits only by the footer, hidden above `md`, and moves below the button on mobile. |
| W-6 | P2 | **"Discard draft" sits next to the save status** at the top, in the same row as reassuring information. The destructive action belongs with the draft's lifecycle actions, away from status. |
| W-7 | P2 | **The consent step exposes internal jargon.** It shows "statement version gemini-free-2026-11-14-v1". The provider item is a long paragraph inside a checkbox label, so the important warning ("Google may use this content … review by people") is buried. |
| W-8 | P1 | **Scope scales badly.** Every source repeats a 3-up access ChoiceCard grid. Conversation lists have no select-all or none and no limit (a long export can have hundreds). People are unticked as small chips, and an unticked chip only gets a strikethrough, while the consequence is permanent ("can't be undone here", Alert). The masking table always lists all 10 kinds, including zeros. |
| W-9 | P2 | **Drop zones.** The two zones are about 240 px tall each, stacked on mobile, which pushes the file list below the fold (`wizard-3-vp-390.png`). The hidden input has `tabIndex=-1` (fine, the button works), but the drop target has no keyboard-reachable equivalent label. The disabled state is only 50% opacity. You can't cancel an in-flight upload: Remove is disabled while busy. |
| W-10 | P2 | **Time zone fallback.** If `Intl` fails, it silently falls back to `Asia/Kolkata`, with no display of the zone used for dates (the user is never shown which time zone the preview is in). |
| W-11 | P2 | **Glass sticky footer** (X-11). Also, on mobile the footer and the preview banner together take about 25% of the viewport. |
| W-12 | P2 | **Module-level mutable focus flag** (`focusNextStep = { current: false }`). It is shared across every wizard instance, including `wizard-preview`. Harmless today, but fragile. |
| W-13 | P2 | **Demo seams.** `DetailsStep`, `MatchesSection`, `STEPS` and `StepHeading` are exported from a file that imports server actions, so `demo` cannot import them without pulling in `lib/actions` (agreed fix, plan §9). |

States: empty (no files: drop zones only ✓), loading (`FormSkeleton` ✓, per-file phases ✓), error (per file ✓,
start ✓, autosave ✓), success (toast "Processing started" plus navigation ✓), partial (some files failed: counted
"n need attention" ✓; the Continue gate counts only ready files ✓). Missing: a summary state (W-1), an offline or
stale-draft notice beyond the autosave conflict.

## P. Processing: `/handover/[id]/processing` (`components/processing/**`)

What works: live polling (3 s) plus a server nudge; a polite live region announcing only stage changes; a per-stage
list with partial and failed states; plain-language source failures with a support reference; re-consent when the
provider changed; reduced-motion progress.

| ID | Sev | Finding |
|---|---|---|
| P-1 | P2 | **The failure alert repeats itself.** "This run stopped before it finished" (title), then the reason text "Processing stopped before it finished." (`processing-failed-vp-dark.png`). |
| P-2 | P1 | **People who can't start get wrong instructions.** In the draft or not-started state, the description says "Add consent for every source, then start processing" to reviewers who have no Start control (`canStart` false). They need "Waiting for the creator or outgoing member to start processing". |
| P-3 | P2 | **Cancel has no confirmation**, and nothing explains what happens to partial work. |
| P-4 | P2 | **The overall % is the mean of stage fractions,** so it can jump or stall. Fine as a sense of progress, but it reads as precise (monospace %). |
| P-5 | P2 | **The aside repeats Settings' source list** with a different layout. Three stacked sections in one card. |
| P-6 | P1 | **Succeeded with 0 points loops.** The review empty state "Processing finished without finding any points" offers only "View processing", which links back here. `createManualPoint` is allowed in `in_review`, but the review hides Add a point when there are no points (the empty state returns early). |
| P-7 | P2 | **Preview calls `continueProcessing`** (X-12). |

States: running ✓, partial ✓, failed ✓, cancelled (title only), not started ✓, no sources ✓, not a reviewer
(EmptyState "Processing is for reviewers" ✓). Missing: cancelled guidance, "queued for a long time" (worker
off).

## R. Review: `/handover/[id]/review` (`components/review/**`)

What works: three panes (readiness and sections · points · evidence detail); J/K/A/E/R hotkeys with a help dialog;
honest per-status card treatments (conflict two-column, gap dashed, inferred rationale); approve flows that ask for
input exactly when the server needs it (confirm inferred, resolution note, known gap); undo via reopen; edit
creates a revision with a reason; exclude and restore evidence with reasons; access change with a floor; the PI-11
guard notice; advance to the next pending point after a decision; read-only reasons.

| ID | Sev | Finding |
|---|---|---|
| R-1 | P1 | **The main pane gets the least space.** At 1440 the columns are sidebar 240, readiness 248, points about 440, detail 368. At 1024 the points get about 430 px and the detail goes to a sheet (`review-vp.png`, `review-vp-1024.png`). The filter toolbar wraps to 3 rows in the centre column. |
| R-2 | P1 | **Every card repeats the decision bar.** 4–5 buttons on each of 24 cards (Evidence, Edit, Resolve, Reject, Approve, plus Kbd hints) make a wall of controls. A conflict card is 640 px tall on desktop and 910 px on mobile. One decision bar for the *selected* point, kept in the same place, would be calmer and faster. |
| R-3 | P1 | **Quotes are clamped where the decision is made.** Conflict quotes are clamped to 3 lines on the card *and in the Resolve dialog* (`ConflictSides` passes `clamp`), with no way to expand. The reviewer records "what is true now" without being able to read both sides in full. |
| R-4 | P1 | **No source context** (X-3). The "Source context" section shows only source-level metadata, matched to evidence by *title* (`sourceTitles.has(s.title)`), which breaks when two sources share a title. |
| R-5 | P0 | **The privacy review is missing** (X-1). The card shows nothing for `privacyReview = "required"`. |
| R-6 | P1 | **Dead blocker buttons** (X-2). |
| R-7 | P1 | **Publish is hidden on small screens.** The Publish button lives only in the readiness panel. Below `lg` that panel sits inside a *collapsed* `<details>` ("Readiness 33% · sections"), so on tablet and phone the main end action is invisible. |
| R-8 | P1 | **Publish is a blind step.** The dialog says what publishing means but not *what* will be published: approved count, known gaps, rejected left out, the incoming recipients who will be asked to acknowledge, and the version number. Afterwards there's only a toast (X-5). |
| R-9 | P1 | **Keyboard and screen readers.** (a) Single-letter shortcuts without a modifier, with no way to turn them off, fail WCAG 2.1.4 and clash with screen-reader quick keys. (b) J/K changes `aria-current` on an `<article>` but leaves focus on `body`, so nothing is announced. (c) About 40 tab stops (filters, sections, blockers) come before the first point, and there's no skip link to the list. (d) Selecting by clicking the card body is mouse-only (the heading button covers keyboard, but the card's click target is larger than its accessible control). |
| R-10 | P2 | **Three overlapping filter systems.** Sections (left rail) plus Conflicts and Gaps (left rail), plus status chips plus review chips. "Conflicts" in the rail and the "Conflicting" chip do almost the same thing, with different counts: the rail counts only non-rejected points, the filter shows rejected ones too. |
| R-11 | P2 | **The evidence caption wraps badly.** The separator dots are `::before` on each item, so after a wrap a line starts with "·" (`review-vp-390.png`). The source icon sits alone on its own line in narrow panes. The location (`line 3982`) is truncated off in the conflict columns. |
| R-12 | P2 | **"Ask in Gap Interview"** creates a question immediately with generated wording ("What should the incoming member know about …?") and auto priority. You can't adjust it, and the only feedback is a toast. |
| R-13 | P2 | **Revisions are a list of struck-through titles.** You can't see what changed in the statement. `editReason` is quoted in small grey text. |
| R-14 | P2 | **The readiness ring shows `score`** ("33%"), which the contract says never gates publishing. It reads like a target. Blockers are what matter. |
| R-15 | P2 | **Heading order.** The detail pane's `h2` (point title) comes after the list's `h3`s in DOM order, and the sheet duplicates the same detail. |
| R-16 | P2 | **Edit dialog.** Array attributes are edited as comma-separated text. Errors aren't linked (X-14). "Shows as inferred until Baton re-checks" is accurate but alarming, with no indication of *when* the re-check happens. |
| R-17 | P2 | **Approved/rejected badges look like status pills.** They use the success/danger `Badge` next to the evidence `StatusBadge` in the same header row: a reviewer's signature and an evidence state look like siblings (D5). |

States: loading (`WorkspaceSkeleton` ✓), empty (no points: 3 variants ✓, but P-6), filtered empty ✓, read-only
(processing or published, with a reason ✓), not a reviewer (lock with a link to Published ✓), error (✗ hidden, X-4),
partial (some `getPoint` failed: silently missing ✗), success (toasts; advance ✓), conflict (`expectedRevisionId`
mismatch: the server returns `conflict` → toast only; there's no "this point changed, reload" state ✗).

## G. Gaps (manager): `/handover/[id]/gaps` (`components/gaps/**`)

| ID | Sev | Finding |
|---|---|---|
| G-1 | P2 | **The header is a metric hero.** Three `text-4xl` serif numbers (Open / To review / Closed): dashboard styling on a document product. |
| G-2 | P1 | **Privacy holds are ignored** (X-7). Held answers show Accept/Reject like any other. |
| G-3 | P2 | **"Linked point" goes to the top of the review,** not to the point (X-9). |
| G-4 | P2 | **Accept and Reject act immediately,** with no reason for Reject. Accept turns the answer into testimony *evidence*, but the button doesn't preview where it will appear ("Adds to: Owner of the bank account"). |
| G-5 | P2 | **No list of existing links here.** Active links live only in Settings, so you can't tell whether a link already went out before you create another one. The link dialog's text hard-codes "up to 20 uses". Expiry is a bare number input. |
| G-6 | P2 | **Published state gives no explanation.** `canManage` turns false and the buttons disappear silently. |
| G-7 | P2 | **Status text** is the raw enum, lower case and capitalised by CSS. Priority wording differs from the interview (X-10). |
| G-8 | P2 | **Add a question has no visible field errors** (X-14). |

States: no questions (2 variants ✓), error loading (✓ for review roles), non-review roles (they get the list
read-only with no explanation).

## I. Gap Interview (contributor): `/g/[token]` (`components/gap-interview/gap-interview.tsx`)

What works: intro, then one question per screen, then a check-your-answers review, then done; draft saved in
`localStorage` per token prefix; focus management; skip; masked-input reassurance; the error alert keeps the
answers.

| ID | Sev | Finding |
|---|---|---|
| I-1 | P1 | **Answers stay on the device without saying so.** The draft (name plus answers) persists on shared devices with no notice and no "Clear my answers from this device". |
| I-2 | P2 | **Missing context.** It doesn't show who asked or when the link expires (the DTO has only `handoverTitle`), or what happens to answers beyond "a reviewer will check". The intro says "their documents couldn't answer", but the sources are mostly chats. |
| I-3 | P2 | **`autoFocus` on the answer box.** On mobile the keyboard opens at once and covers the question and its context. |
| I-4 | P2 | **"Important"** here and "Required" in the manager (X-10). |
| I-5 | P2 | **The invalid-link state** is an `EmptyState` (error tone) with no next step beyond "Ask the person who sent it". |
| I-6 | P2 | **Not owned in the map.** `components/gap-interview/**` is missing from agent-ownership.md (request to `main`). `SharedLinkShell` is shell-owned. |

## H. Invitation: `/h/[token]`

| ID | Sev | Finding |
|---|---|---|
| H-1 | P2 | **The visible title isn't the h1.** The `h1` is `sr-only` ("Handover invitation"), and the visible panel title is an `h2`. The visible title should be the h1. |
| H-2 | P2 | **The page can't say which handover or who invited** (by design: the token isn't redeemed on render). The copy should say so plainly instead of the generic "Someone is passing on …". |
| H-3 | P2 | **Three stacked sign-in routes** (Google, email+password, magic link), with the alternatives as ghost buttons of equal weight. |

States: signed out ✓, sent ✓, signed in (accept) ✓, errors via `?error=` ✓ (4 kinds). Good coverage.

## PB. Published report: `/handover/[id]/published` (`components/published/**`)

What works: editorial structure (summary, at a glance, first 7 days, sections, open questions, acknowledge); a TOC
and mobile jump links; inferred and conflict notes; collapsed quotes; a redaction notice; first-week ticks with
SSR-safe storage; heading outline h1 → h2 → h3 → h4.

| ID | Sev | Finding |
|---|---|---|
| PB-1 | P2 | **"At a glance" picks the first three non-empty sections plus open questions.** Which numbers appear depends on the data. Ownership or Access can drop out. |
| PB-2 | P2 | **The TOC never marks the current section** (no scroll-spy) and doesn't link to the summary. |
| PB-3 | P2 | **Evidence is collapsed, with no summary of its spread** (how many sources, newest date). The quote slip has no location in the published DTO, which is fine, but sources show only the title. |
| PB-4 | P1 | **Acknowledgement is weak as a formal act.** It's a dark marketing-style band (`bg-inverse`). After acknowledging, only a toast plus a re-render. There's no receipt (version, date, statement). Creators and reviewers can't see *who* has acknowledged (no data in `MemberSummary`: a data gap, not a UI bug; note for `main`). |
| PB-5 | P2 | **No print stylesheet.** A handover is a document people will print or save as PDF. Nav, TOC, toggles and the ack form would all print. |
| PB-6 | P2 | **`textRedacted` is never shown** (X-7). A redacted point reads as normal text. |
| PB-7 | P2 | **"Version N", but nothing says what changed since the previous version** (no data; future). |
| PB-8 | P2 | **The first-week progress bar animates width without `motion-reduce`.** |
| PB-9 | P2 | **Not published yet.** Reviewers get the same "The team is still reviewing" text as incoming members, with no link to the review. |

## S. Settings: `/handover/[id]/settings` (`components/settings/**`)

| ID | Sev | Finding |
|---|---|---|
| S-1 | P1 | **Clearance changes apply instantly on `<select>` change,** with no confirmation and no undo. One accidental keyboard arrow changes who can see evidence. |
| S-2 | P1 | **The erasure result is discarded** (X-5): counts and same-name participants elsewhere. |
| S-3 | P1 | **The invite form has no visible labels.** Labels are `sr-only` and the email field shows only a placeholder (WCAG 3.3.2). |
| S-4 | P2 | **"Start a revision" lives only here,** while the review's read-only notice says "Start a revision in Settings" without linking to it. |
| S-5 | P2 | **One long column.** Lifecycle, members, links, sources, privacy and danger are all at the same level. |
| S-6 | P2 | **Exclusions show "Conversation #3"**, which means nothing after the fact (no preview text survives by design; the copy should say so). |
| S-7 | P2 | **Removing a source after processing** says "Points keep their evidence until you reprocess", but reprocessing is not offered anywhere on this page. |

## Dark mode (all screens)

Dark tokens exist and every screen renders without contrast collapse in my captures (`*-dark.png`). Issues:
evidence tints (`status-*-soft/60`) become muddy on the dark card, so the conflict panel reads pink-brown; the ack
band (`bg-inverse`) in dark is a lifted navy that looks like a different product; mask chips (`bg-foreground/8`)
almost vanish in dark; the readiness-ring track is low contrast. These are inputs for `brand`'s designed dark
palette (D4), not fixes I would make myself.

## Responsive (390)

No overflow anywhere. Problems: review cards are very tall (910 px conflict card); Publish is hidden (R-7); filter
chips wrap to 3 rows; wizard drop zones push content down (W-9); Gap Interview `autoFocus` (I-3); published jump
links work well.

## Tests that cover my screens today (keep)

`components/wizard/__tests__/{confirm-failure,details-save,draft-state}`, `components/review/__tests__/{manual-point,sample-point}`,
`components/shared/__tests__/{mask-tokens,render-determinism,key-facts,token-status,run-status,preview-guard,design-states,support-guard}`,
`lib/mocks/__tests__/gap-access.test.ts`, `tests/integration/{it04-ui-escaping,r3-render-determinism,r3-key-facts,r3-details-autosave,r3-draft-resume,r3-preview-guard,prototype-sample-e2e,r3-upload-rejection-reasons}`.
Notably `it04-ui-escaping` renders `EvidenceQuote`, `PointCard` and `PublishedHandoverView` and asserts that the
masked text goes through `MaskedText`, and it reads those exact file paths. Renames must keep it passing (plan §8).
