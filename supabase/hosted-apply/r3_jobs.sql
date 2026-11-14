-- Read-only. Jobs that would make Phase D unsafe. Output: check | value | ok (ok = t when it is safe to proceed).
select 'jobs_queued' as check, count(*)::text as value, count(*) = 0 as ok
  from public.processing_jobs where status = 'queued'
union all
select 'jobs_running', count(*)::text, count(*) = 0
  from public.processing_jobs where status = 'running'
union all
select 'runs_queued_or_running', count(*)::text, count(*) = 0
  from public.processing_runs where status in ('queued', 'running')
union all
select 'unexpired_job_leases', count(*)::text, count(*) = 0
  from public.processing_jobs where lease_expires_at > now();
