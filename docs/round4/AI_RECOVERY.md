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

## Real-model proof

`node scripts/ai/run-live-eval.mjs <key-file outside the repo>` runs extraction, quote verification and support
verification through the production Gemini adapter with production's model ids on synthetic datasets only (four,
including `ds04-vendor-launch-ops`: deadline, decision reversed, three owners, unresolved question, financial
commitment, dependency, changed information). `NODE_ENV=test` is the documented synthetic-data mode in which the
governance gate does not apply. Status 2026-11-20: **not run** — no Gemini key exists on the development machine,
and the production key is a Vercel *sensitive* variable (not readable by design).
