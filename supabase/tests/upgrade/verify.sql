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
    'public.start_processing(uuid,uuid,text,jsonb,jsonb)'] loop                                     -- 300400
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
  -- 300200: the new column and trigger
  perform tests.ok(exists (select 1 from information_schema.columns
                            where table_schema = 'public' and table_name = 'processing_jobs' and column_name = 'claim_progress_done'),
                   '300200: processing_jobs.claim_progress_done exists');
  perform tests.ok(exists (select 1 from pg_trigger where tgname = 'processing_jobs_claim_progress'), '300200: claim-progress trigger exists');
  -- 300500 (only when that migration was applied): unfenced writers revoked, mark_source_parse_failed kept
  if exists (select 1 from upgrade.applied where name like '20261113300500%') then
    perform tests.ok(not has_function_privilege('service_role', 'public.insert_extracted_point(uuid,uuid,text,text,text,jsonb,text,text,jsonb,double precision)', 'EXECUTE')
                     and not has_function_privilege('service_role', 'public.persist_parsed_source(uuid,jsonb,text)', 'EXECUTE'),
                     '300500: unfenced pipeline writers are revoked');
    perform tests.ok(has_function_privilege('service_role', 'public.mark_source_parse_failed(uuid,text)', 'EXECUTE'),
                     '300500: mark_source_parse_failed stays granted (lib/db/storage.ts)');
  end if;
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

-- 300200: the job claimed BEFORE the upgrade (claim_progress_done NULL) yields with progress
select tests.ok((select claim_progress_done is null and status = 'running' from public.processing_jobs where id = tests.id('job_hp')),
                '300200: the in-flight job has no claim checkpoint (claimed before the column existed)');
select tests.eq(public.complete_processing_job(tests.id('job_hp'), 1, 'yield', null, null, null, null, 3, 5), 'queued',
                '300200: the in-flight job yields after the upgrade');
select tests.eq((select attempt from public.processing_jobs where id = tests.id('job_hp')), 0,
                '300200: a checkpointing yield of the in-flight job does not consume an attempt');
-- 300100: the re-claimed job is fenced; a stale attempt is refused
select tests.eq((select id from public.claim_ready_processing_jobs(5, 900) limit 1), tests.id('job_hp'), 'the job is claimable again');
select tests.eq((select claim_progress_done from public.processing_jobs where id = tests.id('job_hp')), 3,
                '300200: the new claim records its starting progress');
select tests.throws(format($q$select public.pipeline_set_job_provenance(%L, 99, '{}'::jsonb)$q$, tests.id('job_hp')), 'BTLL0',
                    '300100: a stale attempt cannot write');
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

select 'upgrade verified' as result;
