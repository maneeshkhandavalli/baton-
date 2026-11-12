-- Round 3, Agent 4 (DB-13 follow-up). CREATE OR REPLACE with the SAME signature and grants as in
-- 20261113300100. REQUIRES APPROVAL BEFORE ANY HOSTED APPLY.
--
-- 20261113300100 dropped every NEW point that ended up with no stored citation. That is right for a claim
-- that was only ever backed by quotes (its quotes were all rejected, so nothing supports it), but wrong for
-- an INFERRED claim: §11.4/§12.10 allow a candidate with no citation when it carries an inference
-- rationale, and such a point is stored with evidence status `inferred`. Rule now:
--   * a new point is inserted when at least one citation is stored, OR when it has a non-empty inference
--     rationale (an inferred point, shown as inferred and never as sourced);
--   * otherwise (no rationale and no surviving citation) it is not inserted.

create or replace function public.pipeline_store_extract_chunk(
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

    begin -- subtransaction: a new point without surviving support is rolled back
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
        if v_inserted and v_ok = 0 and coalesce(btrim(v_entry -> 'point' ->> 'inferenceRationale'), '') = '' then
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
