-- UPGRADE-PATH TEST, step 3 (after EVERY Round 3 migration was applied on the populated baseline).
-- Post-apply verification of each migration, and the new behaviour exercised on rows created BEFORE the
-- upgrade. LOCAL DOCKER ONLY. Synthetic data only.
\set ON_ERROR_STOP 1

-- ── reads: unchanged except the added HandoverSummary.description ───────────
select tests.eq(upgrade.diff(), '{}'::text[], 'every pre-upgrade read is unchanged (except the added description key)');
select tests.as_user('ann');
select tests.ok(tests.read(format('select public.api_get_handover(%L)', tests.id('hd'))) ? 'description', '100400: api_get_handover returns description');
select tests.ok((select bool_and(e ? 'description') from jsonb_array_elements(tests.read('select public.api_list_my_handovers()')) e),
                '100400: api_list_my_handovers returns description');
select tests.as_owner();

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
  perform tests.eq((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                     where n.nspname = 'public' and p.proname like 'pipeline\_%' and p.proargnames[3] = 'p_claim_generation'),
                   8, '300800: exactly 8 generation-checked overloads');
  perform tests.eq((select array_agg(distinct coalesce(r.rolname::text, 'PUBLIC') order by coalesce(r.rolname::text, 'PUBLIC'))
                      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                      cross join lateral aclexplode(p.proacl) a
                      left join pg_roles r on r.oid = a.grantee
                     where n.nspname = 'public' and p.proname like 'pipeline\_%' and p.proargnames[3] = 'p_claim_generation'
                       and a.privilege_type = 'EXECUTE' and a.grantee <> p.proowner),
                   array['service_role']::text[], '300800: the overloads'' only EXECUTE grantee besides the owner is service_role');
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

select 'upgrade verified' as result;
