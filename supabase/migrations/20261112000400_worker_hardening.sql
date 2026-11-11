-- Worker hardening from the QA integration run (2026-11-12). Additive grants change + one CREATE OR REPLACE
-- with an unchanged signature and grants.
--
--   QA-N1  The legacy claim_processing_jobs and record_job_attempt bypass the reaper, stage ordering and
--          fencing of claim_ready_processing_jobs / complete_processing_job (DB-1, DB-2). The worker no
--          longer uses them, so no API role may execute them.
--   QA-L8  finish_processing_run copies error_message to handovers.last_error_message, which every member
--          can read. It now accepts only ERROR_CODES codes and reason tokens (§12.7), never free text.

revoke execute on function public.claim_processing_jobs(int, int) from public, anon, authenticated, service_role;
revoke execute on function public.record_job_attempt(uuid, text, jsonb, text, text, timestamptz, int, int)
  from public, anon, authenticated, service_role;

create or replace function public.finish_processing_run(p_run_id uuid, p_status text, p_error_code text default null, p_error_message text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_handover uuid;
  v_status text;
begin
  if p_error_code is not null and p_error_code <> all (array[
       'validation_failed', 'unauthenticated', 'forbidden', 'not_found', 'conflict', 'invalid_transition',
       'precondition_failed', 'rate_limited', 'payload_too_large', 'unsupported_file_type', 'token_invalid',
       'parse_failed', 'processing_failed', 'internal']) then
    raise exception 'unknown error code' using errcode = 'BTVF0';
  end if;
  if p_error_message is not null and p_error_message !~ '^[a-z0-9_:]{1,64}$' then
    raise exception 'error message must be a reason token' using errcode = 'BTVF0';
  end if;
  select handover_id into v_handover from public.processing_runs where id = p_run_id;
  if v_handover is null then
    raise exception 'run not found' using errcode = 'BTNF0';
  end if;
  perform public._lock_handover_for_update(v_handover, true); -- first lock
  -- M4: jobs before the run row (same order as the claim functions), never the reverse.
  perform 1 from public.processing_jobs where run_id = p_run_id order by id for update;
  select status into v_status from public.processing_runs where id = p_run_id for update;
  if v_status not in ('queued', 'running') then
    raise exception 'run is not active' using errcode = 'BTIT0';
  end if;
  if p_status not in ('succeeded', 'failed', 'cancelled') then
    raise exception 'invalid final status' using errcode = 'BTVF0';
  end if;
  perform public._close_run(v_handover, p_run_id, p_status, p_error_code, p_error_message, null);
end $$;
