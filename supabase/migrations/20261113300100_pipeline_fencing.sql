-- Round 3, Agent 4 (AI & pipeline reliability). ADDITIVE: new functions and grants only; no existing
-- function, table, column or policy is changed. REQUIRES APPROVAL BEFORE ANY HOSTED APPLY.
--
--   DB-12  Stale-worker fencing. Every pipeline writer now has a fenced twin that takes the worker's claim
--          (job id + attempt) and refuses the write unless, at commit time:
--            * the job is `running` with exactly that attempt (not reclaimed, reaped, finished, cancelled),
--            * its lease has not expired,
--            * its run is still active (queued/running),
--            * the job's stage is one that may perform this write, and
--            * the target row belongs to the job's handover (and, for per-source stages, its source).
--          The job row is locked (FOR NO KEY UPDATE) after the handover row (FOR SHARE), so a write and
--          a completion / reclaim / reap / run close are serialised: the loser sees the new state.
--          A refused claim raises SQLSTATE BTLL0 ("claim lost"), which lib/db/pipeline.ts turns into
--          ClaimLostError; the runner drops the job without recording anything (the lease expires and
--          the job is reclaimed, or reaped on its last attempt).
--   DB-13  pipeline_store_extract_chunk: one chunk's points and their evidence in ONE transaction, with
--          the chunk checkpoint (`progress_done`) in the same transaction. A new point with no citation
--          that survives validation is not inserted (no point without evidence); a failure rolls back
--          the whole chunk (no orphan evidence); a repeated call for a committed chunk is a no-op
--          (idempotent on retry, and on a lost response).
--
-- Lock order everywhere: handover (FOR SHARE) → job → source / point / evidence rows, the same order
-- finish_processing_run uses (handover FOR UPDATE → jobs → run). complete_processing_job and
-- heartbeat_processing_job lock only the job row.
--
-- The unfenced writers (insert_extracted_point, add_source_quote_evidence, record_quote_check,
-- record_support_verdict, create_system_gap_question, set_point_sort_keys, persist_parsed_source,
-- mark_source_parse_failed, set_job_provenance) stay executable by service_role for now because the
-- lead-owned SQL suites and lib/db/storage.ts still call them; lib/pipeline no longer does. Revoking
-- them is a proposed follow-up (docs: Agent 4 Round 3 report).

-- ── helper: validate and lock the caller's claim ────────────────────────────────

create function public._pipeline_claim(p_job_id uuid, p_attempt int, p_stages text[])
returns public.processing_jobs
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_handover uuid;
  v_job public.processing_jobs;
  v_run_status text;
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

-- ── fenced writers ────────────────────────────────────────────────────────────

create function public.pipeline_set_job_provenance(p_job_id uuid, p_attempt int, p_provenance jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_provenance is null or jsonb_typeof(p_provenance) <> 'object' then
    raise exception 'provenance must be an object' using errcode = 'BTVF0';
  end if;
  perform public._pipeline_claim(p_job_id, p_attempt, array['extract', 'verify_support']);
  update public.processing_jobs set ai_provenance = p_provenance where id = p_job_id;
end $$;

create function public.pipeline_persist_parsed_source(p_job_id uuid, p_attempt int, p_parsed jsonb, p_pepper_version text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.processing_jobs;
begin
  v_job := public._pipeline_claim(p_job_id, p_attempt, array['parse']);
  if v_job.source_id is null then
    raise exception 'parse job without a source' using errcode = 'BTVF0';
  end if;
  perform public.persist_parsed_source(v_job.source_id, p_parsed, p_pepper_version);
end $$;

create function public.pipeline_mark_source_parse_failed(p_job_id uuid, p_attempt int, p_error_code text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.processing_jobs;
begin
  v_job := public._pipeline_claim(p_job_id, p_attempt, array['parse']);
  if v_job.source_id is null then
    raise exception 'parse job without a source' using errcode = 'BTVF0';
  end if;
  perform public.mark_source_parse_failed(v_job.source_id, p_error_code);
end $$;

create function public.pipeline_record_quote_check(p_job_id uuid, p_attempt int, p_evidence_id uuid, p_quote_check text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.processing_jobs;
begin
  v_job := public._pipeline_claim(p_job_id, p_attempt, array['verify_quotes']);
  if not exists (select 1 from public.evidence_quotes q
                  where q.id = p_evidence_id and q.handover_id = v_job.handover_id
                    and q.source_id is not distinct from v_job.source_id) then
    raise exception 'evidence is outside this job' using errcode = 'BTFB0';
  end if;
  perform public.record_quote_check(p_evidence_id, p_quote_check);
end $$;

create function public.pipeline_record_support_verdict(
  p_job_id uuid, p_attempt int, p_point_evidence_id uuid, p_revision_id uuid, p_verdict text, p_rationale text,
  p_provenance jsonb, p_quote_sha256 bytea
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.processing_jobs;
begin
  v_job := public._pipeline_claim(p_job_id, p_attempt, array['verify_support']);
  if not exists (select 1 from public.point_evidence where id = p_point_evidence_id and handover_id = v_job.handover_id) then
    raise exception 'evidence link is outside this job' using errcode = 'BTFB0';
  end if;
  perform public.record_support_verdict(p_point_evidence_id, p_revision_id, p_verdict, p_rationale, p_provenance, p_quote_sha256);
end $$;

create function public.pipeline_create_system_gap_question(
  p_job_id uuid, p_attempt int, p_point_id uuid, p_category text, p_question text, p_context text, p_priority text,
  p_access_level text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.processing_jobs;
begin
  v_job := public._pipeline_claim(p_job_id, p_attempt, array['analyze', 'prepare_review']);
  return public.create_system_gap_question(v_job.handover_id, p_point_id, p_category, p_question, p_context, p_priority,
                                           p_access_level);
end $$;

create function public.pipeline_set_point_sort_keys(p_job_id uuid, p_attempt int, p_keys jsonb)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.processing_jobs;
begin
  v_job := public._pipeline_claim(p_job_id, p_attempt, array['prepare_review']);
  return public.set_point_sort_keys(v_job.handover_id, v_job.run_id, p_keys);
end $$;

-- ── DB-13: one extraction chunk, atomically ─────────────────────────────────────
-- p_entries: [{ "pointId": uuid | null,
--               "point": { "category", "title", "statement", "attributes", "inferenceRationale" } | null,
--               "citations": [{ "messageId": uuid, "quote": text, "quoteStart": int | null, "quoteEnd": int | null }] }]
-- An entry either attaches citations to an existing point (pointId) or creates a new point (point).
-- Citations are stored with quote_check 'pending' (verify_quotes decides). A citation whose message is not
-- in the job's source, was erased, or is implausible is dropped and counted; a NEW point whose citations
-- were all dropped is not inserted. Returns
--   { "alreadyCommitted": bool, "entries": [{ "pointId": uuid | null, "inserted": bool, "citations": int,
--                                             "rejected": int, "skipped": bool }] }.

create function public.pipeline_store_extract_chunk(
  p_job_id uuid, p_attempt int, p_chunk_index int, p_chunk_total int, p_access_level text, p_ai_provenance jsonb,
  p_entries jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.processing_jobs;
  v_done int;
  v_entry jsonb;
  v_cite jsonb;
  v_point uuid;
  v_inserted boolean;
  v_skipped boolean;
  v_ok int;
  v_rejected int;
  v_out jsonb := '[]'::jsonb;
begin
  v_job := public._pipeline_claim(p_job_id, p_attempt, array['extract']);
  if p_chunk_index is null or p_chunk_total is null or p_chunk_total < 1 or p_chunk_index < 0
     or p_chunk_index >= p_chunk_total then
    raise exception 'invalid chunk position' using errcode = 'BTVF0';
  end if;
  if p_entries is null or jsonb_typeof(p_entries) <> 'array' then
    raise exception 'entries must be an array' using errcode = 'BTVF0';
  end if;
  if p_ai_provenance is null or jsonb_typeof(p_ai_provenance) <> 'object' then
    raise exception 'provenance must be an object' using errcode = 'BTVF0';
  end if;
  if v_job.source_id is null then
    raise exception 'extract job without a source' using errcode = 'BTVF0';
  end if;
  -- One source = one access level (QA-M8); a level change since the messages were read is a conflict.
  if not exists (select 1 from public.sources where id = v_job.source_id and access_level = p_access_level and deleted_at is null) then
    raise exception 'the source changed since its messages were read' using errcode = 'BTCF0';
  end if;

  v_done := coalesce(v_job.progress_done, 0);
  if p_chunk_index < v_done then
    return jsonb_build_object('alreadyCommitted', true, 'entries', '[]'::jsonb); -- idempotent repeat
  end if;
  if p_chunk_index > v_done then
    raise exception 'chunks are stored in order' using errcode = 'BTVF0';
  end if;

  for v_entry in select e from jsonb_array_elements(p_entries) e loop
    v_point := nullif(v_entry ->> 'pointId', '')::uuid;
    v_inserted := false;
    v_skipped := false;
    v_ok := 0;
    v_rejected := 0;
    if (v_point is null) = (v_entry -> 'point' is null or jsonb_typeof(v_entry -> 'point') = 'null') then
      raise exception 'an entry has exactly one of pointId and point' using errcode = 'BTVF0';
    end if;

    begin -- subtransaction: a new point without surviving evidence is rolled back with its (zero) links
      if v_point is not null then
        if not exists (select 1 from public.handover_points p where p.id = v_point and p.handover_id = v_job.handover_id) then
          raise exception 'point is outside this job' using errcode = 'BTFB0';
        end if;
        if exists (select 1 from public.handover_points p where p.id = v_point and p.erased_at is not null) then
          v_skipped := true; -- erased since it was read: attach nothing
        end if;
      else
        v_point := public.insert_extracted_point(
          v_job.handover_id, v_job.run_id, v_entry -> 'point' ->> 'category', v_entry -> 'point' ->> 'title',
          v_entry -> 'point' ->> 'statement', coalesce(v_entry -> 'point' -> 'attributes', '{}'::jsonb),
          v_entry -> 'point' ->> 'inferenceRationale', p_access_level, p_ai_provenance, 0);
        v_inserted := true;
      end if;

      if not v_skipped then
        for v_cite in select c from jsonb_array_elements(coalesce(v_entry -> 'citations', '[]'::jsonb)) c loop
          if not exists (select 1 from public.source_messages m
                          where m.id = nullif(v_cite ->> 'messageId', '')::uuid and m.source_id = v_job.source_id) then
            v_rejected := v_rejected + 1;
            continue;
          end if;
          begin
            perform public.add_source_quote_evidence(v_point, (v_cite ->> 'messageId')::uuid, v_cite ->> 'quote',
                                                     (v_cite ->> 'quoteStart')::int, (v_cite ->> 'quoteEnd')::int, 'pending');
            v_ok := v_ok + 1;
          exception when sqlstate 'BTNF0' or sqlstate 'BTVF0' then
            v_rejected := v_rejected + 1; -- erased meanwhile, or implausible: drop the citation (§10.6)
          end;
        end loop;
        if v_inserted and v_ok = 0 then
          raise exception 'no evidence' using errcode = 'BTNE0'; -- internal marker, caught just below
        end if;
      end if;
    exception when sqlstate 'BTNE0' then
      v_point := null;
      v_inserted := false;
    end;

    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'pointId', v_point, 'inserted', v_inserted, 'citations', v_ok, 'rejected', v_rejected, 'skipped', v_skipped));
  end loop;

  -- The checkpoint commits with the chunk: a retry resumes after it, never repeats it.
  update public.processing_jobs
     set progress_done = p_chunk_index + 1, progress_total = p_chunk_total
   where id = p_job_id;
  return jsonb_build_object('alreadyCommitted', false, 'entries', v_out);
end $$;

-- ── grants (default privileges were revoked by the grants migration) ─────────────

revoke execute on function
  public._pipeline_claim(uuid, int, text[]),
  public.pipeline_set_job_provenance(uuid, int, jsonb),
  public.pipeline_persist_parsed_source(uuid, int, jsonb, text),
  public.pipeline_mark_source_parse_failed(uuid, int, text),
  public.pipeline_record_quote_check(uuid, int, uuid, text),
  public.pipeline_record_support_verdict(uuid, int, uuid, uuid, text, text, jsonb, bytea),
  public.pipeline_create_system_gap_question(uuid, int, uuid, text, text, text, text, text),
  public.pipeline_set_point_sort_keys(uuid, int, jsonb),
  public.pipeline_store_extract_chunk(uuid, int, int, int, text, jsonb, jsonb)
from public, anon, authenticated, service_role;

grant execute on function
  public.pipeline_set_job_provenance(uuid, int, jsonb),
  public.pipeline_persist_parsed_source(uuid, int, jsonb, text),
  public.pipeline_mark_source_parse_failed(uuid, int, text),
  public.pipeline_record_quote_check(uuid, int, uuid, text),
  public.pipeline_record_support_verdict(uuid, int, uuid, uuid, text, text, jsonb, bytea),
  public.pipeline_create_system_gap_question(uuid, int, uuid, text, text, text, text, text),
  public.pipeline_set_point_sort_keys(uuid, int, jsonb),
  public.pipeline_store_extract_chunk(uuid, int, int, int, text, jsonb, jsonb)
to service_role;
