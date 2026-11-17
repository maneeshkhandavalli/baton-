# Round 3 — Autonomous background processing (Task 01, fixes JOB-1)

Status: implemented on branch `round3/task01-autonomous-worker`, not deployed. The scheduler itself is an
operator step that needs approval (see [Activation](#activation-requires-approval)).

## Problem (JOB-1)

A hosted run advanced only while something inside a Vercel request drained jobs:

- the `after()` drain that `startProcessing` schedules (5 jobs or 50 s), and
- `continueProcessing`, which the open processing page calls every 20 s.

Nothing in the repo invoked `app/api/pipeline/drain` on a schedule. There was no `vercel.json`, no cron, and the
route accepted POST only, while Vercel cron jobs call with GET. Closing the tab stalled the run until the page
was reopened. A run started by a bot would never have finished.

## Selected architecture

**The existing database queue stays the source of truth. One authenticated HTTP endpoint is the worker. An
external scheduler calls it every minute.**

```
 browser / bot backend                       scheduler (every minute)
        │ startProcessing (server)                 │ pg_cron → pg_net POST  (selected)
        ▼                                          │   or Vercel schedule  (Pro, alternative)
  start_processing RPC ──► processing_runs +       ▼
                           processing_jobs ◄── /api/pipeline/drain  (Bearer CRON_SECRET)
        │ after() drain (accelerator)               │ drainJobs(25 jobs, 240 s)
        ▼                                           ▼
  same drainJobs, 5 jobs / 50 s          claim_ready_processing_jobs (SKIP LOCKED, lease 300 s)
                                          → stage handler → fenced complete_processing_job
                                          → finish_processing_run when the last job is terminal
```

### Options evaluated

Vercel facts below come from the official docs, read on 2026-11-17. The Schedules product is in beta and its
limits "may change before general availability".

| Option | Frequency | Plan constraint | Verdict |
|---|---|---|---|
| **A. Vercel Schedules (beta)**, path target → this route | Hobby: every 15 min with a fixed 15-min jitter window. Pro/Enterprise: every minute, 1-min jitter. | Beta. Function and path targets are not retried. | Good on **Pro**. Inadequate on Hobby: up to about 30 min between ticks, and each retry backoff (30 s, 2 min, 8 min) costs a full tick. |
| A'. Vercel Schedules, private function target | Same as A. | Needs `@vercel/schedules` (a new dependency) and a separate function entry. | No advantage over a path target: this route already authenticates. |
| A''. Vercel Schedules, queue target | Same as A. | Needs Vercel Queues (public beta, separately billed) and a new consumer. | Rejected: a second queue would duplicate the database queue. |
| **B. Vercel Cron Jobs** (legacy, being migrated to Schedules) | Hobby: **once per day** (±59 min). Pro: every minute. | Production only. GET only. No retries. | Inadequate on Hobby. On Pro, use A instead. |
| **C. Supabase `pg_cron` + `pg_net`** → this route | Every minute (pg_cron also supports second-level intervals). | Both extensions are available on every Supabase plan, including Free. No Vercel plan dependency. | **Selected.** |
| D. A separate always-on worker (Fly, Render, Railway…) | Continuous | A new paid service, a second deployment and second copies of the secrets. | Rejected: not needed; C meets the requirements. |

**Hosting plan.** The Vercel plan could not be determined from this machine. The Vercel CLI is not
installed, the repo's `.vercel/project.json` names the project but not the plan, and reading the plan
needs an authenticated account call that was not made. The project rule that no paid tier may be
enabled for Gemini suggests Hobby, but that is not evidence. **Option C was chosen because it delivers
one-minute ticks whatever the Vercel plan is.** If the team confirms Pro and prefers to keep scheduling
inside Vercel, Option A needs no code change (see [Alternative](#alternative-vercel-schedules-pro-only)).

**Why C over A on Pro too:**

- C is GA, while Schedules is beta.
- C skips the call entirely when no run is active, so an idle project makes no Vercel invocations. A Vercel
  schedule invokes every minute, around 43,000 invocations a month.
- C runs on whichever Supabase project production uses, so there is nothing to keep in sync per Vercel
  environment.

The costs of C:

- The secret is held in two places: the Vercel environment and Supabase Vault.
- The endpoint URL is fixed. Only production is ticked; previews are covered in [Limitations](#remaining-limitations).

## Execution flow

1. **Start.** `startProcessing` (server action, `lib/actions/core/handovers.ts`) calls the `start_processing`
   RPC through the service role, with the verified actor. SQL re-checks the role, lifecycle, consent and
   sources, and inserts one `processing_runs` row plus its `processing_jobs` (`queued`). It then calls
   `scheduleDrain()`, which may or may not get to run. **Nothing after this point needs the browser or the
   starting request.**
2. **Tick.** Every minute, pg_cron evaluates the job in `supabase/ops/schedule-pipeline-worker.sql`. If any
   run is `queued` or `running`, `net.http_post` sends `POST <production>/api/pipeline/drain` with
   `Authorization: Bearer <CRON_SECRET>` and `x-baton-trigger: pg_cron`. Both values are read from Vault at
   run time.
3. **Drain.** The route (`app/api/pipeline/drain/route.ts`) authenticates and calls
   `drainJobs({ maxJobs: 25, deadlineMs: 240_000 })` (`lib/pipeline/worker.ts` → `lib/pipeline/runner.ts`):
   - first it closes runs whose outcome is already decided (`list_finishable_runs`, DB-15);
   - then, one job at a time while the budget lasts, it claims via `claim_ready_processing_jobs(1, 300)`;
   - it runs the stage handler, heartbeating the lease;
   - it records exactly one fenced `complete_processing_job` per claim;
   - if the job is terminal, it calls `finish_processing_run`, which moves the handover to `in_review`
     or records the failure.
4. **Read back.** The processing page, the dashboard or a bot reads `processing_runs`/`processing_jobs` through
   the existing RLS queries (`getProcessingStatus`). The final state is in the database whether or not anyone
   watched.

## Scheduler configuration

`supabase/ops/schedule-pipeline-worker.sql` is an **operator script, not a migration**. It lives outside
`supabase/migrations` so nothing applies it automatically. It:

- enables `pg_cron` and `pg_net`;
- documents (commented out, with placeholders) the two `vault.create_secret` calls: `baton_worker_url` and
  `baton_worker_secret`;
- schedules `baton-pipeline-worker` at `* * * * *` (a no-op while no run is active or the secrets are absent);
- schedules a daily cleanup of `cron.job_run_details` older than 7 days.

`timeout_milliseconds := 300000` keeps pg_net from hanging up before the route's `maxDuration` (300 s).

## Authentication

- **Route.**
  - `CRON_SECRET` must be set and at least 32 characters; otherwise every call gets a 401 (fails closed).
  - The presented `Authorization: Bearer …` is compared with SHA-256 digests in constant time.
  - GET and POST behave identically.
  - The caller cannot change the budget. The response carries counts only.
  - A refused call logs `worker_unauthorized` with the trigger token only.
- **Scheduler.**
  - The secret and URL live in Supabase Vault (encrypted at rest).
  - `cron.job` stores only the command text, which reads Vault at run time.
  - Only roles that can read `vault.decrypted_secrets` (postgres/service role) can see them.
- **Rotation.** Update Vault (`vault.update_secret`) and Vercel's `CRON_SECRET`, then redeploy, because a
  deployment keeps the secret it was built with. During the gap calls answer 401, nothing is processed, and
  nothing is lost: jobs simply wait.
- **Vercel Deployment Protection.** If production is protected, pg_net calls are blocked before reaching the
  route. Production domains are normally unprotected under Standard Protection. Confirm this in the live test.

## Overlap, retry and recovery (unchanged engine)

All of these were already in the database. This task relies on them and adds none:

| Concern | Mechanism | Where |
|---|---|---|
| Two sweeps claim the same job | `for update … skip locked` in the claim. Each claim is an `(id, attempt)` pair. | `claim_ready_processing_jobs`, migrations `20261112000100`, `20261111000500` |
| Stale worker writes after losing its claim | Fenced writers (`pipeline_*`) and `complete_processing_job` check `(job, attempt)` and raise `ClaimLostError` | `20261113300100_pipeline_fencing.sql`, `20261113300800_claim_generation.sql` |
| Worker crashes mid-job | Lease of 300 s with heartbeats. An expired `running` job is re-claimed as the next attempt, or reaped on its final attempt. | DB-1, `20261112000100` |
| Transient failure | `retry` with backoff 30 s, 2 min, 8 min (`lib/pipeline/backoff.ts`), up to `max_attempts` | runner `completeJob` |
| Long stage | Checkpointed `yield` requeues without using an attempt. Extraction resumes from stored chunks. | DB-13, `lib/pipeline/stages/extract.ts` |
| Ordering | Only jobs whose earlier stages are terminal are claimable | DB-1 |
| Run never closes (last job reaped) | `list_finishable_runs` at the start of every drain | DB-15 |
| Completed work re-run | Terminal jobs are never claimable. An `extract` whose input hash already succeeded is a no-op. | claim SQL, runner `precheck` |

With one tick a minute and drains of up to 240 s, as many as about 4 drains can overlap. That is safe, and
parallel claims increase throughput. It also means more concurrent AI calls (see JOB-2 in Limitations).

## Runtime and batch limits

| Limit | Value | Source |
|---|---|---|
| Route `maxDuration` | 300 s (allowed on every plan with Fluid Compute: Hobby max 300 s, Pro max 800 s) | `route.ts` |
| Drain budget per sweep | 25 jobs or 240 s, whichever comes first. No new job is claimed with less than 30 s left. | `route.ts`, `runner.ts` |
| Lease | 300 s, renewed by heartbeats during a stage | `runner.ts` |
| Tick | 1 min (pg_cron). Worst-case pickup latency is about 1 min plus any retry backoff. | ops SQL |
| Accelerators | `after()` drain on start (5 jobs or 50 s). Page nudge every 20 s while open (same budget). | `worker.ts`, `processing-view.tsx` |

## Hosting-plan requirements

- **Vercel:** any plan. The route needs only `maxDuration = 300`, which Hobby allows. No Vercel scheduling
  feature is used.
- **Supabase:** any plan with `pg_cron`, `pg_net` and Vault, which hosted projects include.
- **No new paid service.** Costs: about one function invocation per active minute; nothing while idle.

## Monitoring

| Question | Where to look |
|---|---|
| Is the scheduler firing? | `select jobname, status, start_time, return_message from cron.job_run_details d join cron.job j using (jobid) where j.jobname = 'baton-pipeline-worker' order by start_time desc limit 20;` |
| Did the calls reach the route? | `select created, status_code, timed_out, error_msg from net._http_response order by created desc limit 20;` (pg_net keeps about 6 h). `401` means the secrets drifted. `5xx` or a timeout means an infrastructure problem. |
| What did each sweep do? | Vercel function logs for `/api/pipeline/drain`: structured `worker_invoked`, `worker_finished` (trigger, durationMs, claimed, succeeded, retried, failed, deferred, skipped, lost), `drain_done`, `job_completed`, `run_finished`, `job_lost`, `worker_failed`, `worker_unauthorized`. IDs, counts and reason tokens only (`lib/pipeline/log.ts`). |
| Is anything stuck? | `select r.id, r.status, min(j.next_attempt_at) as next_due, now() - r.created_at as age from processing_runs r join processing_jobs j on j.run_id = r.id where r.status in ('queued','running') and j.status in ('queued','running') group by r.id having min(coalesce(j.next_attempt_at, j.created_at)) < now() - interval '5 minutes';` Any row means work is due but not being claimed. |

Alerting is not configured. There is no alerting service in the stack, and adding one was out of scope.

## How future integrations trigger processing (contract for the bot workstream)

What the processing side guarantees, verified by `tests/integration/r3-autonomous-worker.test.ts`:

1. **A run needs only rows, not a session.** Once `start_processing` has committed, the run reaches a
   terminal state through scheduled sweeps alone. No browser, no cookie, no `after()` callback and no
   follow-up request is required.
2. **Entry point.** Start a run the same way the web app does:
   - core `startProcessing(deps, { handoverId })` (`lib/actions/core/handovers.ts`);
   - this runs the same plan (`planProcessingRun`) and the same `start_processing` RPC;
   - SQL re-checks the actor's membership, role, lifecycle and consent;
   - do not insert jobs directly, and do not call the worker route to start work.
3. **Optional acceleration.** Inside a request handler, such as a bot webhook, `scheduleDrain()` adds an
   `after()` drain. Outside a request scope it logs `drain_not_scheduled` and returns, and the next tick
   picks the run up.
4. **Progress and result.** Read `processing_runs.status` (`queued | running | succeeded | failed | cancelled`)
   and the per-stage progress through the RLS query `getProcessingStatus(handoverId)`. Notifying a channel
   on completion would be a later addition, polled or added to `finish_processing_run`, and is not part of
   this task.
5. **Never** call `/api/pipeline/drain` from a bot with the shared `CRON_SECRET`. It is the scheduler's
   credential, not an integration credential.

**Open dependency (SEC-2, owned with the bot workstream).** The core action needs `ActionDeps` whose
`getActor()` returns a `VerifiedActor` and whose `queries` are RLS-scoped to that user. Today both come
from a Supabase browser session. A bot needs one of two things:

- (a) a bot-principal model that maps a linked platform account to a Baton profile and builds the
  `VerifiedActor` server-side; or
- (b) a service-role variant of `listSources` for planning.

Either way, `start_processing` remains the authorization gate. This choice belongs to the bot design and is
deliberately not made here.

## Activation (requires approval)

Nothing below has been done. In order:

1. Merge this branch and deploy it to production. The route then accepts the scheduler's POST, and Vercel cron
   GET if ever used.
2. Confirm that `CRON_SECRET` is set in the Vercel production environment and is at least 32 characters. Do
   not print it.
3. In the Supabase SQL editor of the production project:
   - run the two `vault.create_secret` statements with the real URL and secret;
   - then run `supabase/ops/schedule-pipeline-worker.sql`.

### Live-test procedure (needs approval: hosted DB and production deployment)

1. With a test account, upload the synthetic fixture (`fixtures/parser/whatsapp/pii-chat.txt`) and start
   processing.
2. **Close the tab immediately.** Wait 3 minutes without opening any Baton page.
3. In SQL:
   - `select status from processing_runs where id = '<run>'` should be `succeeded`, or `failed` with a
     reason;
   - `cron.job_run_details` should show successful ticks;
   - `net._http_response` should show `200`s.
4. Reopen the processing page. It should show the finished state, and the handover should be `in_review`.
5. Check the Vercel logs for `worker_invoked` with `trigger: pg_cron` and a matching `run_finished`.
6. Negative check: temporarily change `baton_worker_secret` in Vault. Expect `401` in `net._http_response`, a
   `worker_unauthorized` log line, and no job claimed. Restore it, and the next tick resumes.
7. Gemini free tier: one run uses about 14 requests (extraction and verification), and the daily quota is about
   20 per model. Run this once, not repeatedly.

## Alternative: Vercel Schedules (Pro only)

If the plan is Pro and the team prefers Vercel-native scheduling, use this **instead of** the pg_cron job, not
in addition to it. Both together would double the calls, which is safe but wasteful.

```json
{
  "schedules": {
    "baton-pipeline-worker": { "schedule": "* * * * *", "path": "/api/pipeline/drain", "requestMethod": "POST", "jitter": 1 }
  }
}
```

Vercel sends `Authorization: Bearer <CRON_SECRET>` to path targets, which this route already verifies. Do not
add this on Hobby: Hobby schedules are limited to every 15 minutes with a 15-minute jitter. The schema above
follows the beta docs and must be re-checked against them when adopted.

## Remaining limitations

- **Production only.** The pg_cron job targets one URL. Preview deployments share the same Supabase project
  (baton-dev), so production's worker also drains runs started from a preview, with production's code and
  AI environment. This was already true of every hosted drain. A run whose snapshot names a provider that
  production refuses fails closed with `provider_not_configured`.
- **Not verified against hosted infrastructure.** That pg_cron, pg_net and Vault are enabled on the hosted
  project, and that pg_net reaches the production domain, are covered only by the live test above. The
  scheduler SQL was exercised locally against the `supabase/postgres` image
  ([Verification](#verification-performed)).
- **JOB-2 (quota).** The scheduler makes runs finish without a tab. It does not raise the Gemini free-tier
  daily quota. Overlapping drains can also hit per-minute limits sooner; those errors are retryable and back
  off.
- **No alerting.** Monitoring is query and log based.
- **Bot principal (SEC-2)** is still open, as described in the contract above.

## Verification performed

See the task report for exact commands and results. In summary:

- `tests/integration/r3-autonomous-worker.test.ts` (Tier E, real Postgres with every migration, opt-in
  `BATON_IT_PG=1`): six scenarios. A run completes with no session and no `after()`; completed work is not
  re-run; overlapping sweeps never run a job twice; a crashed lease is protected and then recovered; a failure
  is recorded and read back; an unauthenticated call touches nothing.
- `tests/integration/it13-tokens-drain.test.ts`: GET/POST authentication parity, the fixed budget, and log
  hygiene.
- The scheduler SQL was applied in a local `supabase/postgres:17.12.0.000` container (pg_cron, pg_net,
  supabase_vault 0.3.2) with a stub `processing_runs` table and a local listener standing in for the route.
  Over 5 minute ticks, every tick succeeded. It made no call while the secrets were absent or no run was
  active. While a run was active it sent one `POST /api/pipeline/drain` with the matching bearer,
  `x-baton-trigger: pg_cron` and body `{}`, and pg_net recorded `200`. The secret does not appear in
  `cron.job`. Re-applying the script leaves one job of each name.
- Production-build smoke (`next start`, no database configured):
  - GET and POST without the secret, or with a wrong one, return `401`;
  - PUT returns `405`;
  - the right secret reaches the worker, which refuses the unconfigured database target with
    `500 drain_failed`;
  - the logs show `worker_invoked` and `worker_failed` with the trigger token, and the secret never
    appears in them.
