-- Round 5 recovery copy (READ-ONLY): the current definitions and grants of the two functions the UI3 fixes replace.
-- Restoring = run these CREATE OR REPLACE statements, then delete the two history rows 20261115100100/20261115100200.
select '-- ' || p.oid::regprocedure::text || ' owner=' || pg_get_userbyid(p.proowner) || ' acl=' || coalesce(p.proacl::text, '-')
       || E'\n' || pg_get_functiondef(p.oid) || E';\n'
  from pg_proc p
 where p.oid in (to_regprocedure('public.review_gap_answer(uuid,uuid,text,text)'), to_regprocedure('public.list_points_for_pipeline(uuid)'))
 order by p.proname;
