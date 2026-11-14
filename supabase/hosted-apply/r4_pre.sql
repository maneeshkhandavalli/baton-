-- Round 4 prerequisites for 20261114100100_account_deletion (READ-ONLY). Expect 8 rows, every last column t.
select 'history_rows' as check, count(*)::text as value, count(*) = 36 as ok from supabase_migrations.schema_migrations
union all
select 'history_newest', max(version), max(version) = '20261113300900' from supabase_migrations.schema_migrations
union all
select 'no_delete_own_account', coalesce(to_regprocedure('public.delete_own_account(uuid,text,uuid[])')::text, '-'), to_regprocedure('public.delete_own_account(uuid,text,uuid[])') is null
union all
select 'no_account_has_password', coalesce(to_regprocedure('public.account_has_password(uuid)')::text, '-'), to_regprocedure('public.account_has_password(uuid)') is null
union all
select 'has_check_account_deletion', 'service_role', coalesce(has_function_privilege('service_role', to_regprocedure('public.check_account_deletion(uuid,text,uuid[])'), 'EXECUTE'), false)
union all
select 'has_delete_account_data', 'service_role', coalesce(has_function_privilege('service_role', to_regprocedure('public.delete_account_data(uuid,text)'), 'EXECUTE'), false)
union all
select 'purge_handover_closed', 'all API roles',
       to_regprocedure('public.purge_handover(uuid,uuid,uuid)') is not null
       and not has_function_privilege('service_role', 'public.purge_handover(uuid,uuid,uuid)'::regprocedure, 'EXECUTE')
       and not has_function_privilege('authenticated', 'public.purge_handover(uuid,uuid,uuid)'::regprocedure, 'EXECUTE')
       and not has_function_privilege('anon', 'public.purge_handover(uuid,uuid,uuid)'::regprocedure, 'EXECUTE')
union all
select 'no_restore_role', '-', not exists (select 1 from pg_roles where rolname = 'baton_restore');
