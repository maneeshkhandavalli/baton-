-- DB-14 (integration, pipeline request): job states of one run, so the worker can decide when and how to
-- finish it (§9.3 run outcome, §6.17). Service role only; additive.

create function public.list_run_jobs(p_run_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'runStatus', r.status,
    'jobs', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', j.id, 'stage', j.stage, 'sourceId', j.source_id, 'status', j.status, 'attempt', j.attempt,
               'maxAttempts', j.max_attempts, 'errorCode', j.error_code, 'errorMessage', j.error_message)
             order by public._pipeline_stage_rank(j.stage), j.source_id nulls last, j.id)
        from public.processing_jobs j
       where j.run_id = r.id), '[]'::jsonb))
    from public.processing_runs r
   where r.id = p_run_id
$$;

revoke execute on function public.list_run_jobs(uuid) from public, anon, authenticated, service_role;
grant execute on function public.list_run_jobs(uuid) to service_role;
