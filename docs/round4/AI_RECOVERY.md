# AI pipeline recovery (2026-11-20)

Evidence-only record. Nothing in production was changed while writing it.

## Root cause (verified from Git history, Vercel and read-only production queries)

Round 2 production (`8946ecb`, deployed 2026-11-15) ran real Gemini: `AI_PROVIDER=gemini` + `AI_API_KEY` +
`AI_MODEL_EXTRACT=gemini-3.6-flash` / `AI_MODEL_VERIFY=gemini-3.5-flash-lite` was enough
(`git show 8946ecb:lib/ai/config.ts`). The production database records 7 processing runs with provider `gemini`.

The deployment of master `166d257` (2026-11-17 16:42 UTC, Round 3) shipped code that needs configuration and
migrations production never received. Three independent blockers, all fail-closed by design (no code defect found):

| # | Introduced by | Requirement | Production state | Effect |
|---|---|---|---|---|
| 1 | `1ca9e3c` (R3 Task 02) | `AI_DATA_GOVERNANCE=gemini-paid-dpa` (operator attests the key belongs to a billed Google Cloud project; free-tier data may be used for training) | unset | `getAiConfiguration` → `provider_not_configured`: Start processing is refused **before any model request** |
| 2 | `0be11b5` (R3 Task 01B) | migration `20261117100100_pipeline_worker_slots` | not applied | every drain fails closed: queued jobs never run |
| 3 | `1ca9e3c` (R3 Task 02) | migration `20261117200100_identity_vault` + `IDENTITY_MAP_KEY`/`_VERSION` | neither present | parse fails (`db_schema_outdated` / `identity_map_key_unverified`) |

Ruled out: provider adapter (unchanged request shape, `lib/ai/providers/gemini.ts`), model identifiers (the same
ones Round 2 used), response parsing (unit and eval suites), worker auth (`after()` drains need no `CRON_SECRET`).

## Restoration (no code change needed)

Restoring the Round 2 behaviour safely = configuration + migrations, all behind the release approval gate:

1. Apply the 18 pending migrations in the reviewed order (verified one at a time on a populated database:
   `supabase/tests/upgrade/run.sh`, 39/39 PASS, every pre-upgrade read unchanged).
2. Production env: `IDENTITY_MAP_KEY` (new; production has no identity-vault rows) + `IDENTITY_MAP_KEY_VERSION=k1`.
3. `AI_DATA_GOVERNANCE=gemini-paid-dpa` **only** if the owner confirms the production key's Google Cloud project has
   active billing. Never set to bypass the gate. Without it, processing stays refused.
4. Autonomous worker (pg_cron + pg_net + Vault + `CRON_SECRET`), per `docs/round3/autonomous-worker.md`.

## Real-model results (2026-11-20, real Gemini, synthetic datasets only)

Key: the owner's local `gemini-live.env` (never read into logs). Provider `gemini@1`, extract `gemini-3.6-flash`,
verify `gemini-3.5-flash-lite` (production's ids).

| Metric (4 datasets) | extract@1 (owner's run) | extract@2 (run 2, no failed chunks) |
|---|---|---|
| extractionRecall | 67.4% (31/46) | **93.5% (43/46)** |
| citationAccuracy | 97.0% (32/33) | 94.1% (48/51) |
| supportAccuracy | 90.9% (20/22) | 95.5% (21/22) |
| unsupportedClaimRate | 3.6% (1/28) | 2.6% (1/39) |
| attributionAccuracy | 100% (10/10) | 100% (11/11) |
| contradictionRecall* | 62.5% (5/8) | 62.5% (5/8) |

* deterministic signal retrieval, not the model.

- **Root cause of the misses (extract@1):** the model returned exactly 7 candidates per dataset and skipped open
  questions (6/7 unmatched), conflicting statements (3/4) and money amounts (3/8). Not chunking (1 chunk, 0 failed),
  not validation (0 dropped), not evidence linking (citations 97%). Fix: `extract@2` adds a Coverage section to the
  extraction prompt (`lib/ai/prompts/extract.ts`); everything else is unchanged.
- extract@2 run 1 had two provider failures (`ai_timed_out`, `ai_provider_error`); run 2 had none.
- **Live prompt-injection suite (required before a prompt bump, §11.8 rule 7): NOT yet satisfied.** The 7 extract
  cases did not execute (provider errors and `ai_quota_exhausted`). Verify cases (support@1, unchanged): 3 model
  verdicts were `supports` instead of `irrelevant` on injected quotes (pre-existing; the deterministic PI-11 guard is
  the backstop) and 2 cases guarded where the suite expected no guard (safe direction). Re-run with quota:
  `node scripts/ai/run-live-eval.mjs <key-file> --injection`. **Do not release extract@2 until it passes.**
- **Key tier:** `ai_quota_exhausted` after about 20 extract calls in a day matches the Gemini free-tier daily quota.
  If the production key is the same kind, `AI_DATA_GOVERNANCE=gemini-paid-dpa` cannot be set truthfully.
- Real-AI end-to-end handover on the isolated stack: ready
  (`node scripts/connectors/preview-3110.mjs .env.connectors-test.local --ai-key-file <key-file>`), not run: quota
  exhausted for the day.

## Real-model proof

`node scripts/ai/run-live-eval.mjs <key-file outside the repo>` runs extraction, quote verification and support
verification through the production Gemini adapter with production's model ids on synthetic datasets only (four,
including `ds04-vendor-launch-ops`: deadline, decision reversed, three owners, unresolved question, financial
commitment, dependency, changed information). `NODE_ENV=test` is the documented synthetic-data mode in which the
governance gate does not apply. Status 2026-11-20: **run** with the owner's local key (results above); the production
key itself is a Vercel *sensitive* variable and was not read.
