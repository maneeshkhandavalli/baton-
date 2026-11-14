-- Baton Round 3 hosted apply, STEP 1 PRE-CHECK (read-only). The three checks from migrations.md §5,
-- combined into ONE result grid for the Supabase SQL editor. Run as postgres (the SQL editor default).
-- Expected:
--   newest_migrations   -> 20261112000500 first; NO row starting 20261113
--   jobs_queued_running -> 0
--   functions_present   -> true
select 'newest_migrations' as check_name,
       (select string_agg(version, ', ' order by version desc)
          from (select version from supabase_migrations.schema_migrations order by version desc limit 3) t) as result
union all
select 'jobs_queued_running',
       (select count(*)::text from public.processing_jobs where status in ('queued', 'running'))
union all
select 'functions_present',
       (select (count(*) = 15)::text from (values
          ('public.heartbeat_processing_job(uuid,integer,integer,integer,integer)'), ('public.api_get_point(uuid)'),
          ('public.create_handover(uuid,text,text,text,text,text)'), ('public.create_source(uuid,uuid,text,text,text,bigint,text,text)'),
          ('public.api_list_my_handovers()'), ('public.api_get_handover(uuid)'),
          ('public.erase_participant(uuid,uuid,text,bytea,text,uuid,uuid)'), ('public.purge_handover(uuid,uuid,uuid)'),
          ('public.mark_source_raw_deleted(uuid)'), ('public.source_upload_target(uuid,uuid)'),
          ('public.complete_processing_job(uuid,integer,text,jsonb,text,text,timestamp with time zone,integer,integer)'),
          ('public.start_processing(uuid,uuid,text,jsonb,jsonb)'), ('public.api_get_processing_status(uuid)'),
          ('public.persist_parsed_source(uuid,jsonb,text)'), ('public.mark_source_parse_failed(uuid,text)')) f(sig)
         where to_regprocedure(sig) is not null)
union all
select 'schema_migrations_columns',
       (select string_agg(column_name, ', ' order by ordinal_position) from information_schema.columns
         where table_schema = 'supabase_migrations' and table_name = 'schema_migrations');
