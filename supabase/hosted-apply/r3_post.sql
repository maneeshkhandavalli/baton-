-- Read-only. State after Phase D (used by r3verifyAll together with 04_verify_all.sql). Output: check | value | ok.
select 'history_rows' as check, count(*)::text as value, count(*) = 36 as ok
  from supabase_migrations.schema_migrations
union all
select 'history_newest', max(version), max(version) = '20261113300900'
  from supabase_migrations.schema_migrations
union all
select 'phase_D_rows_present', count(*)::text, count(*) = 5
  from supabase_migrations.schema_migrations
 where version in ('20261113300500', '20261113300600', '20261113300700', '20261113300800', '20261113300900')
union all
select 'claim_generation_not_null', count(*)::text, count(*) = 1
  from information_schema.columns
 where table_schema = 'public' and table_name = 'processing_jobs' and column_name = 'claim_generation'
   and is_nullable = 'NO'
union all
select 'generation_overloads_8', count(*)::text, count(*) = 8
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and p.proname like 'pipeline\_%' and p.proargnames[3] = 'p_claim_generation';
