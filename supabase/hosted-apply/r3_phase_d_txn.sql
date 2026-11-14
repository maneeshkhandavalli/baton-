-- Baton Round 3, PHASE D transaction wrapper (psql script). WRITES. Run ONLY through `run-hosted.sh r3phaseD`.
--
-- Why a wrapper: 03_phase_D_migrations_14-18.sql (pinned, rehearsed, kept byte-for-byte) checks for queued or
-- running jobs in a DO block BEFORE its own `begin;`. That check is not atomic with the migrations: a worker
-- could queue or claim a job between the check and the transaction, and #17 (claim_generation) backfills every
-- job row assuming none is in flight. This wrapper closes that window:
--   1. the transaction opens first;
--   2. lock_timeout bounds every lock wait (a busy table aborts the run instead of hanging);
--   3. EXCLUSIVE locks on processing_runs and processing_jobs block INSERT/UPDATE/DELETE and SELECT ... FOR
--      UPDATE (job claims, heartbeats, new runs) until commit, while plain reads keep working;
--   4. the job, history and column checks run INSIDE the locked transaction;
--   5. the pinned bundle is included verbatim. Its own `begin;` only raises the WARNING "there is already a
--      transaction in progress" (not an error), its guard re-runs harmlessly, and its `commit;` commits
--      everything at once. Any error before that commit ends psql (ON_ERROR_STOP) and the server rolls the whole
--      transaction back: nothing is applied.
-- #17's ALTER TABLE later upgrades the processing_jobs lock to ACCESS EXCLUSIVE inside the same transaction.

\set ON_ERROR_STOP on
\set QUIET on
begin;
set local lock_timeout = '10s';
lock table public.processing_runs, public.processing_jobs in exclusive mode;

do $$
declare
  v_jobs int;
  v_rows int;
  v_newest text;
  v_phase_d int;
begin
  select count(*) into v_jobs from public.processing_jobs where status in ('queued', 'running');
  if v_jobs > 0 then
    raise exception 'phase D aborted: % processing job(s) queued or running (checked under lock)', v_jobs;
  end if;
  select count(*), max(version) into v_rows, v_newest from supabase_migrations.schema_migrations;
  if v_rows <> 31 or v_newest is distinct from '20261113300400' then
    raise exception 'phase D aborted: migration history has % rows, newest %; expected 31 rows, newest 20261113300400',
      v_rows, v_newest;
  end if;
  select count(*) into v_phase_d from supabase_migrations.schema_migrations
   where version in ('20261113300500', '20261113300600', '20261113300700', '20261113300800', '20261113300900');
  if v_phase_d <> 0 then
    raise exception 'phase D aborted: % Phase D migration(s) already recorded', v_phase_d;
  end if;
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'processing_jobs' and column_name = 'claim_generation') then
    raise exception 'phase D aborted: processing_jobs.claim_generation already exists';
  end if;
end $$;

\echo [phase D] locked; 0 jobs in flight; history 31 rows (newest 20261113300400); applying #14-#18
\set QUIET off
\i /ha/03_phase_D_migrations_14-18.sql
