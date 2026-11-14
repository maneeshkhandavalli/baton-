# Hosted apply: Round 3 Phase D (migrations #14–#18) on baton-dev

Runner and pinned SQL for applying Phase D to the **isolated baton-dev project `xnwppnzvrpthukxjfojj`**.
Background, per-migration notes and the full rollback recipes: `docs/round3/migrations.md` (§3, §5).
Ported from `baton-multiagent/restore-dev/run-hosted.sh` and `baton-multiagent/hosted-apply/`.

> **Phase D writes to the database. Run `r3phaseD` only with explicit approval.**
> Never point this runner at the original project (`enalguyitewjojgrgzxv`); it refuses to.

## Files

| File | Role | Writes? |
|---|---|---|
| `03_phase_D_migrations_14-18.sql` | The reviewed and rehearsed bundle: #14–#18 verbatim, each with its history row. Byte-identical to the baton-multiagent copy. | yes (only via the wrapper) |
| `r3_phase_d_txn.sql` | Transaction wrapper: begin → lock → in-transaction guard → `\i` the bundle | yes |
| `r3_jobs.sql` | Queued/running jobs, open runs, live leases | no |
| `r3_prereq.sql` | Phase D prerequisites: 31 history rows, newest `20261113300400`, no Phase D rows, no `claim_generation`, the 15 §5 function signatures | no |
| `05_verify_phase_A.sql` | §3 Verify blocks #1–#13 (expect 14 rows, all `t`) | no |
| `04_verify_all.sql` | §3 Verify blocks #1–#18 (expect 19 rows, all `t`; only meaningful after Phase D) | no |
| `r3_post.sql` | After Phase D: 36 history rows, newest `20261113300900`, `claim_generation` NOT NULL, 8 generation overloads | no |
| `phase-d.mjs` | Offline verifier: SHA-256 pins, migration order, bundle rebuilt byte-for-byte | — |
| `run-hosted.sh` | The runner | — |
| `__tests__/runner.test.mjs` | Runner tests (fake `docker`, no network): `node --test supabase/hosted-apply/__tests__/runner.test.mjs` | — |
| `rehearse-phase-d.sh` | Local transaction rehearsal on a throwaway `postgres:17-alpine` with `--network none` (no credentials, never reaches Supabase): nested BEGIN/COMMIT, guard, locks against concurrent inserts/claims/heartbeats, `lock_timeout` before and midway, deliberate mid-transaction failure, success exactly once, re-run refused. **Last run 2026-11-13 (Postgres 17.11): 50 passed, 0 failed.** Uses no stdin and no `docker exec -i` (piping SQL through `docker exec -i` from an interactive Git Bash terminal hung), calls `docker.exe` directly, and puts a timeout on every Docker call. | local only |

## Commands

```bash
export BATON_DEV_SECRETS=/path/outside/the/repo/baton-dev.env   # SUPABASE_DB_URL=postgresql://postgres.xnwppnzvrpthukxjfojj:…@….pooler.supabase.com:5432/postgres
bash supabase/hosted-apply/run-hosted.sh verify-files   # offline only
bash supabase/hosted-apply/run-hosted.sh r3jobs         # read-only
bash supabase/hosted-apply/run-hosted.sh r3verifyA      # read-only
BATON_PHASE_D_CONFIRM=apply-phase-d-to-xnwppnzvrpthukxjfojj \
bash supabase/hosted-apply/run-hosted.sh r3phaseD       # WRITES
bash supabase/hosted-apply/run-hosted.sh r3verifyAll    # read-only, after Phase D
```

Every command, in order:

1. **Offline verification** (`phase-d.mjs verify`). Every SQL file here must match its full SHA-256 pin, and any unpinned `.sql` fails. The five migration files must match their pins. The migrations after `20261113300400` must be exactly these five, in ascending order. The bundle must equal the five files reassembled byte for byte (fixed header, `-- ===== <file> (verbatim) =====`, file bytes, one history row each, then `commit;` and `notify`). The wrapper must end by including that bundle. Any mismatch exits with code 2 before anything connects.
2. **`r3phaseD` only:** `BATON_PHASE_D_CONFIRM` must equal `apply-phase-d-to-xnwppnzvrpthukxjfojj`. Otherwise it exits with code 3 before reading credentials.
3. **Credentials.** `BATON_DEV_SECRETS` must name a file outside the repository. `SUPABASE_DB_URL` must use the pooler user `postgres.xnwppnzvrpthukxjfojj` on `*.pooler.supabase.com:5432` (Session pooler), and must not contain the original project's ref in either spelling. It is split into a private temporary PG* file, which is deleted on exit. The password is never printed or put on a command line (exit code 3).
4. **Docker** must be running (exit code 4). `psql` runs in `postgres:17-alpine`.
5. **Read-only queries** run inside `BEGIN READ ONLY … ROLLBACK`, and every result row must end in `t` with the expected row count.

`r3phaseD` re-runs every read-only gate (`r3_jobs`, `05`, `r3_prereq`). If any fails it exits with code 5 and applies nothing. Otherwise it runs `r3_phase_d_txn.sql` once. On success it runs the read-only post-checks (`04` and `r3_post`). If the transaction fails it exits with code 6, reports that nothing was applied, and shows the unchanged prerequisites.

**Project identity.** Two independent signals:

- The pooler routes by the user name `postgres.<ref>`, and the runner accepts only baton-dev's.
- `r3_prereq.sql` and the in-transaction guard require Phase A's 31-row history. The original project still has the 18-row baseline, so it fails both.

## Transaction safety (why the wrapper exists)

The bundle's own job guard is a `DO` block **before** its `begin;`. That check is **not atomic** with the migrations. A worker, or a user starting processing, could queue or claim a job between the guard and the first migration statement. #17's backfill (`claim_generation = attempt`) assumes no claim is in flight.

`r3_phase_d_txn.sql` closes that window without changing the reviewed bundle:

1. `begin;`, then `set local lock_timeout = '10s'`, so a busy table aborts the run instead of hanging.
2. `lock table public.processing_runs, public.processing_jobs in exclusive mode`. This blocks `INSERT`/`UPDATE`/`DELETE` and `SELECT … FOR UPDATE` (new runs, job claims, heartbeats) until commit. Plain reads continue. `EXCLUSIVE` rather than `SHARE ROW EXCLUSIVE` avoids a deadlock with a claim that already holds a `FOR UPDATE` row lock.
3. Under that lock, the guard re-checks: no queued or running jobs, 31 history rows (newest `20261113300400`), no Phase D rows, no `claim_generation`.
4. `\i` the pinned bundle. Its `begin;` only raises the warning *"there is already a transaction in progress"*. Its guard re-runs harmlessly, and its `commit;` commits everything at once. #17's `ALTER TABLE` upgrades the `processing_jobs` lock to `ACCESS EXCLUSIVE` inside the same transaction.
5. With `ON_ERROR_STOP`, any error before the commit ends psql, and the server rolls back the whole transaction: nothing is applied.

**Operational step:** stop the local dev server (`restore-dev/start-baton-dev.mjs`) before `r3phaseD`, because its background worker drains baton-dev jobs. The lock makes a running worker safe, but it could make the run abort on `lock_timeout`. Restart only Round 3 code (≥ `0bb1b96`) afterwards. An older worker is refused on any job that has yielded once #17 is applied.

## What Phase D changes

| # | Change | Data effect | Rollback |
|---|---|---|---|
| 14 | Revokes `EXECUTE` on 8 unfenced pipeline writers from `public`, `anon`, `authenticated`, `service_role` | none (grants only) | Re-grant. Old workers that call these directly fail with `42501` until then. |
| 15 | Revokes `EXECUTE` on `mark_source_parse_failed(uuid, text)` | none | Re-grant |
| 16 | `api_get_processing_status` replaced (same signature): stage status gains `partial`; open jobs show `queued`/`running` instead of `failed` | none (read function) | Re-run the `20261111000900` definition. The UI must handle `partial` (the current build does). |
| 17 | Adds `processing_jobs.claim_generation bigint not null default 0`, then **updates every job row** to `claim_generation = attempt` (30 rows on baton-dev on 2026-11-13). Replaces `_remember_claim_progress`, `_pipeline_claim` and `heartbeat_processing_job` (same signatures). Adds `_pipeline_use_generation` (no API grant) and 8 `pipeline_*` overloads (service_role only). Heartbeat no longer renews an expired lease. | One new column, backfilled. The only trigger on the table (`processing_jobs_claim_progress`) fires only when `attempt` increases, so the backfill does not trigger it. | Per `docs/round3/migrations.md` §3 #17: drop the overloads and helper, restore the three functions, then drop the column. Dropping the column loses the generation values. They are derived data, but jobs that yielded after #17 can't be told apart from new claims any more. Roll back #17 before #14/#15. |
| 18 | `api_get_point` replaced (same signature): evidence items gain `guarded` and `model_verdict` | none (read function) | Re-run `20261111000900_read_api.sql:160`. Rolling back cannot undo the exposure: reviewers will already have seen which verdicts the injection guard overrode. |

No migration deletes or truncates data. Every change is in one transaction, so a failure leaves the database exactly as it was. After `commit`, `notify pgrst, 'reload schema'` makes PostgREST see #17's overloads.

## Execution record

**Phase D was applied to baton-dev (`xnwppnzvrpthukxjfojj`) on 2026-11-13, 16:54:16–16:54:29 UTC, with the user's explicit approval.** It ran exactly once and exited with code 0. The original project was not touched.

Gates before the write:

- **Offline:** 7 pinned SQL files and 5 migrations verified, and the bundle was rebuilt byte for byte.
- **Target guard:** `postgres.xnwppnzvrpthukxjfojj` via the Session pooler, also checked earlier without connecting.
- **Local rehearsal:** `rehearse-phase-d.sh`, 50/50 on Postgres 17.11.
- **Local SQL suites:** `npm run test:sql` 20/20, `npm run test:integration:sql` 10/10.
- **Runner tests:** 34/34.
- **Live read-only checks:** `r3jobs` 4/4 and `r3verifyA` (14/14 + 8/8), run once on their own and again inside `r3phaseD`.

Before the write, baton-dev had 31 history rows (newest `20261113300400`), no Phase D rows, no `claim_generation`, all 15 prerequisite signatures, and 0 queued or running jobs, open runs or live leases. The dev server and its worker were stopped.

The transaction itself:

- The guard ran under `EXCLUSIVE` locks and confirmed 0 jobs in flight.
- There was exactly one nested-`BEGIN` warning, as expected.
- #17's backfill reported `UPDATE 30`, followed by one `COMMIT` and `NOTIFY`.

After the write:

- **`04_verify_all.sql`:** 19/19 `true`.
- **`r3_post.sql`:** 5/5. History has 36 rows, newest `20261113300900`; the five Phase D versions are present once each.
- **New schema:** `claim_generation` is NOT NULL, and all 8 generation overloads exist.
- **Consistency:** `claim_generation = attempt` on all 30 jobs, and none is lower. Distribution: 24×1, 1×2, 5×0.
- **Job state:** 0 queued or running jobs, 0 open runs, 0 live leases. Jobs: 24 succeeded, 1 failed, 5 cancelled. Runs: 3 succeeded, 1 failed. Handovers: 4 active, 3 soft-deleted. All of this is unchanged from before the write.

Since then:

- Only Round 3 code (≥ `0bb1b96`) may run against baton-dev.
- No hosted processing run has used the claim-generation path yet.
