# Baton overnight integration — task board

Lead branch: `feature/main-integration` (base `259da23`, contracts `1f2b635`). Interfaces:
`docs/integration/interfaces.md`. Workers are worktree-isolated subagents (not Agent Teams).
Status: `todo` · `in_progress` · `blocked` · `review` · `done`. Only the owner edits its paths.

Previous run archived (not applied): `../baton-first-run-recovery-20261112-030003/`.

## Workers

| Worker | Branch | Worktree | Model / effort | Isolation verified |
|---|---|---|---|---|
| lead | `feature/main-integration` | `baton` (original) | Opus 5.5 / high | n/a |
| backend | `feature/overnight-backend` | pending | pending | pending |
| ai-engine | `feature/overnight-ai` | pending | pending | pending |
| pipeline | `feature/overnight-pipeline` | pending | pending | pending |
| qa-security | `feature/overnight-qa` | pending | pending | pending |

## Tasks

| # | Task | Owner | Depends on | Status | Tests | Blockers | Review |
|---|---|---|---|---|---|---|---|
| L1 | Forensic cleanup + archive | lead | — | done | archive hashes verified | — | — |
| L2 | Graphify graph + architecture read | lead | L1 | done | — | 23 SQL files not graphed (no tree_sitter_sql) | — |
| L3 | AI output schemas in contracts (§11.8 rule 2) | lead | L2 | done | contract tests 102/102, tsc | — | self |
| L4 | Interface agreements I1–I3 | lead | L3 | done | — | — | — |
| W0 | Isolation + model check, recon, DB requests | all workers | L4 | todo | — | — | lead |
| A1 | provider types, config (`provider_not_configured`), quote-check, fake adapter | ai-engine | W0 | todo | unit | — | lead |
| A2 | extract + verify-support with Zod + quote verification | ai-engine | A1 | todo | unit | — | lead, qa |
| A3 | prompt-injection fixtures + suite (`fixtures/ai/**`) | ai-engine | A2 | todo | suite | — | qa |
| L5 | DB requests: worker reads, preview target (additive migration + `lib/db` + SQL tests) | lead | W0 | todo | SQL tests | — | qa |
| B1 | `lib/data` real facade | backend | W0 | todo | unit | — | lead |
| B2 | `lib/actions/*` (§11.3) except startProcessing/previewSource | backend | W0 | todo | unit | — | lead, qa |
| B3 | previewSource + startProcessing + consent provider | backend | A1, P1, L5 | todo | unit | — | lead, qa |
| P1 | plan, pepper, worker skeleton, stage ordering | pipeline | A1, W0 | todo | unit | stage ordering vs `max_attempts` | lead |
| P2 | parse, extract, verify_quotes, verify_support, analyze, prepare_review | pipeline | P1, A2, L5 | todo | unit + synthetic run | — | lead, qa |
| Q1 | Read-only security audit of foundations | qa-security | W0 | todo | — | — | lead |
| Q2 | Integration acceptance test plan | qa-security | Q1 | todo | — | lead approval | lead |
| Q3 | `tests/integration/**` | qa-security | Q2 approved | todo | integration | — | lead |
| L6 | Worker route `app/api/pipeline/drain` (+ cron secret) | lead | P1 | todo | — | — | qa |
| L7 | UI rewiring mocks → `lib/data` + `lib/actions`; `/demo` stays on mocks | lead | B1, B2 | todo | build | Q3 (published route) | qa |
| L8 | `.env.example`, test scripts | lead | — | todo | — | — | — |
| L9 | Integrate worker branches; full tests, SQL tests, tsc, lint, build; synthetic E2E | lead | all | todo | all | — | qa |

## Open decisions (not resolved by agents)

- **D11** AI provider, models, retention: open → production AI is `provider_not_configured`.
- **D27** recovery store: open → erasure and purge fail closed.
- **Q1** identity hashes in `SourcePreview` returned to browsers (reconciliation §5).
- **Q3** where incoming/lead members read a publication (`/handover/[id]/published` proposal).
- **Q5** rate limits for uploads and AI calls.
