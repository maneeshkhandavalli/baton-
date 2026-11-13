-- Round 3 PHASE A verification: the runbook's Verify queries for #1-#13 only (docs/round3/migrations.md §3).
-- Read-only. Expected: 14 rows (#4 returns two), ok = true on every row.
select '#1' as migration, ok from (
  select to_regprocedure('public.update_handover_details(uuid,uuid,timestamptz,text,text,text,text)') is not null
     and has_function_privilege('service_role', 'public.update_handover_details(uuid,uuid,timestamptz,text,text,text,text)', 'EXECUTE')
     and not has_function_privilege('authenticated', 'public.update_handover_details(uuid,uuid,timestamptz,text,text,text,text)', 'EXECUTE')
) v(ok)
union all
select '#2' as migration, ok from (
  select pg_get_functiondef('public.create_handover(uuid,text,text,text,text,text)'::regprocedure) like '%baton.create_handover:%'
) v(ok)
union all
select '#3' as migration, ok from (
  select pg_get_functiondef('public.create_source(uuid,uuid,text,text,text,bigint,text,text)'::regprocedure) like '%baton.create_source:%'
) v(ok)
union all
select '#4' as migration, ok from (
  select prosrc like '%''description'', h.description%' from pg_proc where oid = 'public.api_get_handover(uuid)'::regprocedure
  union all
  select prosrc like '%''description'', h.description%' from pg_proc where oid = 'public.api_list_my_handovers()'::regprocedure
) v(ok)
union all
select '#5' as migration, ok from (
  select bool_and(pg_get_functiondef(f::regprocedure) like '%_require_actor%')
         and bool_and(not has_function_privilege('service_role', f::regprocedure, 'EXECUTE'))
    from unnest(array['public.erase_participant(uuid,uuid,text,bytea,text,uuid,uuid)', 'public.purge_handover(uuid,uuid,uuid)']) f
) v(ok)
union all
select '#6' as migration, ok from (
  select has_function_privilege('service_role', 'public.list_orphan_upload_candidates(interval,interval,integer)', 'EXECUTE')
     and not has_function_privilege('authenticated', 'public.list_orphan_upload_candidates(interval,interval,integer)', 'EXECUTE')
) v(ok)
union all
select '#7' as migration, ok from (
  select has_function_privilege('service_role', 'public.list_deleted_handover_raw_paths(uuid,uuid)', 'EXECUTE')
     and not has_function_privilege('authenticated', 'public.list_deleted_handover_raw_paths(uuid,uuid)', 'EXECUTE')
) v(ok)
union all
select '#8' as migration, ok from (
  select pg_get_functiondef('public.mark_source_raw_deleted(uuid)'::regprocedure) like '%raw upload is still needed%'
) v(ok)
union all
select '#9' as migration, ok from (
  select pg_get_functiondef('public.source_upload_target(uuid,uuid)'::regprocedure) like '%''kind'', v_s.kind%'
) v(ok)
union all
select '#10' as migration, ok from (
  select count(*) = 9 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and (p.proname like 'pipeline\_%' or p.proname = '_pipeline_claim')
     and p.proargnames[3] is distinct from 'p_claim_generation'
) v(ok)
union all
select '#11' as migration, ok from (
  select exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'processing_jobs'
                  and column_name = 'claim_progress_done')
     and exists (select 1 from pg_trigger where tgname = 'processing_jobs_claim_progress')
) v(ok)
union all
select '#12' as migration, ok from (
  select pg_get_functiondef('public.pipeline_store_extract_chunk(uuid,integer,integer,integer,text,jsonb,jsonb)'::regprocedure)
         ilike '%inference%'
) v(ok)
union all
select '#13' as migration, ok from (
  select pg_get_functiondef('public.start_processing(uuid,uuid,text,jsonb,jsonb)'::regprocedure) like '%jsonb_array_length%'
) v(ok)
order by 1;
