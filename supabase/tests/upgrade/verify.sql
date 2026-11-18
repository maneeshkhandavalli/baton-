-- UPGRADE-PATH TEST, step 3 (after EVERY Round 3 migration was applied on the populated baseline).
-- Post-apply verification of each migration, and the new behaviour exercised on rows created BEFORE the
-- upgrade. LOCAL DOCKER ONLY. Synthetic data only.
\set ON_ERROR_STOP 1

-- ── reads: unchanged except the added HandoverSummary.description and EvidenceItem guard fields ─────
select tests.eq(upgrade.diff(), '{}'::text[], 'every pre-upgrade read (incl. api_get_point of pr1-pr3, ppub1) is unchanged except the added keys');
select tests.as_user('ann');
select tests.ok(tests.read(format('select public.api_get_handover(%L)', tests.id('hd'))) ? 'description', '100400: api_get_handover returns description');
select tests.ok((select bool_and(e ? 'description') from jsonb_array_elements(tests.read('select public.api_list_my_handovers()')) e),
                '100400: api_list_my_handovers returns description');
select tests.as_owner();

-- 300900: every evidence item of the pre-upgrade points now carries guarded / model_verdict
select tests.as_user('rev');
select coalesce(jsonb_agg(e), '[]'::jsonb) as v18_ev
  from unnest(array['pr1', 'pr2', 'pr3', 'ppub1']) p,
       jsonb_array_elements(tests.read(format('select public.api_get_point(%L)', tests.id(p))) -> 'evidence') e \gset
select tests.as_owner();
create temp table v18_ev as select e from jsonb_array_elements(:'v18_ev'::jsonb) e;
select tests.ok((select count(*) >= 3 from v18_ev), '300900: the reviewer still reads the pre-upgrade points'' evidence');
select tests.ok((select bool_and(e ? 'guarded' and e ? 'model_verdict') from v18_ev), '300900: every evidence item has guarded and model_verdict');
-- the verdict the guard demoted BEFORE the upgrade (seed.sql, pr2) is exposed from its stored provenance
select tests.eq((select e -> 'guarded' from v18_ev where e ->> 'point_evidence_id' = tests.id('pr2_link')::text), 'true'::jsonb,
                '300900: a pre-upgrade guarded verdict reads guarded = true');
select tests.eq((select e ->> 'model_verdict' from v18_ev where e ->> 'point_evidence_id' = tests.id('pr2_link')::text), 'supports',
                '300900: and exposes the model''s verdict before the guard');
select tests.eq((select e ->> 'support_verdict' from v18_ev where e ->> 'point_evidence_id' = tests.id('pr2_link')::text), 'irrelevant',
                '300900: the stored verdict is unchanged');
select tests.ok((select bool_and(not (e ? 'injectionGuard') and e::text not like '%addressed_to_ai%') from v18_ev),
                '300900: no raw provenance or pattern id reaches the read');
select tests.ok((select bool_and(e -> 'guarded' = 'false'::jsonb and e -> 'model_verdict' = 'null'::jsonb) from v18_ev
                  where e ->> 'point_evidence_id' <> tests.id('pr2_link')::text),
                '300900: every other pre-upgrade verdict reads guarded = false, model_verdict = null');
-- RLS, grants and security mode unchanged
select tests.as_user('eve');
select tests.ok(tests.read(format('select public.api_get_point(%L)', tests.id('pr2'))) is null, '300900: a non-member still reads nothing');
select tests.as_owner();
select tests.ok(has_function_privilege('authenticated', 'public.api_get_point(uuid)', 'EXECUTE')
                and not has_function_privilege('anon', 'public.api_get_point(uuid)', 'EXECUTE')
                and not (select prosecdef from pg_proc where oid = 'public.api_get_point(uuid)'::regprocedure),
                '300900: api_get_point keeps its grants and stays SECURITY INVOKER');
-- a later reset of the guarded verdict clears the fields (the provenance stays behind)
update public.point_evidence set support_verdict = 'unchecked', verified_revision_id = null, verdict_rationale = null
 where id = tests.id('pr2_link');
select tests.as_user('rev');
select tests.ok((select e -> 'guarded' = 'false'::jsonb and e -> 'model_verdict' = 'null'::jsonb
                   from jsonb_array_elements(tests.read(format('select public.api_get_point(%L)', tests.id('pr2'))) -> 'evidence') e
                  where e ->> 'point_evidence_id' = tests.id('pr2_link')::text), '300900: a reset verdict is no longer guarded');
select tests.as_owner();

-- ── 300800: the protected fenced writers have EXACTLY their expected overloads ─
-- (R3 Task 04) Each of the 8 fenced writers of 300100/300300 has precisely two overloads: the attempt-only original
-- and the 300800 generation-checked twin. This replaces a count of every `pipeline_*` function whose third argument
-- is `p_claim_generation`, which also matched unrelated later writers (Task 02's pipeline_list_handover_people) and
-- stopped the script. Signatures are compared by name and argument TYPES, so a missing twin, a renamed one, or any
-- extra overload of a protected name (whatever its argument names) is reported. Self-test: verify_selftest.sql.
create or replace function upgrade.protected_overload_problems()
returns text[]
language sql
stable
as $fn$
  with expected(sig) as (values
    ('pipeline_set_job_provenance(uuid,integer,jsonb)'),
    ('pipeline_set_job_provenance(uuid,integer,bigint,jsonb)'),
    ('pipeline_persist_parsed_source(uuid,integer,jsonb,text)'),
    ('pipeline_persist_parsed_source(uuid,integer,bigint,jsonb,text)'),
    ('pipeline_mark_source_parse_failed(uuid,integer,text)'),
    ('pipeline_mark_source_parse_failed(uuid,integer,bigint,text)'),
    ('pipeline_record_quote_check(uuid,integer,uuid,text)'),
    ('pipeline_record_quote_check(uuid,integer,bigint,uuid,text)'),
    ('pipeline_record_support_verdict(uuid,integer,uuid,uuid,text,text,jsonb,bytea)'),
    ('pipeline_record_support_verdict(uuid,integer,bigint,uuid,uuid,text,text,jsonb,bytea)'),
    ('pipeline_create_system_gap_question(uuid,integer,uuid,text,text,text,text,text)'),
    ('pipeline_create_system_gap_question(uuid,integer,bigint,uuid,text,text,text,text,text)'),
    ('pipeline_set_point_sort_keys(uuid,integer,jsonb)'),
    ('pipeline_set_point_sort_keys(uuid,integer,bigint,jsonb)'),
    ('pipeline_store_extract_chunk(uuid,integer,integer,integer,text,jsonb,jsonb)'),
    ('pipeline_store_extract_chunk(uuid,integer,bigint,integer,integer,text,jsonb,jsonb)')),
  protected_names as (select distinct split_part(sig, '(', 1) as proname from expected),
  actual as (
    select p.proname || '(' || replace(oidvectortypes(p.proargtypes), ', ', ',') || ')' as sig
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname in (select proname from protected_names))
  select coalesce(array_agg(x order by x), '{}'::text[]) from (
    select 'unexpected overload: ' || a.sig as x from actual a where a.sig not in (select sig from expected)
    union all
    select 'missing overload: ' || e.sig from expected e where e.sig not in (select sig from actual)) d
$fn$;

-- ── every Round 3 function exists with its signature and grants ─────────────
do $$
declare
  f text;
begin
  -- server-only mutations / worker functions: service_role yes, browser no
  foreach f in array array[
    'public.update_handover_details(uuid,uuid,timestamp with time zone,text,text,text,text)',      -- 100100
    'public.create_handover(uuid,text,text,text,text,text)',                                        -- 100200
    'public.create_source(uuid,uuid,text,text,text,bigint,text,text)',                              -- 100300
    'public.list_orphan_upload_candidates(interval,interval,integer)',                              -- 200100
    'public.list_deleted_handover_raw_paths(uuid,uuid)',                                            -- 200200
    'public.pipeline_store_extract_chunk(uuid,integer,integer,integer,text,jsonb,jsonb)',              -- 300100/300300
    'public.complete_processing_job(uuid,integer,text,jsonb,text,text,timestamp with time zone,integer,integer)', -- 300200
    'public.start_processing(uuid,uuid,text,jsonb,jsonb)',                                          -- 300400
    -- 300100 fenced writers (attempt-only): still granted after 300800
    'public.pipeline_set_job_provenance(uuid,integer,jsonb)',
    'public.pipeline_persist_parsed_source(uuid,integer,jsonb,text)',
    'public.pipeline_mark_source_parse_failed(uuid,integer,text)',
    'public.pipeline_record_quote_check(uuid,integer,uuid,text)',
    'public.pipeline_record_support_verdict(uuid,integer,uuid,uuid,text,text,jsonb,bytea)',
    'public.pipeline_create_system_gap_question(uuid,integer,uuid,text,text,text,text,text)',
    'public.pipeline_set_point_sort_keys(uuid,integer,jsonb)',
    -- 300800: the 8 generation-checked overloads
    'public.pipeline_set_job_provenance(uuid,integer,bigint,jsonb)',
    'public.pipeline_persist_parsed_source(uuid,integer,bigint,jsonb,text)',
    'public.pipeline_mark_source_parse_failed(uuid,integer,bigint,text)',
    'public.pipeline_record_quote_check(uuid,integer,bigint,uuid,text)',
    'public.pipeline_record_support_verdict(uuid,integer,bigint,uuid,uuid,text,text,jsonb,bytea)',
    'public.pipeline_create_system_gap_question(uuid,integer,bigint,uuid,text,text,text,text,text)',
    'public.pipeline_set_point_sort_keys(uuid,integer,bigint,jsonb)',
    'public.pipeline_store_extract_chunk(uuid,integer,bigint,integer,integer,text,jsonb,jsonb)',
    'public.heartbeat_processing_job(uuid,integer,integer,integer,integer)'] loop                    -- 300800 (replaced in place)
    perform tests.ok(to_regprocedure(f) is not null, 'exists: ' || f);
    perform tests.ok(has_function_privilege('service_role', f, 'EXECUTE'), 'server executes ' || f);
    perform tests.ok(not has_function_privilege('authenticated', f, 'EXECUTE') and not has_function_privilege('anon', f, 'EXECUTE'),
                     'browser cannot execute ' || f);
  end loop;
  -- reads stay browser-callable (100400)
  perform tests.ok(has_function_privilege('authenticated', 'public.api_get_handover(uuid)', 'EXECUTE')
                   and has_function_privilege('authenticated', 'public.api_list_my_handovers()', 'EXECUTE'), '100400: read grants kept');
  -- D27 (100500): still executable by no API role
  foreach f in array array['public.erase_participant(uuid,uuid,text,bytea,text,uuid,uuid)', 'public.purge_handover(uuid,uuid,uuid)'] loop
    perform tests.ok(not has_function_privilege('service_role', f, 'EXECUTE') and not has_function_privilege('authenticated', f, 'EXECUTE')
                     and not has_function_privilege('anon', f, 'EXECUTE'), '100500/D27: no API role executes ' || f);
    perform tests.ok(pg_get_functiondef(to_regprocedure(f)) like '%_require_actor%', '100500: ' || f || ' validates the actor');
  end loop;
  -- 300800: the new overloads are granted to service_role ONLY (no PUBLIC grant, no other role)
  perform tests.eq(upgrade.protected_overload_problems(), '{}'::text[],
                   '300800: each protected writer has exactly its attempt-only original and its generation-checked twin');
  perform tests.eq((select array_agg(distinct coalesce(r.rolname::text, 'PUBLIC') order by coalesce(r.rolname::text, 'PUBLIC'))
                      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                      cross join lateral aclexplode(p.proacl) a
                      left join pg_roles r on r.oid = a.grantee
                     where n.nspname = 'public' and p.proargnames[3] = 'p_claim_generation'
                       and p.proname in ('pipeline_set_job_provenance', 'pipeline_persist_parsed_source', 'pipeline_mark_source_parse_failed',
                                         'pipeline_record_quote_check', 'pipeline_record_support_verdict',
                                         'pipeline_create_system_gap_question', 'pipeline_set_point_sort_keys', 'pipeline_store_extract_chunk')
                       and a.privilege_type = 'EXECUTE' and a.grantee <> p.proowner),
                   array['service_role']::text[], '300800: the overloads'' only EXECUTE grantee besides the owner is service_role');
  -- (R3 Task 04) no pipeline_* function at all (incl. the Task 02/03 writers) is executable by PUBLIC, anon or authenticated
  perform tests.eq((select array_agg(p.oid::regprocedure::text order by 1) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                     where n.nspname = 'public' and p.proname like 'pipeline\_%'
                       and (has_function_privilege('anon', p.oid, 'EXECUTE') or has_function_privilege('authenticated', p.oid, 'EXECUTE'))),
                   null::text[], 'no pipeline_* function is executable by a browser role');
  -- 300800: the internal helpers stay executable by no API role
  foreach f in array array['public._pipeline_use_generation(bigint)', 'public._pipeline_claim(uuid,integer,text[])'] loop
    perform tests.ok(to_regprocedure(f) is not null
                     and not has_function_privilege('service_role', f, 'EXECUTE') and not has_function_privilege('authenticated', f, 'EXECUTE')
                     and not has_function_privilege('anon', f, 'EXECUTE'), '300800: no API role executes ' || f);
  end loop;
  -- 300200: the new column and trigger
  perform tests.ok(exists (select 1 from information_schema.columns
                            where table_schema = 'public' and table_name = 'processing_jobs' and column_name = 'claim_progress_done'),
                   '300200: processing_jobs.claim_progress_done exists');
  perform tests.ok(exists (select 1 from pg_trigger where tgname = 'processing_jobs_claim_progress'), '300200: claim-progress trigger exists');
  -- 300500: the 8 unfenced writers are revoked from every API role
  perform tests.ok(not has_function_privilege('service_role', 'public.insert_extracted_point(uuid,uuid,text,text,text,jsonb,text,text,jsonb,double precision)', 'EXECUTE')
                   and not has_function_privilege('service_role', 'public.persist_parsed_source(uuid,jsonb,text)', 'EXECUTE')
                   and not has_function_privilege('service_role', 'public.add_source_quote_evidence(uuid,uuid,text,integer,integer,text)', 'EXECUTE'),
                   '300500: unfenced pipeline writers are revoked');
  -- 300600: mark_source_parse_failed revoked too; its fenced twin stays callable
  perform tests.ok(not has_function_privilege('service_role', 'public.mark_source_parse_failed(uuid,text)', 'EXECUTE')
                   and not has_function_privilege('authenticated', 'public.mark_source_parse_failed(uuid,text)', 'EXECUTE'),
                   '300600: mark_source_parse_failed is revoked from every API role');
  perform tests.ok(has_function_privilege('service_role', 'public.pipeline_mark_source_parse_failed(uuid,integer,text)', 'EXECUTE'),
                   '300600: the fenced pipeline_mark_source_parse_failed stays granted');
  -- 200300 / 200400 / 300700: replaced in place, grants kept
  perform tests.ok(has_function_privilege('service_role', 'public.mark_source_raw_deleted(uuid)', 'EXECUTE')
                   and not has_function_privilege('authenticated', 'public.mark_source_raw_deleted(uuid)', 'EXECUTE'),
                   '200300: mark_source_raw_deleted keeps its server-only grant');
  perform tests.ok(has_function_privilege('service_role', 'public.source_upload_target(uuid,uuid)', 'EXECUTE')
                   and not has_function_privilege('authenticated', 'public.source_upload_target(uuid,uuid)', 'EXECUTE'),
                   '200400: source_upload_target keeps its server-only grant');
  perform tests.ok(has_function_privilege('authenticated', 'public.api_get_processing_status(uuid)', 'EXECUTE')
                   and not (select prosecdef from pg_proc where oid = 'public.api_get_processing_status(uuid)'::regprocedure),
                   '300700: api_get_processing_status stays a SECURITY INVOKER read');
end $$;

-- ── new behaviour on PRE-UPGRADE rows ───────────────────────────────────────
-- 100100: edit the pre-upgrade draft
select tests.as_user('ann');
select public.update_handover_details(tests.actor(), tests.id('hd'),
         (select date_trunc('milliseconds', updated_at) from public.handovers where id = tests.id('hd')),
         'Handover hd (edited)', 'Team hd', null, 'Added after the upgrade');
select tests.eq(tests.read(format('select public.api_get_handover(%L)', tests.id('hd'))) ->> 'description', 'Added after the upgrade',
                '100100 + 100400: an edit of a pre-upgrade draft reads back');
select tests.throws(format('select public.update_handover_details(%L, %L, now(), %L, %L)', tests.actor(), tests.id('hr'), 'Late', 'Team'),
                    'BTIT0', '100100: the pre-upgrade in-review handover is not editable');

-- 100200: duplicate-draft prevention for new submissions
select tests.eq(public.create_handover(tests.actor(), 'After upgrade', 'Club', null, null, 'outgoing'),
                public.create_handover(tests.actor(), 'After upgrade', 'Club', null, null, 'outgoing'), '100200: resubmission returns the same draft');

-- 100300: retries of the pre-upgrade unfinished uploads
select tests.eq(public.create_source(tests.actor(), tests.id('hd'), 'text', 'notes.txt', 'text/plain', 100, repeat('1', 64)), tests.id('sd1'),
                '100300: a pre-upgrade pending upload with no object is reused');
select tests.put('sd2b', public.create_source(tests.actor(), tests.id('hd'), 'whatsapp_export', 'chat.txt', 'text/plain', 200, repeat('2', 64)));
select tests.as_owner();
select tests.ok(tests.id('sd2b') <> tests.id('sd2') and (select state = 'removed' from public.sources where id = tests.id('sd2')),
                '100300: a pre-upgrade pending upload whose object arrived is replaced');

-- 200100: orphan candidates see the pre-upgrade discarded draft and the replaced row
select tests.as_service();
select tests.ok(exists (select 1 from jsonb_array_elements(public.list_orphan_upload_candidates()) c
                         where c ->> 'sourceId' = tests.id('sdel')::text and c ->> 'reason' = 'handover_deleted'),
                '200100: the pre-upgrade discarded draft''s upload is a candidate');
select tests.ok(exists (select 1 from jsonb_array_elements(public.list_orphan_upload_candidates()) c
                         where c ->> 'sourceId' = tests.id('sd2')::text and c ->> 'reason' = 'removed_raw_pending'),
                '200100 + 100300: the replaced row''s object is a sweep candidate');
-- 200200: the raw paths of the pre-upgrade discarded draft, for its creator only
select tests.eq((select e ->> 'rawStoragePath' from jsonb_array_elements(public.list_deleted_handover_raw_paths(tests.id('ann'), tests.id('hdel'))) e),
                'raw/' || tests.id('hdel') || '/' || tests.id('sdel'), '200200: lists the pre-upgrade discarded draft''s raw path');
select tests.throws(format('select public.list_deleted_handover_raw_paths(%L, %L)', tests.id('ann'), tests.id('hd')), 'BTPF0',
                    '200200: a live draft is refused');

-- 300800: claim_generation exists and was backfilled from attempt on the pre-upgrade rows
select tests.ok(exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'processing_jobs'
                         and column_name = 'claim_generation' and is_nullable = 'NO'), '300800: processing_jobs.claim_generation exists');
select tests.ok((select bool_and(claim_generation = attempt) from public.processing_jobs
                  where run_id in (tests.id('run_hp'), tests.id('run_hr'), tests.id('run_hx'))),
                '300800: pre-upgrade jobs are backfilled with claim_generation = attempt');
select tests.eq((select claim_generation from public.processing_jobs where id = tests.id('job_hp')), 1::bigint,
                '300800: the in-flight job keeps generation 1');
-- 300800: the in-flight claim still writes through the legacy (no-generation) overload: (job, attempt) is unambiguous
select tests.eq(tests.try(format($q$select public.pipeline_set_job_provenance(%L, 1, '{"provider":"fake"}'::jsonb)::text$q$, tests.id('job_hp'))),
                'OK:', '300800: a claim taken before the upgrade keeps writing without a generation');

-- 300200: the job claimed BEFORE the upgrade (claim_progress_done NULL) yields with progress
select tests.ok((select claim_progress_done is null and status = 'running' from public.processing_jobs where id = tests.id('job_hp')),
                '300200: the in-flight job has no claim checkpoint (claimed before the column existed)');
select tests.eq(public.complete_processing_job(tests.id('job_hp'), 1, 'yield', null, null, null, null, 3, 5), 'queued',
                '300200: the in-flight job yields after the upgrade');
select tests.eq((select attempt from public.processing_jobs where id = tests.id('job_hp')), 0,
                '300200: a checkpointing yield of the in-flight job does not consume an attempt');
-- 300100: the re-claimed job is fenced; a stale attempt is refused
select tests.ok(tests.id('job_hp') in (select id from public.claim_ready_processing_jobs(10, 900)), 'the job is claimable again');
select tests.eq((select claim_progress_done from public.processing_jobs where id = tests.id('job_hp')), 3,
                '300200: the new claim records its starting progress');
select tests.throws(format($q$select public.pipeline_set_job_provenance(%L, 99, '{}'::jsonb)$q$, tests.id('job_hp')), 'BTLL0',
                    '300100: a stale attempt cannot write');
-- 300800: yield + reclaim reused attempt 1 but advanced the generation; only the current generation may write
select tests.eq((select attempt::text || '/' || claim_generation::text from public.processing_jobs where id = tests.id('job_hp')), '1/2',
                '300800: yield + reclaim reuses attempt 1 and increments the generation to 2');
select tests.throws(format($q$select public.pipeline_set_job_provenance(%L, 1, 1::bigint, '{}'::jsonb)$q$, tests.id('job_hp')), 'BTLL0',
                    '300800: the stale generation (the pre-yield claim, same attempt number) is refused');
select tests.throws(format($q$select public.pipeline_set_job_provenance(%L, 1, '{}'::jsonb)$q$, tests.id('job_hp')), 'BTLL0',
                    '300800: without a generation, an ambiguous (job, attempt) is refused');
select tests.eq(tests.try(format($q$select public.pipeline_set_job_provenance(%L, 1, 2::bigint, '{"provider":"fake"}'::jsonb)::text$q$, tests.id('job_hp'))),
                'OK:', '300800: the current generation writes');
select tests.ok(coalesce(current_setting('baton.claim_generation', true), '') = '', '300800: the generation setting does not leak past the call');
-- 300800: a live lease is still renewed; an expired lease is not
select tests.ok(public.heartbeat_processing_job(tests.id('job_hp'), 1, 300) in ('queued', 'running'), '300800: a heartbeat on a live lease renews it');
select tests.as_owner();
update public.processing_jobs set lease_expires_at = now() - interval '1 second' where id = tests.id('job_hp');
select tests.as_service();
select tests.eq(public.heartbeat_processing_job(tests.id('job_hp'), 1, 300), 'lost', '300800: a heartbeat on an expired lease is lost');
select tests.ok((select lease_expires_at < now() from public.processing_jobs where id = tests.id('job_hp')), '300800: and the lease stays expired');
select tests.as_owner();

-- 300400: an empty job list is refused on the pre-upgrade in-review handover
select tests.as_user('ann');
select tests.throws(format($q$select public.start_processing(%L, %L, 'pv', '{"provider":"fake"}'::jsonb, '[]'::jsonb)$q$,
                           tests.actor(), tests.id('hr')), 'BTVF0', '300400: start_processing refuses an empty job list');
select tests.as_owner();

-- the pre-upgrade publication is still readable by the incoming member
select tests.as_user('inc');
select tests.ok(tests.read(format('select public.api_get_published_handover(%L)', tests.id('hpub'))) ->> 'publication_id' = tests.id('pub')::text,
                'the pre-upgrade publication still reads');
select tests.as_owner();

-- 200400: source_upload_target also returns the declared kind (pre-upgrade pending upload)
select tests.as_service();
select tests.eq(public.source_upload_target(tests.id('ann'), tests.id('sd1')) ->> 'kind', 'text', '200400: source_upload_target returns kind');
select tests.ok(public.source_upload_target(tests.id('ann'), tests.id('sd1')) ?& array['raw_storage_path', 'size_bytes', 'sha256'],
                '200400: the existing fields are unchanged');
select tests.as_owner();

-- 200300: a raw delete is recorded only when the raw upload is no longer needed
select tests.as_user('ann');
select tests.put('sup', public.create_source(tests.actor(), tests.id('hd'), 'text', 'live.txt', 'text/plain', 70, repeat('4', 64)));
select tests.as_owner();
insert into storage.objects (bucket_id, name, metadata)
select 'source-uploads', raw_storage_path, '{"size": 70}' from public.sources where id = tests.id('sup');
select tests.as_user('ann');
select public.confirm_source_uploaded(tests.actor(), tests.id('sup'), 70, repeat('4', 64));
select tests.as_service();
select tests.throws(format('select public.mark_source_raw_deleted(%L)', tests.id('sup')), 'BTIT0',
                    '200300: a live uploaded source keeps its raw upload');
select tests.throws(format('select public.mark_source_raw_deleted(%L)', tests.id('sd1')), 'BTIT0',
                    '200300: a live pending upload keeps its raw path');
select public.mark_source_raw_deleted(tests.id('sdel'));
select public.mark_source_raw_deleted(tests.id('sd2'));
select tests.as_owner();
select tests.ok((select raw_storage_path is null and raw_deleted_at is not null from public.sources where id = tests.id('sdel')),
                '200300 + 200200: the pre-upgrade discarded draft''s cleanup is still recorded');
select tests.ok((select raw_storage_path is null from public.sources where id = tests.id('sd2')),
                '200300 + 100300: the replaced (removed) row''s cleanup is still recorded');
select tests.eq(jsonb_array_length(public.list_deleted_handover_raw_paths(tests.id('ann'), tests.id('hdel'))), 0,
                '200200: nothing left to clean for the discarded draft');

-- 300700: a stage whose jobs are all terminal, some succeeded and some failed, reports `partial`
select tests.handover('hm', 'ann', 'outgoing');
select tests.source('hm', 'sm1');
select tests.source('hm', 'sm2');
select tests.as_user('ann');
select tests.put('run_hm', public.start_processing(tests.actor(), tests.id('hm'), 'pv-upgrade', '{"provider":"fake"}'::jsonb,
  jsonb_build_array(jsonb_build_object('stage', 'extract', 'sourceId', tests.id('sm1'), 'inputHash', md5('m1')),
                    jsonb_build_object('stage', 'extract', 'sourceId', tests.id('sm2'), 'inputHash', md5('m2')),
                    jsonb_build_object('stage', 'prepare_review', 'sourceId', null, 'inputHash', md5('mp')))));
select tests.as_owner();
update public.processing_jobs set status = 'succeeded', finished_at = now() where run_id = tests.id('run_hm') and source_id = tests.id('sm1');
update public.processing_jobs set status = 'failed', finished_at = now(), error_code = 'processing_failed'
 where run_id = tests.id('run_hm') and source_id = tests.id('sm2');
select tests.as_user('ann');
select tests.eq((select s ->> 'status' from jsonb_array_elements(tests.read(format('select public.api_get_processing_status(%L)', tests.id('hm')))
                   -> 'run' -> 'stages') s where s ->> 'stage' = 'extract'), 'partial', '300700: a mixed stage reports partial');
select tests.eq((select s ->> 'status' from jsonb_array_elements(tests.read(format('select public.api_get_processing_status(%L)', tests.id('hm')))
                   -> 'run' -> 'stages') s where s ->> 'stage' = 'prepare_review'), 'queued', '300700: an open stage stays queued');
select tests.eq((select (s ->> 'done') || '/' || (s ->> 'total') from jsonb_array_elements(tests.read(format('select public.api_get_processing_status(%L)', tests.id('hm')))
                   -> 'run' -> 'stages') s where s ->> 'stage' = 'extract'), '1/2', '300700: done/total unchanged');
-- 300700 on the PRE-UPGRADE mixed run: the intended change of the stage statuses the UI receives
select tests.eq(coalesce((select jsonb_object_agg(s ->> 'stage', s ->> 'status')
                            from jsonb_array_elements(tests.read(format('select public.api_get_processing_status(%L)', tests.id('hx')))
                                   -> 'run' -> 'stages') s), '{}'::jsonb),
                '{"extract": "partial", "verify_quotes": "queued"}'::jsonb,
                '300700: pre-upgrade mixed run: extract failed → partial, verify_quotes failed → queued (a job is still open)');
select tests.as_owner();

-- ── 500100: source versions on PRE-UPGRADE rows ─────────────────────────────
select tests.eq((select count(*)::int from public.sources
                  where lineage_id is distinct from id or version_number is distinct from 1 or supersedes_source_id is not null
                     or superseded_at is not null or superseded_by_source_id is not null), 0,
                '500100: every existing source is version 1 of its own lineage');
select tests.eq((select count(*)::int from public.source_version_changes), 0, '500100: no transition is invented for existing rows');
select tests.ok(has_function_privilege('service_role', 'public.create_source_version(uuid,uuid,text,text,text,bigint,text,text)', 'EXECUTE')
                and not has_function_privilege('authenticated', 'public.create_source_version(uuid,uuid,text,text,text,bigint,text,text)', 'EXECUTE')
                and not has_function_privilege('anon', 'public.create_source_version(uuid,uuid,text,text,text,bigint,text,text)', 'EXECUTE'),
                '500100: create_source_version is server-only');
select tests.as_user('ann');
select tests.ok((select bool_and(s -> 'version' ->> 'lineage_id' = s ->> 'id' and (s -> 'version' ->> 'version_number')::int = 1)
                   from jsonb_array_elements(tests.read(format('select public.api_list_sources(%L)', tests.id('hr')))) s),
                '500100: api_list_sources reports version 1 for a pre-upgrade source');
-- a new version of the source of the PRE-UPGRADE published handover: the published read does not move
select public.start_revision(tests.actor(), tests.id('hpub'));
select tests.put('spub_v2', (public.create_source_version(tests.actor(), tests.id('spub'), 'whatsapp_export', 'chat v2.txt', 'text/plain', 100,
                                                          repeat('c', 64)) ->> 'source_id')::uuid);
select tests.as_owner();
insert into storage.objects (bucket_id, name, metadata)
select 'source-uploads', raw_storage_path, '{"size": 100}' from public.sources where id = tests.id('spub_v2');
select tests.as_user('ann');
select public.confirm_source_uploaded(tests.actor(), tests.id('spub_v2'), 100, repeat('c', 64));
select public.record_source_consent(tests.actor(), tests.id('spub_v2'), 'consent@1', 'fake', 'everyone', 'Asia/Kolkata');
select tests.as_owner();
select tests.ok((select superseded_by_source_id = tests.id('spub_v2') from public.sources where id = tests.id('spub'))
                and (select version_number = 2 and lineage_id = tests.id('spub') from public.sources where id = tests.id('spub_v2')),
                '500100: a pre-upgrade source receives version 2');
select tests.ok((select bool_and(pe.excluded_at is null) from public.point_evidence pe where pe.point_id = tests.id('ppub1')),
                '500100: the evidence of the pre-upgrade version stays active');
select tests.as_user('inc');
select tests.eq(upgrade.strip(tests.read(format('select public.api_get_published_handover(%L)', tests.id('hpub')))),
                (select reads -> 'inc:hpub:published' from upgrade.snapshot where id = 1),
                '500100: the incoming member reads the pre-upgrade publication unchanged after a new source version');
select tests.as_owner();

-- ── 500200: scoped update processing and the publication gate on PRE-UPGRADE rows ─
select tests.ok(has_function_privilege('service_role', 'public.start_source_update_processing(uuid,uuid,text,jsonb,jsonb)', 'EXECUTE')
                and not has_function_privilege('authenticated', 'public.start_source_update_processing(uuid,uuid,text,jsonb,jsonb)', 'EXECUTE')
                and has_function_privilege('service_role', 'public.source_update_processing_scope(uuid,uuid)', 'EXECUTE')
                and not has_function_privilege('authenticated', 'public.source_update_processing_scope(uuid,uuid)', 'EXECUTE'),
                '500200: scoped processing is server-only');
select tests.eq((select state from public.source_version_changes where to_source_id = tests.id('spub_v2')), 'awaiting_processing',
                '500200: the pre-upgrade source''s new version awaits processing');
select tests.as_user('ann');
select tests.eq(public.source_update_processing_scope(tests.actor(), tests.id('hpub')) ->> 'mode', 'full',
                '500200: a handover never processed by a run is processed in full');
select tests.throws(format('select public.publish_handover(%L, %L)', tests.actor(), tests.id('hpub')), 'BTPF0',
                    '500200: the unprocessed update blocks republishing the pre-upgrade handover');
select tests.as_owner();
select tests.eq((select count(*)::int from public.handover_publications where handover_id = tests.id('hpub')), 1,
                '500200: the pre-upgrade publication is the only one');
select tests.as_user('inc');
select tests.eq(upgrade.strip(tests.read(format('select public.api_get_published_handover(%L)', tests.id('hpub')))),
                (select reads -> 'inc:hpub:published' from upgrade.snapshot where id = 1),
                '500200: the incoming member still reads the pre-upgrade publication unchanged');
select tests.as_owner();
-- Task 04 scope on the pre-upgrade mixed run: identical to the latest-run view (a full run extracted every source)
select tests.eq((select count(*)::int from public._extraction_publish_gaps(tests.id('hx'))), 1,
                '500200: the pre-upgrade mixed run still has exactly its one failed source as a gap');

-- ── 18500100 (R3 Task 05D): change detection on PRE-UPGRADE rows ────────────
select tests.eq((select base_publication_id from public.source_version_changes where to_source_id = tests.id('spub_v2')),
                (select current_publication_id from public.handovers where id = tests.id('hpub')),
                '18500100: the pre-upgrade handover''s update records its current publication as the baseline');
select tests.eq((select count(*)::int from public.source_change_review_items), 0, '18500100: no review item is invented for existing rows');
select tests.ok(has_table_privilege('authenticated', 'public.source_change_review_items', 'SELECT')
                and not has_table_privilege('authenticated', 'public.source_change_review_items', 'INSERT')
                and not has_table_privilege('authenticated', 'public.source_change_review_items', 'UPDATE')
                and not has_table_privilege('service_role', 'public.source_change_review_items', 'INSERT')
                and not has_table_privilege('anon', 'public.source_change_review_items', 'SELECT'),
                '18500100: review items are read-only for API roles');
select tests.ok(has_function_privilege('service_role', 'public.pipeline_record_change_detection(uuid,integer,uuid,text,jsonb,jsonb,bigint)', 'EXECUTE')
                and not has_function_privilege('authenticated', 'public.pipeline_record_change_detection(uuid,integer,uuid,text,jsonb,jsonb,bigint)', 'EXECUTE')
                and has_function_privilege('service_role', 'public.list_change_detection_input(uuid)', 'EXECUTE')
                and not has_function_privilege('authenticated', 'public.list_change_detection_input(uuid)', 'EXECUTE')
                and not has_function_privilege('service_role', 'public._blocking_change_reviews(uuid)', 'EXECUTE'),
                '18500100: the detector functions are server-only; internals are not executable');
select tests.as_user('ann');
select tests.ok((select bool_or(b ->> 'kind' = 'source_updates_pending')
                   from jsonb_array_elements(tests.read(format('select public.api_get_readiness(%L)', tests.id('hpub'))) -> 'blockers') b),
                '18500100: readiness of the pre-upgrade handover reports its pending source update (never "ready")');
select tests.eq(tests.read(format('select public.api_list_change_review_items(%L)', tests.id('hpub'))), '[]'::jsonb,
                '18500100: the review-item read API works on the pre-upgrade handover');
select tests.as_owner();

-- ── 18600100 (R3 Task 05E): change-review decisions on PRE-UPGRADE rows ──────
select tests.eq((select count(*)::int from public.source_change_review_decisions), 0, '18600100: no decision is invented');
select tests.ok(has_function_privilege('service_role', 'public.decide_change_review_item(uuid,uuid,text,text,uuid,text,jsonb)', 'EXECUTE')
                and not has_function_privilege('authenticated', 'public.decide_change_review_item(uuid,uuid,text,text,uuid,text,jsonb)', 'EXECUTE')
                and not has_function_privilege('anon', 'public.decide_change_review_item(uuid,uuid,text,text,uuid,text,jsonb)', 'EXECUTE')
                and not has_table_privilege('authenticated', 'public.source_change_review_decisions', 'INSERT')
                and has_table_privilege('authenticated', 'public.source_change_review_decisions', 'SELECT'),
                '18600100: deciding is server-only; decisions are read-only for API roles');
select tests.eq((select count(*)::int from public.review_actions where action = 'change_review'), 0, '18600100: existing review history is unchanged');
select tests.as_user('ann');
select tests.eq(tests.read(format('select public.api_get_change_reviews(%L)', tests.id('hpub'))), '[]'::jsonb,
                '18600100: the reviewer read API works on the pre-upgrade handover');
select tests.as_owner();

-- ── 18700100–18700300 (R3 Task 06): invitations on PRE-UPGRADE rows ──────────
select tests.as_service();
select tests.eq(public.get_member_invite_details(sha256(convert_to('upgrade-invite', 'UTF8')), null) ->> 'state', 'pending',
                '18700100: a pre-upgrade invitation reads as pending');
select tests.eq(public.get_member_invite_details(sha256(convert_to('upgrade-invite', 'UTF8')), null) ->> 'recipient_email_masked', 'l***@example.test',
                '18700100: with a masked address');
select tests.as_owner();
select tests.user('lee');
select tests.as_service();
select tests.eq((public.redeem_member_invite(sha256(convert_to('upgrade-invite', 'UTF8')), tests.id('lee')) ->> 'replayed')::boolean, false,
                '18700100: the pre-upgrade invitation redeems');
select tests.eq((public.redeem_member_invite(sha256(convert_to('upgrade-invite', 'UTF8')), tests.id('lee')) ->> 'replayed')::boolean, true,
                '18700100: and replays for the same user');
select tests.eq(public.get_member_invite_details(sha256(convert_to('upgrade-invite', 'UTF8')), tests.id('lee')) ->> 'state', 'accepted',
                '18700100: the member sees it as accepted');
select tests.as_owner();
select tests.eq((select count(*)::int from public.handover_members where handover_id = tests.id('hr') and profile_id = tests.id('lee')), 1,
                '18700100: one membership');
select tests.as_reader('ann');
select tests.ok((select bool_and(t ? 'delivery_status') from jsonb_array_elements(public.list_access_tokens(tests.id('hr'), 'member_invite', false)) t),
                '18700200: the invitation listing carries delivery_status');
select tests.ok((select bool_and(t -> 'delivery_status' = 'null'::jsonb) from jsonb_array_elements(public.list_access_tokens(tests.id('hr'), 'member_invite', false)) t),
                '18700200: null for invitations never emailed');
select tests.as_owner();
select tests.ok(has_function_privilege('service_role', 'public.get_member_invite_details(bytea,uuid)', 'EXECUTE')
                and not has_function_privilege('authenticated', 'public.get_member_invite_details(bytea,uuid)', 'EXECUTE')
                and has_function_privilege('service_role', 'public.reissue_member_invite(uuid,uuid,bytea,timestamp with time zone)', 'EXECUTE')
                and not has_function_privilege('authenticated', 'public.reissue_member_invite(uuid,uuid,bytea,timestamp with time zone)', 'EXECUTE')
                and has_function_privilege('service_role', 'public.record_invitation_delivery(uuid,uuid,text,text,text)', 'EXECUTE')
                and not has_function_privilege('anon', 'public.member_invite_recipient(uuid,uuid)', 'EXECUTE')
                and not has_function_privilege('authenticated', 'public.redeem_member_invite(bytea,uuid)', 'EXECUTE')
                and has_function_privilege('service_role', 'public.redeem_member_invite(bytea,uuid)', 'EXECUTE')
                and not has_table_privilege('authenticated', 'public.invitation_deliveries', 'SELECT')
                and not has_table_privilege('service_role', 'public.invitation_deliveries', 'INSERT'),
                '18700100/200: the invitation functions are server-only; delivery records are unreadable by API roles');
select tests.as_service();
select tests.ok(public.consume_rate_limit('invite_redeem_client', repeat('cd', 32)) and public.consume_rate_limit('invite_send_actor', repeat('cd', 32)),
                '18700300: existing and new rate-limit scopes both work');
select tests.as_owner();

select 'upgrade verified' as result;
