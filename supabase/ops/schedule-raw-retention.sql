-- Baton raw-upload retention schedule (Round 3 Task 02, PRIV-2; docs/architecture/privacy-and-data-protection.md).
--
-- OPERATOR SCRIPT, NOT A MIGRATION, and OPT-IN: run it only after the owner approved the retention policy.
-- It reuses the pipeline worker's scheduler infrastructure (supabase/ops/schedule-pipeline-worker.sql:
-- pg_cron, pg_net, Vault, the private baton_ops schema and the signed-dispatch convention). It is not a
-- second worker and does not touch the worker's schedule. Prerequisites, in order:
--   1. migration 20261117200200_raw_retention.sql is applied;
--   2. the app version with /api/cron/retention is deployed. What the endpoint DOES is decided there:
--      BATON_RETENTION_MODE unset/"off" → nothing; "dry_run" → inventory only; "live" → deletes.
--      Start with "dry_run" for a week (proposal choice 6), then "live";
--   3. schedule-pipeline-worker.sql has been run (it creates baton_ops and the baton_worker_secret);
--   4. one more Vault secret exists (run ONCE, by hand, in the SQL editor; never commit the value):
--        select vault.create_secret('https://<production-domain>/api/cron/retention', 'baton_retention_url', 'Baton retention endpoint');
-- Run as `postgres`. Re-running is safe. Signed headers are bound to the "retention" purpose
-- ("v1.<ts>.<id>.retention"), so a header captured from pg_net's queue cannot start a pipeline drain and a
-- drain header cannot start a retention sweep.

do $$
begin
  if not exists (select 1 from pg_namespace where nspname = 'baton_ops') then
    raise exception 'run supabase/ops/schedule-pipeline-worker.sql first (baton_ops is missing)';
  end if;
  if to_regclass('public.raw_retention_items') is null or to_regclass('public.raw_retention_runs') is null then
    raise exception 'apply migration 20261117200200_raw_retention.sql first';
  end if;
end $$;

create table if not exists baton_ops.retention_dispatches (
  id bigint generated always as identity primary key,
  dispatched_at timestamptz not null default now(),
  request_id bigint,
  outcome text not null default 'pending'
    check (outcome in ('pending', 'ok', 'http_error', 'timeout', 'connection_error', 'missing', 'not_sent')),
  status_code int,
  error text,
  claimed int,
  deleted int,
  failed int,
  checked_at timestamptz
);
create index if not exists retention_dispatches_pending on baton_ops.retention_dispatches (dispatched_at) where outcome = 'pending';
revoke all on table baton_ops.retention_dispatches from public, anon, authenticated, service_role;

create or replace function baton_ops.reconcile_retention_dispatches()
returns int
language plpgsql
set search_path = ''
as $$
declare
  v_done int;
begin
  update baton_ops.retention_dispatches d
     set outcome = case
                     when h.timed_out then 'timeout'
                     when h.status_code is null then 'connection_error'
                     when h.status_code between 200 and 299 then 'ok'
                     else 'http_error'
                   end,
         status_code = h.status_code,
         error = case when h.error_msg is null then null
                      else left(regexp_replace(h.error_msg, '[^A-Za-z0-9 _.:,()/-]', '', 'g'), 200) end,
         claimed = baton_ops._json_int(h.content, 'claimed'),
         deleted = baton_ops._json_int(h.content, 'deleted'),
         failed = baton_ops._json_int(h.content, 'failed'),
         checked_at = now()
    from net._http_response h
   where d.outcome = 'pending' and h.id = d.request_id;
  get diagnostics v_done = row_count;
  update baton_ops.retention_dispatches
     set outcome = 'missing', checked_at = now()
   where outcome = 'pending' and dispatched_at < now() - interval '7 minutes';
  return v_done;
end $$;

create or replace function baton_ops.retention_tick()
returns text
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
  perform baton_ops.reconcile_retention_dispatches();
  if exists (select 1 from baton_ops.retention_dispatches where outcome = 'pending') then
    return 'in_flight';
  end if;
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'baton_retention_url';
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'baton_worker_secret';
  if v_url is null or v_key is null or length(v_key) < 32 then
    insert into baton_ops.retention_dispatches (outcome, error, checked_at) values ('not_sent', 'secrets_missing', now());
    return 'not_sent';
  end if;
  insert into baton_ops.retention_dispatches default values returning id into v_id;
  v_at := floor(extract(epoch from clock_timestamp()))::bigint;
  v_request := net.http_post(
    url := v_url,
    body := jsonb_build_object('dispatch', v_id),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-baton-dispatch', 'v1.' || v_at || '.' || v_id || '.'
        || encode(extensions.hmac('v1.' || v_at || '.' || v_id || '.retention', v_key, 'sha256'), 'hex')),
    timeout_milliseconds := 300000
  );
  update baton_ops.retention_dispatches set request_id = v_request where id = v_id;
  return 'dispatched';
end $$;

create or replace function baton_ops.retention_housekeeping()
returns void
language sql
set search_path = ''
as $$
  delete from baton_ops.retention_dispatches where dispatched_at < now() - interval '30 days';
  delete from cron.job_run_details
   where end_time < now() - interval '7 days'
     and jobid in (select jobid from cron.job where jobname = 'baton-raw-retention');
$$;

revoke all on all tables in schema baton_ops from public, anon, authenticated, service_role;
revoke all on all functions in schema baton_ops from public, anon, authenticated, service_role;

-- Hourly, at minute 41 (away from the worker's housekeeping at 03:17). The housekeeping runs inside the
-- daily 03:47 slot.
select cron.schedule('baton-raw-retention', '41 * * * *', $job$ select baton_ops.retention_tick() $job$);
select cron.schedule('baton-raw-retention-housekeeping', '47 3 * * *', $job$ select baton_ops.retention_housekeeping() $job$);

do $$
declare
  r text;
begin
  foreach r in array array['anon', 'authenticated'] loop
    if has_schema_privilege(r, 'baton_ops', 'USAGE') then raise exception 'baton_ops is usable by %', r; end if;
    if has_table_privilege(r, 'public.raw_retention_items', 'SELECT') then raise exception 'raw_retention_items is readable by %', r; end if;
    if has_table_privilege(r, 'public.raw_retention_runs', 'SELECT') then raise exception 'raw_retention_runs is readable by %', r; end if;
  end loop;
end $$;

-- Operational report (counts only):   select public.raw_retention_report();
-- Dispatch health:                     select outcome, count(*) from baton_ops.retention_dispatches
--                                        where dispatched_at > now() - interval '24 hours' group by 1;
-- To stop:   select cron.unschedule('baton-raw-retention'); select cron.unschedule('baton-raw-retention-housekeeping');
-- (or set BATON_RETENTION_MODE=off on the deployment: the endpoint then does nothing).
