-- Round 3, Agent 4 (QA-R3-01). CREATE OR REPLACE of start_processing with the SAME signature, grants and
-- body as 20261111000400_lifecycle.sql, plus one check: an empty (or non-array) job list is refused with
-- validation_failed (BTVF0). Such a run could never finish: no job would ever complete and close it.
-- (lib/pipeline/finish.ts also closes any legacy zero-job run as failed `no_jobs`.)
-- The check runs after every existing validation, so all earlier refusals keep their SQLSTATE.
-- Fixtures that start a run with '[]' only to get a processing context must now pass one job
-- (40_lifecycle_review.sql, tests/integration/db/sql/it03_quotes.sql; see the Agent 4 report).
-- REQUIRES APPROVAL BEFORE ANY HOSTED APPLY.

create or replace function public.start_processing(p_actor_profile_id uuid, 
  p_handover_id uuid, p_pipeline_version text, p_ai_config jsonb, p_jobs jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := public._require_actor(p_actor_profile_id);
  v_h public.handovers;
  v_provider text := p_ai_config ->> 'provider';
  v_included uuid[];
  v_run uuid;
  v_job jsonb;
  v_source uuid;
begin
  v_h := public._lock_handover_for_update(p_handover_id);
  if not public._is_member_as(v_actor, p_handover_id) then
    raise exception 'handover not found' using errcode = 'BTNF0';
  end if;
  if not (public._is_creator_as(v_actor, p_handover_id) or public._member_role_as(v_actor, p_handover_id) = 'outgoing') then
    raise exception 'only the creator or an outgoing member can start processing' using errcode = 'BTFB0';
  end if;
  if v_h.state not in ('draft', 'in_review') then
    raise exception 'processing cannot start from %', v_h.state using errcode = 'BTIT0';
  end if;
  if exists (select 1 from public.processing_runs where handover_id = p_handover_id and status in ('queued', 'running')) then
    raise exception 'a run is already active' using errcode = 'BTCF0';
  end if;
  if v_provider is null or coalesce(btrim(p_pipeline_version), '') = '' then
    raise exception 'pipeline version and AI provider are required' using errcode = 'BTVF0';
  end if;

  select array_agg(s.id order by s.created_at, s.id) into v_included
    from public.sources s
   where s.handover_id = p_handover_id and s.deleted_at is null
     and (s.state = 'parsed' or (s.state in ('uploaded', 'failed') and s.raw_storage_path is not null));
  if v_included is null then
    raise exception 'no source is ready for processing' using errcode = 'BTPF0';
  end if;
  if exists (select 1 from public.sources s where s.id = any (v_included)
             and (s.consent_recorded_at is null or s.consent_ai_provider is distinct from v_provider)) then
    raise exception 'every source needs consent for the configured AI provider' using errcode = 'BTPF0';
  end if;

  -- QA-R3-01 (checked last, so every earlier refusal keeps its own code): a run needs at least one job, or it could never finish (nothing would ever complete it).
  if p_jobs is null or jsonb_typeof(p_jobs) <> 'array' or jsonb_array_length(p_jobs) = 0 then
    raise exception 'a processing run needs at least one job' using errcode = 'BTVF0';
  end if;

  insert into public.processing_runs (handover_id, triggered_by, status, source_ids, pipeline_version, ai_provider, ai_config)
  values (p_handover_id, v_actor, 'queued', v_included, p_pipeline_version, v_provider, p_ai_config)
  returning id into v_run;

  for v_job in select * from jsonb_array_elements(coalesce(p_jobs, '[]'::jsonb)) loop
    v_source := nullif(v_job ->> 'sourceId', '')::uuid;
    if v_source is not null and not (v_source = any (v_included)) then
      raise exception 'job source is not part of this run' using errcode = 'BTVF0';
    end if;
    if v_job ->> 'stage' = 'parse' and (v_source is null
        or exists (select 1 from public.sources where id = v_source and state = 'parsed')) then
      raise exception 'parse jobs are only for sources that are not parsed yet' using errcode = 'BTVF0';
    end if;
    insert into public.processing_jobs (handover_id, run_id, source_id, stage, input_hash, next_attempt_at)
    values (p_handover_id, v_run, v_source, v_job ->> 'stage', decode(v_job ->> 'inputHash', 'hex'), now());
  end loop;

  perform public.transition_handover(p_handover_id, 'processing', v_actor);
  perform public._audit(p_handover_id, v_actor, null, 'processing.started', 'processing_run', v_run, null,
                        jsonb_build_object('sourceCount', cardinality(v_included)));
  return v_run;
end $$;
