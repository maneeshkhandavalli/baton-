# Background processing and connector sync: scheduling recommendation (21 Nov 2026)

Status: a recommendation only. **Nothing here has been applied to production.** Every production step below needs
the owner's explicit approval.

## The problem (verified on production, 20 Nov)

Production has neither `pg_cron` nor `pg_net` enabled, and no `vercel.json` cron. Processing only advances:

1. once, right after **Start processing** (an `after()` drain with a 5-job / 50 s budget, `lib/pipeline/worker.ts`); and
2. while a **Processing page** is open: it nudges the worker about every 20 seconds (`components/processing/processing-view.tsx`).

If nobody keeps the page open, jobs wait. On 20 Nov, a judge demo run sat idle for 4 min 53 s between two stages,
and a full sample run took about 32 minutes on production, against about 65 seconds locally.

Connectors behave the same way. Discord messages are pulled, and every provider's buffer is flushed into a source,
only when the creator presses **Bring in new messages**, because nothing calls `/api/connectors/sync`.

The UI no longer promises background work. The running-processing headline now says "Keep this page open"
(`components/processing/processing-headline.ts`).

## Two endpoints, two secrets (keep them separate)

| Endpoint | Purpose | Credential |
|---|---|---|
| `POST /api/pipeline/drain` | advances processing jobs | `CRON_SECRET` (bearer), or the signed `x-baton-dispatch` header from the pg_cron dispatcher |
| `POST /api/connectors/sync` | pulls Discord, flushes connector buffers into sources | `CONNECTOR_SYNC_SECRET` (bearer) only; `CRON_SECRET` is rejected |

`CONNECTOR_SYNC_SECRET` must differ from `CRON_SECRET`. On production they are separate values, confirmed by the
`/test` page check.

## Why Vercel Cron alone doesn't solve it

On Vercel Hobby, cron jobs run at most once a day. A once-a-day drain doesn't fix a minute-level stall. Vercel Cron
also always sends `CRON_SECRET`, so it can't call the connector sync route.

## Recommendation

### Option A (recommended): the Supabase pg_cron dispatcher for processing

- Uses `supabase/ops/schedule-pipeline-worker.sql`, which already exists and is tested locally
  (`supabase/ops/tests/run.sh`).
- Every minute it checks `public.pipeline_work_due()`. It makes no call when idle, keeps at most one request in
  flight, and signs a 120-second dispatch header, so the long-lived secret never leaves the database.
- Cost: nothing extra on the Supabase free plan. It makes no calls when there's no work.
- Owner steps, each needing approval:
  1. In the Supabase SQL editor for baton-dev, create the two Vault secrets described in the script header (the worker
     URL `https://baton-seven-alpha.vercel.app/api/pipeline/drain`, and the same value as Vercel's `CRON_SECRET`).
  2. Run `supabase/ops/schedule-pipeline-worker.sql` as `postgres`. It enables `pg_cron` and `pg_net` and ends with
     privilege checks.
  3. Start a sample run, close the tab, and confirm the run finishes (check `/test` or the Processing page later).
- After it works, restore the "you can leave this page" wording. Gate it on a server flag so the UI never promises
  more than the deployment does.

### Option B: an external scheduler (needed for connector sync anyway)

- Any HTTPS cron service (for example cron-job.org or a GitHub Actions schedule) calling:
  - `POST https://baton-seven-alpha.vercel.app/api/connectors/sync` with header
    `Authorization: Bearer <CONNECTOR_SYNC_SECRET>`, every 5 to 15 minutes; and, if Option A isn't used,
  - `POST https://baton-seven-alpha.vercel.app/api/pipeline/drain` with header
    `Authorization: Bearer <CRON_SECRET>`, every 1 to 2 minutes.
- Store the secrets only in the scheduler's secret store, never in a repository or a URL.
- GitHub Actions' minimum interval is 5 minutes and timing is best-effort.

### Suggested setup

Option A for processing, plus Option B for `/api/connectors/sync` only. Until then:

- tell users to keep the Processing page open;
- creators press **Bring in new messages** for connector content.

## Not done, by design

- No production SQL was run.
- No extensions were enabled.
- No Vault secrets were created.
- No external scheduler account was created.
- No Vercel cron was added.
