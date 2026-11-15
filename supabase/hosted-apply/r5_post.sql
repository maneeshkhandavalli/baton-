-- Round 5 (UI3 fixes) state after 20261115100100_gap_answer_point + 20261115100200_pipeline_points_cited_messages
-- (READ-ONLY). Expect 9 rows, every last column t.
with f as (
  select p.proname, p.prosecdef, p.proconfig, p.prosrc, pg_get_userbyid(p.proowner) as owner, p.oid
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.oid in (to_regprocedure('public.review_gap_answer(uuid,uuid,text,text)'), to_regprocedure('public.list_points_for_pipeline(uuid)'))
)
select 'history_rows' as check, count(*)::text as value, count(*) = 39 as ok from supabase_migrations.schema_migrations
union all
select 'history_newest', max(version), max(version) = '20261115100200' from supabase_migrations.schema_migrations
union all
select 'r5_history', '-', 2 = (select count(*) from supabase_migrations.schema_migrations where version in ('20261115100100', '20261115100200'))
union all
select 'review_gap_answer_secdef', coalesce((select owner from f where proname = 'review_gap_answer'), '-'),
       coalesce((select prosecdef and proconfig = array['search_path=""'] from f where proname = 'review_gap_answer'), false)
union all
select 'review_gap_answer_server_only', 'service_role',
       has_function_privilege('service_role', 'public.review_gap_answer(uuid,uuid,text,text)', 'EXECUTE')
       and not has_function_privilege('authenticated', 'public.review_gap_answer(uuid,uuid,text,text)', 'EXECUTE')
       and not has_function_privilege('anon', 'public.review_gap_answer(uuid,uuid,text,text)', 'EXECUTE')
union all
select 'review_gap_answer_is_new', '-', coalesce((select prosrc like '%QA-UI3-G1%' from f where proname = 'review_gap_answer'), false)
union all
select 'list_points_secdef', coalesce((select owner from f where proname = 'list_points_for_pipeline'), '-'),
       coalesce((select prosecdef and proconfig = array['search_path=""'] from f where proname = 'list_points_for_pipeline'), false)
union all
select 'list_points_server_only', 'service_role',
       has_function_privilege('service_role', 'public.list_points_for_pipeline(uuid)', 'EXECUTE')
       and not has_function_privilege('authenticated', 'public.list_points_for_pipeline(uuid)', 'EXECUTE')
       and not has_function_privilege('anon', 'public.list_points_for_pipeline(uuid)', 'EXECUTE')
union all
select 'list_points_is_new', '-', coalesce((select prosrc like '%citedMessageIds%' from f where proname = 'list_points_for_pipeline'), false);
