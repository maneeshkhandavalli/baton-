# Round 3: AI and pipeline reliability (Agent 4)

Scope: QA-L5 (credential masking), DB-12 (stale-worker fencing), DB-13 (atomic chunk persistence),
PI-11 (verifier prompt injection), QA-R3-01 (empty runs) and E4 (recovery). No AI provider is selected,
configured or enabled. D11 stays open, D27 stays fail-closed, and the fake adapter remains
development/test only (production refusal: `lib/ai/__tests__/config.test.ts`,
`tests/integration/r3-production-refusal.test.ts`).

## Migrations, in apply order

**Every one of these requires approval before any hosted apply.** All are additive: new functions,
`CREATE OR REPLACE` with an unchanged signature and grants, one nullable column, or grant changes.

| # | File | What it does | Requires |
|---|---|---|---|
| 1 | `20261113300100_pipeline_fencing.sql` | DB-12: `_pipeline_claim` plus the fenced writers `pipeline_set_job_provenance`, `pipeline_persist_parsed_source`, `pipeline_mark_source_parse_failed`, `pipeline_record_quote_check`, `pipeline_record_support_verdict`, `pipeline_create_system_gap_question`, `pipeline_set_point_sort_keys`. DB-13: `pipeline_store_extract_chunk` (one chunk's points, evidence and checkpoint in one transaction). A stale claim raises SQLSTATE `BTLL0`. | all earlier migrations (uses `persist_parsed_source`, `add_source_quote_evidence`, `insert_extracted_point`, `_require_active_run`, `_lock_handover_for_share`) |
| 2 | `20261113300200_job_yield_checkpoint.sql` | E4: adds `processing_jobs.claim_progress_done` (set by a trigger at claim time) and replaces `complete_processing_job`, so a checkpointing `yield` is judged against the claim's starting progress and no longer costs an attempt. | 1 is not required, but apply in order |
| 3 | `20261113300300_extract_chunk_inferred_points.sql` | DB-13 follow-up: `pipeline_store_extract_chunk` keeps inferred points (a rationale and no citation). It still drops a claim whose citations were all refused and that has no rationale. | 1 |
| 4 | `20261113300400_start_processing_requires_jobs.sql` | QA-R3-01: `start_processing` refuses a null, non-array or empty job list (`BTVF0`). This check runs after all the existing ones. | — |
| 5 | `20261113300500_revoke_unfenced_pipeline_writers.sql` | DB-12-LEGACY: revokes the 8 unfenced writers from `public`, `anon`, `authenticated` and `service_role`. `mark_source_parse_failed` stays granted because `lib/db/storage.ts` still calls it. | 1 (the fenced twins call the revoked functions as their owner); the fixture updates in the lead SQL and IT-SQL suites |
| 6 | `20261113300600_revoke_mark_source_parse_failed.sql` | DB-12-LEGACY part 2: revokes `mark_source_parse_failed`. Since d4f4d46 (Agent 3) and 0d222b3, the parse job writes an integrity mismatch through the fenced `pipeline_mark_source_parse_failed`. | 1; fixture updates (it10:113, it18:41) |
| 7 | `20261113300700_processing_status_partial.sql` | E4 (lead-approved): `api_get_processing_status` (same signature, grants and shape) reports per-stage `partial`, and open jobs report `queued`/`running` instead of `failed`. | — (the read model in `lib/db/mappers.ts` accepts `partial` since the same commit) |

**Code dependency.** The worker code since `ab96beb` (`lib/db/pipeline.ts`) calls only the
`pipeline_*` functions. Any database the worker runs against (including hosted dev) therefore needs
migrations **1–3** first. Without them, every run fails at once with `precondition_failed` /
`db_schema_outdated`, visible in run state and never retried. There is no fallback to the unfenced
writers: a fallback would defeat DB-12. Migration 4 does not affect the worker. Apply migration 5 only
together with the fixture updates.

## DB-12 / DB-13 in one paragraph

A worker's claim is the job id plus its attempt. Every write the pipeline makes takes that claim. The
database locks the handover (FOR SHARE) and then the job row, and refuses the write unless all of these
hold: the job is running at that attempt, its lease has not expired, its run is still active, the job's
stage may perform this write, and the target row belongs to the job's handover (and, for per-source
stages, to its source). Completion, reclaim and reaping all lock the same job row, so a write and a
claim change never interleave. Extraction stores each chunk's points, evidence and `progress_done`
checkpoint in one transaction. A retry resumes after the last committed chunk, and a repeated chunk is
a no-op. Tests: `supabase/tests/sql/98_pipeline_fencing.sql`, `lib/db/__tests__/pipeline-fencing.test.ts`,
`lib/pipeline/__tests__/{ai-stages,runner,recovery}.test.ts`.

## PI-11: the live-suite gate

Production AI may be enabled only when both layers below pass:

1. **Deterministic, provider-independent, always on** (`npm run test:ai`). `lib/ai/injection-guard.ts`
   screens the claim, quote and context the verifier sees, on a normalised view (NFKC, format
   characters removed, Cyrillic/Greek homoglyphs folded). It looks for instructions addressed to an
   automated checker: ignore-previous-instructions, role tags with orders, chat-template tokens, direct
   address of an AI with an order, verdict directives, and JSON verdicts. When it finds one,
   `verifySupport` replaces `supports`/`partial` with `irrelevant` and a fixed rationale.
   `modelVerdict` and the pattern ids (never the text) are kept. Quote existence is checked
   deterministically: `verify_quotes` plus the SQL plausibility check (QA-M1); DB-8 offers only
   verified quotes. As a result, an injected quote cannot make a point `sourced` on a compromised
   model's word. Fixtures: `fixtures/ai/prompt-injection/cases/PI-01…PI-18`; PI-16 covers obfuscation,
   PI-17 injection in context, and PI-18 is a benign control.
2. **Live suite** (`lib/ai/__tests__/prompt-injection.live.test.ts`). It runs every fixture against the
   production provider being enabled and asserts the model's own verdict (`modelVerdict`, before the
   guard), because paraphrased injections can evade the patterns. The gate is 100% pass on that exact
   provider, model and prompt version, re-run after any change to any of them. It is skipped while no
   production provider is configured, which remains the case: D11 is open and nothing here selects one.

## Run-state notes for the UI (E4)

- New reason tokens on jobs and runs: `db_schema_outdated` (run-fatal, `precondition_failed`) and
  `no_jobs` (a legacy zero-job run, closed as failed).
- A run in which some sources failed and at least one extract succeeded finishes `succeeded`. The
  failed sources stay visible on their jobs and sources.
- Stage status (`ProcessingStatus.run.stages[].status`) is `RunStatus | "partial"`. `partial` means all of
  the stage's jobs are terminal and some succeeded while the rest failed or were skipped, or the run
  succeeded although this stage's jobs failed or were skipped. A stage with open jobs is
  `running`/`queued`, never `failed`. The run status itself is unchanged.
