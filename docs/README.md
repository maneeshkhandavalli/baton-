# Baton documentation

Start here. One line per document. Judges: read the first section, then `status/STATUS.md`.

## For judges (start here)

- [submission/SUBMISSION.md](submission/SUBMISSION.md): the hackathon submission (what Baton is, what was built, how to try it). Linked from the hackathon submission page.
- [submission/DEPLOYMENT_PLAN.md](submission/DEPLOYMENT_PLAN.md): judge-facing deployment plan (proposal; nothing is hosted from it yet).
- [status/STATUS.md](status/STATUS.md): live completion checklist, what works end to end and how it was verified.
- [status/AI_RECOVERY.md](status/AI_RECOVERY.md): record of the AI pipeline recovery (2026-11-20).
- [review/README.md](review/README.md): screenshots and browser verification evidence, indexed.

## Product

- [product/journey-audit.md](product/journey-audit.md): audit of the application journeys (creator and incoming owner).
- [product/decision-timeline-plan.md](product/decision-timeline-plan.md): the decision timeline (Timeline tab at `/handover/[id]/timeline` and the demo's Receive step): plan, audit amendments and build notes.
- [design/design-system.md](design/design-system.md): the Baton design system. [design/design-decisions.md](design/design-decisions.md): UI decisions. [design/AI-SLOP-AUDIT.md](design/AI-SLOP-AUDIT.md): landing audit. [design/landing/](design/landing/): landing reference analysis.

## Architecture

- [architecture/shared-contracts.md](architecture/shared-contracts.md): the authoritative contracts (enums, schemas, DTOs, data model, access control, pipeline). Referenced by section number from the code.
- [architecture/contract-reconciliation.md](architecture/contract-reconciliation.md): Revision 8 reconciliation of the contracts.
- [architecture/autonomous-worker.md](architecture/autonomous-worker.md): scheduled background pipeline worker.
- [architecture/living-handover-versions.md](architecture/living-handover-versions.md): source versions and change detection (Living Handover).
- [architecture/privacy-and-data-protection.md](architecture/privacy-and-data-protection.md): privacy model, pseudonymisation, retention policy.
- [architecture/proposals/](architecture/proposals/): retention, address masking, exclusions in documents.

## AI

- [ai/ai-pipeline.md](ai/ai-pipeline.md): AI and pipeline reliability.
- [ai/ai-extraction-and-verification.md](ai/ai-extraction-and-verification.md): extraction, evidence verification, providers (Gemini, Omega), evaluation.

## Connectors

- [connectors/connectors-contract.md](connectors/connectors-contract.md): the provider-neutral connector contract.
- Setup guides: [github](connectors/github.md), [slack](connectors/slack.md), [discord](connectors/discord.md), [telegram](connectors/telegram.md); [CHECKLIST.md](connectors/CHECKLIST.md) (owner checklist), [SLACK_SCOPE_AUDIT.md](connectors/SLACK_SCOPE_AUDIT.md).

## Operations

- [operations/migrations.md](operations/migrations.md): migrations, hosted-apply readiness and rollback recipes.
- [operations/release-guard.md](operations/release-guard.md): the publish guard and release reliability.
- [operations/LIVE_TEST_PLAN.md](operations/LIVE_TEST_PLAN.md), [ISOLATED_DB_PROPOSAL.md](operations/ISOLATED_DB_PROPOSAL.md), [OWNER_INPUTS.md](operations/OWNER_INPUTS.md): live provider tests, isolated connector database, owner inputs.
- Environment variables: see `.env.example` at the repo root.

## History (kept for traceability, not current)

- `history/round3/`: Round 3 plan, changelog, completion audit, Task 06 contracts, QA findings (`qa/`), and Task 06 screenshots.
- `history/integration/`: the Round 2 overnight integration (interfaces, task board, proposals).
- `history/design/`: UI3 collaboration notes, reviews, research and route verification.
- Round 4 records live in `status/`, `connectors/`, `operations/` and `review/` (there is no separate round4 folder any more).

## Moved paths (2026-11-20 reorganisation)

Old links to the repository (for example the GitHub blob URL of `docs/round4/STATUS.md`) need the new path below. `docs/submission/SUBMISSION.md` and `docs/submission/DEPLOYMENT_PLAN.md` did NOT move. `docs/architecture/shared-contracts.md`, `docs/architecture/contract-reconciliation.md`, `docs/design/design-system.md`, `docs/design/design-decisions.md` and `docs/design/AI-SLOP-AUDIT.md` did not move either. Screenshot folders are shown as `dir/*`.

| Old path | New path |
|---|---|
| `docs/design/agent-ownership.md` | `docs/history/design/agent-ownership.md` |
| `docs/design/design-reviews.md` | `docs/history/design/design-reviews.md` |
| `docs/design/integration-status.md` | `docs/history/design/integration-status.md` |
| `docs/design/qa/ui3-functional-qa.md` | `docs/history/design/qa/ui3-functional-qa.md` |
| `docs/design/research/ui3-research.md` | `docs/history/design/research/ui3-research.md` |
| `docs/design/route-verification.md` | `docs/history/design/route-verification.md` |
| `docs/integration/final-integration-pr.md` | `docs/history/integration/final-integration-pr.md` |
| `docs/integration/interfaces.md` | `docs/history/integration/interfaces.md` |
| `docs/integration/proposals/q1-opaque-participant-refs.md` | `docs/history/integration/proposals/q1-opaque-participant-refs.md` |
| `docs/integration/proposals/q5-rate-limits.md` | `docs/history/integration/proposals/q5-rate-limits.md` |
| `docs/integration/task-board.md` | `docs/history/integration/task-board.md` |
| `docs/landing/loopsii-analysis.md` | `docs/design/landing/loopsii-analysis.md` |
| `docs/landing/loopsii-reference-breakdown.md` | `docs/design/landing/loopsii-reference-breakdown.md` |
| `docs/landing/screens/*` | `docs/review/landing-early/*` |
| `docs/proposals/address-masking.md` | `docs/architecture/proposals/address-masking.md` |
| `docs/proposals/exclusions-in-documents.md` | `docs/architecture/proposals/exclusions-in-documents.md` |
| `docs/proposals/retention.md` | `docs/architecture/proposals/retention.md` |
| `docs/qa/browser-scripts.md` | `docs/history/round3/qa/browser-scripts.md` |
| `docs/qa/pi11-residuals.md` | `docs/history/round3/qa/pi11-residuals.md` |
| `docs/qa/round3-findings.md` | `docs/history/round3/qa/round3-findings.md` |
| `docs/qa/round3-test-plan.md` | `docs/history/round3/qa/round3-test-plan.md` |
| `docs/round3/CHANGELOG_R3.md` | `docs/history/round3/CHANGELOG_R3.md` |
| `docs/round3/DEV_PROJECT_RESTORE_PLAN.md` | `docs/history/round3/DEV_PROJECT_RESTORE_PLAN.md` |
| `docs/round3/PRODUCT_COMPLETION_AUDIT.md` | `docs/history/round3/PRODUCT_COMPLETION_AUDIT.md` |
| `docs/round3/REMAINING_WORK.md` | `docs/history/round3/REMAINING_WORK.md` |
| `docs/round3/ai-extraction-and-verification.md` | `docs/ai/ai-extraction-and-verification.md` |
| `docs/round3/ai-pipeline.md` | `docs/ai/ai-pipeline.md` |
| `docs/round3/autonomous-worker.md` | `docs/architecture/autonomous-worker.md` |
| `docs/round3/living-handover-versions.md` | `docs/architecture/living-handover-versions.md` |
| `docs/round3/migrations.md` | `docs/operations/migrations.md` |
| `docs/round3/plan.md` | `docs/history/round3/plan.md` |
| `docs/round3/privacy-and-data-protection.md` | `docs/architecture/privacy-and-data-protection.md` |
| `docs/round3/release-guard.md` | `docs/operations/release-guard.md` |
| `docs/round3/task06-backend-contract.md` | `docs/history/round3/task06-backend-contract.md` |
| `docs/round3/task06-contract.md` | `docs/history/round3/task06-contract.md` |
| `docs/round3/task06-qa/*` | `docs/history/round3/task06-qa/*` |
| `docs/round3/task06-ui-evidence/*` | `docs/history/round3/task06-ui-evidence/*` |
| `docs/round4/AI_RECOVERY.md` | `docs/status/AI_RECOVERY.md` |
| `docs/round4/STATUS.md` | `docs/status/STATUS.md` |
| `docs/round4/connectors-contract.md` | `docs/connectors/connectors-contract.md` |
| `docs/round4/review/README.md` | `docs/review/README.md` |
| `docs/round4/review/app/*` | `docs/review/app/*` |
| `docs/round4/review/browser/*` | `docs/review/browser/*` |
| `docs/round4/review/connectors/*` | `docs/review/connectors/*` |
| `docs/round4/review/landing/*` | `docs/review/landing/*` |
| `docs/round4/setup/CHECKLIST.md` | `docs/connectors/CHECKLIST.md` |
| `docs/round4/setup/ISOLATED_DB_PROPOSAL.md` | `docs/operations/ISOLATED_DB_PROPOSAL.md` |
| `docs/round4/setup/LIVE_TEST_PLAN.md` | `docs/operations/LIVE_TEST_PLAN.md` |
| `docs/round4/setup/OWNER_INPUTS.md` | `docs/operations/OWNER_INPUTS.md` |
| `docs/round4/setup/SLACK_SCOPE_AUDIT.md` | `docs/connectors/SLACK_SCOPE_AUDIT.md` |
| `docs/round4/setup/discord.md` | `docs/connectors/discord.md` |
| `docs/round4/setup/github.md` | `docs/connectors/github.md` |
| `docs/round4/setup/slack.md` | `docs/connectors/slack.md` |
| `docs/round4/setup/telegram.md` | `docs/connectors/telegram.md` |
| `docs/round4/ux/journey-audit.md` | `docs/product/journey-audit.md` |
| `docs/design/collab/**` (brand, demo, handover, shell) | `docs/history/design/collab/**` |
