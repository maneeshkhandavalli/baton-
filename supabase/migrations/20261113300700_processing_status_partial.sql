-- Round 3, Agent 4 (E4: accurate run states; lead-approved contract change to ProcessingStatus stage
-- status). CREATE OR REPLACE of api_get_processing_status with the SAME signature, grants, security
-- (invoker, RLS applies) and output shape as 20261111000900_read_api.sql; only the per-stage status changes:
--   running   any job running
--   queued    any job still queued (incl. a retry waiting for its backoff), none running
--   succeeded every job succeeded
--   partial   all jobs terminal, some succeeded and the rest failed or were skipped; or the run succeeded
--             although this stage's jobs all failed or were skipped (a failed source in a successful run)
--   failed    all jobs terminal, none succeeded, at least one failed, and the run did not succeed
--   cancelled all jobs terminal and cancelled, and the run did not succeed
-- Before: a stage showed `failed` while other jobs were still queued, and `cancelled` when one source was
-- skipped although the others succeeded. REQUIRES APPROVAL BEFORE ANY HOSTED APPLY.

create or replace function public.api_get_processing_status(p_handover_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'handover_state', h.state,
    'run', (
      select jsonb_build_object(
        'id', r.id, 'status', r.status, 'started_at', r.started_at, 'finished_at', r.finished_at,
        'error', case when r.error_code is not null
                      then jsonb_build_object('code', r.error_code, 'message', coalesce(r.error_message, '')) end,
        'stages', coalesce((
          select jsonb_agg(jsonb_build_object('stage', st.stage, 'status', st.status, 'done', st.done, 'total', st.total)
                           order by array_position(array['parse','extract','verify_quotes','verify_support','analyze','prepare_review'], st.stage))
            from (
              select j.stage,
                     -- E4 (lead-approved contract change): `partial` = some of the stage's jobs succeeded and
                     -- the others failed or were skipped (cancelled), or the run succeeded although this
                     -- stage's own jobs failed or were skipped. Open jobs win: a stage still working is
                     -- running/queued, never failed, until every job is terminal.
                     case when bool_or(j.status = 'running') then 'running'
                          when bool_or(j.status = 'queued') then 'queued'
                          when bool_and(j.status = 'succeeded') then 'succeeded'
                          when bool_or(j.status = 'succeeded') then 'partial'
                          when r.status = 'succeeded' then 'partial'
                          when bool_or(j.status = 'failed') then 'failed'
                          else 'cancelled' end as status,
                     count(*) filter (where j.status = 'succeeded') as done,
                     count(*) as total
                from public.processing_jobs j where j.run_id = r.id group by j.stage
            ) st), '[]'::jsonb))
        from public.processing_runs r where r.handover_id = h.id
       order by r.created_at desc, r.id limit 1),
    'sources', public.api_list_sources(h.id))
  from public.handovers h where h.id = p_handover_id
$$;
