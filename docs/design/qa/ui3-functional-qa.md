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
| Auth | Google sign-in and session restoration | Unverified (needs a real Google account) |
| Account | Details, sign-in methods, change password (mismatch, < 8 chars, success, sign-in with the new password) | Pass |
| Account | Deletion blocked while the user owns a handover; typed `DELETE` (case-sensitive) gate; soft delete, anonymised "Former member" profile, old credentials refused | Pass |
| Account | Deletion with "Delete permanently" on an owned, published handover removes the handover and its data | Pass |
| Dashboard | Empty state, links, New handover; cards per role (creator, reviewer, incoming) | Pass |
| Dashboard | Failed run on a draft showed "Sources added · not started yet" | **Fixed** QA-UI3-D1 |
| Dashboard | Reviewer's draft card said "Continue setup" | **Fixed** QA-UI3-D2 |
| Dashboard | Search and filters | Not applicable: the approved simple dashboard (D17) has no search/filter row |
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
| Review | Points from a failed run duplicated by the retry (reworded statements are not merged) | **Open** (pipeline matching; see below) |
| Review | Model labelled the ₹200 quote "contradicts" a ₹200 claim; "free for everyone" became its own decision | AI quality observation |
| Gaps | Interview link (questions, level, expiry); guest flow without an account (name, answer, skip, review, send); answer masked; owner accepts | Pass |
| Gaps | Accepted answer to a category-level question (not linked to a point) creates evidence but no point, so it never reaches the published handover | **Open** (database function; needs approval) |
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

## Open items needing a decision

1. **Gap answers to category questions are lost from the publication** (`review_gap_answer` inserts testimony without a point
   when `point_id` is null). Options: create a point from the accepted answer, or require linking it to a point before
   accepting. Database function change.
2. **Retry after a failed run duplicates points** when the model rewords them (dedup matches normalised statements only).
   Options: drop points created only by a failed run on retry, or also treat "same category + same cited message set" as a
   duplicate. Pipeline change.
3. **Local `.env.local` points at baton-dev with the fake AI provider.** Until QA-UI3-P1 reaches the code a plain
   `npm run dev` in the main folder runs, that server drains production jobs. Use `BATON_DEV_WORKER=0` (or the launcher)
   meanwhile.
