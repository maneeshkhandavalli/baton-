-- Round 3 Task 01B (JOB-1 hardening): global worker concurrency and the scheduler's "is there work" check.
-- Additive: one table and five functions, all service-role only. Job-level leases, fencing, retries and
-- checkpoints (DB-1, DB-2, DB-12, DB-13, DB-15) are untouched; a worker slot only limits how many SWEEPS run
-- at once across every entry point (scheduler, the after() drain on start, the processing-page nudge, the
-- local dev loop), because they all go through lib/pipeline/worker.ts drainJobs.
--
--   pipeline_worker_slots            one row per slot; holder token + lease; generation counts acquisitions
--   acquire_pipeline_worker_slot     atomic: takes a free or expired slot among 1..p_max_slots, or returns null
--   renew_pipeline_worker_slot       extends the lease only for the current holder (token fencing)
--   release_pipeline_worker_slot     frees the slot only for the current holder (a stale worker cannot)
--   pipeline_work_due                true iff a sweep would have something to do right now (the scheduler's gate)

create table public.pipeline_worker_slots (
  slot int primary key check (slot between 1 and 16),
  holder uuid,
  generation bigint not null default 0,
  trigger text check (trigger is null or trigger ~ '^[a-z0-9_]{1,32}$'),
  acquired_at timestamptz,
  lease_expires_at timestamptz,
  constraint pipeline_worker_slots_held check ((holder is null) = (lease_expires_at is null))
);

alter table public.pipeline_worker_slots enable row level security;
revoke all on table public.pipeline_worker_slots from public, anon, authenticated, service_role;

create function public.acquire_pipeline_worker_slot(p_max_slots int, p_lease_seconds int, p_trigger text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_slot int;
  v_token uuid := gen_random_uuid();
  v_generation bigint;
begin
  if p_max_slots is null or p_max_slots < 1 or p_max_slots > 16
     or p_lease_seconds is null or p_lease_seconds < 30 or p_lease_seconds > 900
     or p_trigger is null or p_trigger !~ '^[a-z0-9_]{1,32}$' then
    raise exception 'invalid worker slot parameters' using errcode = 'BTVF0';
  end if;

  -- Only missing rows are inserted, so an acquisition never waits on a slot row another worker is taking.
  insert into public.pipeline_worker_slots (slot)
  select g from generate_series(1, p_max_slots) g
   where not exists (select 1 from public.pipeline_worker_slots s where s.slot = g)
  on conflict (slot) do nothing;

  -- Atomic: a slot another transaction is taking right now is skipped (never waited on, never shared).
  select s.slot into v_slot
    from public.pipeline_worker_slots s
   where s.slot <= p_max_slots
     and (s.holder is null or s.lease_expires_at <= now())
   order by s.slot
   limit 1
   for update skip locked;

  if v_slot is null then
    return null;
  end if;

  update public.pipeline_worker_slots
     set holder = v_token, generation = generation + 1, trigger = p_trigger, acquired_at = now(),
         lease_expires_at = now() + make_interval(secs => p_lease_seconds)
   where slot = v_slot
  returning generation into v_generation;

  return jsonb_build_object('slot', v_slot, 'token', v_token, 'generation', v_generation);
end $$;

create function public.renew_pipeline_worker_slot(p_slot int, p_token uuid, p_lease_seconds int)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_found boolean;
begin
  if p_slot is null or p_token is null or p_lease_seconds is null or p_lease_seconds < 30 or p_lease_seconds > 900 then
    raise exception 'invalid worker slot parameters' using errcode = 'BTVF0';
  end if;
  -- Only the current holder, and only while its lease is live: an expired holder has lost the slot even if
  -- nobody has taken it yet, so it can never extend itself back past a newer acquisition.
  update public.pipeline_worker_slots
     set lease_expires_at = now() + make_interval(secs => p_lease_seconds)
   where slot = p_slot and holder = p_token and lease_expires_at > now()
  returning true into v_found;
  return coalesce(v_found, false);
end $$;

create function public.release_pipeline_worker_slot(p_slot int, p_token uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_found boolean;
begin
  if p_slot is null or p_token is null then
    raise exception 'invalid worker slot parameters' using errcode = 'BTVF0';
  end if;
  update public.pipeline_worker_slots
     set holder = null, trigger = null, acquired_at = null, lease_expires_at = null
   where slot = p_slot and holder = p_token
  returning true into v_found;
  return coalesce(v_found, false);
end $$;

-- The scheduler's gate. True iff a drain would do something now, using the same predicates as
-- claim_ready_processing_jobs (DB-1) and the worker's run-outcome rules (lib/pipeline/finish.ts):
--   (a) a queued job is due (no backoff pending) and every earlier stage it depends on is terminal,
--       and (for extract) no other extract of its run holds a live lease;
--   (b) a running job's lease has expired (reclaimed as the next attempt, or reaped on its last);
--   (c) an active run can be finalised now: no open job, or a run-fatal failure, or a failed
--       handover-level stage (decideRunOutcome finishes these at once).
-- A run that is merely "running" with all its jobs in backoff or under a live lease is NOT due.
-- Keep RUN_FATAL_REASONS in step with lib/pipeline/types.ts (asserted by lib/pipeline/__tests__).
create function public.pipeline_work_due()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    exists (
      select 1
        from public.processing_jobs c0
        join public.processing_runs r on r.id = c0.run_id
       where r.status in ('queued', 'running')
         and c0.status = 'queued'
         and (c0.next_attempt_at is null or c0.next_attempt_at <= now())
         and c0.attempt < c0.max_attempts
         and not exists (
           select 1 from public.processing_jobs d
            where d.run_id = c0.run_id and d.id <> c0.id
              and public._pipeline_stage_rank(d.stage) < public._pipeline_stage_rank(c0.stage)
              and (d.source_id is not distinct from c0.source_id or d.source_id is null or c0.source_id is null)
              and d.status not in ('succeeded', 'failed', 'cancelled'))
         and (c0.stage <> 'extract' or not exists (
           select 1 from public.processing_jobs e
            where e.run_id = c0.run_id and e.id <> c0.id and e.stage = 'extract'
              and e.status = 'running' and e.lease_expires_at >= now())))
    or exists (
      select 1
        from public.processing_jobs j
        join public.processing_runs r on r.id = j.run_id
       where r.status in ('queued', 'running')
         and j.status = 'running' and j.lease_expires_at < now())
    or exists (
      select 1
        from public.processing_runs r
       where r.status in ('queued', 'running')
         and (not exists (select 1 from public.processing_jobs j where j.run_id = r.id and j.status in ('queued', 'running'))
              or exists (select 1 from public.processing_jobs j
                          where j.run_id = r.id and j.status = 'failed'
                            and (j.error_message in ('provider_not_configured', 'ai_config_changed', 'db_schema_outdated')
                                 or j.stage in ('verify_support', 'analyze', 'prepare_review')))));
$$;

revoke execute on function public.acquire_pipeline_worker_slot(int, int, text) from public, anon, authenticated, service_role;
revoke execute on function public.renew_pipeline_worker_slot(int, uuid, int) from public, anon, authenticated, service_role;
revoke execute on function public.release_pipeline_worker_slot(int, uuid) from public, anon, authenticated, service_role;
revoke execute on function public.pipeline_work_due() from public, anon, authenticated, service_role;
grant execute on function public.acquire_pipeline_worker_slot(int, int, text) to service_role;
grant execute on function public.renew_pipeline_worker_slot(int, uuid, int) to service_role;
grant execute on function public.release_pipeline_worker_slot(int, uuid) to service_role;
grant execute on function public.pipeline_work_due() to service_role;
