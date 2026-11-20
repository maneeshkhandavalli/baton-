-- Round 4 final fix (Agent C, audit S5 / F18): job completion and heartbeat are fenced like the data writers.
-- ADDITIVE: complete_processing_job and heartbeat_processing_job are replaced in place with the SAME
-- signatures and grants, and each gets a generation-checked twin with a DISTINCT name
-- (complete_processing_claim, heartbeat_processing_claim; p_claim_generation third), so there is exactly one
-- function per name and no positional call can become ambiguous. Idempotent (create or replace; grants re-applied).
--
-- Before: both checked only `status = 'running'` and the attempt number. A checkpointing `yield` gives its
-- attempt back, so the next claim reuses the attempt number, and a stale worker from before the yield could
-- complete (or keep alive) the job another worker had reclaimed. Completion also ignored lease expiry.
--
-- After, for completion (raises BTCF0 'job lease lost', which the worker treats as a lost claim):
--   * the claim generation must match exactly when given (twin), or (attempt-only original) the claim must be
--     unambiguous: claim_generation = attempt, i.e. no yield since the job was first claimed at that attempt.
--     This is exactly the rule _pipeline_claim already applies to every data writer;
--   * the lease must still be live (lease_expires_at > now()): an expired claim may already belong to another
--     worker, and every data write of that claim is already refused after expiry;
--   * the job's run must still be active (queued or running).
-- For heartbeat: the same generation rule, returning 'lost' (the existing contract) instead of raising.
-- The generation reaches the original through the transaction-local setting baton.claim_generation, set by
-- _pipeline_use_generation and cleared after the call, exactly like the 300800 writer twins.

create or replace function public.complete_processing_job(
  p_job_id uuid, p_attempt int, p_outcome text, p_attempt_record jsonb default null,
  p_error_code text default null, p_error_message text default null, p_next_attempt_at timestamptz default null,
  p_progress_done int default null, p_progress_total int default null
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.processing_jobs;
  v_yield boolean;
  v_status text;
  v_run_status text;
  v_generation text := nullif(current_setting('baton.claim_generation', true), '');
begin
  select * into v_job from public.processing_jobs where id = p_job_id for update;
  if not found then
    raise exception 'job not found' using errcode = 'BTNF0';
  end if;
  if v_job.status <> 'running' or v_job.attempt <> p_attempt then
    raise exception 'job lease lost' using errcode = 'BTCF0';
  end if;
  -- S5: one claim, one generation. Exact when given; otherwise (job, attempt) must be unambiguous.
  if (v_generation is not null and v_job.claim_generation <> v_generation::bigint)
     or (v_generation is null and v_job.claim_generation <> v_job.attempt) then
    raise exception 'job lease lost' using errcode = 'BTCF0';
  end if;
  -- S5: an expired lease is not this claim's any more (it is claimable by another worker).
  if v_job.lease_expires_at is null or v_job.lease_expires_at <= now() then
    raise exception 'job lease lost' using errcode = 'BTCF0';
  end if;
  -- S5: the run must still own the work (closing a run cancels its jobs; this is defence in depth).
  select status into v_run_status from public.processing_runs where id = v_job.run_id;
  if v_run_status is null or v_run_status not in ('queued', 'running') then
    raise exception 'job lease lost' using errcode = 'BTCF0';
  end if;
  if p_outcome is null or p_outcome not in ('succeeded', 'retry', 'failed', 'skipped', 'yield') then
    raise exception 'unknown outcome' using errcode = 'BTVF0';
  end if;
  if p_error_code is not null and p_error_code <> all (array[
       'validation_failed', 'unauthenticated', 'forbidden', 'not_found', 'conflict', 'invalid_transition',
       'precondition_failed', 'rate_limited', 'payload_too_large', 'unsupported_file_type', 'token_invalid',
       'parse_failed', 'processing_failed', 'internal']) then
    raise exception 'unknown error code' using errcode = 'BTVF0';
  end if;
  -- §12.7: a structural reason token only, never content.
  if p_error_message is not null and p_error_message !~ '^[a-z0-9_:]{1,64}$' then
    raise exception 'error message must be a reason token' using errcode = 'BTVF0';
  end if;
  if p_attempt_record is not null and jsonb_typeof(p_attempt_record) <> 'object' then
    raise exception 'attempt record must be an object' using errcode = 'BTVF0';
  end if;

  -- E4: progress is measured against the claim's starting point, not against heartbeats of this attempt.
  v_yield := p_outcome = 'yield' and p_progress_done is not null
             and p_progress_done > coalesce(v_job.claim_progress_done, 0);
  v_status := case
    when p_outcome = 'succeeded' then 'succeeded'
    when p_outcome = 'failed' then 'failed'
    when p_outcome = 'skipped' then 'cancelled'
    when v_yield then 'queued'
    when v_job.attempt < v_job.max_attempts then 'queued' -- retry, or a yield without progress
    else 'failed' end;

  update public.processing_jobs
     set attempt_log = case when p_attempt_record is null then attempt_log else attempt_log || jsonb_build_array(p_attempt_record) end,
         status = v_status,
         attempt = case when v_yield then attempt - 1 else attempt end,
         next_attempt_at = case when v_status = 'queued' then coalesce(p_next_attempt_at, now()) end,
         lease_expires_at = null,
         error_code = case when v_status = 'succeeded' or v_yield then null
                           when p_outcome = 'skipped' then 'precondition_failed' else p_error_code end,
         error_message = case when v_status = 'succeeded' or v_yield then null
                              when p_outcome = 'skipped' then 'upstream_failed' else p_error_message end,
         progress_done = coalesce(p_progress_done, progress_done),
         progress_total = coalesce(p_progress_total, progress_total),
         finished_at = case when v_status = 'queued' then null else now() end
   where id = p_job_id;
  return v_status;
end $$;

create or replace function public.heartbeat_processing_job(
  p_job_id uuid, p_attempt int, p_lease_seconds int, p_progress_done int default null, p_progress_total int default null
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.processing_jobs;
  v_run_status text;
  v_generation text := nullif(current_setting('baton.claim_generation', true), '');
begin
  if p_lease_seconds is null or p_lease_seconds < 30 or p_lease_seconds > 900 then
    raise exception 'invalid lease' using errcode = 'BTVF0';
  end if;
  select * into v_job from public.processing_jobs where id = p_job_id for update;
  if not found or v_job.status <> 'running' or v_job.attempt <> p_attempt then
    return 'lost';
  end if;
  -- S5: the same generation rule as completion and the data writers.
  if (v_generation is not null and v_job.claim_generation <> v_generation::bigint)
     or (v_generation is null and v_job.claim_generation <> v_job.attempt) then
    return 'lost';
  end if;
  -- An expired lease is not renewed: the job is claimable by another worker from that moment (DB-12).
  if v_job.lease_expires_at is null or v_job.lease_expires_at <= now() then
    return 'lost';
  end if;
  select status into v_run_status from public.processing_runs where id = v_job.run_id;
  if v_run_status is null or v_run_status not in ('queued', 'running') then
    return 'lost';
  end if;
  update public.processing_jobs
     set lease_expires_at = now() + make_interval(secs => p_lease_seconds),
         progress_done = coalesce(p_progress_done, progress_done),
         progress_total = coalesce(p_progress_total, progress_total)
   where id = p_job_id;
  return v_run_status;
end $$;

-- ── generation-checked twins (distinct names; p_claim_generation third, like the 300800 writers) ────────────────────────

create or replace function public.complete_processing_claim(
  p_job_id uuid, p_attempt int, p_claim_generation bigint, p_outcome text, p_attempt_record jsonb default null,
  p_error_code text default null, p_error_message text default null, p_next_attempt_at timestamptz default null,
  p_progress_done int default null, p_progress_total int default null
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result text;
begin
  perform public._pipeline_use_generation(p_claim_generation);
  v_result := public.complete_processing_job(p_job_id, p_attempt, p_outcome, p_attempt_record, p_error_code, p_error_message,
                                             p_next_attempt_at, p_progress_done, p_progress_total);
  perform set_config('baton.claim_generation', '', true);
  return v_result;
end $$;

create or replace function public.heartbeat_processing_claim(
  p_job_id uuid, p_attempt int, p_claim_generation bigint, p_lease_seconds int, p_progress_done int default null,
  p_progress_total int default null
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result text;
begin
  perform public._pipeline_use_generation(p_claim_generation);
  v_result := public.heartbeat_processing_job(p_job_id, p_attempt, p_lease_seconds, p_progress_done, p_progress_total);
  perform set_config('baton.claim_generation', '', true);
  return v_result;
end $$;

-- ── grants: service_role only ────────────────────────────────────────────────────────────────────────────

revoke execute on function
  public.complete_processing_job(uuid, int, text, jsonb, text, text, timestamptz, int, int),
  public.complete_processing_claim(uuid, int, bigint, text, jsonb, text, text, timestamptz, int, int),
  public.heartbeat_processing_job(uuid, int, int, int, int),
  public.heartbeat_processing_claim(uuid, int, bigint, int, int, int)
from public, anon, authenticated;

grant execute on function
  public.complete_processing_job(uuid, int, text, jsonb, text, text, timestamptz, int, int),
  public.complete_processing_claim(uuid, int, bigint, text, jsonb, text, text, timestamptz, int, int),
  public.heartbeat_processing_job(uuid, int, int, int, int),
  public.heartbeat_processing_claim(uuid, int, bigint, int, int, int)
to service_role;
