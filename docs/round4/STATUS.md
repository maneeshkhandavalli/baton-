# Hackathon completion checklist (live)

Deadline: **2026-11-20 23:59 IST**. Branch `work/r4-integration` (GitHub remote `gh`). Preview
http://localhost:3110 (`next dev` for browser verification; see review/browser/VERIFICATION.md). Update this file at every checkpoint; never mark a column without evidence.

Legend: ✅ done · ⏳ in progress · ❌ not done · 🔒 blocked by owner action (see "Blocked on").

| # | Deliverable | Implemented | Automated tests | Browser verified | Live provider verified | Blocked on |
|---|---|---|---|---|---|---|
| 1 | GitHub integration (real repo events) | ✅ | ✅ connectors suite (synthetic) | ❌ | ❌ | 🔒 GitHub App registration + credentials; isolated DB start; tunnel |
| 2 | Discord bot (real channel messages) | ✅ | ✅ | ❌ | ❌ | 🔒 credentials; isolated DB start; tunnel |
| 3 | Telegram bot (real group messages) | ✅ (private connect link since `72047c0`) | ✅ | ❌ | ❌ | 🔒 bot token + webhook secret; isolated DB start; tunnel |
| 4 | Slack (real Events API messages) | ✅ (minimal scopes since `0e3836d`) | ✅ | ❌ | ❌ | 🔒 app console changes (`slack.md` §3b) + credentials; isolated DB start; tunnel |
| 5 | Living Handover end to end | ✅ (Task 05) | ✅ pipeline + SQL suites | ✅ Playwright: new version → change detection (2 contradictions) → corrections → v2 published → re-acknowledged (`review/browser/VERIFICATION.md`) | — | — |
| 6 | Creator and incoming-member journeys | ✅ | ✅ actions + integration + SQL | ✅ Playwright: sign-up, wizard, processing, review, gaps, publish, invite, accept, role boundaries | — | — |
| 7 | Invitations and onboarding tours with saved progress | ✅ | ✅ | ✅ Playwright: tours (creator + incoming), persistence (server metadata), replay/skip, reissue, used/accepted links | — | Task 06 demo-account checks: owner sign-in still pending |
| 8 | Reliability and regression | ✅ audit fixes `72047c0` | ✅ see below | ✅ HTTP smoke 20/20 | — | — |
| 9 | Submission documentation + judge-accessible link | ⏳ `docs/submission/SUBMISSION.md` draft | — | — | — | 🔒 owner decision on hosting (deployment not authorised yet) |

## Last full regression (`72047c0`, 2026-11-19)

typecheck ✅ · lint ✅ · contracts 116 · db 240 · parsers 630 · ui 406 · connectors 146 · ai 311 · actions 277 ·
pipeline 236 · integration 404 + 1 TODO (PI-11 D11-LIVE-1, live-provider test) · SQL 31/31 files · integration SQL
all pass, 0 open findings · production build ✅ · HTTP smoke 20/20 (public pages 200, workspace routes → /login,
dev previews 404, unconfigured connector routes 404, sync/drain 401 without the secret).

## Environment facts

* `baton-dev` (127.0.0.1:54321): healthy; Task 06 invitation migrations recorded; connector migrations NOT applied
  (by design). Task 05 demo handovers unchanged (last update 2026-11-17).
* Isolated connector stack: project folder prepared at
  `C:\Users\manee\Documents\programing\baton-connectors-testdb` (config + 54 migrations from `72047c0`); **not
  started** — the start command needs the owner (see the hand-off in the latest report).
* Host memory: 2.6 GB free before any isolated stack (2026-11-19); a `javaw` process uses ~2.3 GB.

## Browser verification (Playwright MCP, 2026-11-19)

See `review/browser/VERIFICATION.md`. Defects found and fixed in the run: landing compact header (`95c6016`), tour
counter (`5a734ee`), incoming Gaps page (`d9acd00`). Environment: `BATON_SITE_URL` in `.env.local` points at 3106
(overridden for the 3110 process); the test AI adapter only runs under `next dev`.

## Audit follow-ups (2026-11-19)

* Connector sync uses its own `CONNECTOR_SYNC_SECRET`; `CRON_SECRET` only drives the pipeline (`9b1ecb7`).
* Capture notices name the person who connected / paused / stopped (Baton display name only) (`0196881`).
