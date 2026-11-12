# Baton overnight integration — task board

Lead branch: `feature/main-integration` (base `259da23`; implementation base `fbc21d4`). Interfaces:
`docs/integration/interfaces.md`. Workers are worktree-isolated subagents (not Agent Teams).
Status: `todo` · `in_progress` · `blocked` · `review` · `done`. Only the owner edits its paths.

Previous run archived (not applied): `../baton-first-run-recovery-20261112-030003/`.

## Workers

| Worker | Branch | Worktree | Model / effort | Isolation verified |
|---|---|---|---|---|
| lead | `feature/main-integration` | `baton` (original) | Opus 5.5 / high | n/a |
| backend | `feature/overnight-backend` | `.claude/worktrees/agent-abf31294540bea791` | Opus 5.5 (`claude-opus-5-5`) / high | yes: own toplevel and branch, ff to c3d938f, clean |
| ai-engine | `feature/overnight-ai` | `.claude/worktrees/agent-a4b158632f13c9b26` | Opus 5.5 (`claude-opus-5-5`) / high | yes: own toplevel and branch, ff to c3d938f, clean |
| pipeline | `feature/overnight-pipeline` | `.claude/worktrees/agent-a474a78d2fc1178de` | Opus 5.5 (`claude-opus-5-5`) / high | yes: own toplevel and branch, ff to c3d938f, clean |
| qa-security | `feature/overnight-qa` | `.claude/worktrees/agent-ad39947a82db36335` | Opus 5.5 (`claude-opus-5-5`) / high | yes: own toplevel and branch, ff to c3d938f, clean |

## Tasks

| # | Task | Owner | Depends on | Status | Tests | Blockers | Review |
|---|---|---|---|---|---|---|---|
| L1 | Forensic cleanup + archive | lead | — | done | archive hashes verified | — | — |
| L2 | Graphify graph + architecture read | lead | L1 | done | — | 23 SQL files not graphed (no tree_sitter_sql) | — |
| L3 | AI output schemas + caps in contracts (§11.8 rule 2, §12.10) | lead | L2 | done (`1f2b635`, `7257fae`) | contract 103/103, tsc | — | self |
| L4 | Interface agreements I1–I3 | lead | L3 | done | — | — | — |
| W0 | Isolation + model check, recon, DB requests | all workers | L4 | done | — | — | lead: approved |
| A1 | provider types, config (`provider_not_configured`), quote-check, fake adapter | ai-engine | W0 | done, merged `005438d` | lib/ai 78 | — | lead: approved |
| A2 | extract + verify-support with Zod + quote verification | ai-engine | A1 | done, merged `e2454cc` | lib/ai 153 | PI-11 needs the live suite (D11) | lead: approved |
| A3 | prompt-injection fixtures + suite (`fixtures/ai/**`) | ai-engine | A2 | done, merged `e2454cc` | 15 cases; live suite gated on D11 | — | lead: approved |
| L5 | DB-1..15, R1, R2 + QA-M1..M5/M7/L1/N1/L8 (migrations 20261112000100–0400, `lib/db`) | lead | W0 | done (`e642dbf`, `e3c685d`, `d4ca286`, `332be88`) | SQL 9/9, Tier P 6/6, lib/db 105 | DB-12/13 deferred | qa: verified (NOW HOLDS) |
| B1 | `lib/data` real facade | backend | W0 | done, merged `14f81af` | lib/actions 70 | — | lead: approved |
| B2 | `lib/actions/*` (§11.3) except startProcessing/previewSource | backend | W0 | done, merged `14f81af` | lib/actions 70 | — | lead: approved |
| B3 | previewSource + startProcessing + consent provider | backend | A1, P1, L5 | done, merged `6c15bf5` | lib/actions 81 | — | lead: approved |
| P1 | plan, pepper, worker skeleton, stage ordering | pipeline | A1, W0 | done, merged `c78d4c2` | pipeline 58 | — (DB-1, DB-14, DB-15) | lead: approved |
| P2 | extract, verify_quotes, verify_support on the real lib/ai | pipeline | P1, A2, L5 | done, merged `19a15eb` | pipeline 91 | DB-12/13 deferred | lead: approved |
| Q1 | Read-only security audit of foundations | qa-security | W0 | done (1 high, 9 medium, 8 low) | suites green | — | lead: triaged in interfaces.md |
| Q2 | Integration acceptance test plan | qa-security | Q1 | done (IT-01..IT-14) | — | — | lead: approved |
| Q3 | `tests/integration/**` incl. Tier E end-to-end | qa-security | Q2 approved | done, merged `1374837` | integration 214, Tier P 6/6, E2E 4/4 | — | lead: approved |
| L6 | Worker route `app/api/pipeline/drain` (+ cron secret) | lead | P1 | done | build | — | qa: IT-13 pending |
| L7 | UI rewiring mocks → `lib/data` + `lib/actions`; `/demo` stays on mocks; real invite flow; `/handover/[id]/published` | lead | B1, B2 | done `a617780` | build | Q3 decision pending (default applied) | qa: IT-07/14 pending |
| L8 | `.env.example`, test scripts | lead | — | done | `npm test` (all suites) | — | — |
| L9 | Integrate worker branches; full tests, SQL tests, tsc, lint, build; synthetic E2E | lead | all | done @ `1374837` | npm test all green; SQL 9/9; Tier P 6/6; E2E 4/4; tsc; lint; build | — | qa: verified |

## Open decisions (not resolved by agents)

- **D11** AI provider, models, retention: open → production AI is `provider_not_configured`.
- **D27** recovery store: open → erasure and purge fail closed.
- **Q1** identity hashes in `SourcePreview` returned to browsers (reconciliation §5).
- **Q3** where incoming/lead members read a publication (`/handover/[id]/published` proposal).
- **Q5** rate limits for uploads and AI calls.

## QA findings not fixed tonight (for the user)

- **PI-11** a verifier model that obeys an injected quote can mark it `supports`; only the live injection suite (after D11) can test this. Pre-production gate.
- **M1b** SQL checks that an exact quote occurs in the body, not that UTF-16 offsets point at it.
- **DB-12/13** run fencing on writers and atomic chunk inserts are deferred.

- **L2** `erase_participant`/`purge_handover` lack `_require_actor`: fix before D27 grants them.
- **L3** the DB accepts provider `fake`: only TypeScript config guards production.
- **L5** credential detector misses whitespace separators (`password Hunter2`): `lib/privacy` contract change.
- **L7** `X-Forwarded-For` trust per platform before production.
- **I1** incoming members can see member roles/ack flags and author profile UUIDs in publications.

## Release-readiness triage (2026-11-12)
- **Verified at `7c58e64`:** `npm test` 1,218/0; SQL 9/9; Tier P 6/6; E2E 4/4; tsc, eslint and build exit 0.
- **Fixed:** QA-L3 TypeScript half (`ab7847d`, ai-engine) and QA-M1b (`7b49486`, lead). Both are hard
  tests (qa-security `e82d87e`).
- **Gated:** QA-L2 before erasure/purge; QA-L5, DB-12, DB-13 and PI-11 before production AI.
- **Documented limitations:** QA-L3 DB half, QA-L7, QA-I1, QA-L1 DB half.
- **Proposals awaiting the owner:** `proposals/q1-opaque-participant-refs.md` (R9) and
  `proposals/q5-rate-limits.md`.
- **Independent QA review** of `2076b8b..5d6f412`: no regressions, no D11/D27 weakening, no secrets.
