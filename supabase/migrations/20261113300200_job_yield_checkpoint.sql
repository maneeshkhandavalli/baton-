-- Round 3, Agent 4 (E4). ADDITIVE: one nullable column, one trigger, and complete_processing_job replaced
-- with the SAME signature and grants. REQUIRES APPROVAL BEFORE ANY HOSTED APPLY.
--
-- Bug: complete_processing_job decided whether a `yield` made progress by comparing the reported
-- progress with processing_jobs.progress_done. But heartbeat_processing_job (and, since DB-13,
-- pipeline_store_extract_chunk) already write progress_done during the attempt, so a checkpointing
-- yield reported progress EQUAL to the stored value and was treated as "no progress": it consumed an
-- attempt, and a long extract that yields repeatedly could fail with attempts exhausted although every
-- yield had stored new chunks.
--
-- Fix: remember the progress at claim time (claim_progress_done, set by a trigger whenever a claim
-- increments `attempt`) and compare against that. A yield still has to make strictly more progress than
-- the claim started with, so a job cannot yield forever without doing work.

alter table public.processing_jobs add column claim_progress_done int;

create function public._remember_claim_progress()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status = 'running' and new.attempt > old.attempt then
    new.claim_progress_done := old.progress_done;
  end if;
  return new;
end $$;

create trigger processing_jobs_claim_progress
  before update of attempt on public.processing_jobs
  for each row execute function public._remember_claim_progress();

revoke execute on function public._remember_claim_progress() from public, anon, authenticated, service_role;

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
begin
  select * into v_job from public.processing_jobs where id = p_job_id for update;
  if not found then
    raise exception 'job not found' using errcode = 'BTNF0';
  end if;
  if v_job.status <> 'running' or v_job.attempt <> p_attempt then
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
