-- Round 4 final fix (Agent C, audit 4.8 / F5): a re-run that reuses an earlier extract carries its coverage.
-- ADDITIVE: one new fenced worker function. No table, policy or existing function changes. Idempotent.
--
-- Background: an extract job whose input hash already succeeded in another run of the handover (for example
-- a run that was cancelled AFTER its extracts finished) is not run again: its points are already stored, so
-- the worker completes the new job without calling the AI (lib/pipeline/runner.ts). Before this migration
-- the new job was completed as `0 of 0` and no coverage row was written for the new run, so the extraction
-- report (which reads the latest run) showed "Fully analysed · 0 messages inspected" next to "Coverage was not
-- recorded".
--
-- pipeline_reuse_prior_extract (extract jobs only, fenced by the claim like every writer):
--   * finds the most recent succeeded extract with the same handover, source and input hash in ANOTHER run
--     (whatever that run's final status: its points exist either way);
--   * copies that run's extraction_source_coverage row and extraction_chunk_stats rows for the source onto
--     the current run (on conflict do nothing: a retry is a no-op, a row written by this run wins);
--   * records on the new job the prior job's AI provenance plus `reusedFrom` {jobId, runId, runStatus};
--   * returns the reuse provenance (prior job, run and run status) and the prior job's progress, which the
--     worker records as the new job's progress and attempt record. When the prior run recorded no coverage,
--     `coverageCopied` is false and the report keeps saying "coverage not recorded" (never "complete").

create or replace function public.pipeline_reuse_prior_extract(p_job_id uuid, p_attempt int, p_claim_generation bigint default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.processing_jobs;
  v_prior record;
  v_cov int;
  v_stats int;
begin
  if p_claim_generation is not null then
    perform public._pipeline_use_generation(p_claim_generation);
  end if;
  v_job := public._pipeline_claim(p_job_id, p_attempt, array['extract']);
  perform set_config('baton.claim_generation', '', true);
  if v_job.source_id is null then
    raise exception 'extract job without a source' using errcode = 'BTVF0';
  end if;

  select p.id, p.run_id, p.progress_done, p.progress_total, p.ai_provenance, r.status as run_status
    into v_prior
    from public.processing_jobs p
    join public.processing_runs r on r.id = p.run_id
   where p.handover_id = v_job.handover_id and p.run_id <> v_job.run_id and p.stage = 'extract'
     and p.source_id = v_job.source_id and p.input_hash = v_job.input_hash and p.status = 'succeeded'
   order by p.finished_at desc nulls last, p.created_at desc, p.id desc
   limit 1;
  if v_prior.id is null then
    return jsonb_build_object('reused', false);
  end if;

  insert into public.extraction_source_coverage (run_id, handover_id, source_id, detector_version, messages_inspected,
                                                 messages_with_signals, signals_total, oversize_skipped, empty_skipped, chunks_total)
  select v_job.run_id, c.handover_id, c.source_id, c.detector_version, c.messages_inspected, c.messages_with_signals,
         c.signals_total, c.oversize_skipped, c.empty_skipped, c.chunks_total
    from public.extraction_source_coverage c
   where c.run_id = v_prior.run_id and c.source_id = v_job.source_id
  on conflict (run_id, source_id) do nothing;

  insert into public.extraction_chunk_stats (run_id, handover_id, source_id, chunk_index, chunk_total, messages, candidates,
                                             inserted, merged, dropped)
  select v_job.run_id, s.handover_id, s.source_id, s.chunk_index, s.chunk_total, s.messages, s.candidates, s.inserted,
         s.merged, s.dropped
    from public.extraction_chunk_stats s
   where s.run_id = v_prior.run_id and s.source_id = v_job.source_id
  on conflict (run_id, source_id, chunk_index) do nothing;

  -- Provenance: the new job carries the AI provenance of the extraction it reuses, and says so.
  update public.processing_jobs
     set ai_provenance = coalesce(v_prior.ai_provenance, '{}'::jsonb)
                         || jsonb_build_object('reusedFrom', jsonb_build_object('jobId', v_prior.id, 'runId', v_prior.run_id,
                                                                                'runStatus', v_prior.run_status))
   where id = v_job.id;

  select count(*)::int into v_cov from public.extraction_source_coverage where run_id = v_job.run_id and source_id = v_job.source_id;
  select count(*)::int into v_stats from public.extraction_chunk_stats where run_id = v_job.run_id and source_id = v_job.source_id;

  return jsonb_build_object(
    'reused', true,
    'priorJobId', v_prior.id,
    'priorRunId', v_prior.run_id,
    'priorRunStatus', v_prior.run_status,
    'progressDone', v_prior.progress_done,
    'progressTotal', v_prior.progress_total,
    'coverageCopied', v_cov > 0,
    'chunkStats', v_stats);
end $$;

revoke execute on function public.pipeline_reuse_prior_extract(uuid, int, bigint) from public, anon, authenticated, service_role;
grant execute on function public.pipeline_reuse_prior_extract(uuid, int, bigint) to service_role;
