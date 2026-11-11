-- DB-15 (integration, pipeline request): active runs that may need finishing, so a run whose last job was
-- reaped (lease expired on its final attempt) is still closed by the next drain (§9.3). The worker decides
-- the outcome with listRunJobs + its pure run-outcome rules; this only nominates candidates.
-- Service role only; additive.

create function public.list_finishable_runs(p_limit int default 20)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_limit is null or p_limit < 1 or p_limit > 100 then
    raise exception 'invalid limit' using errcode = 'BTVF0';
  end if;
  return coalesce((
    select jsonb_agg(x.id order by x.created_at, x.id) from (
      select r.id, r.created_at
        from public.processing_runs r
       where r.status in ('queued', 'running')
         and (not exists (select 1 from public.processing_jobs j where j.run_id = r.id and j.status in ('queued', 'running'))
              or exists (select 1 from public.processing_jobs j where j.run_id = r.id and j.status = 'failed'))
       order by r.created_at, r.id
       limit p_limit) x), '[]'::jsonb);
end $$;

revoke execute on function public.list_finishable_runs(int) from public, anon, authenticated, service_role;
grant execute on function public.list_finishable_runs(int) to service_role;
