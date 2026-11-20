-- R3 Task 05C: scoped processing of source updates, the update lifecycle and the publication gate
-- (migration 20261117500200_scoped_version_processing). Synthetic data only.
\set ON_ERROR_STOP 1

select tests.user(u) from unnest(array['ann', 'rev', 'inc']) u;

-- ── helpers (the 05B upload/consent path, and a simulated worker) ────────────
create function tests.hx(p_char text) returns text language sql immutable as $$ select repeat(p_char, 64) $$;
create function tests.new_version(p_prev uuid, p_hex text) returns uuid language plpgsql as $$
declare v uuid;
begin
  perform tests.as_user('ann');
  v := (public.create_source_version(tests.actor(), p_prev, 'whatsapp_export', 'chat v.txt', 'text/plain', 100, p_hex) ->> 'source_id')::uuid;
  perform tests.as_owner();
  insert into storage.objects (bucket_id, name, metadata)
  select 'source-uploads', raw_storage_path, '{"size": 100}' from public.sources where id = v;
  perform tests.as_user('ann');
  perform public.confirm_source_uploaded(tests.actor(), v, 100, p_hex);
  perform public.record_source_consent(tests.actor(), v, 'consent@1', 'fake', 'everyone', 'Asia/Kolkata');
  perform tests.as_owner();
  return v;
end $$;
-- the exact job set a scoped run needs for p_sources (parse when not parsed), plus p_extra jobs
create function tests.scoped_jobs(p_sources uuid[], p_wide text[] default array['verify_support', 'analyze', 'prepare_review'])
returns jsonb language sql volatile as $$
  select coalesce((select jsonb_agg(j) from (
            select jsonb_build_object('stage', st, 'sourceId', s, 'inputHash', md5(st || s::text)) as j
              from unnest(p_sources) s cross join unnest(array['parse', 'extract', 'verify_quotes']) st
             where st <> 'parse' or (select state from public.sources where id = s) <> 'parsed'
            union all
            select jsonb_build_object('stage', w, 'sourceId', null, 'inputHash', md5(w)) from unnest(p_wide) w) x), '[]'::jsonb)
$$;
create function tests.start_sql(p_h text, p_jobs jsonb) returns text language sql volatile as $$
  select format('select public.start_source_update_processing(%L, %L, %L, %L, %L)::text', tests.id('ann'), tests.id(p_h),
                'pv-test', '{"provider":"fake"}', p_jobs)
$$;
create function tests.start(p_h text, p_name text, p_sources uuid[]) returns uuid language plpgsql as $$
declare v uuid;
begin
  perform tests.as_user('ann');
  v := public.start_source_update_processing(tests.actor(), tests.id(p_h), 'pv-test', '{"provider":"fake"}', tests.scoped_jobs(p_sources));
  perform tests.as_owner();
  return tests.put(p_name, v);
end $$;
-- the worker's outcome: every job of the run ends as p_others, the extract job of p_source as given; then the run closes
create function tests.finish(p_run uuid, p_source uuid, p_extract text, p_done int, p_total int, p_run_status text,
                             p_others text default 'succeeded') returns void language plpgsql as $$
begin
  update public.processing_jobs set status = p_others, finished_at = now(), attempt = 1,
         error_code = case when p_others = 'failed' then 'processing_failed' end
   where run_id = p_run and not (stage = 'extract' and source_id = p_source);
  update public.processing_jobs set status = p_extract, finished_at = now(), attempt = 1, progress_done = p_done, progress_total = p_total,
         error_message = case when p_extract <> 'succeeded' then 'ai_provider_error' end
   where run_id = p_run and stage = 'extract' and source_id = p_source;
  perform tests.as_service();
  perform public.finish_processing_run(p_run, p_run_status, case when p_run_status = 'failed' then 'processing_failed' end,
                                       case when p_run_status = 'failed' then 'analyze_failed' end);
  perform tests.as_owner();
end $$;
create function tests.change(p_source uuid) returns public.source_version_changes language sql volatile as $$
  select * from public.source_version_changes where to_source_id = p_source
$$;
create function tests.gaps(p_h text) returns jsonb language sql security definer as $$
  select coalesce(jsonb_agg(jsonb_build_object('sourceId', g.source_id, 'fingerprint', g.fingerprint)), '[]'::jsonb)
    from public._extraction_publish_gaps(tests.id(p_h)) g
$$;
create function tests.pub_sql(p_h text, p_acks jsonb default null) returns text language sql as $$
  select case when p_acks is null then format('select public.publish_handover(%L, %L)', tests.id('ann'), tests.id(p_h))
              else format('select public.publish_handover(%L, %L, null, %L::jsonb)', tests.id('ann'), tests.id(p_h), p_acks) end
$$;
grant execute on all functions in schema tests to anon, authenticated, service_role;

-- ── a processed, published handover with two sources ─────────────────────────
select tests.handover('h', 'ann', 'outgoing');
select tests.member('h', 'rev', 'reviewer');
select tests.member('h', 'inc', 'incoming');
select tests.source('h', 's1');
select tests.source('h', 's2');
update public.sources set consent_ai_provider = 'fake' where handover_id = tests.id('h');
insert into public.processing_runs (handover_id, status, source_ids, pipeline_version, ai_provider, ai_config, created_at, finished_at)
values (tests.id('h'), 'succeeded', array[tests.id('s1'), tests.id('s2')], 'pv-test', 'fake', '{}', clock_timestamp() - interval '1 hour', now());
insert into public.processing_jobs (handover_id, run_id, source_id, stage, status, attempt, input_hash, progress_done, progress_total)
select tests.id('h'), r.id, s, 'extract', 'succeeded', 1, '\x01', 2, 2
  from public.processing_runs r cross join unnest(array[tests.id('s1'), tests.id('s2')]) s where r.handover_id = tests.id('h');
select tests.point('h', 'p1');
select tests.cite('p1', 's1', 'alice', 1);
select tests.set_state('h', 'in_review');
select tests.approve_all('h');
select tests.as_user('ann');
select tests.put('pub1', public.publish_handover(tests.actor(), tests.id('h'), 'v1'));
select tests.as_owner();
select tests.kv_put('pub1_points', (select jsonb_agg(to_jsonb(pp) order by pp.id) from public.publication_points pp
                                     where pp.publication_id = tests.id('pub1')));
select tests.as_user('inc');
select tests.kv_put('published_v1', tests.read(format('select public.api_get_published_handover(%L)', tests.id('h'))));
select tests.as_owner();

-- ── grants ───────────────────────────────────────────────────────────────────
do $$
declare r text;
begin
  foreach r in array array['anon', 'authenticated'] loop
    perform tests.ok(not has_function_privilege(r, 'public.start_source_update_processing(uuid,uuid,text,jsonb,jsonb)', 'EXECUTE')
                     and not has_function_privilege(r, 'public.source_update_processing_scope(uuid,uuid)', 'EXECUTE'), r || ': server-only');
  end loop;
  foreach r in array array['anon', 'authenticated', 'service_role'] loop
    perform tests.ok(not has_function_privilege(r, 'public._source_update_scope(uuid)', 'EXECUTE')
                     and not has_function_privilege(r, 'public._assert_source_updates_settled(uuid)', 'EXECUTE')
                     and not has_function_privilege(r, 'public._blocking_source_updates(uuid)', 'EXECUTE')
                     and not has_function_privilege(r, 'public._trg_source_update_run_closed()', 'EXECUTE'), r || ': internals not executable');
  end loop;
  perform tests.ok(has_function_privilege('service_role', 'public.start_source_update_processing(uuid,uuid,text,jsonb,jsonb)', 'EXECUTE'),
                   'service_role starts scoped runs');
end $$;

-- ── an update awaiting processing ────────────────────────────────────────────
select tests.as_user('ann');
select public.start_revision(tests.actor(), tests.id('h'));
select tests.as_owner();
select tests.put('v2', tests.new_version(tests.id('s1'), tests.hx('b')));
select tests.eq((tests.change(tests.id('v2'))).state, 'awaiting_processing', 'activated: awaiting processing');
select tests.as_user('ann');
select tests.eq(tests.read(format('select public.api_get_source(%L)', tests.id('v2'))) -> 'version' ->> 'update_state', 'awaiting_processing',
                'the read API reports the update state');
-- publication is refused on every path; a refused publication leaves nothing behind
select tests.throws(tests.pub_sql('h'), 'BTPF0', 'gate: an update awaiting processing blocks the 3-argument publish');
select tests.throws(tests.pub_sql('h', '[]'), 'BTPF0', 'gate: and the 4-argument publish');
select tests.as_owner();
select tests.throws(format($q$insert into public.handover_publications (handover_id, version, published_by) values (%L, 9, %L)$q$,
                           tests.id('h'), tests.id('ann')), 'BTPF0', 'gate: a direct publication row is refused (any role that could write it)');
do $$
begin
  perform set_config('baton.publishing', 'on', true);
  perform tests.throws(format('select public.transition_handover(%L, %L, %L)', tests.id('h'), 'approved', tests.id('ann')), 'BTPF0',
                       'gate: the direct in_review → approved transition is refused');
  perform set_config('baton.publishing', 'off', true);
end $$;
select tests.eq((select count(*)::int from public.handover_publications where handover_id = tests.id('h')), 1, 'no partial publication');
select tests.eq((select count(*)::int from public.publication_source_acknowledgements where handover_id = tests.id('h')), 0, 'no acknowledgement left behind');
select tests.eq((select state from public.handovers where id = tests.id('h')), 'in_review', 'still in review');

-- ── the scope comes from the database ────────────────────────────────────────
select tests.as_user('ann');
select tests.eq(public.source_update_processing_scope(tests.actor(), tests.id('h')),
                jsonb_build_object('mode', 'scoped', 'sourceIds', jsonb_build_array(tests.id('v2'))), 'scope: only the new version');
select tests.as_user('rev');
select tests.throws(format('select public.source_update_processing_scope(%L, %L)', tests.id('rev'), tests.id('h')), 'BTFB0', 'a reviewer cannot start processing');
select tests.throws(format('select public.start_source_update_processing(%L, %L, %L, %L, %L)', tests.id('rev'), tests.id('h'), 'pv', '{"provider":"fake"}',
                           tests.scoped_jobs(array[tests.id('v2')])), 'BTFB0', 'nor a scoped run');
select tests.as_user('ann');
-- the job set must be exactly the scope's, with every handover-wide stage
select tests.throws(tests.start_sql('h', tests.scoped_jobs(array[tests.id('v2'), tests.id('s2')])), 'BTCF0', 'jobs for an untouched source are refused');
select tests.throws(tests.start_sql('h', tests.scoped_jobs(array[tests.id('s1')])), 'BTCF0', 'jobs for the superseded version are refused');
select tests.throws(tests.start_sql('h', tests.scoped_jobs(array[tests.id('v2')], array['analyze', 'prepare_review'])), 'BTVF0', 'verify_support is required');
select tests.throws(tests.start_sql('h', tests.scoped_jobs(array[tests.id('v2')], array['verify_support', 'analyze', 'analyze', 'prepare_review'])), 'BTVF0',
                    'a handover-wide stage runs once');
select tests.throws(tests.start_sql('h', tests.scoped_jobs(array[]::uuid[])), 'BTCF0', 'the new version must get its jobs');
select tests.throws(tests.start_sql('h', (select jsonb_agg(e) from jsonb_array_elements(tests.scoped_jobs(array[tests.id('v2')])) e
                                           where e ->> 'stage' <> 'verify_quotes')), 'BTCF0', 'every source-specific stage of the new version is required');
select tests.as_owner();
select tests.eq((select count(*)::int from public.processing_runs where handover_id = tests.id('h')), 1, 'refused starts created no run');

-- ── processing: only the new version gets source-specific work ───────────────
select tests.start('h', 'run2', array[tests.id('v2')]);
do $$
begin
  perform tests.eq((select source_ids from public.processing_runs where id = tests.id('run2')), array[tests.id('s2'), tests.id('v2')],
                   'the run covers every current source (handover-wide stages read them), never the superseded one');
  perform tests.eq((select array_agg(stage || ':' || coalesce(case when source_id = tests.id('v2') then 'v2' end, '-') order by stage)
                      from public.processing_jobs where run_id = tests.id('run2')),
                   array['analyze:-', 'extract:v2', 'parse:v2', 'prepare_review:-', 'verify_quotes:v2', 'verify_support:-'],
                   'source-specific jobs only for the new version, plus every handover-wide stage');
  perform tests.eq((tests.change(tests.id('v2'))).state, 'processing', 'processing');
  perform tests.eq((tests.change(tests.id('v2'))).run_id, tests.id('run2'), 'with its run');
  perform tests.eq((select (after ->> 'scoped')::boolean from public.audit_logs where entity_id = tests.id('run2') and action = 'processing.started'), true, 'audited as scoped');
end $$;
select tests.as_user('ann');
select tests.throws(tests.start_sql('h', tests.scoped_jobs(array[tests.id('v2')])), 'BTIT0', 'a repeated request cannot start a second run');
select tests.throws(format('select public.start_processing(%L, %L, %L, %L, %L)', tests.id('ann'), tests.id('h'), 'pv', '{"provider":"fake"}',
                           tests.scoped_jobs(array[tests.id('v2')])), 'BTIT0', 'nor can a full one');
select tests.as_owner();

-- ── the run closes: extraction complete, run succeeded, but this simulated worker recorded no change detection:
--    Task 05D never marks it ready → failed (detection_incomplete), still blocks, and is processed again ─
select tests.finish(tests.id('run2'), tests.id('v2'), 'succeeded', 3, 3, 'succeeded');
select tests.eq(((tests.change(tests.id('v2'))).state, (tests.change(tests.id('v2'))).error_code)::text, '(failed,detection_incomplete)',
                'processed, not compared: failed (detection_incomplete), never ready');
select tests.eq((select state from public.handovers where id = tests.id('h')), 'in_review', 'back in review');
select tests.as_user('ann');
select tests.throws(tests.pub_sql('h'), 'BTPF0', 'gate: an update without its change detection blocks publication');
select tests.as_owner();
select tests.eq(public.source_update_processing_scope(tests.id('ann'), tests.id('h')) ->> 'mode', 'scoped', 'the undetected update is processed again (scoped)');

-- ── a newer version: the earlier update is superseded; failure, retry, acknowledgement ─
select tests.put('v3', tests.new_version(tests.id('v2'), tests.hx('c')));
select tests.eq((tests.change(tests.id('v2'))).state, 'superseded', 'the earlier update is superseded, whatever it had reached');
select tests.eq((tests.change(tests.id('v3'))).state, 'awaiting_processing', 'the new one waits');
-- attempt 1: the extraction completes but a handover-wide stage fails → failed (run_failed), blocks, no acknowledgement helps
select tests.start('h', 'run3', array[tests.id('v3')]);
select tests.finish(tests.id('run3'), tests.id('v3'), 'succeeded', 2, 2, 'failed', 'failed');
select tests.eq(((tests.change(tests.id('v3'))).state, (tests.change(tests.id('v3'))).error_code)::text, '(failed,run_failed)',
                'complete extraction, failed run: failed (run_failed)');
select tests.as_user('ann');
select tests.throws(tests.pub_sql('h', tests.gaps('h')), 'BTPF0', 'gate: a failed run blocks even with every acknowledgement');
select tests.as_owner();
select tests.eq((select count(*)::int from public.publication_source_acknowledgements where handover_id = tests.id('h')), 0, 'and leaves no acknowledgement');
-- attempt 2 (retry): the same record moves back to processing; the extraction fails → failed (extraction_failed)
select tests.start('h', 'run4', array[tests.id('v3')]);
select tests.eq((tests.change(tests.id('v3'))).state, 'processing', 'a retry: processing again');
select tests.finish(tests.id('run4'), tests.id('v3'), 'failed', 0, 0, 'failed');
select tests.eq(((tests.change(tests.id('v3'))).state, (tests.change(tests.id('v3'))).error_code)::text, '(failed,extraction_failed)',
                'failed extraction: failed (extraction_failed)');
select tests.eq((select count(*)::int from public.source_version_changes where to_source_id = tests.id('v3')), 1, 'retries never duplicate the record');
-- Task 04 decides it: refused without the acknowledgement, published with it; the update stays failed
select tests.as_user('ann');
select tests.throws(tests.pub_sql('h'), 'BTPF0', 'Task 04: a failed update needs the explicit acknowledgement');
select tests.eq(jsonb_array_length(tests.gaps('h')), 1, 'exactly the new version is a gap');
select tests.put('pub2', public.publish_handover(tests.actor(), tests.id('h'), 'v2', tests.gaps('h')));
select tests.as_owner();
do $$
begin
  perform tests.eq((select state from public.handovers where id = tests.id('h')), 'approved', 'published with the acknowledgement');
  perform tests.eq((tests.change(tests.id('v3'))).state, 'failed', 'and the update is still failed: never marked verified');
  perform tests.eq((select jsonb_array_length(after -> 'updates') from public.audit_logs
                     where entity_id = tests.id('pub2') and action = 'publication.source_updates_unverified'), 1,
                   'the publication records that it went out with an unverified update');
  perform tests.eq((select count(*)::int from public.publication_source_acknowledgements where source_id = tests.id('v3')), 1, 'one acknowledgement');
end $$;
select tests.as_user('inc');
select tests.eq(tests.read(format('select public.api_get_published_handover(%L)', tests.id('h'))) ->> 'publication_id', tests.id('pub2')::text,
                'the incoming member reads the new publication');
select tests.as_owner();
select tests.eq((select count(*)::int from public.publication_points where publication_id = tests.id('pub1')), 1, 'the first snapshot is unchanged');
select tests.eq((select jsonb_agg(to_jsonb(pp) order by pp.id) from public.publication_points pp where pp.publication_id = tests.id('pub1')),
                tests.kv('pub1_points'), 'the first snapshot is byte-for-byte what was published');

-- ── processing (fabricated while in review) also blocks; illegal transitions are refused ─
select tests.as_user('ann');
select public.start_revision(tests.actor(), tests.id('h'));
select tests.as_owner();
select tests.put('v4', tests.new_version(tests.id('v3'), tests.hx('d')));
select tests.throws(format('update public.source_version_changes set state = %L where to_source_id = %L', 'processing', tests.id('v4')), 'BTIT0',
                    'the lifecycle moves only through its triggers');
do $$
begin
  perform set_config('baton.versioning', 'on', true);
  update public.source_version_changes set state = 'processing' where to_source_id = tests.id('v4');
  perform tests.throws(format('update public.source_version_changes set state = %L where to_source_id = %L', 'awaiting_processing', tests.id('v4')),
                       'BTIT0', 'no transition back to awaiting');
  perform tests.throws(format('update public.source_version_changes set state = %L, error_code = null where to_source_id = %L', 'superseded', tests.id('v4')),
                       'BTIT0', 'a processing update is never superseded behind its run''s back');
  perform set_config('baton.versioning', 'off', true);
  perform tests.as_user('ann');
  perform tests.throws(tests.pub_sql('h'), 'BTPF0', 'gate: a processing update blocks publication');
  perform tests.as_owner();
  raise exception 'undo' using errcode = 'TZRB0';
exception when sqlstate 'TZRB0' then
  null;
end $$;
select tests.eq((tests.change(tests.id('v4'))).state, 'awaiting_processing', 'fabrication undone');

-- ── Task 04 scope: a scoped run never hides an older, unacknowledged gap ──────
select tests.handover('h4', 'ann', 'outgoing');
select tests.source('h4', 'a1');
select tests.source('h4', 'a2');
update public.sources set consent_ai_provider = 'fake' where handover_id = tests.id('h4');
insert into public.processing_runs (handover_id, status, source_ids, pipeline_version, ai_provider, ai_config, created_at, finished_at)
values (tests.id('h4'), 'succeeded', array[tests.id('a1'), tests.id('a2')], 'pv-test', 'fake', '{}', clock_timestamp() - interval '1 hour', now());
select tests.put('r41', (select id from public.processing_runs where handover_id = tests.id('h4')));
insert into public.processing_jobs (handover_id, run_id, source_id, stage, status, attempt, input_hash, progress_done, progress_total, error_message)
values (tests.id('h4'), tests.id('r41'), tests.id('a1'), 'extract', 'failed', 1, '\x01', 1, 4, 'ai_quota_exhausted'),
       (tests.id('h4'), tests.id('r41'), tests.id('a2'), 'extract', 'succeeded', 1, '\x02', 2, 2, null);
select tests.set_state('h4', 'in_review');
select tests.put('a2v2', tests.new_version(tests.id('a2'), tests.hx('e')));
select tests.start('h4', 'r42', array[tests.id('a2v2')]);
select tests.finish(tests.id('r42'), tests.id('a2v2'), 'succeeded', 1, 1, 'succeeded');
select tests.eq((select array_agg(g.source_id::text || ':' || g.gap_state || ':' || (g.run_id = tests.id('r41'))::text)
                   from public._extraction_publish_gaps(tests.id('h4')) g),
                array[tests.id('a1')::text || ':partial:true'],
                'a1''s partial extraction from the earlier run is still a gap after a scoped run that did not touch it');
select tests.as_user('ann');
do $$
declare rep jsonb := tests.read(format('select public.api_get_extraction_report(%L)', tests.id('h4')));
begin
  perform tests.eq((select s ->> 'gapState' from jsonb_array_elements(rep -> 'sources') s where s ->> 'sourceId' = tests.id('a1')::text), 'partial',
                   'the report shows the same gap (report = gate)');
  perform tests.eq((select s ->> 'runId' from jsonb_array_elements(rep -> 'sources') s where s ->> 'sourceId' = tests.id('a1')::text), tests.id('r41')::text,
                   'judged by its own latest extraction');
  perform tests.eq((select s ->> 'gapState' from jsonb_array_elements(rep -> 'sources') s where s ->> 'sourceId' = tests.id('a2v2')::text), 'complete',
                   'the new version is complete');
  perform tests.eq((select count(*)::int from jsonb_array_elements(rep -> 'sources') s where s ->> 'sourceId' = tests.id('a2')::text), 0,
                   'the superseded version is not listed');
  perform tests.eq((select u ->> 'state' || ':' || (u ->> 'blocksPublication') from jsonb_array_elements(rep -> 'sourceUpdates') u),
                   'failed:true', 'the report lists the update and that it blocks');
end $$;
select tests.as_owner();

-- ── a full run of an ordinary handover is unchanged ──────────────────────────
select tests.handover('h5', 'ann', 'outgoing');
select tests.source('h5', 'b1');
update public.sources set consent_ai_provider = 'fake' where handover_id = tests.id('h5');
select tests.as_user('ann');
select tests.eq(public.source_update_processing_scope(tests.actor(), tests.id('h5')) ->> 'mode', 'full', 'a draft is processed in full');
select tests.throws(tests.start_sql('h5', tests.scoped_jobs(array[tests.id('b1')])), 'BTIT0', 'no scoped run outside review');
select tests.put('r51', public.start_processing(tests.actor(), tests.id('h5'), 'pv-test', '{"provider":"fake"}',
                   jsonb_build_array(jsonb_build_object('stage', 'extract', 'sourceId', tests.id('b1'), 'inputHash', md5('b1')))));
select tests.as_owner();
select tests.eq((select source_ids from public.processing_runs where id = tests.id('r51')), array[tests.id('b1')], 'the full run is as before');
select tests.eq((select count(*)::int from public.source_version_changes where handover_id = tests.id('h5')), 0, 'no update record for an ordinary source');

-- ── the published snapshots stay readable and unchanged ──────────────────────
-- while a later revision is open (v4 awaiting processing), the incoming member keeps reading publication 2
select tests.as_user('inc');
select tests.eq(tests.read(format('select public.api_get_published_handover(%L)', tests.id('h'))) ->> 'publication_id', tests.id('pub2')::text,
                'the incoming member keeps reading the last publication during the revision');
select tests.as_owner();

-- ── a scoped run uses the same worker fencing: a lost lease is reclaimed, the stale attempt cannot write ─
select tests.handover('h6', 'ann', 'outgoing');
select tests.source('h6', 'c1');
select tests.source('h6', 'c2');
update public.sources set consent_ai_provider = 'fake' where handover_id = tests.id('h6');
insert into public.processing_runs (handover_id, status, source_ids, pipeline_version, ai_provider, ai_config, created_at, finished_at)
values (tests.id('h6'), 'succeeded', array[tests.id('c1'), tests.id('c2')], 'pv-test', 'fake', '{}', clock_timestamp() - interval '1 hour', now());
insert into public.processing_jobs (handover_id, run_id, source_id, stage, status, attempt, input_hash, progress_done, progress_total)
select tests.id('h6'), r.id, s, 'extract', 'succeeded', 1, '\x01', 1, 1
  from public.processing_runs r cross join unnest(array[tests.id('c1'), tests.id('c2')]) s where r.handover_id = tests.id('h6');
select tests.set_state('h6', 'in_review');
select tests.put('c1v2', tests.new_version(tests.id('c1'), tests.hx('f')));
select tests.start('h6', 'r6', array[tests.id('c1v2')]);
select tests.as_service();
create temp table claimed6 as select * from public.claim_ready_processing_jobs(10, 300);
grant all on claimed6 to service_role;
select tests.as_owner();
select tests.eq((select array_agg(c.stage order by c.stage) from claimed6 c where c.run_id = tests.id('r6')), array['parse'],
                'only the new version''s first job is ready (stage order unchanged)');
select tests.put('j6', (select id from claimed6 where run_id = tests.id('r6')));
update public.processing_jobs set lease_expires_at = now() - interval '1 second', next_attempt_at = now() - interval '1 hour' where id = tests.id('j6');
select tests.as_service();
truncate claimed6;
insert into claimed6 select * from public.claim_ready_processing_jobs(10, 300);
select tests.eq((select attempt from claimed6 where id = tests.id('j6')), 2, 'worker crash: the job is reclaimed as attempt 2');
select tests.throws(format('select public.pipeline_mark_source_parse_failed(%L, 1, %L)', tests.id('j6'), 'parse_failed'), 'BTLL0',
                    'the stale attempt cannot write');
select tests.as_owner();
select tests.eq((select count(*)::int from public.processing_jobs where run_id = tests.id('r6')), 6, 'the retry created no extra job');
select tests.eq((tests.change(tests.id('c1v2'))).state, 'processing', 'the update is still processing (one record)');
