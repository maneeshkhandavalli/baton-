-- Read-only. Phase D prerequisites (docs/round3/migrations.md §5 pre-check, adapted to "Phase A already applied").
-- Output: check | value | ok. Every row must be ok = t before r3phaseD may run.
-- Fingerprint: only baton-dev has Phase A (31 rows, newest 20261113300400); the original project still has the
-- 18-row baseline, so this check also refuses the wrong database.
select 'history_rows' as check, count(*)::text as value, count(*) = 31 as ok
  from supabase_migrations.schema_migrations
union all
select 'history_newest', max(version), max(version) = '20261113300400'
  from supabase_migrations.schema_migrations
union all
select 'phase_A_rows_20261113', count(*)::text, count(*) = 13
  from supabase_migrations.schema_migrations where version like '20261113%'
union all
select 'phase_D_rows_present', count(*)::text, count(*) = 0
  from supabase_migrations.schema_migrations
 where version in ('20261113300500', '20261113300600', '20261113300700', '20261113300800', '20261113300900')
union all
select 'claim_generation_column', count(*)::text, count(*) = 0
  from information_schema.columns
 where table_schema = 'public' and table_name = 'processing_jobs' and column_name = 'claim_generation'
union all
-- The functions Phase D replaces or depends on (same 15 signatures as the §5 pre-check).
select 'prerequisite_functions_15', count(*)::text, count(*) = 15 from (values
  ('public.heartbeat_processing_job(uuid,integer,integer,integer,integer)'), ('public.api_get_point(uuid)'),
  ('public.create_handover(uuid,text,text,text,text,text)'), ('public.create_source(uuid,uuid,text,text,text,bigint,text,text)'),
  ('public.api_list_my_handovers()'), ('public.api_get_handover(uuid)'),
  ('public.erase_participant(uuid,uuid,text,bytea,text,uuid,uuid)'), ('public.purge_handover(uuid,uuid,uuid)'),
  ('public.mark_source_raw_deleted(uuid)'), ('public.source_upload_target(uuid,uuid)'),
  ('public.complete_processing_job(uuid,integer,text,jsonb,text,text,timestamp with time zone,integer,integer)'),
  ('public.start_processing(uuid,uuid,text,jsonb,jsonb)'), ('public.api_get_processing_status(uuid)'),
  ('public.persist_parsed_source(uuid,jsonb,text)'), ('public.mark_source_parse_failed(uuid,text)')) f(sig)
 where to_regprocedure(sig) is not null
union all
-- #17 replaces these two (created by Phase A #10/#11).
select 'phase_A_claim_functions', count(*)::text, count(*) = 2 from (values
  ('public._pipeline_claim(uuid,integer,text[])'), ('public._remember_claim_progress()')) f(sig)
 where to_regprocedure(sig) is not null
union all
select 'generation_overloads_absent', count(*)::text, count(*) = 0
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname like 'pipeline\_%' and p.proargnames[3] = 'p_claim_generation';
