# UI3 functional QA (integrated candidate)

Date: 2026-11-15. Candidate: `ui3/integration` @ `dd777dd`. Lead-run, in a real browser (headless Chrome driven over the
DevTools protocol; the Claude in Chrome extension had no connected browser). Backend: baton-dev (the project production
uses). Data: four disposable synthetic accounts (`…@example.com`) and invented chats only; all of them, and the QA
handover with its sources, runs and answers, were deleted through the app's own account deletion at the end.
Screenshots: `.claude/ui3/shots/qa/` (git-ignored).

Result key: **Pass** · **Fixed** (failed, root-caused, fixed on a branch, merged, retested) · **Open** (needs a decision) ·
**Unverified**.

## Main application

| Area | Test | Result |
|---|---|---|
| Auth | Protected routes redirect signed-out users to `/login?next=…` (`/dashboard`, `/account`, handover settings) | Pass |
| Auth | Email + password sign-in; `next` honoured; malformed `next` falls back to `/dashboard` | Pass |
| Auth | Wrong password → "That email and password don't match" | Pass |
| Auth | Sign-out clears cookies; protected routes redirect again | Pass |
| Auth | Google sign-in start: button → Supabase → accounts.google.com with client_id, state and redirect_uri = baton-dev's auth callback (not the original project); PKCE is the server client's default and /auth/callback exchanges the code | Pass (completing a Google sign-in needs a real Google account: unverified) |
| Auth | Session restoration: a new browser is signed out; restoring only the saved session cookie restores /dashboard and /account | Pass |
| Account | Details, sign-in methods, change password (mismatch, < 8 chars, success, sign-in with the new password) | Pass |
| Account | Deletion blocked while the user owns a handover; typed `DELETE` (case-sensitive) gate; soft delete, anonymised "Former member" profile, old credentials refused | Pass |
| Account | Deletion with "Delete permanently" on an owned, published handover removes the handover and its data | Pass |
| Dashboard | Empty state, links, New handover; cards per role (creator, reviewer, incoming) | Pass |
| Dashboard | Failed run on a draft showed "Sources added · not started yet" | **Fixed** QA-UI3-D1 |
| Dashboard | Reviewer's draft card said "Continue setup" | **Fixed** QA-UI3-D2 |
| Dashboard | Search and filters | Verified absent (0 search or filter controls): the approved simple dashboard (D17, built on master's) has none; not added |
| Wizard | Step 1 validation, draft creation, consent gating (3 statements), uploads (.txt chat 15 msgs/3 people, .md doc), scope and access step | Pass |
| Masking | "send the guest wifi codes last time" / "guest wifi for the event: ask IT" kept; laptop password, phone and email masked (wizard, review quotes, gap answers) | **Fixed** QA-UI3-M1, then Pass |
| Processing | Run failed `ai_config_changed`: a local `npm run dev` (fake AI, `.env.local` → baton-dev) drained the job | **Fixed** QA-UI3-P1 (worker opt-in); stopping that server unblocked QA |
| Processing | Failure screen (sources safe, reason, Try again); duplicate-start protection (second click on a disabled "Starting…", one run) | Pass |
| Processing | Failed-run "Add or change sources" looped back to the same page | **Fixed** QA-UI3-H1 ("Manage sources" → Settings → Sources) |
| Processing | Real Gemini run: extract → quote check → support check → conflicts/gaps → prepare review, ~3 min | Pass |
| Review | Points across decisions, owners, open work, risks/dependencies, contacts, accounts; quotes with source + line; verification chips | Pass |
| Review | "Edited since its quotes were checked. Re-verifying…" shown for never-checked quotes | **Fixed** QA-UI3-H2 |
| Review | Draft (run stopped part-way) offered Approve/Edit/Reject that always failed | **Fixed** QA-UI3-H3 (read-only with a reason) |
| Review | Decision date shown as raw `2026-09-05T04:50:00+00:00` | **Fixed** QA-UI3-K1 |
| Review | Approve (toast with Undo), Confirm & approve for inferred (checkbox gate), Reject with reason, Edit with required reason → Revision 2 | Pass |
| Review | Resolve conflict (note required, "Sources disagreed · resolved") | Pass |
| Review | One-click Approve after Resolve failed "This can't be done yet" | **Fixed** QA-UI3-H4 |
| Review | Points from a failed run duplicated by the retry (reworded statements are not merged) | **Fixed in code** QA-UI3-X1 (unit + isolated Postgres tests); live effect needs migration 20261115100200 applied |
| Review | Model labelled the ₹200 quote "contradicts" a ₹200 claim; "free for everyone" became its own decision | AI quality observation |
| Gaps | Interview link (questions, level, expiry); guest flow without an account (name, answer, skip, review, send); answer masked; owner accepts | Pass |
| Gaps | Accepted answer to a category-level question (not linked to a point) creates evidence but no point, so it never reaches the published handover | **Fixed in code** QA-UI3-G1 (isolated Postgres tests); live effect needs migration 20261115100100 applied |
| Sharing | Invite (one-time link), revoke with confirmation, accept as invited account, role shown | Pass |
| Publishing | Gates (pending, inferred, conflict, required gap) → "Ready to publish" → publish with summary → v1, read-only review | Pass |
| Recipient | Published view (rejected points excluded), quotes on demand, first-week ticks, acknowledgement gate, "Acknowledged" on dashboard | Pass |
| Settings | Members/clearance, invitations, sources (remove), participants (erase), danger zone | Pass ("1 phone numbers" plural copy: minor) |
| Layout | Dashboard, published, review, account at 390 and 1440, light and dark: no overflow, no console errors, no failed requests | Pass |

## Demo (`/demo`, no sign-in)

| Test | Result |
|---|---|
| Entry without sign-in; story Priya → Neha, Kabir; read-only label | Pass |
| Category filters (9), status filters (5), review filters (4) with correct "Showing N of 24" | Pass |
| Shortcuts dialog (Esc closes); J/K move the selected point (`aria-current`) and scroll | Pass |
| Review actions turned off with a reason; conflict shows Supports / Contradicts | Pass |
| Incoming tab (arrow keys move focus, Enter activates); first week, section anchors, "Show quotes" (`aria-expanded`), acknowledgement explained as demo-only | Pass |
| First-week ticks persist on the device; unticking restores 0/5 | Pass |
| "Reset the sandbox" | Not applicable: the demo is read-only; its only state is the device-local first-week ticks |
| 390 and 1440, light and dark: no overflow, no console errors | Pass |

## Landing

| Test | Result |
|---|---|
| Round 3 previews (bots, Ask the Handover, Living Handover) labelled "Coming in Round 3" and "Preview", no controls; Discord and Telegram side by side | Pass (also static tests) |
| "For the nerds": pipeline + five collapsed topics expand | Pass |
| 390 and 1440, light and dark: no overflow, no console errors | Pass |

## Data-integrity fixes (2026-11-15, second pass)

Both fixes are on their own branches from master and merged into `ui3/integration`. Their migrations are tested only on
throwaway Postgres 17 containers (`supabase/tests/run.sh`, `tests/integration/db/run.sh`); they are NOT applied to
baton-dev or any hosted project.

| ID | Root cause | Fix | Tests |
|---|---|---|---|
| G1 | `review_gap_answer` linked accepted testimony only to a question's point; general questions have none, so the answer reached no point, and `publish_handover` snapshots approved points only | Migration `20261115100100_gap_answer_point.sql`: accepting an answer to a question without a point (in review) creates one pending `gap_answer` point with the testimony and links the question to it; later answers attach to the same point; publish stays blocked until a reviewer confirms and approves it; access follows the question; outside review such an accept is refused | SQL `99_gap_answer_point.sql` (linked, unlinked, second answer, rejected, leads-only, uncategorised, publish gate, snapshot content, recipient visibility by clearance, refusal outside review); static copy test |
| X1 | Dedup matched identical statements (or one subject field) only; a retry re-extracts the same chunk and the model rewords, so failed-run points were duplicated | Same category + at least one identical cited message + identical markers (digits, months, weekdays, ordinals) and negation + content-word Dice ≥ 0.6, compared against current and original wording; attaching only adds citations. Migration `20261115100200_pipeline_points_cited_messages.sql` adds `citedMessageIds` and `originalStatement` to the worker's point list (read-only, same grants) | `retry-dedup.test.ts` (identical and reworded retries, distinct claims kept apart, edited/approved and rejected targets, partial failure then retry, repeated retries, fingerprints); SQL `99_pipeline_points_cited.sql` (keys, excluded citations, grants) |

Results: SQL suite 22/22 files; integration SQL suite (Docker-gated) 11/11 files; npm test 2,162 (2,161 pass, 0 fail,
1 todo). Browser regression on baton-dev with the new code and the migrations NOT applied: processing completes
(9 distinct points), review renders, no console errors; both fixes fall back safely without their migrations.

## Open items needing a decision

1. **Apply migrations `20261115100100` and `20261115100200` to baton-dev** (production uses it). Until then the two fixes
   have no live effect. Requires your explicit approval; apply with the existing hosted-apply tooling, then verify.
2. **Local `.env.local` points at baton-dev with the fake AI provider** (see QA-UI3-P1).
