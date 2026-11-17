-- Baton scheduled pipeline worker (Round 3 JOB-1 / Task 01B, docs/round3/autonomous-worker.md).
--
-- OPERATOR SCRIPT, NOT A MIGRATION. Nothing applies it automatically. Prerequisites, in order:
--   1. migration 20261117100100_pipeline_worker_slots.sql is applied (public.pipeline_work_due and the
--      worker-slot functions);
--   2. the app version that accepts signed dispatches (lib/pipeline/worker-auth.ts) is deployed;
--   3. the two Vault secrets below exist.
-- Run it as `postgres` (the Supabase SQL editor's role). Re-running it is safe (idempotent). It ends with
-- privilege checks that abort the script if anything is exposed that must not be.
-- Verified locally by supabase/ops/tests/run.sh (supabase/postgres image, pg_cron + pg_net + Vault).
--
-- Every minute, `baton_ops.pipeline_worker_tick()`:
--   1. reconciles earlier dispatches with pg_net's responses (ok / http_error / timeout / connection_error /
--      missing), so endpoint failures are recorded, not just "the cron job ran";
--   2. returns unless public.pipeline_work_due() (a job is due, a retry's time has come, a lease expired, or
--      a run can be finalised): an idle or merely-waiting database makes no call;
--   3. returns while an earlier dispatch is still pending (at most one scheduler request in flight);
--   4. otherwise POSTs to the worker endpoint with a SIGNED, short-lived header. The long-lived secret never
--      leaves the database: pg_net's request queue (granted to PUBLIC by Supabase, and not revocable by
--      `postgres`) only ever holds `x-baton-dispatch: v1.<ts>.<id>.<hmac>`, valid for 120 s.
--
-- Secrets (run ONCE, by hand, replacing the placeholders in the SQL editor; never commit or save values):
--   select vault.create_secret('https://<production-domain>/api/pipeline/drain', 'baton_worker_url', 'Baton worker endpoint');
--   select vault.create_secret('<the CRON_SECRET value set in Vercel, 32+ characters>', 'baton_worker_secret', 'Baton worker signing key');
-- Rotation: vault.update_secret(<id>, '<new>') AND Vercel CRON_SECRET, then redeploy. Until both match, the
-- endpoint answers 401 and dispatches are recorded as http_error 401; jobs wait, nothing is lost.

-- 0. Extensions (available on every Supabase plan; no-ops when already enabled).
create extension if not exists pg_cron;
create extension if not exists pg_net;
create extension if not exists pgcrypto with schema extensions;

-- 1. A private schema for the scheduler's own state. Never exposed through the Data API; no grants.
create schema if not exists baton_ops;
revoke all on schema baton_ops from public, anon, authenticated, service_role;

create table if not exists baton_ops.worker_dispatches (
  id bigint generated always as identity primary key,
  dispatched_at timestamptz not null default now(),
  request_id bigint,
  outcome text not null default 'pending'
    check (outcome in ('pending', 'ok', 'http_error', 'timeout', 'connection_error', 'missing', 'not_sent')),
  status_code int,
  error text,
  claimed int,
  succeeded int,
  failed int,
  retried int,
  busy int,
  checked_at timestamptz
);
create index if not exists worker_dispatches_pending on baton_ops.worker_dispatches (dispatched_at) where outcome = 'pending';
create index if not exists worker_dispatches_request on baton_ops.worker_dispatches (request_id);
revoke all on table baton_ops.worker_dispatches from public, anon, authenticated, service_role;

-- An integer field of the endpoint's JSON response (counts only), or null. Never raises.
create or replace function baton_ops._json_int(p_body text, p_key text)
returns int
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_body is null or length(p_body) > 4000 then return null; end if;
  if jsonb_typeof(p_body::jsonb -> p_key) = 'number' then return (p_body::jsonb ->> p_key)::numeric::int; end if;
  return null;
exception when others then
  return null;
end $$;

-- Records the HTTP outcome of every pending dispatch whose pg_net response exists. A dispatch with no
-- response 7 minutes after it was sent (the request timeout is 5 minutes) becomes `missing`, which is
-- never confused with `ok`. Response rows live 6 h in pg_net; this runs every minute.
create or replace function baton_ops.reconcile_worker_dispatches()
returns int
language plpgsql
set search_path = ''
as $$
declare
  v_done int;
begin
  update baton_ops.worker_dispatches d
     set outcome = case
                     when h.timed_out then 'timeout'
                     when h.status_code is null then 'connection_error'
                     when h.status_code between 200 and 299 then 'ok'
                     else 'http_error'
                   end,
         status_code = h.status_code,
         -- pg_net's own error text (e.g. "Could not resolve host: <host>"), restricted and truncated.
         -- Request headers and bodies are never copied.
         error = case when h.error_msg is null then null
                      else left(regexp_replace(h.error_msg, '[^A-Za-z0-9 _.:,()/-]', '', 'g'), 200) end,
         claimed = baton_ops._json_int(h.content, 'claimed'),
         succeeded = baton_ops._json_int(h.content, 'succeeded'),
         failed = baton_ops._json_int(h.content, 'failed'),
         retried = baton_ops._json_int(h.content, 'retried'),
         busy = baton_ops._json_int(h.content, 'busy'),
         checked_at = now()
    from net._http_response h
   where d.outcome = 'pending' and h.id = d.request_id;
  get diagnostics v_done = row_count;

  update baton_ops.worker_dispatches
     set outcome = 'missing', checked_at = now()
   where outcome = 'pending' and dispatched_at < now() - interval '7 minutes';
  return v_done;
end $$;

-- Sends one signed dispatch (see lib/pipeline/worker-auth.ts for the verifier). Returns the dispatch id.
create or replace function baton_ops.dispatch_pipeline_worker(p_timeout_ms int default 300000)
returns bigint
language plpgsql
set search_path = ''
as $$
declare
  v_url text;
  v_key text;
  v_id bigint;
  v_at bigint;
  v_request bigint;
begin
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'baton_worker_url';
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'baton_worker_secret';
  if v_url is null or v_key is null or length(v_key) < 32 then
    insert into baton_ops.worker_dispatches (outcome, error, checked_at) values ('not_sent', 'secrets_missing', now())
    returning id into v_id;
    return v_id;
  end if;

  insert into baton_ops.worker_dispatches default values returning id into v_id;
  v_at := floor(extract(epoch from clock_timestamp()))::bigint;
  v_request := net.http_post(
    url := v_url,
    body := jsonb_build_object('dispatch', v_id),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-baton-dispatch', 'v1.' || v_at || '.' || v_id || '.'
        || encode(extensions.hmac('v1.' || v_at || '.' || v_id, v_key, 'sha256'), 'hex')),
    -- The endpoint may run up to its maxDuration (300 s); never hang up on it first.
    timeout_milliseconds := p_timeout_ms
  );
  update baton_ops.worker_dispatches set request_id = v_request where id = v_id;
  return v_id;
end $$;

-- The scheduled job. Returns 'idle', 'in_flight' or 'dispatched' (visible in cron.job_run_details).
create or replace function baton_ops.pipeline_worker_tick()
returns text
language plpgsql
set search_path = ''
as $$
begin
  perform baton_ops.reconcile_worker_dispatches();
  if not public.pipeline_work_due() then
    return 'idle';
  end if;
  if exists (select 1 from baton_ops.worker_dispatches where outcome = 'pending') then
    return 'in_flight';
  end if;
  perform baton_ops.dispatch_pipeline_worker();
  return 'dispatched';
end $$;

-- Daily housekeeping, limited to Baton's own records: its dispatch log and ITS cron jobs' history only.
create or replace function baton_ops.housekeeping()
returns void
language sql
set search_path = ''
as $$
  delete from baton_ops.worker_dispatches where dispatched_at < now() - interval '14 days';
  delete from cron.job_run_details
   where end_time < now() - interval '7 days'
     and jobid in (select jobid from cron.job where jobname in ('baton-pipeline-worker', 'baton-pipeline-worker-housekeeping'));
$$;

-- Operational report: one row. `failures_since_last_ok` > 0 with `work_due_now` true is the alarm condition.
create or replace view baton_ops.worker_health as
with d as (select * from baton_ops.worker_dispatches),
     last_ok as (select max(dispatched_at) as at from d where outcome = 'ok')
select
  (select at from last_ok) as last_ok_at,
  (select max(dispatched_at) from d) as last_dispatch_at,
  (select count(*) from d where outcome = 'pending') as pending_now,
  (select count(*) from d where outcome not in ('ok', 'pending')
                            and dispatched_at > coalesce((select at from last_ok), '-infinity'::timestamptz)) as failures_since_last_ok,
  (select count(*) from d where dispatched_at > now() - interval '24 hours' and outcome = 'ok') as ok_24h,
  (select count(*) from d where dispatched_at > now() - interval '24 hours' and outcome = 'ok' and busy = 1) as busy_24h,
  (select count(*) from d where dispatched_at > now() - interval '24 hours' and outcome = 'http_error') as http_error_24h,
  (select count(*) from d where dispatched_at > now() - interval '24 hours' and outcome = 'timeout') as timeout_24h,
  (select count(*) from d where dispatched_at > now() - interval '24 hours' and outcome = 'connection_error') as connection_error_24h,
  (select count(*) from d where dispatched_at > now() - interval '24 hours' and outcome = 'missing') as missing_24h,
  (select count(*) from d where dispatched_at > now() - interval '24 hours' and outcome = 'not_sent') as not_sent_24h,
  public.pipeline_work_due() as work_due_now;

revoke all on all tables in schema baton_ops from public, anon, authenticated, service_role;
revoke all on all functions in schema baton_ops from public, anon, authenticated, service_role;

-- 2. Schedules. cron.schedule with an existing name replaces that job's schedule and command.
select cron.schedule('baton-pipeline-worker', '* * * * *', $job$ select baton_ops.pipeline_worker_tick() $job$);
select cron.schedule('baton-pipeline-worker-housekeeping', '17 3 * * *', $job$ select baton_ops.housekeeping() $job$);
-- The Task 01 version's cleanup job deleted every job's history; remove it if it was ever scheduled.
do $$
begin
  if exists (select 1 from cron.job where jobname = 'baton-pipeline-worker-history-cleanup') then
    perform cron.unschedule('baton-pipeline-worker-history-cleanup');
  end if;
end $$;

-- 3. Checks. Abort (and roll back nothing silently) if anything that must stay private is reachable.
do $$
declare
  r text;
begin
  foreach r in array array['anon', 'authenticated'] loop
    if has_schema_privilege(r, 'baton_ops', 'USAGE') then raise exception 'baton_ops is usable by %', r; end if;
    if has_table_privilege(r, 'vault.decrypted_secrets', 'SELECT') then raise exception 'vault.decrypted_secrets is readable by %', r; end if;
    if exists (select 1 from pg_namespace where nspname = 'cron') and has_schema_privilege(r, 'cron', 'USAGE') then
      raise exception 'the cron schema is usable by %', r;
    end if;
  end loop;
  if exists (select 1 from cron.job j join vault.decrypted_secrets s on s.name = 'baton_worker_secret'
              where position(s.decrypted_secret in j.command) > 0) then
    raise exception 'a cron job command contains the worker secret';
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticator'
               and exists (select 1 from unnest(coalesce(rolconfig, '{}')) c
                            where c like 'pgrst.db_schemas=%' and (c ~ '(=|,)\s*net\s*(,|$)' or c ~ '(=|,)\s*baton_ops\s*(,|$)'))) then
    raise exception 'net or baton_ops is exposed through the Data API (pgrst.db_schemas)';
  end if;
  -- Informational: Supabase grants pg_net's tables to PUBLIC and only their owner can revoke that
  -- (supabase/ops/harden-pg-net.sql). Baton queues no long-lived credential there.
  if has_table_privilege('anon', 'net.http_request_queue', 'SELECT') then
    raise notice 'pg_net request queue is readable by anon (Supabase default); it holds only short-lived signed dispatch headers';
  end if;
end $$;

-- To stop the scheduler (processing then advances only while a processing page is open, as before):
--   select cron.unschedule('baton-pipeline-worker');
--   select cron.unschedule('baton-pipeline-worker-housekeeping');
