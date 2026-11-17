-- R3 Task 03 (EXT-1/2/3, VER-2/3): signals, coverage, chunk stats and point review flags
-- (migration 20261117300100_extraction_reliability).
\set ON_ERROR_STOP 1

select tests.user(u) from unnest(array['ann', 'rev', 'inc', 'out']) u;
select tests.handover('h', 'ann', 'outgoing');
select tests.member('h', 'rev', 'reviewer');
select tests.member('h', 'inc', 'incoming');
select tests.source('h', 's1');
select tests.source('h', 's2');
select tests.handover('h2', 'out', 'outgoing');
select tests.source('h2', 'z');
select tests.point('h2', 'Z');

select tests.as_user('ann');
select tests.put('run', public.start_processing(tests.actor(), tests.id('h'), 'pv-test', '{"provider":"fake"}'::jsonb,
  jsonb_build_array(
    jsonb_build_object('stage', 'extract', 'sourceId', tests.id('s1'), 'inputHash', md5('e1')),
    jsonb_build_object('stage', 'analyze', 'sourceId', null, 'inputHash', md5('an')))));
select tests.as_owner();
select tests.put('ex', (select id from public.processing_jobs where run_id = tests.id('run') and stage = 'extract'));
select tests.put('an', (select id from public.processing_jobs where run_id = tests.id('run') and stage = 'analyze'));

-- helpers (strings for tests.throws)
create function tests.sig_sql(p_job text, p_attempt int, p_signals jsonb) returns text language sql as $$
  select format('select public.pipeline_store_source_signals(%L, %s, %L, %L)', tests.id(p_job), p_attempt,
    '{"detectorVersion":"signals@1","messagesInspected":9,"messagesWithSignals":2,"signals":3,"oversizeSkipped":1,"emptySkipped":0,"chunksTotal":2}',
    p_signals)
$$;
create function tests.sig(p_msg uuid, p_kind text, p_start int, p_end int) returns jsonb language sql as $$
  select jsonb_build_object('messageId', p_msg, 'kind', p_kind, 'strength', 'strong', 'start', p_start, 'end', p_end, 'value', null)
$$;
grant execute on function tests.sig_sql(text, int, jsonb), tests.sig(uuid, text, int, int) to service_role;

-- ── grants: clients never reach the writers ──────────────────────────────────
select tests.as_reader('ann');
select tests.throws(tests.sig_sql('ex', 1, '[]'), '42501', 'authenticated cannot store signals');
select tests.throws(format('select public.pipeline_store_point_flags(%L, 1, %L)', tests.id('an'), '[]'), '42501',
                    'authenticated cannot store flags');
select tests.throws(format('select public.review_point_flag(%L, %L, %L)', tests.id('ann'), gen_random_uuid(), 'dismissed'), '42501',
                    'reviewer mutations are server-only');
select tests.as_anon();
select tests.throws(format('select public.api_get_extraction_report(%L)', tests.id('h')), '42501', 'anon cannot read the report');

-- ── the extract job is claimed; a stale claim is refused ─────────────────────
select tests.as_service();
create temp table claimed as select * from public.claim_ready_processing_jobs(10, 300);
select tests.eq((select id from claimed where stage = 'extract'), tests.id('ex'), 'extract claimed');
select tests.throws(tests.sig_sql('ex', 2, '[]'), 'BTLL0', 'wrong attempt: claim lost');

-- signals: only messages of the job's own source
select tests.throws(tests.sig_sql('ex', 1, jsonb_build_array(tests.sig(tests.msg('s2', 'alice', 1), 'decision', 0, 5))), 'BTFB0',
                    'a message of another source is refused');
select tests.throws(tests.sig_sql('ex', 1, jsonb_build_array(tests.sig(tests.msg('z', 'alice', 1), 'decision', 0, 5))), 'BTFB0',
                    'a message of another handover is refused');
select tests.throws(tests.sig_sql('ex', 1, jsonb_build_array(tests.sig(tests.msg('s1', 'alice', 1), 'gossip', 0, 5))), '23514',
                    'an unknown kind is refused');
select tests.eq((select public.pipeline_store_source_signals(tests.id('ex'), 1,
  '{"detectorVersion":"signals@1","messagesInspected":9,"messagesWithSignals":2,"signals":3,"oversizeSkipped":1,"emptySkipped":0,"chunksTotal":2}',
  jsonb_build_array(tests.sig(tests.msg('s1', 'alice', 1), 'decision', 0, 5),
                    tests.sig(tests.msg('s1', 'alice', 1), 'deadline', 6, 13),
                    tests.sig(tests.msg('s1', 'bob', 2), 'financial_commitment', 0, 9)))), 3, 'three signals stored');
select tests.eq((select public.pipeline_store_source_signals(tests.id('ex'), 1,
  '{"detectorVersion":"signals@1","messagesInspected":9,"messagesWithSignals":2,"signals":3,"oversizeSkipped":1,"emptySkipped":0,"chunksTotal":2}',
  jsonb_build_array(tests.sig(tests.msg('s1', 'alice', 1), 'decision', 0, 5)))), 0, 'a retry inserts nothing (idempotent)');

-- chunk stats: upsert by chunk; reason tokens and integer counts only
select public.pipeline_record_extract_chunk_stats(tests.id('ex'), 1, 0,
  '{"chunkTotal":2,"messages":5,"candidates":4,"inserted":2,"merged":1,"dropped":{"fabricated":1}}');
select public.pipeline_record_extract_chunk_stats(tests.id('ex'), 1, 0,
  '{"chunkTotal":2,"messages":5,"candidates":4,"inserted":2,"merged":1,"dropped":{"fabricated":1,"identity_dropped":1}}');
select tests.eq((select count(*)::int from public.extraction_chunk_stats where run_id = tests.id('run')), 1, 'a retried chunk replaces its row');
select tests.throws(format('select public.pipeline_record_extract_chunk_stats(%L, 1, 1, %L)', tests.id('ex'),
  '{"chunkTotal":2,"messages":1,"candidates":0,"inserted":0,"merged":0,"dropped":{"Bad Key":1}}'), 'BTVF0', 'a non-token reason is refused');
select tests.throws(format('select public.pipeline_record_extract_chunk_stats(%L, 1, 1, %L)', tests.id('ex'),
  '{"chunkTotal":2,"messages":1,"candidates":0,"inserted":0,"merged":0,"dropped":{"fabricated":"text"}}'), 'BTVF0', 'a non-numeric count is refused');
-- the extract job checkpoints one of two chunks, then fails: a partial source
-- the analyze job may not write signals; the extract job may not write flags
select tests.as_owner();
update public.processing_jobs set progress_done = 1, progress_total = 2 where id = tests.id('ex');
update public.processing_jobs set status = 'running', attempt = 1, lease_expires_at = now() + interval '5 minutes'
 where id = tests.id('an');
select tests.as_service();
select tests.throws(tests.sig_sql('an', 1, '[]'), 'BTFB0', 'analyze cannot store signals');
select tests.throws(format('select public.pipeline_store_point_flags(%L, 1, %L)', tests.id('ex'), '[]'), 'BTFB0',
                    'extract cannot store flags');

-- ── flags: current revision of a point in the job's handover only ────────────
select tests.as_owner();
select tests.point('h', 'p1', 'owner');
select tests.cite('p1', 's1', 'alice', 1);
create function tests.flag(p_point text, p_kind text, p_msg uuid, p_rev uuid default null) returns jsonb language sql as $$
  select jsonb_build_object('pointId', tests.id(p_point),
    'revisionId', coalesce(p_rev, (select current_revision_id from public.handover_points where id = tests.id(p_point))),
    'kind', p_kind, 'messageId', p_msg,
    'detail', case when p_msg is null then '{"field":"ownerLabel","status":"unrecognized"}'::jsonb
                   else '{"reasons":["newer","reversal_marker"],"score":6}'::jsonb end,
    'dedupeKey', coalesce(p_msg::text, 'ownerLabel'))
$$;
grant execute on function tests.flag(text, text, uuid, uuid) to service_role;
select tests.as_service();
select tests.eq((select public.pipeline_store_point_flags(tests.id('an'), 1, jsonb_build_array(
  tests.flag('p1', 'possible_contradiction', tests.msg('s1', 'carol', 3)),
  tests.flag('p1', 'attribution_unresolved', null)))), 2, 'two flags stored');
select tests.eq((select public.pipeline_store_point_flags(tests.id('an'), 1, jsonb_build_array(
  tests.flag('p1', 'attribution_unresolved', null)))), 0, 'an existing flag is not rewritten');
select tests.throws(format('select public.pipeline_store_point_flags(%L, 1, %L)', tests.id('an'),
  jsonb_build_array(tests.flag('Z', 'attribution_unresolved', null))), 'BTFB0', 'a point of another handover is refused');
select tests.throws(format('select public.pipeline_store_point_flags(%L, 1, %L)', tests.id('an'),
  jsonb_build_array(tests.flag('p1', 'attribution_inferred', null, gen_random_uuid()))), 'BTFB0', 'a stale revision is refused');
select tests.throws(format('select public.pipeline_store_point_flags(%L, 1, %L)', tests.id('an'),
  jsonb_build_array(tests.flag('p1', 'attribution_inferred', tests.msg('s1', 'bob', 1)))), '23514',
  'an attribution flag never names a message');

-- ── the report (as a reviewer) ───────────────────────────────────────────────
do $$
declare r jsonb; s jsonb;
begin
  perform tests.as_reader('rev');
  r := public.api_get_extraction_report(tests.id('h'));
  perform tests.eq((r ->> 'available')::boolean, true, 'report available');
  perform tests.eq(r ->> 'runId', tests.id('run')::text, 'latest run');
  select e into s from jsonb_array_elements(r -> 'sources') e where e ->> 'sourceId' = tests.id('s1')::text;
  perform tests.eq((s ->> 'coverageRecorded')::boolean, true, 'coverage recorded');
  perform tests.eq((s ->> 'messagesInspected')::int, 9, 'messages inspected');
  perform tests.eq((s ->> 'oversizeSkipped')::int, 1, 'oversize skipped');
  perform tests.eq((s ->> 'chunksDone')::int, 1, 'one chunk done');
  perform tests.eq((s ->> 'chunksTotal')::int, 2, 'of two');
  perform tests.eq((s ->> 'candidatesReturned')::int, 4, 'candidates from chunk stats');
  perform tests.eq((s -> 'discarded' ->> 'identity_dropped')::int, 1, 'discards by reason');
  perform tests.eq((s ->> 'signalMessagesLinked')::int, 1, 'alice 1 is cited by p1');
  perform tests.eq((s ->> 'signalMessagesUnreviewed')::int, 1, 'bob 2 is unreviewed');
  perform tests.eq((r -> 'flags' ->> 'possibleContradictions')::int, 1, 'one open contradiction flag');
  perform tests.eq((r -> 'flags' ->> 'unresolvedAttribution')::int, 1, 'one unresolved attribution');
  perform tests.eq(jsonb_array_length(public.api_list_unreviewed_signals(tests.id('h'), 10)), 1, 'one unreviewed message listed');
  perform tests.eq(jsonb_array_length(public.api_list_point_flags(tests.id('h'))), 2, 'two flags listed');
  perform tests.ok((select (e ->> 'messageExcerpt') like 'Carol message 3%' from jsonb_array_elements(public.api_list_point_flags(tests.id('h'))) e
                     where e ->> 'kind' = 'possible_contradiction'), 'contradiction flag carries the later message');

  perform tests.as_reader('inc');
  perform tests.ok(public.api_get_extraction_report(tests.id('h')) is null, 'an incoming member gets no report');
  perform tests.eq(jsonb_array_length(public.api_list_unreviewed_signals(tests.id('h'), 10)), 0, 'nor signals');
  perform tests.eq(jsonb_array_length(public.api_list_point_flags(tests.id('h'))), 0, 'nor flags');
  perform tests.eq((select count(*)::int from public.extraction_signals), 0, 'RLS hides signal rows');

  perform tests.as_reader('out');
  perform tests.ok(public.api_get_extraction_report(tests.id('h')) is null, 'a non-member gets no report');
end $$;

-- ── reviewer mutations ───────────────────────────────────────────────────────
select tests.as_service();
select tests.eq(public.review_extraction_signals(tests.id('rev'), tests.id('h'), tests.msg('s1', 'bob', 2), 'dismissed'), 1,
                'a reviewer dismisses the message''s signals');
select tests.throws(format('select public.review_extraction_signals(%L, %L, %L, %L)', tests.id('inc'), tests.id('h'),
                           tests.msg('s1', 'bob', 2), 'dismissed'), 'BTNF0', 'an incoming member cannot');
select tests.throws(format('select public.review_extraction_signals(%L, %L, %L, %L)', tests.id('out'), tests.id('h'),
                           tests.msg('s1', 'bob', 2), 'dismissed'), 'BTNF0', 'a non-member cannot');
select tests.throws(format('select public.review_extraction_signals(%L, %L, %L, %L)', tests.id('rev'), tests.id('h'),
                           tests.msg('z', 'bob', 2), 'dismissed'), 'BTNF0', 'a message of another handover is not found');
select public.review_point_flag(tests.id('rev'), (select id from public.point_review_flags where kind = 'attribution_unresolved'), 'confirmed');
select tests.throws(format('select public.review_point_flag(%L, %L, %L)', tests.id('out'),
                           (select id from public.point_review_flags where kind = 'possible_contradiction'), 'dismissed'),
                    'BTNF0', 'a non-member cannot review a flag');
select tests.eq((select count(*)::int from public.audit_logs where action in ('signals.reviewed', 'point_flag.reviewed')), 2, 'both audited');

do $$
declare r jsonb; s jsonb;
begin
  perform tests.as_reader('rev');
  r := public.api_get_extraction_report(tests.id('h'));
  select e into s from jsonb_array_elements(r -> 'sources') e where e ->> 'sourceId' = tests.id('s1')::text;
  perform tests.eq((s ->> 'signalMessagesUnreviewed')::int, 0, 'nothing left unreviewed');
  perform tests.eq((s ->> 'signalMessagesDismissed')::int, 1, 'one dismissed');
  perform tests.eq((r -> 'flags' ->> 'unresolvedAttribution')::int, 0, 'a reviewed flag is no longer open');
  perform tests.eq(jsonb_array_length(public.api_list_unreviewed_signals(tests.id('h'), 10)), 0, 'the queue is empty');
end $$;

-- ── a later edit makes the old flags stale (current revision only) ────────────
-- (built directly, as edit_point would: the handover is still processing here)
select tests.as_owner();
do $$
declare r uuid;
begin
  insert into public.point_revisions (handover_id, point_id, revision_number, title, statement, attributes, author_kind, ai_provenance)
  values (tests.id('h'), tests.id('p1'), 2, 'Edited', 'Edited statement', '{"responsibility":"Bank"}', 'system', '{"provider":"fake"}')
  returning id into r;
  update public.handover_points set current_revision_id = r where id = tests.id('p1');
end $$;
do $$
begin
  perform tests.as_reader('rev');
  perform tests.eq((public.api_get_extraction_report(tests.id('h')) -> 'flags' ->> 'possibleContradictions')::int, 0,
                   'flags on an earlier revision do not count');
  perform tests.eq(jsonb_array_length(public.api_list_point_flags(tests.id('h'))), 0, 'nor are they listed');
end $$;

-- ── erasing a message removes its signals ─────────────────────────────────────
select tests.as_owner();
delete from public.source_messages where id = tests.msg('s1', 'bob', 2);
select tests.eq((select count(*)::int from public.extraction_signals where source_message_id = tests.msg('s1', 'bob', 2)), 0,
                'signals cascade with their message');

-- ── grants ────────────────────────────────────────────────────────────────────
do $$
begin
  perform tests.ok(has_function_privilege('service_role', 'public.pipeline_store_source_signals(uuid,int,jsonb,jsonb,bigint)', 'execute'), 'service_role writes signals');
  perform tests.ok(not has_function_privilege('authenticated', 'public.pipeline_store_point_flags(uuid,int,jsonb,bigint)', 'execute'), 'authenticated cannot write flags');
  perform tests.ok(not has_function_privilege('authenticated', 'public.review_extraction_signals(uuid,uuid,uuid,text)', 'execute'), 'mutations are server-only');
  perform tests.ok(has_function_privilege('authenticated', 'public.api_get_extraction_report(uuid)', 'execute'), 'authenticated reads the report');
  perform tests.ok(not has_function_privilege('anon', 'public.api_list_point_flags(uuid)', 'execute'), 'anon cannot read flags');
end $$;
