-- baton-dev restore: READ-ONLY verification (safe to run any time; writes nothing).
-- One result grid: check | value. run-hosted.sh compares the public row counts with the backup.
select 'history_rows' as check, count(*)::text as value from supabase_migrations.schema_migrations
union all select 'history_newest', max(version) from supabase_migrations.schema_migrations
union all select 'history_round3_rows', count(*)::text from supabase_migrations.schema_migrations where version like '20261113%'
union all select 'auth_users', count(*)::text from auth.users
union all select 'auth_identities', count(*)::text from auth.identities
union all select 'profiles_joined_to_auth', count(*)::text from public.profiles p join auth.users u on u.id = p.id
union all select 'fk_constraints', count(*)::text from pg_constraint c join pg_namespace s on s.oid = c.connamespace where c.contype = 'f' and s.nspname = 'public'
union all select 'user_triggers_disabled', count(*)::text from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and not t.tgisinternal and t.tgenabled = 'D'
union all select 'rls_policies_public', count(*)::text from pg_policies where schemaname = 'public'
union all select 'rls_enabled_tables', count(*)::text from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and relkind = 'r' and relrowsecurity
union all select 'citext', count(*)::text from pg_extension where extname = 'citext'
union all select 'auth_user_trigger', count(*)::text from pg_trigger where tgname = 'on_auth_user_created' and tgrelid = 'auth.users'::regclass
union all select 'storage_upload_policy', count(*)::text from pg_policies where schemaname = 'storage' and policyname = 'baton_source_uploads_insert'
union all select 'bucket_source_uploads', coalesce((select public::text || '/' || file_size_limit from storage.buckets where id = 'source-uploads'), 'missing')
union all select 'storage_object_present', count(*)::text from storage.objects where bucket_id = 'source-uploads' and name = 'raw/58053120-daa8-4c5a-83b5-dbe6830ea429/28820916-61e3-4bdc-8379-98412eef0794'
union all select 'jobs_queued_running', count(*)::text from public.processing_jobs where status in ('queued', 'running')
union all
select 'rows:public.' || c.relname, (xpath('/row/c/text()', query_to_xml(format('select count(*) c from public.%I', c.relname), false, true, '')))[1]::text
  from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r'
order by 1;
