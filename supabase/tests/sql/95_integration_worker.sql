-- Integration worker and action support (migration 20261112000100): stage ordering, fencing, reaping,
-- worker reads, the DB-11 quote fix, grants, and the R1/R2 access rules.
\set ON_ERROR_STOP 1

select tests.user(u) from unnest(array['ann', 'rev', 'inc', 'eve']) u;
select tests.handover('h', 'ann', 'outgoing');
select tests.member('h', 'rev', 'reviewer');
select tests.member('h', 'inc', 'incoming');
select tests.source('h', 's1');
select tests.source('h', 's2');

-- A run over two parsed sources: per-source extract + verify_quotes, then per-handover stages.
select tests.as_user('ann');
select tests.put('run', public.start_processing(tests.actor(), tests.id('h'), 'pv-test', '{"provider":"fake"}'::jsonb,
  jsonb_build_array(
    jsonb_build_object('stage', 'extract', 'sourceId', tests.id('s1'), 'inputHash', md5('e1')),
    jsonb_build_object('stage', 'extract', 'sourceId', tests.id('s2'), 'inputHash', md5('e2')),
    jsonb_build_object('stage', 'verify_quotes', 'sourceId', tests.id('s1'), 'inputHash', md5('q1')),
    jsonb_build_object('stage', 'verify_quotes', 'sourceId', tests.id('s2'), 'inputHash', md5('q2')),
    jsonb_build_object('stage', 'verify_support', 'sourceId', null, 'inputHash', md5('vs')),
    jsonb_build_object('stage', 'analyze', 'sourceId', null, 'inputHash', md5('an')),
    jsonb_build_object('stage', 'prepare_review', 'sourceId', null, 'inputHash', md5('pr')))));
select tests.as_owner();

select tests.put(stage || coalesce('_' || (case source_id when tests.id('s1') then 's1' when tests.id('s2') then 's2' end), ''), id)
  from public.processing_jobs where run_id = tests.id('run');

-- ── grants: browser roles cannot reach any worker function ──────────────────
select tests.as_reader('ann');
select tests.throws('select * from public.claim_ready_processing_jobs(5, 300)', '42501', 'authenticated cannot claim jobs');
select tests.throws($$select public.list_extraction_messages('$$ || tests.id('s1') || $$', -1, 10)$$, '42501',
                    'authenticated cannot read raw worker messages');
select tests.throws($$select public.source_preview_target('$$ || tests.id('ann') || $$', '$$ || tests.id('s1') || $$')$$,
                    '42501', 'authenticated cannot call the preview target');
select tests.as_anon();
select tests.throws($$select public.api_get_source('$$ || tests.id('s1') || $$')$$, '42501', 'anon cannot call api_get_source');

-- ── DB-1: ordering and serial extract ───────────────────────────────────────
select tests.as_service();
create temp table claimed as select * from public.claim_ready_processing_jobs(10, 300);
select tests.eq((select count(*)::int from claimed), 1, 'only one extract is claimable at a time per run');
select tests.eq((select stage from claimed), 'extract', 'the first claim is an extract');
select tests.eq((select count(*)::int from public.claim_ready_processing_jobs(10, 300)), 0,
                'nothing else is ready while the first extract runs');
select tests.throws('select * from public.claim_ready_processing_jobs(0, 300)', 'BTVF0', 'claim limits are validated');

-- ── DB-2: fencing and outcomes ──────────────────────────────────────────────
select tests.throws(format('select public.complete_processing_job(%L, 99, %L)', (select id from claimed), 'succeeded'),
                    'BTCF0', 'a stale attempt cannot complete the job');
select tests.throws(format('select public.complete_processing_job(%L, 1, %L, null, %L, %L)', (select id from claimed),
                           'failed', 'processing_failed', 'Alice said the PIN is 1234'),
                    'BTVF0', 'error messages must be reason tokens, never content');
select tests.throws(format('select public.complete_processing_job(%L, 1, %L, null, %L)', (select id from claimed),
                           'failed', 'made_up_code'), 'BTVF0', 'error codes must be ERROR_CODES');
select tests.eq(public.complete_processing_job((select id from claimed), 1, 'succeeded',
                  '{"attempt":1,"outcome":"succeeded"}'::jsonb), 'succeeded', 'completion with the matching attempt');
select tests.throws(format('select public.complete_processing_job(%L, 1, %L)', (select id from claimed), 'succeeded'),
                    'BTCF0', 'a finished job cannot be completed twice');
select tests.eq((select jsonb_array_length(attempt_log) from public.processing_jobs where id = (select id from claimed)), 1,
                'the attempt record is appended');

-- the other extract and the first source's verify_quotes are now ready; the per-handover stages are not
truncate claimed;
insert into claimed select * from public.claim_ready_processing_jobs(10, 300);
select tests.eq((select count(*)::int from claimed), 2, 'next: the other extract and one verify_quotes');
select tests.ok(not exists (select 1 from claimed where stage in ('verify_support', 'analyze', 'prepare_review')),
                'per-handover stages wait for every source');

-- yield with progress keeps the attempt; yield without progress is a retry
select tests.eq(public.complete_processing_job((select id from claimed where stage = 'verify_quotes'), 1, 'yield',
                  null, null, null, null, 1, 3), 'queued', 'yield re-queues');
select tests.eq((select attempt from public.processing_jobs where id = (select id from claimed where stage = 'verify_quotes')), 0,
                'a checkpointing yield does not consume an attempt');

-- ── DB-3: heartbeat ─────────────────────────────────────────────────────────
select tests.eq(public.heartbeat_processing_job((select id from claimed where stage = 'extract'), 7, 300), 'lost',
                'heartbeat with a stale attempt is lost');
select tests.eq(public.heartbeat_processing_job((select id from claimed where stage = 'extract'), 1, 300, 1, 4), 'running',
                'heartbeat returns the run status');
select tests.throws(format('select public.heartbeat_processing_job(%L, 1, 5)', (select id from claimed where stage = 'extract')),
                    'BTVF0', 'lease bounds are validated');

-- skipped → cancelled with the upstream reason
select tests.eq(public.complete_processing_job((select id from claimed where stage = 'extract'), 1, 'skipped'), 'cancelled',
                'skipped is terminal');
select tests.eq((select error_message from public.processing_jobs where id = (select id from claimed where stage = 'extract')),
                'upstream_failed', 'skipped records only the reason token');

-- ── DB-1 reaper: a lease that expired on the last attempt fails instead of hanging ──
select tests.as_owner();
update public.processing_jobs set status = 'running', attempt = max_attempts, lease_expires_at = now() - interval '1 minute'
 where id = tests.id('verify_quotes_s2');
select tests.as_service();
truncate claimed;
insert into claimed select * from public.claim_ready_processing_jobs(10, 300);
select tests.eq((select status from public.processing_jobs where id = tests.id('verify_quotes_s2')), 'failed',
                'the reaper fails a job whose last lease expired');
select tests.eq((select error_message from public.processing_jobs where id = tests.id('verify_quotes_s2')), 'lease_expired',
                'the reaper records a reason token');
select tests.eq((select stage from claimed), 'verify_quotes', 'the yielded verify_quotes is claimable again');
select tests.eq(public.complete_processing_job((select id from claimed), 1, 'succeeded'), 'succeeded', 'verify_quotes done');
select tests.eq((select stage from public.claim_ready_processing_jobs(10, 300)), 'verify_support',
                'verify_support becomes ready once every per-source job is terminal');

-- ── DB-4: job context ───────────────────────────────────────────────────────
select tests.eq(public.get_processing_job_context(tests.id('extract_s1')) #>> '{run,aiProvider}', 'fake', 'run snapshot');
select tests.eq(public.get_processing_job_context(tests.id('extract_s1')) #>> '{source,accessLevel}', 'everyone', 'source access');
select tests.eq(public.get_processing_job_context(tests.id('extract_s1')) ->> 'priorSucceeded', 'false', 'no earlier run');
select tests.ok(public.get_processing_job_context(tests.id('verify_support')) -> 'source' = 'null'::jsonb,
                'per-handover jobs have no source');

-- ── DB-5: masked messages by page ───────────────────────────────────────────
select tests.eq(jsonb_array_length(public.list_extraction_messages(tests.id('s1'), -1, 2000) -> 'messages'), 9, 'all text messages');
select tests.eq((select array_agg((m ->> 'seq')::int order by (m ->> 'seq')::int)
                   from jsonb_array_elements(public.list_extraction_messages(tests.id('s1'), 4, 2) -> 'messages') m),
                array[5, 6], 'paging by seq');
select tests.throws(format('select public.list_extraction_messages(%L, -1, 5000)', tests.id('s1')), 'BTVF0', 'page cap');

-- ── DB-6/7/8/11 need an extracted point with evidence inside the active run ─
select tests.as_owner();
select tests.point('h', 'P', 'owner');
select tests.cite('P', 's1', 'alice', 1, 'unchecked');
select tests.as_service();

select tests.eq(jsonb_array_length(public.list_points_for_pipeline(tests.id('h'))), 1, 'points for dedup');
select tests.eq(public.list_points_for_pipeline(tests.id('h')) -> 0 ->> 'category', 'owner', 'point category');

select tests.eq(jsonb_array_length(public.list_links_needing_support(tests.id('h'), 100)), 1, 'an unchecked link needs support');
select tests.ok(jsonb_array_length(public.list_links_needing_support(tests.id('h'), 100) -> 0 -> 'context') between 1 and 3,
                'at most three neighbours as context');
select tests.ok(not (public.list_links_needing_support(tests.id('h'), 100) -> 0 ? 'stance'), 'the verifier never sees a stance');

-- DB-11: two different not_found quotes on one message keep separate rows
select public.add_source_quote_evidence(tests.id('P'), tests.msg('s1', 'bob', 2), 'first mis-cited quote here', null, null, 'pending');
select public.add_source_quote_evidence(tests.id('P'), tests.msg('s1', 'bob', 2), 'second different mis-cited quote', null, null, 'pending');
select tests.eq((select count(*)::int from public.evidence_quotes where source_message_id = tests.msg('s1', 'bob', 2)), 2,
                'offset-less quotes are deduplicated by text, not collapsed');
select public.add_source_quote_evidence(tests.id('P'), tests.msg('s1', 'bob', 2), 'first mis-cited quote here', null, null, 'pending');
select tests.eq((select count(*)::int from public.evidence_quotes where source_message_id = tests.msg('s1', 'bob', 2)), 2,
                'the same offset-less quote is still deduplicated');

-- QA-M1: the database refuses fabricated or implausible checks
select tests.throws(format('select public.add_source_quote_evidence(%L, %L, %L, 0, 30, %L)', tests.id('P'),
                           tests.msg('s1', 'carol', 1), 'FABRICATED transfer of 50000 rupees', 'exact'),
                    'BTVF0', 'an exact quote must occur in the message');
select tests.throws(format('select public.add_source_quote_evidence(%L, %L, %L, 0, 5, %L)', tests.id('P'),
                           tests.msg('s1', 'carol', 1), 'Carol', 'exact'), 'BTVF0', 'quotes under 12 characters are not evidence');
select tests.throws(format('select public.add_source_quote_evidence(%L, %L, %L, null, null, %L)', tests.id('P'),
                           tests.msg('s1', 'carol', 1), 'Carol message 1 about', 'normalized'), 'BTVF0', 'verified quotes need offsets');
select public.add_source_quote_evidence(tests.id('P'), tests.msg('s1', 'carol', 1), 'message 1 about the bank account', 6, 38, 'exact');
select tests.eq((select quote_check from public.evidence_quotes where source_message_id = tests.msg('s1', 'carol', 1)), 'exact',
                'a genuine exact quote is stored');
select tests.throws(format('select public.record_quote_check(%L, %L)',
                           (select id from public.evidence_quotes where quote_text = 'first mis-cited quote here'), 'exact'),
                    'BTVF0', 'a not-found quote cannot be promoted to exact');

select tests.eq(jsonb_array_length(public.list_quotes_for_check(tests.id('s1'))), 2, 'pending quotes for verify_quotes');
select tests.ok((public.list_quotes_for_check(tests.id('s1')) -> 0 ->> 'messageBody') is not null, 'with the message body');

-- once verified for the current revision the link drops out
select tests.as_owner();
update public.point_evidence set support_verdict = 'supports', verified_revision_id = p.current_revision_id,
       verifier_provenance = '{"provider":"fake"}', verified_at = now()
  from public.handover_points p where p.id = point_evidence.point_id and point_evidence.point_id = tests.id('P');
select tests.as_service();
select tests.eq(jsonb_array_length(public.list_links_needing_support(tests.id('h'), 100)), 0, 'verified links are not re-checked');

-- privacy-held points are never sent to the verifier
select tests.as_owner();
update public.point_evidence set support_verdict = 'unchecked', verified_revision_id = null, verifier_provenance = null, verified_at = null
 where id = tests.id('P/alice1');
update public.handover_points set privacy_review = 'required', privacy_review_flagged_at = now() where id = tests.id('P');
select tests.as_service();
select tests.eq(jsonb_array_length(public.list_links_needing_support(tests.id('h'), 100)), 0, 'privacy-held points are skipped');

-- ── DB-9/10 ─────────────────────────────────────────────────────────────────
select tests.eq(jsonb_array_length(public.list_gap_questions_for_pipeline(tests.id('h'))), 0, 'no questions yet');
select tests.eq(public.set_point_sort_keys(tests.id('h'), tests.id('run'),
                  jsonb_build_array(jsonb_build_object('pointId', tests.id('P'), 'sortKey', 42))), 1, 'sort key set');
select tests.eq((select sort_key from public.handover_points where id = tests.id('P')), 42::double precision, 'sort key stored');
select tests.throws(format('select public.set_point_sort_keys(%L, %L, %L)', tests.id('h'), gen_random_uuid(), '[]'),
                    'BTIT0', 'sort keys only inside the active run');

-- ── R1/R2 on a second, draft handover ───────────────────────────────────────
select tests.as_owner();
select tests.handover('h2', 'ann', 'outgoing');
select tests.member('h2', 'rev', 'reviewer');
select tests.member('h2', 'inc', 'incoming');
insert into public.sources (handover_id, uploaded_by, kind, title, original_filename, mime_type, size_bytes, sha256, state,
                            access_level, timezone, raw_storage_path, consent_statement_version, consent_ai_provider,
                            consent_recorded_at, consent_recorded_by)
values (tests.id('h2'), tests.id('ann'), 'whatsapp_export', 'Upload', 'up.txt', 'text/plain', 10,
        sha256('up'::bytea), 'uploaded', 'everyone', 'Asia/Kolkata', 'raw/h2/up', 'v1', 'fake', now(), tests.id('ann'))
returning tests.put('up', id);
select tests.source('h2', 'parsed2');

select tests.as_reader('ann');
select tests.ok(public.api_get_source(tests.id('up')) is not null, 'the creator reads the source');
select tests.as_reader('inc');
select tests.ok(public.api_get_source(tests.id('up')) is null, 'an incoming member cannot see sources (RLS)');
select tests.as_reader('eve');
select tests.ok(public.api_get_source(tests.id('up')) is null, 'a non-member gets nothing');

select tests.as_service();
select tests.eq(public.source_preview_target(tests.id('ann'), tests.id('up')) ->> 'raw_storage_path', 'raw/h2/up',
                'the creator can preview');
select tests.throws(format('select public.source_preview_target(%L, %L)', tests.id('rev'), tests.id('up')), 'BTFB0',
                    'a reviewer does not manage sources');
select tests.throws(format('select public.source_preview_target(%L, %L)', tests.id('eve'), tests.id('up')), 'BTNF0',
                    'a non-member learns nothing');
select tests.throws(format('select public.source_preview_target(%L, %L)', tests.id('ann'), tests.id('parsed2')), 'BTIT0',
                    'a parsed source has no raw upload to preview');
select tests.eq((select state from public.sources where id = tests.id('up')), 'uploaded', 'preview never changes state');

-- ── DB-14: job states of a run ──────────────────────────────────────────────
select tests.as_service();
select tests.eq(public.list_run_jobs(tests.id('run')) ->> 'runStatus', 'running', 'run status');
select tests.eq(jsonb_array_length(public.list_run_jobs(tests.id('run')) -> 'jobs'), 7, 'every job of the run');
select tests.eq(public.list_run_jobs(tests.id('run')) -> 'jobs' -> 0 ->> 'stage', 'extract', 'ordered by stage rank');
select tests.ok(public.list_run_jobs(gen_random_uuid()) is null, 'unknown run is null');
select tests.as_reader('ann');
select tests.throws(format('select public.list_run_jobs(%L)', tests.id('run')), '42501', 'browser roles cannot list jobs');

-- ── DB-15: finishable runs ──────────────────────────────────────────────────
select tests.as_service();
-- the run has a reaped (failed) job, so it is nominated even though other jobs are still pending
select tests.ok(public.list_finishable_runs(20) ? tests.id('run')::text, 'a run with a failed job is nominated');
select tests.throws('select public.list_finishable_runs(0)', 'BTVF0', 'limit is validated');
select tests.as_reader('ann');
select tests.throws('select public.list_finishable_runs(20)', '42501', 'browser roles cannot list runs');

-- ── QA-N1 / QA-L8 hardening ─────────────────────────────────────────────────
select tests.as_service();
select tests.throws('select * from public.claim_processing_jobs(5, 300)', '42501', 'the legacy claim is not executable');
select tests.throws(format('select public.record_job_attempt(%L, %L)', tests.id('analyze'), 'succeeded'), '42501',
                    'the unfenced legacy completion is not executable');
select tests.throws(format('select public.finish_processing_run(%L, %L, %L, %L)', tests.id('run'), 'failed', 'processing_failed',
                           'OpenAI said: user Alice +91 98765 43210'), 'BTVF0', 'run error messages are reason tokens only');
select tests.throws(format('select public.finish_processing_run(%L, %L, %L)', tests.id('run'), 'failed', 'kaboom'), 'BTVF0',
                    'run error codes are ERROR_CODES only');
