-- Baton scheduled pipeline worker (Round 3 JOB-1, docs/round3/autonomous-worker.md).
--
-- OPERATOR SCRIPT, NOT A MIGRATION. It is deliberately outside supabase/migrations: nothing applies it
-- automatically. Run it by hand in the Supabase SQL editor of the project production uses, once, after the
-- change is approved and the drain route that accepts it is deployed. Re-running it is safe (idempotent).
--
-- What it does: every minute, pg_cron checks whether any processing run is active and, only then, pg_net
-- POSTs to the deployed worker endpoint with the bearer secret. The endpoint claims and runs due jobs under
-- the existing leases, fencing, retries and checkpoints. No browser is involved.
--
-- Secrets: the endpoint URL and the bearer secret live in Supabase Vault, never in this file or in the job
-- text (cron.job stores the command in plain text, so the command only READS the vault at run time).
-- Step 1 is run separately, with the placeholders replaced in the SQL editor. Never commit real values.

-- 0. Extensions (available on every Supabase plan; enabling them is a no-op when already enabled).
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- 1. Secrets. Run ONCE, by hand, replacing the two placeholders (do not save the edited text anywhere):
--
--   select vault.create_secret('https://<production-domain>/api/pipeline/drain', 'baton_worker_url',
--                              'Baton scheduled worker endpoint');
--   select vault.create_secret('<the CRON_SECRET value set in Vercel, 32+ characters>', 'baton_worker_secret',
--                              'Bearer secret for the Baton worker endpoint');
--
-- Rotation: vault.update_secret(<id>, '<new value>') here AND update CRON_SECRET in Vercel, then redeploy
-- (a deployment keeps the CRON_SECRET it was built with). Until both match, calls answer 401 and the logs
-- show `worker_unauthorized`.

-- 2. The schedule. cron.schedule with an existing job name replaces that job's schedule and command.
select cron.schedule(
  'baton-pipeline-worker',
  '* * * * *',
  $job$
    select net.http_post(
      url := (select decrypted_secret from vault.decrypted_secrets where name = 'baton_worker_url'),
      body := '{}'::jsonb,
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'baton_worker_secret'),
        'x-baton-trigger', 'pg_cron'),
      -- The endpoint may run up to its maxDuration (300 s); never hang up on it first.
      timeout_milliseconds := 300000
    )
    -- Idle projects make no calls at all: only while some run is queued or running (which also covers
    -- closing a run whose last job was reaped, DB-15).
    where exists (select 1 from public.processing_runs where status in ('queued', 'running'))
      and exists (select 1 from vault.decrypted_secrets where name = 'baton_worker_url')
      and exists (select 1 from vault.decrypted_secrets where name = 'baton_worker_secret');
  $job$
);

-- 3. Housekeeping: keep pg_cron's own run history bounded (one row per minute otherwise grows forever).
select cron.schedule(
  'baton-pipeline-worker-history-cleanup',
  '17 3 * * *',
  $job$ delete from cron.job_run_details where end_time < now() - interval '7 days' $job$
);

-- To stop the scheduler (processing then advances only while a processing page is open, as before):
--   select cron.unschedule('baton-pipeline-worker');
--   select cron.unschedule('baton-pipeline-worker-history-cleanup');
