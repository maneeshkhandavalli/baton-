-- Round 4 state after 20261114100100_account_deletion (READ-ONLY). Expect 9 rows, every last column t.
with f as (
  select p.oid, p.proname, p.prosecdef, pg_get_userbyid(p.proowner) as owner
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname in ('delete_own_account', 'account_has_password', 'purge_handover', 'erase_participant')
)
select 'history_rows' as check, count(*)::text as value, count(*) = 37 as ok from supabase_migrations.schema_migrations
union all
select 'history_newest', max(version), max(version) = '20261114100100' from supabase_migrations.schema_migrations
union all
select 'delete_own_account_server_only', 'service_role', exists (select 1 from f where proname = 'delete_own_account' and prosecdef
       and has_function_privilege('service_role', oid, 'EXECUTE') and not has_function_privilege('authenticated', oid, 'EXECUTE')
       and not has_function_privilege('anon', oid, 'EXECUTE') and not has_function_privilege('public', oid, 'EXECUTE'))
union all
select 'account_has_password_server_only', 'service_role', exists (select 1 from f where proname = 'account_has_password' and prosecdef
       and has_function_privilege('service_role', oid, 'EXECUTE') and not has_function_privilege('authenticated', oid, 'EXECUTE')
       and not has_function_privilege('anon', oid, 'EXECUTE') and not has_function_privilege('public', oid, 'EXECUTE'))
union all
select 'purge_handover_still_closed', 'no role', exists (select 1 from f where proname = 'purge_handover')
       and not exists (select 1 from f where proname = 'purge_handover' and (has_function_privilege('service_role', oid, 'EXECUTE')
       or has_function_privilege('authenticated', oid, 'EXECUTE') or has_function_privilege('anon', oid, 'EXECUTE') or has_function_privilege('public', oid, 'EXECUTE')))
union all
select 'erase_participant_still_closed', 'no role', exists (select 1 from f where proname = 'erase_participant')
       and not exists (select 1 from f where proname = 'erase_participant' and (has_function_privilege('service_role', oid, 'EXECUTE')
       or has_function_privilege('authenticated', oid, 'EXECUTE') or has_function_privilege('anon', oid, 'EXECUTE') or has_function_privilege('public', oid, 'EXECUTE')))
union all
select 'same_owner_as_purge', (select owner from f where proname = 'delete_own_account'),
       (select owner from f where proname = 'delete_own_account') = (select owner from f where proname = 'purge_handover')
union all
select 'search_path_pinned', 'delete_own_account', exists (select 1 from pg_proc where oid = to_regprocedure('public.delete_own_account(uuid,text,uuid[])') and proconfig @> array['search_path=""'])
union all
select 'no_restore_role', '-', not exists (select 1 from pg_roles where rolname = 'baton_restore');
