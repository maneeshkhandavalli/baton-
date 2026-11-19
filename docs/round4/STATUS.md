# Hackathon completion checklist (live)

Deadline: **2026-11-20 23:59 IST**. Branch `work/r4-integration` (GitHub remote `gh`). Preview
http://localhost:3110 (`next dev` for browser verification; see review/browser/VERIFICATION.md). Update this file at every checkpoint; never mark a column without evidence.

Legend: ✅ done · ⏳ in progress · ❌ not done · 🔒 blocked by owner action (see "Blocked on").

| # | Deliverable | Implemented | Automated tests | Browser verified | Live provider verified | Blocked on |
|---|---|---|---|---|---|---|
| 1 | GitHub integration (real repo events) | ✅ | ✅ connectors suite (synthetic) | ❌ | ❌ | 🔒 GitHub App registration + credentials; tunnel (ngrok token) |
| 2 | Discord bot (real channel messages) | ✅ | ✅ | ❌ | ❌ | 🔒 credentials; tunnel (ngrok token) |
| 3 | Telegram bot (real group messages) | ✅ (private connect link since `72047c0`) | ✅ | ❌ | ❌ | 🔒 bot token + webhook secret; tunnel (ngrok token) |
| 4 | Slack (real Events API messages) | ✅ (minimal scopes since `0e3836d`) | ✅ | ❌ | ❌ | 🔒 app console changes (`slack.md` §3b) + credentials; tunnel (ngrok token) |
| 5 | Living Handover end to end | ✅ (Task 05) | ✅ pipeline + SQL suites | ✅ Playwright: new version → change detection (2 contradictions) → corrections → v2 published → re-acknowledged; v3 → 2 × New information (`review/browser/VERIFICATION.md`) | — | — |
| 6 | Creator and incoming-member journeys | ✅ | ✅ actions + integration + SQL | ✅ Playwright: sign-up, wizard, processing, review, gaps, publish, invite, accept, role boundaries | — | — |
| 7 | Invitations and onboarding tours with saved progress | ✅ | ✅ | ✅ Playwright: tours (creator + incoming), persistence (server metadata), replay/skip, reissue, used/accepted links | — | Task 06 demo-account checks: owner sign-in still pending |
| 8 | Reliability and regression | ✅ audit fixes `72047c0` | ✅ see below | ✅ HTTP smoke 20/20 | — | — |
| 9 | Submission documentation + judge-accessible link | ⏳ `submission/SUBMISSION.md` draft; `submission/DEPLOYMENT_PLAN.md` (options A/B/C) | — | — | — | 🔒 owner decisions: hosting option; billed AI provider (`AI_DATA_GOVERNANCE=gemini-paid-dpa`) |

## Last full regression (`72047c0`, 2026-11-19)

typecheck ✅ · lint ✅ · contracts 116 · db 240 · parsers 630 · ui 406 · connectors 146 · ai 311 · actions 277 ·
pipeline 236 · integration 404 + 1 TODO (PI-11 D11-LIVE-1, live-provider test) · SQL 31/31 files · integration SQL
all pass, 0 open findings · production build ✅ · HTTP smoke 20/20 (public pages 200, workspace routes → /login,
dev previews 404, unconfigured connector routes 404, sync/drain 401 without the secret).

## Environment facts

* `baton-dev` (127.0.0.1:54321): healthy; Task 06 invitation migrations recorded; connector migrations NOT applied
  (by design). Task 05 demo handovers unchanged (last update 2026-11-17).
* Isolated connector stack **running** since 2026-11-19 (`baton-connectors-test`, 127.0.0.1:55321, migrations from
  `91bcafe`); baton-dev verified unchanged against the recorded baseline. 3110 env file `.env.connectors-test.local`
  generated (provider lines empty); 3110 keeps using baton-dev until provider credentials are in.
* Host memory: 2.8 GB free before the isolated start, 2.5 GB after.
* Live provider steps and evidence to capture: `setup/LIVE_TEST_PLAN.md`. Deployment options: `../submission/DEPLOYMENT_PLAN.md`.

## Browser verification (Playwright MCP, 2026-11-19)

See `review/browser/VERIFICATION.md`. Defects found and fixed in the run: landing compact header (`95c6016`), tour
counter (`5a734ee`), incoming Gaps page (`d9acd00`). Environment: `BATON_SITE_URL` in `.env.local` points at 3106
(overridden for the 3110 process); the test AI adapter only runs under `next dev`.

## Audit follow-ups (2026-11-19)

* Connector sync uses its own `CONNECTOR_SYNC_SECRET`; `CRON_SECRET` only drives the pipeline (`9b1ecb7`).
* Capture notices name the person who connected / paused / stopped (Baton display name only) (`0196881`).
* Living Handover "new task not flagged" (browser run): root cause was the built-in test adapter's keyword rules,
  not the detector; fixed and re-verified in the browser with version 3 (`e9d8b92`).

## Live provider verification matrix (evidence only; updated 2026-11-19)

| Verification | Telegram | Discord | Slack | GitHub |
|---|---|---|---|---|
| Code implemented | ✅ | ✅ | ✅ | ✅ |
| Credentials configured | ❌ token missing (username + webhook secret set) | ❌ 4 values missing | ❌ 3 values missing | ❌ App not registered; webhook secret generated |
| Provider app configured | ❌ owner: BotFather privacy/joins | ❌ owner: intent + redirects | ❌ owner: `slack.md` §3b | ❌ owner: register App |
| Installation successful | ❌ | ❌ | ❌ | ❌ |
| Consent verified | ❌ | ❌ | ❌ | ❌ |
| Real event received | ❌ | ❌ | ❌ | ❌ |
| Message persisted | ❌ | ❌ | ❌ | ❌ |
| Correct handover updated | ❌ | ❌ | ❌ | ❌ |
| Duplicate/retry tested | ❌ (synthetic tests only) | ❌ | ❌ | ❌ |
| Disconnect tested | ❌ | ❌ | ❌ | ❌ |
| Real AI processing verified | ❌ (test adapter only; billed key not approved) | ❌ | ❌ | ❌ |

Ready on our side: isolated stack running; 3110 switched to it (`preview-3110.mjs`, Supabase 127.0.0.1:55321,
verified: a new account exists only there); synthetic Telegram test handover "R4 Telegram QA treasurer" published
(v1) on the isolated stack; credential checker `scripts/connectors/check-credentials.mjs`; ngrok policy prepared.
Blocked on: ngrok token (the configured one is rejected, ERR_NGROK_105) and provider credentials
(`setup/OWNER_INPUTS.md`).
