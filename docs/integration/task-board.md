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
| A1 | provider types, config (`provider_not_configured`), quote-check, fake adapter | ai-engine | W0 | todo | unit | — | lead |
| A2 | extract + verify-support with Zod + quote verification | ai-engine | A1 | todo | unit | — | lead, qa |
| A3 | prompt-injection fixtures + suite (`fixtures/ai/**`) | ai-engine | A2 | todo | suite | — | qa |
| L5 | DB requests DB-1..11, R1, R2 + QA-M1..M5/M7/L1 fixes (migration 20261112000100, `lib/db`) | lead | W0 | done (`e642dbf`) | SQL 9/9, lib/db 105/105 | DB-12/13 deferred | qa: pending |
| B1 | `lib/data` real facade | backend | W0 | todo | unit | — | lead |
| B2 | `lib/actions/*` (§11.3) except startProcessing/previewSource | backend | W0 | todo | unit | — | lead, qa |
| B3 | previewSource + startProcessing + consent provider | backend | A1, P1, L5 | todo | unit | — | lead, qa |
| P1 | plan, pepper, worker skeleton, stage ordering | pipeline | A1, W0 | todo | unit | stage ordering vs `max_attempts` | lead |
| P2 | parse, extract, verify_quotes, verify_support, analyze, prepare_review | pipeline | P1, A2, L5 | todo | unit + synthetic run | — | lead, qa |
| Q1 | Read-only security audit of foundations | qa-security | W0 | done (1 high, 9 medium, 8 low) | suites green | — | lead: triaged in interfaces.md |
| Q2 | Integration acceptance test plan | qa-security | Q1 | done (IT-01..IT-14) | — | — | lead: approved |
| Q3 | `tests/integration/**` | qa-security | Q2 approved | todo | integration | — | lead |
| L6 | Worker route `app/api/pipeline/drain` (+ cron secret) | lead | P1 | todo | — | — | qa |
| L7 | UI rewiring mocks → `lib/data` + `lib/actions`; `/demo` stays on mocks | lead | B1, B2 | todo | build | Q3 (published route) | qa |
| L8 | `.env.example`, test scripts | lead | — | env done (`a1557d4`); scripts todo | — | — | — |
| L9 | Integrate worker branches; full tests, SQL tests, tsc, lint, build; synthetic E2E | lead | all | todo | all | — | qa |

## Open decisions (not resolved by agents)

- **D11** AI provider, models, retention: open → production AI is `provider_not_configured`.
- **D27** recovery store: open → erasure and purge fail closed.
- **Q1** identity hashes in `SourcePreview` returned to browsers (reconciliation §5).
- **Q3** where incoming/lead members read a publication (`/handover/[id]/published` proposal).
- **Q5** rate limits for uploads and AI calls.

## QA findings not fixed tonight (for the user)

- **L2** `erase_participant`/`purge_handover` lack `_require_actor`: fix before D27 grants them.
- **L3** the DB accepts provider `fake`: only TypeScript config guards production.
- **L5** credential detector misses whitespace separators (`password Hunter2`): `lib/privacy` contract change.
- **L7** `X-Forwarded-For` trust per platform before production.
- **I1** incoming members can see member roles/ack flags and author profile UUIDs in publications.
