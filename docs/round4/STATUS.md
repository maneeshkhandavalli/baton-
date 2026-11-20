# Hackathon completion checklist (live)

Deadline: **2026-11-20 23:59 IST**. Branch `work/r4-integration` (GitHub remote `gh`). Preview
http://localhost:3110 (`next dev`; the built-in test AI adapter only runs there). Update this file at every
checkpoint; never mark a column without evidence.

Legend: ✅ done · ⏳ in progress · ❌ not done · 🔒 blocked by owner action (see "Blocked on").

"Automated tests" means synthetic suites (no provider, no network). "Live provider verified" means a real person's
message typed in the provider reached Baton through the provider's own delivery and was checked in the database.

| # | Deliverable | Implemented | Automated tests | Browser verified | Live provider verified | Blocked on |
|---|---|---|---|---|---|---|
| 1 | GitHub integration (real repo events) | ✅ | ✅ connectors suite (synthetic) | ❌ | ❌ | 🔒 GitHub App registration + credentials |
| 2 | Discord bot (real channel messages) | ✅ | ✅ | ❌ | ❌ | 🔒 credentials + portal settings |
| 3 | Telegram bot (real group messages) | ✅ | ✅ | ✅ owner in the browser on 3110 (each step verified in the database) | ✅ **2026-11-20, local test AI adapter** (section below) | — |
| 4 | Slack (real Events API messages) | ✅ (minimal scopes since `0e3836d`) | ✅ | ❌ | ❌ | 🔒 app console changes (`slack.md` §3b) + credentials |
| 5 | Living Handover end to end | ✅ (Task 05) | ✅ pipeline + SQL suites | ✅ Playwright (`review/browser/VERIFICATION.md`) and live with Telegram data (v1 → v2, below) | Telegram only | — |
| 6 | Creator and incoming-member journeys | ✅ | ✅ actions + integration + SQL | ✅ Playwright; live: invitation reissue → accept → acknowledge (below) | — | — |
| 7 | Invitations and onboarding tours with saved progress | ✅ | ✅ | ✅ Playwright | — | Task 06 demo-account checks: owner sign-in still pending |
| 8 | Reliability and regression | ✅ | ✅ see below | ✅ HTTP smoke 20/20 (`72047c0`) | — | — |
| 9 | Submission documentation + judge-accessible link | ⏳ `submission/SUBMISSION.md` draft; `submission/DEPLOYMENT_PLAN.md` (options A/B/C) | — | — | — | 🔒 owner decisions: hosting option; billed AI provider (`AI_DATA_GOVERNANCE=gemini-paid-dpa`) |

The connector infrastructure (capture consent, capture windows, buffer, flush, versioned `chat_import` sources,
pending-version consent) is shared by all four providers and covered by synthetic tests for each of them. Only
**Telegram** has been verified live; Discord, Slack and GitHub have not.

## Last full regression (2026-11-20, on top of `2bebbed`)

Every command exited 0: typecheck ✅ · lint ✅ · contracts 116 · db 240 · parsers 630 · ui 425 · ai 312 · actions 277 ·
pipeline 237 · connectors 188 · integration 404 + 1 TODO (PI-11 D11-LIVE-1, live-provider test) · SQL 32/32 files
(incl. `99_connectors_r4` capture windows/tombstones and `99_connector_version_consent`) · integration SQL 15/15,
0 open findings.

Not run: `next build` (the running `next dev` preview on 3110 shares `.next`; last build ✅ at `72047c0`). HTTP smoke
last run at `72047c0` (20/20).

## Environment facts (2026-11-20)

* `baton-dev` (127.0.0.1:54321): unchanged by Round 4 connector work: 52 migrations (latest `20261118700300`), no
  connector tables; Task 05 demo handovers last updated 2026-11-17.
* `baton-connectors-test` (127.0.0.1:55321): isolated stack used for ALL connector verification; 55 migrations
  (through `20261120800300_connector_capture_windows`).
* 3110 runs `node scripts/connectors/preview-3110.mjs .env.connectors-test.local` (isolated stack, worker off).
* Tunnel: ngrok static domain `https://spilt-launch-mankind.ngrok-free.dev` with a traffic policy (outside the repo)
  that leaves only the seven exact provider webhook/callback paths public (path must equal raw path); every other path
  needs the tunnel login. 61/61 security checks passed on 2026-11-20 before the live tests.
* Host memory is tight with both stacks running; Claude Code's memory reaper stopped the tunnel and preview once
  (restarted after the owner freed memory).

## Live Telegram verification (2026-11-20, isolated stack, local test AI adapter)

**Scope.** Real messages typed by the owner in a real Telegram group, delivered by Telegram's webhook through the
tunnel to 3110, checked with read-only SQL on `baton-connectors-test` after every step. Processing used the built-in
**test AI adapter** (deterministic keyword rules), **not** a production AI provider. This is not evidence of
production readiness.

| Item | Value |
|---|---|
| Bot | `@BatonProjectContextBot` (privacy mode off; can read all group messages) |
| Group | "baton bot testing group" (installation `b3f0ed31`) |
| Handover | "R4 Telegram QA treasurer" `af38678a-0f73-4c89-afa2-055c3407575d` (creator `r4-tg-creator`) |
| Channel link | `0c0a0f66-49ff-4ecd-ab09-a440a836c08e` |
| Second group (pre-consent test) | "Baton Telegram QA 2", installation `ea4b1122`, link `c9cfac9d` → handover "R4 Telegram QA pre-consent" `8ed71056` |

**What was verified live** (delivery ids are Telegram `update_id`s; message bodies were never printed):

| Step | Evidence |
|---|---|
| Capture consent and buffering | Consent 2026-11-19 19:53:47Z opened capture window 1; messages `11` (later edited in the same window) and `12` buffered (`tg:22324217`–`219`) |
| A. Same-window edit | `tg:22324221` message + `tg:22324222` edit, both processed; one row (`15`) with the edit time recorded |
| B. Cross-window edit refused | `tg:22324223` processed (row `16`); Pause 03:46:53Z / Resume 03:47:09Z; edit `tg:22324224` **ignored `outside_capture_window`**; row `16` unchanged |
| C. Message sent while paused | Pause 03:53:26Z; `tg:22324225` **ignored `no_capturing_link`**; Resume 03:54:11Z; its edit `tg:22324226` **ignored `outside_capture_window`**; no row |
| D. Pre-consent message (second group) | `tg:22324227` (`my_chat_member`), `tg:22324228`, `tg:22324229` **ignored `no_installation`**; after `/handover` + consent (history 0 days, window opened 04:25:32Z) the edit `tg:22324232` **ignored `outside_capture_window`**; 0 rows |
| E. Regular ingestion | `tg:22324233` processed → row `31` on link `0c0a0f66`, exactly one row |
| Import v1 | **Bring in new messages** 04:30:33Z → `chat_import` source `95ff654c` version 1, 5 messages (`11`, `12`, `15`, `16`, `31`); buffer emptied |
| Processing v1 | Run `0a8dcdba` (full run, see "Findings"): succeeded; the test adapter extracted **nothing** from the original wording; TEST-A/B/E produced no points |
| Import v2 | Two new messages (`tg:22324234`, `tg:22324235`) → flush 05:13:19Z → **pending candidate** `c20d3113` (2 messages) |
| Pending-version consent | Recorded on the Processing page (fix `2bebbed`); activated `c20d3113` as version 2, `95ff654c` superseded 05:38:48Z but intact |
| Processing v2 | Run `552fa180`: **scoped update run** over `c20d3113` only; 2 new points: `a9cfbfc4` (next action: finance report due by Monday) and `bb433751` (owner: Asha, monthly reconciliation), each with exact, supporting evidence from v2; change detection: 2 × `new_information`, 0 `evidence_missing`; 11 earlier points unchanged (IDs, content, revisions, evidence) |
| Review and publication | Both `new_information` items accepted; 13 points approved; publication v2 `3af8cbcf` (13 points) at 05:45:31Z; publication v1 `2bcbb67b` (11 points) unchanged |
| Incoming member | Invitation reissued (`5aee6544`, old `b3eeb93e` revoked; email is not configured locally); `r4-tg-other` joined 05:57:40Z; acknowledgement `af81a2d9-5a50-4135-8446-1fd76c07de58` on `3af8cbcf` at 06:00:56Z; handover **acknowledged** |
| Disconnect channel | 06:15:12.158Z: link `0c0a0f66` **revoked**, capture window 3 closed, `connector.channel_unlinked` (actor `r4-tg-creator`, reason `creator_unlinked`, 0 buffered deleted). 06:15:29Z: next message event `tg:22324236` **ignored `no_capturing_link`**, 0 rows |
| Disconnect group (separate action) | 06:16:25.500Z: installation `b3f0ed31` **revoked**, `connector.installation_revoked` (actor `r4-tg-creator`, reason `creator_disconnected`). 06:16:26Z: `bot_removed` processed (the bot left the group); message event `tg:22324237` **ignored `installation_inactive`**. This was the owner's **Disconnect group** click, not a consequence of Disconnect channel |

**Evidence limits.** Baton stores no webhook message content, so `tg:22324236` is identified as the "TEST-F after
disconnect" message only by timing (first message event after the channel disconnect), and the content of
`tg:22324237` is unknown. The bot's "capture stopped" notice was seen in the group by the owner; it is not recorded in
Baton. Telegram's Bot API gives bots no history, so no earlier group messages were (or can be) imported.

**Final state (read-only, 2026-11-20 after 06:16Z).** Source v1 `95ff654c` parsed + superseded; v2 `c20d3113`
current + parsed (2 messages, 2 evidence quotes). Publication v1 `2bcbb67b` (11 points) and v2 `3af8cbcf` (13 points,
current). Acknowledgement `af81a2d9…` valid; handover acknowledged. Link `c9cfac9d` still capturing with 0 buffered;
installation `ea4b1122` active. The bot is no longer in "baton bot testing group". `baton-dev` unchanged.

### Findings and fixes from the live run

| Finding | Status |
|---|---|
| Edits of messages sent before consent or during a pause were accepted (consent boundary) | Fixed `1ce9cd6` (capture windows, migration `20261120800300`), verified live in A–D |
| GitHub comment deletions after a cross-window edit were refused, keeping the deleted text buffered | Fixed `cef6d12` (deletions are tombstones) — synthetic tests only |
| Processing page hid the consent checklist for a source added after a succeeded run | Fixed `740a34e` |
| A connector's version 2+ (uploaded candidate) could not be consented to anywhere in the UI | Fixed `2bebbed` (provider-agnostic; tests for all four providers), verified live with Telegram v2 |
| The test adapter did not extract the original finance wording | Test-adapter limitation (keyword rules); the v2 messages were reworded to match its rules. Real-provider extraction is not verified |
| A source added during review is processed in a **full** run (the scoped run covers version updates only); the 7 gap-answer points' newly verified evidence reopened their approvals (`auto_reopen`) | By design; re-approved before publishing. Scoped processing for added sources would need a migration (not done) |
| Uncited parsed messages are deleted at publication (§12.6) | By design: v1 kept its source row, but its 5 parsed messages (incl. TEST markers) are gone |

### Open risks (not fixed)

* **Delta versions vs change detection (version 3+):** each connector flush is a delta, but change detection compares
  the previous version's evidence with the new version as if it were a full replacement (`chat_import` counts as a
  document). Once v2's two messages carry evidence, a v3 flush would raise false `evidence_missing` items (blocking
  publication until dismissed; nothing is deleted). Do not create v3 until additive comparison for connector sources
  is implemented. Not exercised live.
* A deletion delivered while a link is **paused** is dropped, so the buffered original remains until the next flush
  (Slack/GitHub; Telegram has no deletion events). Documented in `connectors-contract.md` §4a.
* Slack: deleting a thread parent may arrive as `message_changed` with a tombstone subtype — not verified live.
* No live duplicate-delivery test (synthetic de-duplication tests only).

## Live provider verification matrix (evidence only; updated 2026-11-20)

| Verification | Telegram | Discord | Slack | GitHub |
|---|---|---|---|---|
| Code implemented | ✅ | ✅ | ✅ | ✅ |
| Credentials configured | ✅ (isolated env file) | ❌ 4 values missing | ❌ 3 values missing | ❌ App not registered |
| Provider app configured | ✅ privacy off, joins on, webhook → tunnel | ❌ | ❌ | ❌ |
| Installation successful | ✅ `b3f0ed31`, `ea4b1122` | ❌ | ❌ | ❌ |
| Consent verified | ✅ pre-consent and paused messages refused | ❌ | ❌ | ❌ |
| Real event received | ✅ `tg:22324217`–`238` | ❌ | ❌ | ❌ |
| Message persisted | ✅ buffered → v1 (5) and v2 (2) | ❌ | ❌ | ❌ |
| Correct handover updated | ✅ `af38678a` only; second group isolated | ❌ | ❌ | ❌ |
| Duplicate/retry tested | ⏳ delayed delivery after tunnel downtime observed; no duplicate test | ❌ | ❌ | ❌ |
| Disconnect tested | ✅ channel (`no_capturing_link`) and group (`installation_inactive`, bot removed) | ❌ | ❌ | ❌ |
| Real AI processing verified | ❌ test adapter only (billed key not approved) | ❌ | ❌ | ❌ |

Earlier history: browser verification of the core product (2026-11-19) in `review/browser/VERIFICATION.md`; audit
follow-ups `9b1ecb7` (connector sync secret), `0196881` (capture notices name the person), `e9d8b92` (test adapter
"new task" rule).
