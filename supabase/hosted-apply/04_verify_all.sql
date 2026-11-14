-- Baton Round 3: every §3 Verify query from docs/round3/migrations.md, combined so the SQL editor shows
-- one result grid. Expected: 19 rows (#4 returns two), ok = true on every row.
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
union all
select '#14' as migration, ok from (
  select not has_function_privilege('service_role', 'public.persist_parsed_source(uuid,jsonb,text)', 'EXECUTE')
     and not has_function_privilege('service_role', 'public.insert_extracted_point(uuid,uuid,text,text,text,jsonb,text,text,jsonb,double precision)', 'EXECUTE')
) v(ok)
union all
select '#15' as migration, ok from (
  select not has_function_privilege('service_role', 'public.mark_source_parse_failed(uuid,text)', 'EXECUTE')
     and has_function_privilege('service_role', 'public.pipeline_mark_source_parse_failed(uuid,integer,text)', 'EXECUTE')
) v(ok)
union all
select '#16' as migration, ok from (
  select prosrc like '%''partial''%' from pg_proc where oid = 'public.api_get_processing_status(uuid)'::regprocedure
) v(ok)
union all
select '#17' as migration, ok from (
  select exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'processing_jobs'
                  and column_name = 'claim_generation' and is_nullable = 'NO')
     and not exists (select 1 from public.processing_jobs where claim_generation < attempt)
     and (select count(*) = 8 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname like 'pipeline\_%' and p.proargnames[3] = 'p_claim_generation'
             and p.prosecdef and has_function_privilege('service_role', p.oid, 'EXECUTE')
             and not has_function_privilege('authenticated', p.oid, 'EXECUTE') and not has_function_privilege('anon', p.oid, 'EXECUTE'))
     and not has_function_privilege('service_role', 'public._pipeline_use_generation(bigint)', 'EXECUTE')
     and pg_get_functiondef('public._pipeline_claim(uuid,integer,text[])'::regprocedure) like '%baton.claim_generation%'
     and pg_get_functiondef('public._remember_claim_progress()'::regprocedure) like '%claim_generation%'
     and pg_get_functiondef('public.heartbeat_processing_job(uuid,integer,integer,integer,integer)'::regprocedure)
         like '%lease_expires_at <= now()%'
     and has_function_privilege('service_role', 'public.heartbeat_processing_job(uuid,integer,integer,integer,integer)', 'EXECUTE')
     and not has_function_privilege('authenticated', 'public.heartbeat_processing_job(uuid,integer,integer,integer,integer)', 'EXECUTE')
) v(ok)
union all
select '#18' as migration, ok from (
  select pg_get_functiondef('public.api_get_point(uuid)'::regprocedure) like '%''model_verdict''%'
     and pg_get_functiondef('public.api_get_point(uuid)'::regprocedure) like '%''guarded''%'
     and not (select prosecdef from pg_proc where oid = 'public.api_get_point(uuid)'::regprocedure)
     and has_function_privilege('authenticated', 'public.api_get_point(uuid)', 'EXECUTE')
     and not has_function_privilege('anon', 'public.api_get_point(uuid)', 'EXECUTE')
) v(ok)
order by 1;
