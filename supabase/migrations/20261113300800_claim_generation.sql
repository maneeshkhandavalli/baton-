-- Round 3, Agent 4 (DB-12 follow-up: claim generation + heartbeat on an expired lease). ADDITIVE: one column
-- (backfilled), CREATE OR REPLACE of three functions with unchanged signatures and grants, and new overloads.
-- REQUIRES APPROVAL BEFORE ANY HOSTED APPLY.
--
-- 1. Claim generation. `(job, attempt)` was not unique per claim: a checkpointing `yield` gives its attempt
--    back (attempt - 1), so the next claim reuses the same attempt number. `processing_jobs.claim_generation`
--    is incremented by every claim (the same trigger that remembers the claim's starting progress) and is
--    never decremented, so it identifies one claim. Existing rows are backfilled with `attempt`, so a job that
--    never yielded keeps claim_generation = attempt.
--      * New overloads pipeline_*(p_job_id, p_attempt, p_claim_generation, ...) check the exact generation.
--        The worker (lib/db/pipeline.ts) uses them whenever the claim carries a generation.
--      * The original pipeline_*(p_job_id, p_attempt, ...) stay granted (backwards compatible), but are now
--        accepted only while (job, attempt) is unambiguous, i.e. claim_generation = attempt (no yield since
--        the job was first claimed at that attempt); otherwise they refuse with BTLL0.
--    The overloads pass the generation to _pipeline_claim through a transaction-local setting
--    (baton.claim_generation) and call the original function, so every other check is unchanged.
-- 2. heartbeat_processing_job no longer renews a lease that has already expired: it returns 'lost', and the
--    worker stops (LeaseLostError → the job is dropped, recorded nothing) instead of reviving a claim that
--    another worker may already be entitled to take.

alter table public.processing_jobs add column claim_generation bigint not null default 0;
update public.processing_jobs set claim_generation = attempt;

create or replace function public._remember_claim_progress()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status = 'running' and new.attempt > old.attempt then
    new.claim_progress_done := old.progress_done;
    new.claim_generation := old.claim_generation + 1; -- one claim, one generation; a yield never lowers it
  end if;
  return new;
end $$;

create or replace function public._pipeline_claim(p_job_id uuid, p_attempt int, p_stages text[])
returns public.processing_jobs
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_handover uuid;
  v_job public.processing_jobs;
  v_run_status text;
  v_generation text := nullif(current_setting('baton.claim_generation', true), '');
begin
  if p_job_id is null or p_attempt is null then
    raise exception 'a claim (job id and attempt) is required' using errcode = 'BTVF0';
  end if;
  select handover_id into v_handover from public.processing_jobs where id = p_job_id;
  if v_handover is null then
    raise exception 'job not found' using errcode = 'BTNF0';
  end if;
  perform public._lock_handover_for_share(v_handover); -- first lock (same order as finish_processing_run)
  select * into v_job from public.processing_jobs where id = p_job_id for no key update;
  if v_job.status <> 'running' or v_job.attempt <> p_attempt
     or v_job.lease_expires_at is null or v_job.lease_expires_at <= now() then
    raise exception 'claim lost' using errcode = 'BTLL0';
  end if;
  -- Claim generation: exact match when the caller gave one; otherwise (job, attempt) must be unambiguous.
  if (v_generation is not null and v_job.claim_generation <> v_generation::bigint)
     or (v_generation is null and v_job.claim_generation <> v_job.attempt) then
    raise exception 'claim lost' using errcode = 'BTLL0';
  end if;
  select status into v_run_status from public.processing_runs where id = v_job.run_id;
  if v_run_status is null or v_run_status not in ('queued', 'running') then
    raise exception 'claim lost' using errcode = 'BTLL0';
  end if;
  if not (v_job.stage = any (p_stages)) then
    raise exception 'this stage may not perform that write' using errcode = 'BTFB0';
  end if;
  perform public._require_active_run(v_job.handover_id, v_job.run_id); -- N3: handover still processing
  return v_job;
end $$;

-- Sets the generation for the fenced call that follows in this transaction; NULL is refused.
create function public._pipeline_use_generation(p_claim_generation bigint)
returns void
language plpgsql
set search_path = ''
as $$
begin
  if p_claim_generation is null or p_claim_generation < 1 then
    raise exception 'a claim generation is required' using errcode = 'BTVF0';
  end if;
  perform set_config('baton.claim_generation', p_claim_generation::text, true);
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
begin
  if p_lease_seconds is null or p_lease_seconds < 30 or p_lease_seconds > 900 then
    raise exception 'invalid lease' using errcode = 'BTVF0';
  end if;
  select * into v_job from public.processing_jobs where id = p_job_id for update;
  if not found or v_job.status <> 'running' or v_job.attempt <> p_attempt then
    return 'lost';
  end if;
  -- An expired lease is not renewed: the job is claimable by another worker from that moment (DB-12).
  if v_job.lease_expires_at is null or v_job.lease_expires_at <= now() then
    return 'lost';
  end if;
  select status into v_run_status from public.processing_runs where id = v_job.run_id;
  if v_run_status not in ('queued', 'running') then
    return 'lost';
  end if;
  update public.processing_jobs
     set lease_expires_at = now() + make_interval(secs => p_lease_seconds),
         progress_done = coalesce(p_progress_done, progress_done),
         progress_total = coalesce(p_progress_total, progress_total)
   where id = p_job_id;
  return v_run_status;
end $$;

-- ── generation-checked overloads of the fenced writers ─────────────────────────

create function public.pipeline_set_job_provenance(p_job_id uuid, p_attempt int, p_claim_generation bigint, p_provenance jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public._pipeline_use_generation(p_claim_generation);
  perform public.pipeline_set_job_provenance(p_job_id, p_attempt, p_provenance);
  perform set_config('baton.claim_generation', '', true);
end $$;

create function public.pipeline_persist_parsed_source(p_job_id uuid, p_attempt int, p_claim_generation bigint, p_parsed jsonb, p_pepper_version text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public._pipeline_use_generation(p_claim_generation);
  perform public.pipeline_persist_parsed_source(p_job_id, p_attempt, p_parsed, p_pepper_version);
  perform set_config('baton.claim_generation', '', true);
end $$;

create function public.pipeline_mark_source_parse_failed(p_job_id uuid, p_attempt int, p_claim_generation bigint, p_error_code text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public._pipeline_use_generation(p_claim_generation);
  perform public.pipeline_mark_source_parse_failed(p_job_id, p_attempt, p_error_code);
  perform set_config('baton.claim_generation', '', true);
end $$;

create function public.pipeline_record_quote_check(p_job_id uuid, p_attempt int, p_claim_generation bigint, p_evidence_id uuid, p_quote_check text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public._pipeline_use_generation(p_claim_generation);
  perform public.pipeline_record_quote_check(p_job_id, p_attempt, p_evidence_id, p_quote_check);
  perform set_config('baton.claim_generation', '', true);
end $$;

create function public.pipeline_record_support_verdict(p_job_id uuid, p_attempt int, p_claim_generation bigint, p_point_evidence_id uuid, p_revision_id uuid, p_verdict text, p_rationale text, p_provenance jsonb, p_quote_sha256 bytea)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public._pipeline_use_generation(p_claim_generation);
  perform public.pipeline_record_support_verdict(p_job_id, p_attempt, p_point_evidence_id, p_revision_id, p_verdict, p_rationale, p_provenance, p_quote_sha256);
  perform set_config('baton.claim_generation', '', true);
end $$;

create function public.pipeline_create_system_gap_question(p_job_id uuid, p_attempt int, p_claim_generation bigint, p_point_id uuid, p_category text, p_question text, p_context text, p_priority text, p_access_level text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result uuid;
begin
  perform public._pipeline_use_generation(p_claim_generation);
  v_result := public.pipeline_create_system_gap_question(p_job_id, p_attempt, p_point_id, p_category, p_question, p_context, p_priority, p_access_level);
  perform set_config('baton.claim_generation', '', true);
  return v_result;
end $$;

create function public.pipeline_set_point_sort_keys(p_job_id uuid, p_attempt int, p_claim_generation bigint, p_keys jsonb)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result int;
begin
  perform public._pipeline_use_generation(p_claim_generation);
  v_result := public.pipeline_set_point_sort_keys(p_job_id, p_attempt, p_keys);
  perform set_config('baton.claim_generation', '', true);
  return v_result;
end $$;

create function public.pipeline_store_extract_chunk(p_job_id uuid, p_attempt int, p_claim_generation bigint, p_chunk_index int, p_chunk_total int, p_access_level text, p_ai_provenance jsonb, p_entries jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  perform public._pipeline_use_generation(p_claim_generation);
  v_result := public.pipeline_store_extract_chunk(p_job_id, p_attempt, p_chunk_index, p_chunk_total, p_access_level, p_ai_provenance, p_entries);
  perform set_config('baton.claim_generation', '', true);
  return v_result;
end $$;

-- ── grants ───────────────────────────────────────────────────────────────────

revoke execute on function public._pipeline_use_generation(bigint) from public, anon, authenticated, service_role;

revoke execute on function
  public.pipeline_set_job_provenance(uuid, int, bigint, jsonb),
  public.pipeline_persist_parsed_source(uuid, int, bigint, jsonb, text),
  public.pipeline_mark_source_parse_failed(uuid, int, bigint, text),
  public.pipeline_record_quote_check(uuid, int, bigint, uuid, text),
  public.pipeline_record_support_verdict(uuid, int, bigint, uuid, uuid, text, text, jsonb, bytea),
  public.pipeline_create_system_gap_question(uuid, int, bigint, uuid, text, text, text, text, text),
  public.pipeline_set_point_sort_keys(uuid, int, bigint, jsonb),
  public.pipeline_store_extract_chunk(uuid, int, bigint, int, int, text, jsonb, jsonb)
from public, anon, authenticated, service_role;

grant execute on function
  public.pipeline_set_job_provenance(uuid, int, bigint, jsonb),
  public.pipeline_persist_parsed_source(uuid, int, bigint, jsonb, text),
  public.pipeline_mark_source_parse_failed(uuid, int, bigint, text),
  public.pipeline_record_quote_check(uuid, int, bigint, uuid, text),
  public.pipeline_record_support_verdict(uuid, int, bigint, uuid, uuid, text, text, jsonb, bytea),
  public.pipeline_create_system_gap_question(uuid, int, bigint, uuid, text, text, text, text, text),
  public.pipeline_set_point_sort_keys(uuid, int, bigint, jsonb),
  public.pipeline_store_extract_chunk(uuid, int, bigint, int, int, text, jsonb, jsonb)
to service_role;
