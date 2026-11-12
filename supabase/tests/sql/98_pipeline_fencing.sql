-- Round 3, Agent 4: DB-12 stale-worker fencing, DB-13 atomic chunk persistence, E4 yield checkpoint
-- (migrations 20261113300100_pipeline_fencing, 20261113300200_job_yield_checkpoint).
\set ON_ERROR_STOP 1

select tests.user(u) from unnest(array['ann', 'rev']) u;
select tests.handover('h', 'ann', 'outgoing');
select tests.member('h', 'rev', 'reviewer');
select tests.source('h', 's1');
select tests.source('h', 's2');
-- a second handover with its own point, to prove writers cannot reach across handovers
select tests.handover('h2', 'ann', 'outgoing');
select tests.point('h2', 'Q');

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

-- helper: call the chunk writer as a string (for tests.throws / tests.try)
create function tests.chunk_sql(p_job text, p_attempt int, p_index int, p_total int, p_entries jsonb, p_level text default 'everyone')
returns text language sql as $$
  select format('select public.pipeline_store_extract_chunk(%L, %s, %s, %s, %L, %L, %L)::text', tests.id(p_job), p_attempt,
                p_index, p_total, p_level, '{"provider":"fake","model":null}', p_entries)
$$;
grant execute on function tests.chunk_sql(text, int, int, int, jsonb, text) to service_role;

create function tests.points() returns int language sql as $$
  select count(*)::int from public.handover_points where handover_id = tests.id('h')
$$;
create function tests.links() returns int language sql as $$
  select count(*)::int from public.point_evidence where handover_id = tests.id('h')
$$;
create function tests.quotes() returns int language sql as $$
  select count(*)::int from public.evidence_quotes where handover_id = tests.id('h')
$$;
create function tests.progress(p_job text) returns int language sql as $$
  select progress_done from public.processing_jobs where id = tests.id(p_job)
$$;
grant execute on function tests.points(), tests.links(), tests.quotes(), tests.progress(text) to service_role;

-- ── grants: only the service role reaches the fenced writers ───────────────────
select tests.as_reader('ann');
select tests.throws(format('select public.pipeline_store_extract_chunk(%L, 1, 0, 1, %L, %L, %L)', gen_random_uuid(),
                           'everyone', '{}', '[]'), '42501', 'authenticated cannot store chunks');
select tests.throws(format('select public.pipeline_record_quote_check(%L, 1, %L, %L)', gen_random_uuid(), gen_random_uuid(),
                           'exact'), '42501', 'authenticated cannot record quote checks');
select tests.as_anon();
select tests.throws(format('select public.pipeline_set_job_provenance(%L, 1, %L)', gen_random_uuid(), '{}'), '42501',
                    'anon cannot write provenance');
select tests.as_reader('ann');
select tests.throws(format('select public._pipeline_claim(%L, 1, array[%L])', gen_random_uuid(), 'extract'), '42501',
                    'the claim helper is not callable by clients');

-- ── claim the first extract ──────────────────────────────────────────────────────
select tests.as_service();
create temp table claimed as select * from public.claim_ready_processing_jobs(10, 300);
select tests.eq((select count(*)::int from claimed), 1, 'one extract claimed');
select tests.put('ex', (select id from claimed));
select tests.put('xs', (select source_id from claimed));                          -- the claimed job's source
select tests.put('ys', (select id from public.sources where handover_id = tests.id('h') and id <> tests.id('xs')));
select tests.put('ex_other', (select id from public.processing_jobs where run_id = tests.id('run') and stage = 'extract'
                                and source_id = tests.id('ys')));

create temp table chunk_entries (name text primary key, val jsonb);
insert into chunk_entries values
  ('new_two_cites', jsonb_build_array(jsonb_build_object(
     'pointId', null,
     'point', jsonb_build_object('category', 'decision', 'title', 'Bank account', 'statement', 'The bank account moves to Ravi',
                                 'attributes', '{}'::jsonb, 'inferenceRationale', null),
     'citations', jsonb_build_array(
       jsonb_build_object('messageId', tests.msg('xs', 'alice', 1), 'quote', 'message 1 about the bank account', 'quoteStart', 6, 'quoteEnd', 38),
       jsonb_build_object('messageId', tests.msg('xs', 'bob', 1), 'quote', 'a quote the model misremembered', 'quoteStart', null, 'quoteEnd', null))))),
  ('new_other_source_only', jsonb_build_array(jsonb_build_object(
     'pointId', null,
     'point', jsonb_build_object('category', 'decision', 'title', 'Stray', 'statement', 'A claim cited only from another source',
                                 'attributes', '{}'::jsonb, 'inferenceRationale', null),
     'citations', jsonb_build_array(
       jsonb_build_object('messageId', tests.msg('ys', 'alice', 2), 'quote', 'message 2 about the bank account', 'quoteStart', 6, 'quoteEnd', 38))))),
  ('new_no_cites', jsonb_build_array(jsonb_build_object(
     'pointId', null,
     'point', jsonb_build_object('category', 'decision', 'title', 'Bare', 'statement', 'A claim with no citation at all',
                                 'attributes', '{}'::jsonb, 'inferenceRationale', null),
     'citations', '[]'::jsonb)));

-- ── DB-13: a chunk's point and its evidence commit together ─────────────────────
create temp table r as
  select public.pipeline_store_extract_chunk(tests.id('ex'), 1, 0, 4, 'everyone', '{"provider":"fake"}',
                                             (select val from chunk_entries where name = 'new_two_cites')) as v;
select tests.eq((select v ->> 'alreadyCommitted' from r), 'false', 'a new chunk is stored');
select tests.eq((select v #>> '{entries,0,inserted}' from r), 'true', 'the point is inserted');
select tests.eq((select (v #>> '{entries,0,citations}')::int from r), 2, 'both citations are attached');
select tests.put('P1', (select (v #>> '{entries,0,pointId}')::uuid from r));
select tests.eq(tests.points(), 1, 'one point');
select tests.eq(tests.links(), 2, 'two evidence links');
select tests.eq((select count(*)::int from public.evidence_quotes where handover_id = tests.id('h') and quote_check = 'pending'), 2,
                'citations are stored pending (verify_quotes decides)');
select tests.eq(tests.progress('ex'), 1, 'the checkpoint commits with the chunk');
select tests.eq((select extraction_run_id from public.handover_points where id = tests.id('P1')), tests.id('run'),
                'the point belongs to the claimed run');

-- idempotent on retry / lost response: the same chunk again is a no-op
select tests.eq(tests.try(tests.chunk_sql('ex', 1, 0, 4, (select val from chunk_entries where name = 'new_two_cites'))),
                'OK:{"entries": [], "alreadyCommitted": true}', 'a committed chunk is not stored twice');
select tests.eq(tests.points(), 1, 'still one point after the repeat');
select tests.eq(tests.links(), 2, 'still two links after the repeat');
select tests.throws(tests.chunk_sql('ex', 1, 2, 4, '[]'), 'BTVF0', 'chunks are stored in order (no gaps)');
select tests.throws(tests.chunk_sql('ex', 1, 4, 4, '[]'), 'BTVF0', 'the chunk index is bounded by the total');

-- no point without evidence: a new point whose only citation is outside the job's source is not inserted
truncate r;
insert into r select public.pipeline_store_extract_chunk(tests.id('ex'), 1, 1, 4, 'everyone', '{"provider":"fake"}',
                       (select val from chunk_entries where name = 'new_other_source_only') ||
                       (select val from chunk_entries where name = 'new_no_cites') ||
                       jsonb_build_array(jsonb_build_object('pointId', null,
                         'point', jsonb_build_object('category', 'decision', 'title', 'Inferred', 'statement',
                                                     'Meetings probably move to Fridays', 'attributes', '{}'::jsonb,
                                                     'inferenceRationale', 'Several messages plan Friday sessions'),
                         'citations', '[]'::jsonb)));
select tests.eq((select v #>> '{entries,0,pointId}' from r), null, 'no point for a claim without surviving evidence');
select tests.eq((select (v #>> '{entries,0,rejected}')::int from r), 1, 'the foreign citation is rejected');
select tests.eq((select v #>> '{entries,1,pointId}' from r), null, 'no point for a claim without any citation or rationale');
select tests.eq((select v #>> '{entries,2,inserted}' from r), 'true', 'an inferred claim (rationale, no citation) is kept (§12.10)');
select tests.eq((select inference_rationale from public.handover_points where id = (select (v #>> '{entries,2,pointId}')::uuid from r)),
                'Several messages plan Friday sessions', 'with its rationale');
select tests.eq(tests.points(), 2, 'only the inferred point was added; no evidence-less sourced point');
select tests.eq(tests.quotes(), 2, 'no orphan quote was persisted');
select tests.eq(tests.progress('ex'), 2, 'the chunk still counts as done');

-- atomic failure: one bad entry rolls back the whole chunk, including the valid point before it
select tests.throws(tests.chunk_sql('ex', 1, 2, 4,
                      (select val from chunk_entries where name = 'new_two_cites') ||
                      jsonb_build_array(jsonb_build_object('pointId', null,
                        'point', jsonb_build_object('category', 'not_a_category', 'title', 'X', 'statement', 'Y', 'attributes', '{}'::jsonb),
                        'citations', jsonb_build_array(jsonb_build_object('messageId', tests.msg('xs', 'carol', 1), 'quote', 'q',
                                                                          'quoteStart', null, 'quoteEnd', null))))),
                    '23514', 'an invalid candidate fails the chunk');
select tests.eq(tests.points(), 2, 'the failed chunk left no point behind');
select tests.eq(tests.links(), 2, 'the failed chunk left no evidence link behind');
select tests.eq(tests.quotes(), 2, 'the failed chunk left no orphan quote behind');
select tests.eq(tests.progress('ex'), 2, 'the failed chunk did not move the checkpoint');

-- malformed and cross-handover entries
select tests.throws(tests.chunk_sql('ex', 1, 2, 4, jsonb_build_array(jsonb_build_object('pointId', tests.id('P1'),
                      'point', jsonb_build_object('category', 'decision'), 'citations', '[]'::jsonb))),
                    'BTVF0', 'an entry has exactly one of pointId and point');
select tests.throws(tests.chunk_sql('ex', 1, 2, 4, jsonb_build_array(jsonb_build_object('pointId', tests.id('Q'),
                      'citations', jsonb_build_array(jsonb_build_object('messageId', tests.msg('xs', 'carol', 1), 'quote',
                                                     'cross handover quote', 'quoteStart', null, 'quoteEnd', null))))),
                    'BTFB0', 'a chunk cannot attach evidence to another handover''s point');
select tests.throws(tests.chunk_sql('ex', 1, 2, 4, '[]', 'reviewers_only'), 'BTCF0',
                    'a source access-level change since the read is a conflict');

-- merge into an existing point: evidence only
truncate r;
insert into r select public.pipeline_store_extract_chunk(tests.id('ex'), 1, 2, 4, 'everyone', '{"provider":"fake"}',
  jsonb_build_array(jsonb_build_object('pointId', tests.id('P1'), 'citations', jsonb_build_array(
    jsonb_build_object('messageId', tests.msg('xs', 'carol', 2), 'quote', 'message 2 about the bank account', 'quoteStart', 6, 'quoteEnd', 38)))));
select tests.eq((select v #>> '{entries,0,inserted}' from r), 'false', 'a merge inserts no point');
select tests.eq((select (v #>> '{entries,0,citations}')::int from r), 1, 'a merge attaches its citation');
select tests.eq(tests.links(), 3, 'three links now');
select tests.eq(tests.progress('ex'), 3, 'checkpoint after the merge chunk');

-- ── DB-12: stale claims are refused by every writer ─────────────────────────────
select tests.throws(tests.chunk_sql('ex', 99, 3, 4, '[]'), 'BTLL0', 'a stale attempt cannot store a chunk');
select tests.throws(format('select public.pipeline_set_job_provenance(%L, 2, %L)', tests.id('ex'), '{"provider":"fake"}'),
                    'BTLL0', 'a stale attempt cannot write provenance');
select public.pipeline_set_job_provenance(tests.id('ex'), 1, '{"provider":"fake","model":null}');
select tests.eq((select ai_provenance ->> 'provider' from public.processing_jobs where id = tests.id('ex')), 'fake',
                'the current claim writes provenance');
select tests.throws(format('select public.pipeline_record_quote_check(%L, 1, %L, %L)', tests.id('ex'),
                           (select id from public.evidence_quotes where handover_id = tests.id('h') limit 1), 'not_found'),
                    'BTFB0', 'an extract claim cannot record quote checks (stage scope)');
select tests.throws(tests.chunk_sql('ex_other', 0, 0, 1, '[]'), 'BTLL0', 'a queued (unclaimed) job cannot write');

-- lost lease: an expired lease refuses writes even before anyone reclaims the job
select tests.as_owner();
update public.processing_jobs set lease_expires_at = now() - interval '1 second', next_attempt_at = now() - interval '1 hour'
 where id = tests.id('ex');
select tests.as_service();
select tests.throws(tests.chunk_sql('ex', 1, 3, 4, '[]'), 'BTLL0', 'an expired lease cannot store a chunk');
-- reclaimed: the old attempt is refused, the new one may write and resumes at the checkpoint
truncate claimed;
insert into claimed select * from public.claim_ready_processing_jobs(10, 300);
select tests.eq((select attempt from claimed where id = tests.id('ex')), 2, 'the expired job is reclaimed as attempt 2');
select tests.eq((select claim_progress_done from public.processing_jobs where id = tests.id('ex')), 3,
                'the claim remembers the checkpoint it resumes from');
select tests.throws(tests.chunk_sql('ex', 1, 3, 4, '[]'), 'BTLL0', 'the superseded attempt is refused after the reclaim');
select tests.eq(tests.try(tests.chunk_sql('ex', 2, 3, 4, '[]')), 'OK:{"entries": [], "alreadyCommitted": false}',
                'the current attempt resumes at the checkpoint');

-- finished: a completed job's claim can no longer write
select tests.eq(public.complete_processing_job(tests.id('ex'), 2, 'succeeded'), 'succeeded', 'extract done');
select tests.throws(format('select public.pipeline_set_job_provenance(%L, 2, %L)', tests.id('ex'), '{"provider":"fake"}'),
                    'BTLL0', 'a finished job cannot write');
select tests.throws(tests.chunk_sql('ex', 2, 3, 4, '[]'), 'BTLL0', 'a finished job cannot store a chunk');

-- ── serialisation: a writer and a completion of the same claim never interleave ──
truncate claimed;
insert into claimed select * from public.claim_ready_processing_jobs(10, 300);
select tests.eq((select count(*)::int from claimed), 2, 'next: the second extract and the first source''s verify_quotes');
select tests.eq((select id from claimed where stage = 'extract'), tests.id('ex_other'), 'the second extract is claimed');
select tests.put('vq_x', (select id from claimed where stage = 'verify_quotes'));
select tests.eq((select source_id from claimed where stage = 'verify_quotes'), tests.id('xs'), 'for the extracted source');
select tests.as_owner(); -- dblink sessions are opened by the owner
do $$
declare
  r text;
begin
  -- the writer holds the claim; a completion waits, then sees the committed chunk
  perform tests.c_open('c1', 'service'); perform tests.c_open('c2', 'service');
  perform tests.c_exec('c1', 'begin');
  perform tests.ok(tests.c_try('c1', tests.chunk_sql('ex_other', 1, 0, 2, '[]')) like 'OK:%', 'the writer holds the claim');
  perform tests.c_send('c2', format('select public.complete_processing_job(%L, 1, %L, null, null, null, null, 1, 2)',
                                    tests.id('ex_other'), 'yield'));
  perform tests.ok(tests.c_blocked('c2'), 'the completion waits for the in-flight write');
  perform tests.c_exec('c1', 'commit');
  r := tests.c_result('c2');
  perform tests.eq(r, 'OK:queued', 'the completion runs after the write commits');
  perform tests.c_close('c1'); perform tests.c_close('c2');
end $$;
select tests.as_service();
-- E4: before the fix, the stored chunk checkpoint (1) made this yield look progress-free and cost an attempt
select tests.eq((select attempt from public.processing_jobs where id = tests.id('ex_other')), 0,
                'E4: a yield after a stored chunk keeps the attempt (progress measured from the claim)');

-- E4: a yield that made no progress since the claim is a retry (it consumes the attempt)
truncate claimed;
insert into claimed select * from public.claim_ready_processing_jobs(10, 300);
select tests.eq((select attempt from claimed where id = tests.id('ex_other')), 1, 'the yielded extract is claimed again');
select tests.eq((select claim_progress_done from public.processing_jobs where id = tests.id('ex_other')), 1,
                'it resumes from chunk 1');
select tests.eq(public.complete_processing_job(tests.id('ex_other'), 1, 'yield', null, null, null, null, 1, 2), 'queued',
                'a yield without new progress re-queues');
select tests.eq((select attempt from public.processing_jobs where id = tests.id('ex_other')), 1,
                'a yield without new progress consumes the attempt');
truncate claimed;
insert into claimed select * from public.claim_ready_processing_jobs(10, 300);
select tests.eq((select attempt from claimed where id = tests.id('ex_other')), 2, 'claimed as attempt 2');

select tests.as_owner(); -- dblink sessions are opened by the owner
do $$
declare
  r text;
begin
  -- the completion commits first; the in-flight writer of that claim then sees it and is refused
  perform tests.c_open('c1', 'service'); perform tests.c_open('c2', 'service');
  perform tests.c_exec('c1', 'begin');
  perform tests.eq(tests.c_try('c1', format('select public.complete_processing_job(%L, 2, %L)', tests.id('ex_other'), 'succeeded')),
                   'OK:succeeded', 'the completion runs in an open transaction');
  perform tests.c_send('c2', tests.chunk_sql('ex_other', 2, 1, 2, '[]'));
  perform tests.ok(tests.c_blocked('c2'), 'the writer waits for the completion');
  perform tests.c_exec('c1', 'commit');
  r := tests.c_result('c2');
  perform tests.eq(r, 'ERR:BTLL0', 'the writer is refused once the completion commits');
  perform tests.c_close('c1'); perform tests.c_close('c2');
end $$;
select tests.as_service();
select tests.eq(tests.progress('ex_other'), 1, 'the refused chunk moved nothing');

-- ── reaped: a job failed by the reaper cannot write ─────────────────────────────
truncate claimed;
insert into claimed select * from public.claim_ready_processing_jobs(10, 300);
select tests.put('vq_y', (select id from claimed where stage = 'verify_quotes' and source_id = tests.id('ys')));
select tests.as_owner();
update public.processing_jobs set attempt = max_attempts, lease_expires_at = now() - interval '1 minute' where id = tests.id('vq_y');
select tests.as_service();
select tests.eq((select count(*)::int from public.claim_ready_processing_jobs(10, 300)), 0, 'nothing else is ready');
select tests.eq((select status from public.processing_jobs where id = tests.id('vq_y')), 'failed', 'the reaper failed the job');
select tests.throws(format('select public.pipeline_record_quote_check(%L, 3, %L, %L)', tests.id('vq_y'),
                           (select id from public.evidence_quotes where source_id = tests.id('ys') limit 1), 'not_found'),
                    'BTLL0', 'a reaped job cannot record quote checks');

-- verify_quotes: the current claim writes, but only for its own source
select tests.as_owner();
insert into public.evidence_quotes (handover_id, kind, source_id, source_message_id, quote_text, quote_start, quote_end,
                                    message_sent_at, author_label, source_title, location, quote_check, access_level)
select m.handover_id, 'source_quote', m.source_id, m.id, 'Alice message 3 about', 0, 21, m.sent_at, 'Alice', 'Chat', m.location,
       'pending', 'everyone'
  from public.source_messages m where m.id = tests.msg('ys', 'alice', 3)
returning tests.put('yq', id);
select tests.as_service();
select public.pipeline_record_quote_check(tests.id('vq_x'), 1,
         (select id from public.evidence_quotes where source_message_id = tests.msg('xs', 'alice', 1)), 'exact');
select tests.eq((select quote_check from public.evidence_quotes where source_message_id = tests.msg('xs', 'alice', 1)), 'exact',
                'the current verify_quotes claim records its check');
select tests.throws(format('select public.pipeline_record_quote_check(%L, 1, %L, %L)', tests.id('vq_x'), tests.id('yq'), 'exact'),
                    'BTFB0', 'a verify_quotes claim cannot touch another source''s evidence');
select tests.throws(format('select public.pipeline_record_quote_check(%L, 1, %L, %L)', tests.id('vq_x'),
                           (select id from public.evidence_quotes where source_message_id = tests.msg('xs', 'bob', 1)), 'exact'),
                    'BTVF0', 'the fenced writer keeps the QA-M1 plausibility check');
select public.pipeline_record_quote_check(tests.id('vq_x'), 1,
         (select id from public.evidence_quotes where source_message_id = tests.msg('xs', 'bob', 1)), 'not_found');
select tests.eq(public.complete_processing_job(tests.id('vq_x'), 1, 'succeeded'), 'succeeded', 'verify_quotes done');

-- ── verify_support / analyze / prepare_review ───────────────────────────────────
truncate claimed;
insert into claimed select * from public.claim_ready_processing_jobs(10, 300);
select tests.put('vs', (select id from claimed where stage = 'verify_support'));
select tests.put('link', (select pe.id from public.point_evidence pe join public.evidence_quotes q on q.id = pe.evidence_id
                           where q.source_message_id = tests.msg('xs', 'alice', 1)));
select tests.throws(format('select public.pipeline_record_support_verdict(%L, 9, %L, %L, %L, null, %L, %L)', tests.id('vs'),
                           tests.id('link'), (select current_revision_id from public.handover_points where id = tests.id('P1')),
                           'supports', '{"provider":"fake"}',
                           sha256(convert_to('message 1 about the bank account', 'UTF8'))),
                    'BTLL0', 'a stale verify_support claim cannot record a verdict');
select public.pipeline_record_support_verdict(tests.id('vs'), 1, tests.id('link'),
         (select current_revision_id from public.handover_points where id = tests.id('P1')), 'supports', null,
         '{"provider":"fake"}', sha256(convert_to('message 1 about the bank account', 'UTF8')));
select tests.eq((select support_verdict from public.point_evidence where id = tests.id('link')), 'supports',
                'the current verify_support claim records its verdict');
select tests.eq(public.complete_processing_job(tests.id('vs'), 1, 'succeeded'), 'succeeded', 'verify_support done');

truncate claimed;
insert into claimed select * from public.claim_ready_processing_jobs(10, 300);
select tests.put('an', (select id from claimed where stage = 'analyze'));
select tests.throws(format('select public.pipeline_create_system_gap_question(%L, 0, null, %L, %L, null, %L, %L)', tests.id('an'),
                           'owner', 'Who owns the bank account?', 'required', 'everyone'),
                    'BTLL0', 'a stale analyze claim cannot create questions');
select tests.ok(public.pipeline_create_system_gap_question(tests.id('an'), 1, null, 'owner', 'Who owns the bank account?', null,
                  'required', 'everyone') is not null, 'the current analyze claim creates a question');
select tests.eq((select handover_id from public.gap_questions where question = 'Who owns the bank account?'), tests.id('h'),
                'the question lands in the job''s handover');
select tests.throws(format('select public.pipeline_set_point_sort_keys(%L, 1, %L)', tests.id('an'), '[]'), 'BTFB0',
                    'analyze may not set sort keys (stage scope)');
select tests.eq(public.complete_processing_job(tests.id('an'), 1, 'succeeded'), 'succeeded', 'analyze done');

truncate claimed;
insert into claimed select * from public.claim_ready_processing_jobs(10, 300);
select tests.put('pr', (select id from claimed where stage = 'prepare_review'));
select tests.eq(public.pipeline_set_point_sort_keys(tests.id('pr'), 1,
                  jsonb_build_array(jsonb_build_object('pointId', tests.id('P1'), 'sortKey', 7),
                                    jsonb_build_object('pointId', tests.id('Q'), 'sortKey', 8))), 1,
                'sort keys apply only to the job''s handover');
select tests.eq((select sort_key from public.handover_points where id = tests.id('Q')), 0::double precision,
                'another handover''s point is untouched');

-- run cancelled: every claim of the run is stale
select tests.as_user('ann');
select public.cancel_processing(tests.actor(), tests.id('h'));
select tests.as_service();
select tests.throws(format('select public.pipeline_set_point_sort_keys(%L, 1, %L)', tests.id('pr'), '[]'), 'BTLL0',
                    'a cancelled run''s claim cannot write');
select tests.throws(format('select public.pipeline_create_system_gap_question(%L, 1, null, %L, %L, null, %L, %L)', tests.id('pr'),
                           'owner', 'Late question?', 'required', 'everyone'),
                    'BTLL0', 'a cancelled run''s claim cannot create questions');

-- ── parse: fenced persist / mark-failed on a third handover ─────────────────────
select tests.as_owner();
select tests.handover('h3', 'ann', 'outgoing');
insert into public.sources (handover_id, uploaded_by, kind, title, original_filename, mime_type, size_bytes, sha256, state,
                            access_level, timezone, raw_storage_path, consent_statement_version, consent_ai_provider,
                            consent_recorded_at, consent_recorded_by)
values (tests.id('h3'), tests.id('ann'), 'whatsapp_export', 'Upload', 'up.txt', 'text/plain', 10,
        sha256('up3'::bytea), 'uploaded', 'everyone', 'Asia/Kolkata', 'raw/h3/up', 'v1', 'fake', now(), tests.id('ann'))
returning tests.put('up3', id);
select tests.as_user('ann');
select tests.put('run3', public.start_processing(tests.actor(), tests.id('h3'), 'pv-test', '{"provider":"fake"}'::jsonb,
  jsonb_build_array(jsonb_build_object('stage', 'parse', 'sourceId', tests.id('up3'), 'inputHash', md5('p3')))));
select tests.as_service();
truncate claimed;
insert into claimed select * from public.claim_ready_processing_jobs(10, 300);
select tests.put('parse3', (select id from claimed));
select tests.throws(format('select public.pipeline_mark_source_parse_failed(%L, 5, %L)', tests.id('parse3'), 'parse_failed'),
                    'BTLL0', 'a stale parse claim cannot fail the source');
select tests.eq((select state from public.sources where id = tests.id('up3')), 'uploaded', 'the source is untouched');
select tests.throws(format('select public.pipeline_persist_parsed_source(%L, 5, %L, %L)', tests.id('parse3'), '{}', 'p1'),
                    'BTLL0', 'a stale parse claim cannot persist a parse');
select public.pipeline_mark_source_parse_failed(tests.id('parse3'), 1, 'parse_failed');
select tests.eq((select state from public.sources where id = tests.id('up3')), 'failed', 'the current parse claim fails the source');
select tests.throws(format('select public.pipeline_store_extract_chunk(%L, 1, 0, 1, %L, %L, %L)', tests.id('parse3'),
                           'everyone', '{}', '[]'), 'BTFB0', 'a parse claim cannot store extraction chunks');

-- ── QA-R3-01: a run needs at least one job (migration 20261113300400) ───────────
select tests.as_owner();
select tests.handover('h4', 'ann', 'outgoing');
select tests.source('h4', 's4');
select tests.as_user('ann');
select tests.throws(format('select public.start_processing(tests.actor(), %L, %L, %L, %L)', tests.id('h4'), 'pv', '{"provider":"fake"}', '[]'),
                    'BTVF0', 'an empty job list is refused');
select tests.throws(format('select public.start_processing(tests.actor(), %L, %L, %L, null)', tests.id('h4'), 'pv', '{"provider":"fake"}'),
                    'BTVF0', 'a missing job list is refused');
select tests.throws(format('select public.start_processing(tests.actor(), %L, %L, %L, %L)', tests.id('h4'), 'pv', '{"provider":"fake"}', '{}'),
                    'BTVF0', 'a non-array job list is refused');
select tests.eq((select count(*)::int from public.processing_runs where handover_id = tests.id('h4')), 0, 'no run was created');
select tests.eq((select state from public.handovers where id = tests.id('h4')), 'draft', 'the handover stays a draft');
select tests.throws(format('select public.start_processing(tests.actor(), %L, %L, null, %L)', tests.id('h4'), 'pv', '[]'),
                    'BTVF0', 'earlier validation still answers first (provider required)');
select tests.ok(public.start_processing(tests.actor(), tests.id('h4'), 'pv', '{"provider":"fake"}',
                  jsonb_build_array(jsonb_build_object('stage', 'extract', 'sourceId', tests.id('s4'), 'inputHash', md5('e4')))) is not null,
                'a run with one job still starts');
