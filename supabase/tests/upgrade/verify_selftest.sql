-- UPGRADE-PATH TEST, step 5 (R3 Task 04): self-test of verify.sql's protected-overload check
-- (upgrade.protected_overload_problems). Runs after verify.sql on the same upgraded database. LOCAL DOCKER ONLY.
-- Proves that (1) later generation-aware writers such as Task 02's pipeline_list_handover_people are NOT counted,
-- (2) an unexpected overload of a protected writer IS reported, whatever its argument names, and
-- (3) a missing generation-checked twin IS reported. Every change is rolled back.
\set ON_ERROR_STOP 1

-- (1) clean upgraded database; the Task 02 function has p_claim_generation third, like the 300800 twins, and is ignored
select tests.ok(to_regprocedure('public.pipeline_list_handover_people(uuid,integer,bigint)') is not null,
                'precondition: pipeline_list_handover_people exists with p_claim_generation as its third argument');
select tests.ok((select proargnames[3] = 'p_claim_generation' from pg_proc
                  where oid = 'public.pipeline_list_handover_people(uuid,integer,bigint)'::regprocedure), 'precondition: third argument name');
select tests.eq(upgrade.protected_overload_problems(), '{}'::text[], 'clean: no problem reported, pipeline_list_handover_people not included');

-- (2) an unexpected overload of a protected writer is detected (here: generation third, so the old count matched it too,
--     and one with different argument names that the old count would have missed)
begin;
create function public.pipeline_set_point_sort_keys(p_job_id uuid, p_attempt int, p_claim_generation bigint, p_keys jsonb, p_extra text)
returns int language sql as $$ select 0 $$;
create function public.pipeline_record_quote_check(a uuid, b int, c uuid, d text, e boolean)
returns void language sql as $$ select $$;
select tests.eq(upgrade.protected_overload_problems(),
                array['unexpected overload: pipeline_record_quote_check(uuid,integer,uuid,text,boolean)',
                      'unexpected overload: pipeline_set_point_sort_keys(uuid,integer,bigint,jsonb,text)']::text[],
                'extra overloads of protected writers are reported');
rollback;

-- (3) a missing generation-checked twin is detected
begin;
drop function public.pipeline_store_extract_chunk(uuid, integer, bigint, integer, integer, text, jsonb, jsonb);
select tests.eq(upgrade.protected_overload_problems(),
                array['missing overload: pipeline_store_extract_chunk(uuid,integer,bigint,integer,integer,text,jsonb,jsonb)']::text[],
                'a missing twin is reported');
rollback;

select tests.eq(upgrade.protected_overload_problems(), '{}'::text[], 'clean again after the rollbacks');
