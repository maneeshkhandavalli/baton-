# Round 3: autonomous background processing (Task 01 + 01B, fixes JOB-1)

**Status:** implemented on branch `round3/task01-autonomous-worker`.
- Not deployed.
- The migration is not applied anywhere hosted.
- The scheduler is **not** enabled on `baton-dev`.
- Activation is an operator procedure that needs approval; see [Activation procedure](#activation-procedure-requires-approval).

## Problem (JOB-1)

A hosted run advanced only while a Vercel request drained jobs. That meant either the `after()` drain
`startProcessing` schedules, or the processing page's `continueProcessing` nudge every 20 s. Closing the
tab stalled the run, and a run started by a bot would never finish.

## Final architecture

The database queue stays the source of truth. One authenticated endpoint does the work, and a database
scheduler calls it only when there is work. One global worker slot limits how many drains run at once,
whatever starts them.

```
 browser / bot backend                         Supabase pg_cron (every minute, as postgres)
        │ startProcessing                         │ baton_ops.pipeline_worker_tick()
        ▼                                         │   1. reconcile earlier dispatches ← net._http_response
  start_processing ──► processing_runs/jobs       │   2. public.pipeline_work_due()?  no → 'idle'
        │                       ▲                 │   3. a dispatch still pending?   yes → 'in_flight'
        │ after() drain         │                 │   4. pg_net POST, signed x-baton-dispatch header
        ▼ (accelerator)         │                 ▼
  drainJobs ◄───────────────────┼──────── /api/pipeline/drain  (signed dispatch, or Bearer CRON_SECRET)
  (route, after() on start,     │                 │
   page nudge, dev loop)        │                 ▼
        └──► acquire_pipeline_worker_slot (limit BATON_WORKER_MAX_SWEEPS, default 1) ── none free → 200 busy:1
                 └──► drainer: claim (SKIP LOCKED, job lease) → stage → fenced complete → finish run
                      renew slot before every claim; release (token-fenced) at the end
```

### Why this shape

These Vercel facts come from the official docs, read 2026-11-17.

- **The Vercel plan is unknown from here.** The Vercel CLI isn't installed, and no account call was made.
- On Hobby:
  - Vercel Cron Jobs run **once a day** (±59 min).
  - Vercel Schedules (beta) run at most **every 15 minutes, with a 15-minute jitter window**.
- Supabase `pg_cron` and `pg_net` give one-minute ticks on any Vercel plan, add no paid service, and can
  skip the call entirely when there is no work.
- On Pro, Vercel Schedules would also work with the same endpoint and no code change (see
  [Alternative](#alternative-vercel-schedules-pro-only)). They can't skip idle minutes, and they can't record
  HTTP outcomes in the database.

## Concurrency design (Task 01B)

**Global worker slots** live in migration `supabase/migrations/20261117100100_pipeline_worker_slots.sql` and
in `lib/pipeline/worker-slot.ts`.

- **What it covers.** `drainJobs` (`lib/pipeline/worker.ts`) is the only function that drains, and it always
  holds a slot. Every entry point calls it:
  - the endpoint (scheduler, Vercel schedule, manual call);
  - `scheduleDrain`, which serves both `startProcessing` and the page nudge `continueProcessing`;
  - the local dev loop.

  A unit test checks that `createDrainer` is bound nowhere else.
- **Acquisition is atomic.** `acquire_pipeline_worker_slot(max, lease, trigger)` takes the first free or
  expired slot among `1..max` with `FOR UPDATE SKIP LOCKED`. A slot another transaction is taking is skipped,
  never waited on. Missing rows are created without touching existing ones. If no slot is free it returns
  `null`, and the endpoint answers `200` with zero counts and `busy: 1`.
- **Expiry.** The lease is the drain budget plus 60 s, bounded to 30–900 s:

  | Drain | Lease |
  |---|---|
  | Endpoint | 300 s |
  | `after()` drain | 110 s |
  | Dev loop | 120 s |

  An abandoned slot (crashed or frozen function) is free again when its lease ends.
- **Fencing.**
  - Each acquisition gets a new random token and increments `generation`.
  - `renew` succeeds only for the current holder while its lease is live. `release` succeeds only for the
    current holder. A worker whose slot expired, or was taken over, can neither extend nor free the newer
    holder's slot.
  - The drain renews **before every claim**. A worker that lost its slot stops claiming
    (`drain_stopped: worker_slot_lost`). A job already in progress stays protected by the job-level lease
    and fencing, which are unchanged.
- **Fails closed.** If the slot functions are missing (the migration wasn't applied), `drainJobs` throws and
  nothing drains. That is why the migration must be applied before the code is deployed.
- **Job-level protections are untouched.** These are claim `SKIP LOCKED`, job leases and heartbeats, fenced
  writers (DB-12), checkpoints and `yield` (DB-13), retries with backoff (30 s, 2 min, 8 min), reaping, and
  `list_finishable_runs` (DB-15).

**Limits.**
- `BATON_WORKER_MAX_SWEEPS` is an integer from 1 to 4. The default and initial value is **1**.
- The database scheduler also keeps at most one HTTP request in flight.

**Raising concurrency later**, only after the AI provider's quotas are verified:
1. Confirm the Gemini per-minute and per-day limits for the models in use (JOB-2). With the free tier
   (about 20 requests per day per model, measured 2026-11-14) keep it at 1.
2. Set `BATON_WORKER_MAX_SWEEPS=2` in the Vercel production environment and redeploy. Every entry point then
   shares two slots. No migration is needed; slot rows are created on demand, up to 16.
3. Watch `baton_ops.worker_health` and the job `retried` counts for 429s (`ai_transient`) for a day before
   going higher. Lowering the limit takes effect at the next acquisition; a sweep already holding a higher
   slot finishes its budget.

## Authentication

Both mechanisms are implemented in `lib/pipeline/worker-auth.ts`, and both derive from `CRON_SECRET`. The
secret must be at least 32 characters; if it is unset or shorter, every call gets `401` (fails closed).

| Caller | Header | Notes |
|---|---|---|
| Database scheduler (pg_cron + pg_net) | `x-baton-dispatch: v1.<unix s>.<dispatch id>.<hex HMAC-SHA256(secret, "v1.<unix s>.<dispatch id>")>` | The secret never travels. Valid from 30 s before to 120 s after signing; a wrong key, a changed time or id, or a malformed header is `401`. A replay within the window only triggers a slot-limited drain. |
| Vercel cron/schedule, manual | `Authorization: Bearer <CRON_SECRET>` | Constant-time comparison over SHA-256 digests. |

- **HEAD** is handled explicitly: `405`, with `Allow: GET, POST`. It does no authentication, makes no
  database call and writes no log. Without this, Next.js would answer HEAD by running GET, which is a full
  drain.
- **Logging.**
  - Requests that present no credential at all (scanners) are not logged.
  - A presented but wrong credential logs one `worker_unauthorized` line with a reason token
    (`bad_bearer`, `bad_dispatch`, `stale_dispatch`, `secret_unset`).
  - An accepted call logs `worker_invoked` and `worker_finished` (trigger, dispatch id, duration, counts,
    busy) or `worker_failed`.
  - No secret, header or body is ever logged.

## pg_net privilege findings

These were verified in `supabase/postgres:17.12.0.000` (pg_net 0.20.4) by `supabase/ops/tests/run.sh`. On
hosted Supabase, `postgres` is not a superuser, just as in the image; confirm the grants on hosted in step 6
of the activation procedure.

| Object | Owner | Who can access it |
|---|---|---|
| `net.http_request_queue` (holds queued request headers) | `supabase_admin` | **ALL to PUBLIC** |
| `net._http_response` | `supabase_admin` | **ALL to PUBLIC** |
| schema `net` | `supabase_admin` | USAGE to PUBLIC, anon, authenticated, service_role, postgres |
| `net.http_post` / `http_get` | `supabase_admin` | SECURITY INVOKER, default EXECUTE (PUBLIC) |
| pg_net background worker | — | runs as `postgres` (`pg_net.username`); reaches the queue **only through the PUBLIC grant** |
| `vault.decrypted_secrets` | — | `service_role` and `postgres`; **not** anon or authenticated |
| schema `cron` | — | `postgres` (with grant option) and `supabase_admin` only |

Consequences:

- **Any role that can run SQL can read queued request headers.** `postgres`, the Supabase SQL-editor role,
  **cannot revoke** these grants: `revoke … from public` reports "no privileges could be revoked", because
  `supabase_admin` granted them. Supabase's event trigger `issue_pg_net_access` re-grants them whenever
  pg_net is created or upgraded.
- **Baton's fix is to queue no long-lived credential.** The scheduler sends only the signed, two-minute
  header. The test inspects the queued row before commit and confirms there is no `Authorization` header and
  no key, and the stand-in endpoint confirms that no request ever carried the key.
- **Optional owner-only hardening:** `supabase/ops/harden-pg-net.sql`.
  - It first grants explicitly what pg_net's worker (`postgres`), `service_role` and
    `supabase_functions_admin` need, then revokes PUBLIC, anon and authenticated.
  - Verified: run as `postgres` it changes nothing and says so. Run as the owner it removes anon's queue
    access and authenticated's `http_post`, and **pg_net still delivers** for `postgres`.
  - On hosted Supabase only the owner (Supabase support) can apply it. Re-run it after any pg_net upgrade.
- **Data API exposure.**
  - The schedule script aborts if `net` or `baton_ops` appears in `pgrst.db_schemas` on the `authenticator`
    role, or if anon or authenticated can use `baton_ops`, `cron` or `vault.decrypted_secrets`.
  - On hosted Supabase the exposed-schemas list also lives in the dashboard (Settings → API → Exposed
    schemas). Confirm by hand that it is `public`, `graphql_public` only.

## HTTP outcome monitoring

All of this lives in the private schema `baton_ops`, created by `supabase/ops/schedule-pipeline-worker.sql`.
It is owned by `postgres`, has no grants, and is not exposed.

- **`baton_ops.worker_dispatches`.** One row per dispatch, recording:
  - the pg_net `request_id`;
  - `outcome`: `pending`, `ok`, `http_error`, `timeout`, `connection_error`, `missing` or `not_sent`;
  - `status_code`;
  - `error`: pg_net's error text, character-restricted, at most 200 characters. It may contain the endpoint
    host; it never contains headers or bodies;
  - the endpoint's counts (`claimed`, `succeeded`, `failed`, `retried`, `busy`).
- **How outcomes are decided.** `reconcile_worker_dispatches()` runs first in every tick, so it runs every
  minute even when idle, with no browser involved. It joins `net._http_response` on the request id:

  | Response | Outcome |
  |---|---|
  | 2xx | `ok` (`busy = 1` when the slot was held) |
  | Any other status | `http_error` |
  | `timed_out` | `timeout` |
  | No status, with an error | `connection_error` |

  A dispatch with no response 7 minutes after it was sent becomes `missing` (the request timeout is 5 min).
  `missing` is therefore never confused with `ok`, and a recent dispatch stays `pending`. Due work with
  absent or short Vault secrets is recorded as `not_sent` (`secrets_missing`) and makes no HTTP call.
- **Retention.**
  - pg_net keeps responses for 6 h; reconciliation runs every minute, well inside that.
  - `baton_ops.housekeeping()` (daily at 03:17 UTC) deletes dispatch rows older than 14 days.
  - It also deletes **only Baton's own** `cron.job_run_details` older than 7 days, filtering by job name. The
    Task 01 version deleted every job's history and is unscheduled by the script.
- **Report.** `select * from baton_ops.worker_health;` returns one row:
  - `last_ok_at`, `last_dispatch_at`, `pending_now`, `failures_since_last_ok`;
  - 24-hour counts for each outcome, plus `busy_24h`;
  - `work_due_now`.

  **Alarm condition:** `failures_since_last_ok > 0 and work_due_now`.

  Recent failures:
  ```sql
  select id, dispatched_at, outcome, status_code, error from baton_ops.worker_dispatches
   where outcome not in ('ok', 'pending') order by id desc limit 20;
  ```
  The endpoint's own log lines carry the same `dispatchId`, which correlates them.
- **Alerting** is not wired to any external service; that would be a new service.

**pg_net head-of-line blocking (found in testing).** pg_net does not start queued requests while a request
of its current batch is still open. A hung endpoint therefore delays every later pg_net request in the
database by up to the timeout (5 min). Baton keeps one scheduler request in flight, so this only affects
Baton's own next dispatch. Any other pg_net user in the same database would wait too. There is none today.

## Scheduler gate (Task 01B)

`public.pipeline_work_due()` is in the migration, service-role only. It is true only when a drain has
something to do now:

1. **A queued job is due.** Its backoff has passed or it has none, it has attempts left, and every
   earlier-stage job it depends on is terminal. For `extract`, no other extract of the same run may hold a
   live lease. This is the same predicate as `claim_ready_processing_jobs`.
2. **A running job's lease has expired.** It will be reclaimed as the next attempt, or reaped on its last.
3. **A run can be finalised now.** It has no open job, a run-fatal failure (`provider_not_configured`,
   `ai_config_changed`, `db_schema_outdated`), or a failed handover-level stage (`verify_support`,
   `analyze`, `prepare_review`).

These mirror `decideRunOutcome`; a unit test keeps both lists in step with `lib/pipeline/types.ts` and
`finish.ts`. A run that is merely `running`, with every job under a live lease or in backoff, is **not**
due, so no call is made.

`tests/integration/db/sql/it20_worker_slots.sql` checks every case against the full schema. It also checks
that the gate agrees with what a real claim (in a rolled-back subtransaction) plus the finishable-run rule
would do.

## Runtime and batch limits

| Limit | Value |
|---|---|
| Endpoint `maxDuration` | 300 s (allowed on every Vercel plan with Fluid Compute) |
| Sweep budget | 25 jobs or 240 s; no claim with less than 30 s left; AI calls abort at the deadline |
| Concurrent sweeps | `BATON_WORKER_MAX_SWEEPS`, default 1, max 4 (all entry points combined) |
| Scheduler requests in flight | 1 |
| Job lease | 300 s with heartbeats |
| Tick | 1 min. Pickup latency is at most about 1 min after work becomes due, or after the current sweep ends. |

## Activation procedure (requires approval)

None of this has been done. **Do not run anything against `baton-dev` without approval.** Production uses
`baton-dev`.

### 1. Read-only inventory (approval needed; read-only)

Activation makes every due run in `baton-dev` process within about a minute: abandoned runs, runs started
from previews, and runs started by local dev servers.

```sql
select r.id, r.status, r.ai_provider, r.pipeline_version, r.created_at, r.started_at, h.state as handover_state,
       count(*) filter (where j.status = 'queued')                                   as queued,
       count(*) filter (where j.status = 'running' and j.lease_expires_at >= now())  as running_live,
       count(*) filter (where j.status = 'running' and j.lease_expires_at <  now())  as running_expired,
       count(*) filter (where j.status = 'failed')                                   as failed,
       min(j.next_attempt_at) filter (where j.status = 'queued')                     as next_due
  from public.processing_runs r
  join public.handovers h on h.id = r.handover_id
  left join public.processing_jobs j on j.run_id = r.id
 where r.status in ('queued', 'running')
 group by r.id, h.state
 order by r.created_at;
```

### 2. Decide what happens to existing active runs before the first tick

| Run | What activation would do | Recommended |
|---|---|---|
| `ai_provider = 'fake'` (local QA) | Fails closed at the AI stage (`provider_not_configured`) | Cancel first, so no handover is left `failed` by surprise |
| Real provider, old or abandoned | Processes fully and **spends Gemini free-tier quota** (about 14 requests per run against about 20 per day per model); the handover moves to `in_review` with nobody watching | Cancel unless the owner wants it finished |
| Real provider, recent | Finishes; that is the purpose | Leave it |

- **Cancel through the product**: a member opens the processing page and clicks **Cancel**
  (`cancel_processing`, audited). Do not edit rows by hand.
- A run whose owner can't be reached needs an explicit operator decision. That is out of scope here.
- Plan the first activation for after the daily quota reset (08:00 UTC).

### 3. Stop every local worker that points at `baton-dev`

- `baton-dev` is shared: production, previews and any local `next dev` with `BATON_DEV_WORKER=1` all drain
  the same queue.
- Worker slots are database-wide, so a local dev loop competes for the **single** slot. With fake AI it also
  fails real runs with `ai_config_changed`. Production's worker, in turn, fails local QA runs that were
  snapshotted with the fake provider.
- After activation, local servers against `baton-dev` must run with `BATON_DEV_WORKER=0`, which is already
  the default for baton-dev. QA processing belongs on a local Supabase stack or a separate project.

### 4. Apply the migration (approval needed)

- Apply `supabase/migrations/20261117100100_pipeline_worker_slots.sql`. It is additive: one table and five
  functions.
- It must be applied **before** step 5. The new code fails closed without it, and processing would stop
  everywhere, including the `after()` drains.

### 5. Deploy the branch

- Check that `CRON_SECRET` is set in Vercel production, at least 32 characters (don't print it), then
  redeploy so the deployment picks it up.
- Optional: set `BATON_WORKER_MAX_SWEEPS`. The default of 1 is recommended.

### 6. Vercel and Supabase reachability checks

- Use the **stable production domain** for the Vault URL, never a per-deployment URL; Standard Deployment
  Protection covers those.
- Check that Vercel Firewall, Attack Challenge Mode and bot rules don't challenge a non-browser `POST` to
  `/api/pipeline/drain`. Send one manual unauthenticated `POST`: the expected answer is `401` JSON, not a
  challenge page.
- In the Supabase dashboard, confirm the exposed schemas are `public` and `graphql_public` only.
- Enable `pg_cron` and `pg_net` in Database → Extensions if they aren't already. The script also runs
  `create extension if not exists`.
- Optional: ask Supabase support to apply `supabase/ops/harden-pg-net.sql`. It isn't required for Baton's
  safety.

### 7. Create the Vault secrets and the schedule

- In the SQL editor (role `postgres`), run the two `vault.create_secret` statements with the real URL and
  key; the placeholders are at the top of `supabase/ops/schedule-pipeline-worker.sql`.
- Then run that file. It ends with privilege checks and aborts if any fail. A NOTICE that the pg_net queue
  is readable by anon is expected (see the findings above).

### 8. Supervised live test, once

1. Start one run on the synthetic fixture.
2. Close the tab and wait 3 minutes.
3. Check `select * from baton_ops.worker_health`. Expect `ok_24h ≥ 1`, `failures_since_last_ok = 0`, and the
   run `succeeded`, or `failed` with a reason token.
4. In the Vercel logs, check `worker_invoked` with `trigger: pg_cron` and the matching `dispatchId`.

**Rollback:** `select cron.unschedule('baton-pipeline-worker');`. Processing then advances only while a
processing page is open, as before. The migration can stay.

## Local verification (reproducible from the repository)

| Command | What it proves |
|---|---|
| `npm test` | Unit and integration tests, including `lib/pipeline/__tests__/worker-slot.test.ts`, `worker-auth.test.ts` and IT-13 (route auth, HEAD, busy, logging) |
| `BATON_IT_PG=1 node --import ./tests/integration/support/resolve.mjs --test tests/integration/r3-autonomous-worker.test.ts` | The real endpoint, drainer and slot on Postgres with every migration (11 scenarios) |
| `bash tests/integration/db/run.sh it20` | Slot atomicity across two sessions, expiry, fencing, and the gate against the real claim |
| `bash supabase/ops/tests/run.sh` | The ops SQL in `supabase/postgres` with pg_cron, pg_net and Vault (see below) |

`supabase/ops/tests/run.sh` covers:
- idempotence, run as `postgres`;
- idle and gate behaviour, and `not_sent`;
- that the queued headers hold no key;
- that the pgcrypto HMAC matches the TypeScript golden vector;
- `ok`, `busy`, 401, 500, timeout, connection refused, missing versus pending, and in-flight gating;
- housekeeping scope and privileges;
- the hardening script as `postgres` and as the owner;
- one real cron tick.

## Alternative: Vercel Schedules (Pro only)

Use this **instead of** the pg_cron job, never as well. The path target sends `Authorization: Bearer
<CRON_SECRET>`, which the endpoint accepts, and every call is still slot-limited.

```json
{ "schedules": { "baton-pipeline-worker": { "schedule": "* * * * *", "path": "/api/pipeline/drain", "requestMethod": "POST", "jitter": 1 } } }
```

You lose the work-due gate (it calls every minute) and the database-side HTTP outcome log. Vercel's logs
remain. Re-check the beta schema when adopting it. Do not use it on Hobby, where it runs at most every
15 minutes with a 15-minute jitter.

## Contract for integrations (bots)

- **Start runs** through core `startProcessing(deps, { handoverId })`, the same plan and the same
  `start_processing` authorization in SQL. Once that commits, the scheduler finishes the run without any
  browser or session.
- `scheduleDrain()` inside a webhook handler is an optional accelerator. It is slot-limited like everything
  else.
- **Read progress and results** with `getProcessingStatus`.
- **Never** call `/api/pipeline/drain` with `CRON_SECRET` from an integration.
- **Open (SEC-2):** the core action needs a `VerifiedActor` and RLS-scoped queries for the linked user, which
  today come from a browser session. The bot-principal design must supply them.

## Remaining limitations

- **Hosted behaviour is unverified** until the supervised live test: grants, the exposed-schemas setting,
  Deployment Protection and firewall, and that pg_net can reach the production domain.
- **Production only.** Previews share `baton-dev`, so production's worker processes runs started from
  previews, with production's code and AI environment.
- **JOB-2:** the Gemini free-tier quota is unchanged. One sweep at a time reduces burst 429s but doesn't add
  quota.
- **Replays.** A captured signed header can be replayed for up to 2 minutes. It can only trigger a
  slot-limited drain of work that is already due. Nonce tracking was not added.
- **pg_net PUBLIC grants** remain on hosted Supabase unless Supabase applies `harden-pg-net.sql`. The queue
  holds only short-lived signatures.
- **No external alerting.** `baton_ops.worker_health` is query-based.

## Addendum (Round 3 Task 02): raw-upload retention reuses this infrastructure

`supabase/ops/schedule-raw-retention.sql` adds an hourly `baton-raw-retention` job on the same pg_cron / pg_net / Vault / `baton_ops`
setup, with its own dispatch log (`baton_ops.retention_dispatches`) and its own Vault URL secret (`baton_retention_url`); it signs with
the same `baton_worker_secret`, but the signature is bound to its purpose (`v1.<ts>.<id>.retention`), so a drain header and a retention
header are never interchangeable (`lib/pipeline/worker-auth.ts`). Opt-in; see docs/round3/privacy-and-data-protection.md §5.
