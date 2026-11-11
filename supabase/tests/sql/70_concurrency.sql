-- Concurrency tests (§5.5 T1–T16), with real concurrent sessions through dblink. Each race asserts that
-- the second session really blocked on a lock before the first committed.
\set ON_ERROR_STOP 1

select tests.user(u) from unnest(array['ann', 'rev', 'inc1', 'inc2']) u;

-- Fixture: handover <p>h with points <p>A and <p>B sharing one gap-answer testimony <p>T (answer <p>aS to a
-- question on A). Optionally published (with incoming members inc1 and inc2). Then both are flagged.
create function tests.shared_pair(p text, p_publish boolean default false) returns void language plpgsql as $$
declare
  v_q uuid; v_a uuid; v_t uuid; r uuid;
begin
  perform tests.handover(p || 'h', 'ann', 'outgoing');
  perform tests.member(p || 'h', 'rev', 'reviewer');
  perform tests.source(p || 'h', p || 's');
  perform tests.set_state(p || 'h', 'in_review');
  perform tests.point(p || 'h', p || 'A'); perform tests.cite(p || 'A', p || 's', 'bob', 1);
  perform tests.point(p || 'h', p || 'B'); perform tests.cite(p || 'B', p || 's', 'bob', 2);
  insert into public.gap_questions (handover_id, point_id, question, priority, access_level, status)
  values (tests.id(p || 'h'), tests.id(p || 'A'), 'Who holds it?', 'optional', 'everyone', 'open') returning id into v_q;
  insert into public.gap_answers (handover_id, gap_question_id, answered_by_profile_id, answer_text, answerer_label, status)
  values (tests.id(p || 'h'), v_q, tests.id('rev'), 'Original shared answer', 'Rev', 'accepted') returning id into v_a;
  insert into public.evidence_quotes (handover_id, kind, gap_answer_id, quote_text, quote_check, access_level)
  values (tests.id(p || 'h'), 'testimony', v_a, '', 'exact', 'everyone') returning id into v_t;
  for r in select unnest(array[tests.id(p || 'A'), tests.id(p || 'B')]) loop
    insert into public.point_evidence (handover_id, point_id, evidence_id, support_verdict, verified_revision_id, verifier_provenance, verified_at)
    select tests.id(p || 'h'), r, v_t, 'supports', current_revision_id, '{}', now() from public.handover_points where id = r;
  end loop;
  perform tests.put(p || 'q', v_q); perform tests.put(p || 'aS', v_a); perform tests.put(p || 'T', v_t);
  if p_publish then
    perform tests.member(p || 'h', 'inc1', 'incoming');
    perform tests.member(p || 'h', 'inc2', 'incoming');
    perform tests.approve_all(p || 'h');
    perform tests.as_user('ann');
    perform tests.put(p || 'pub', public.publish_handover(tests.actor(), tests.id(p || 'h')));
    perform tests.as_owner();
  end if;
end $$;

create function tests.flag(p_point text) returns void language plpgsql as $$
begin
  perform set_config('baton.erasure', 'on', true);
  perform public._flag_point_for_privacy(tests.id(p_point), 'participant_erasure');
  perform set_config('baton.erasure', 'off', true);
end $$;

-- Decision payload from the review set as `rev` sees it now. Stored in tests.kv by the caller.
create function tests.payload(p_point text, p_decision text, p_rules jsonb) returns jsonb language plpgsql as $$
declare
  d jsonb;
begin
  perform tests.as_reader('rev');
  d := public.api_get_point(tests.id(p_point));
  perform tests.as_owner();
  return jsonb_build_object(
    'expectedRevisionId', d ->> 'current_revision_id', 'decision', p_decision,
    'digest', d -> 'privacy_review_set' ->> 'digest',
    'surfaces', coalesce((select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
        'kind', s ->> 'kind', 'id', s ->> 'id', 'decision', coalesce(p_rules ->> (s ->> 'kind'), 'keep'),
        'replacement', case p_rules ->> (s ->> 'kind') when 'redact' then
          case s ->> 'kind' when 'gap_answer' then jsonb_build_object('answerText', 'Redacted by ' || p_point)
                            when 'review_note' then jsonb_build_object('note', coalesce(p_rules ->> 'note_text', 'n'))
                            when 'gap_question' then jsonb_build_object('question', 'Redacted?') end end)))
      from jsonb_array_elements(d -> 'privacy_review_set' -> 'surfaces') s where s ->> 'kind' <> 'point'), '[]'::jsonb));
end $$;

-- SQL text that resolves p_point with stored payload p_key, as service_role in a dblink session.
create function tests.resolve_sql(p_point text, p_key text) returns text language sql as $$
  select format('select public.resolve_privacy_review(%L, %L, %L, %L)::text',
                tests.id(p_point), tests.kv(p_key) - 'digest', tests.kv(p_key) ->> 'digest', tests.id('rev'))
$$;

grant execute on all functions in schema tests to anon, authenticated, service_role;

-- ═════ T1: A and B share an answer; both redact it concurrently ══════════════
select tests.shared_pair('t1');
select tests.flag('t1A'); select tests.flag('t1B');
select tests.kv_put('t1A', tests.payload('t1A', 'keep', '{"gap_answer":"redact"}'));
select tests.kv_put('t1B', tests.payload('t1B', 'keep', '{"gap_answer":"redact"}'));
do $$
declare
  r1 text; r2 text;
begin
  perform tests.c_open('c1', 'service'); perform tests.c_open('c2', 'service');
  perform tests.c_exec('c1', 'begin');
  r1 := tests.c_try('c1', tests.resolve_sql('t1A', 't1A'));
  perform tests.ok(r1 like 'OK:%', 'T1: first resolution runs: ' || r1);
  perform tests.c_send('c2', tests.resolve_sql('t1B', 't1B'));
  perform tests.ok(tests.c_blocked('c2'), 'T1: second resolution waits for the handover lock');
  perform tests.c_exec('c1', 'commit');
  r2 := tests.c_result('c2');
  perform tests.eq(r2, 'ERR:BTCF0', 'T1: the second gets conflict');
  perform tests.c_close('c1'); perform tests.c_close('c2');
end $$;
do $$ begin
  perform tests.eq((select answer_text from public.gap_answers where id = tests.id('t1aS')), 'Redacted by t1A', 'T1: exactly one decision applied');
  perform tests.eq((select quote_text from public.evidence_quotes where id = tests.id('t1T')), 'Redacted by t1A', 'T1: testimony = answer');
  perform tests.eq((select privacy_review from public.handover_points where id = tests.id('t1B')), 'required', 'T1: B stays required');
  perform tests.ok(tests.kv('t1B') ->> 'digest' <> (tests.payload('t1B', 'keep', '{}') ->> 'digest'), 'T1: B has a new digest');
end $$;

-- ═════ T3: A removes the shared answer, then B (stale digest) submits redact ═
select tests.shared_pair('t3');
select tests.flag('t3A'); select tests.flag('t3B');
select tests.kv_put('t3B', tests.payload('t3B', 'keep', '{"gap_answer":"redact"}'));
select tests.kv_put('t3A', tests.payload('t3A', 'keep', '{"gap_answer":"remove"}'));
do $$ begin
  perform tests.c_open('c1', 'service');
  perform tests.ok(tests.c_try('c1', tests.resolve_sql('t3A', 't3A')) like 'OK:%', 'T3: removal commits');
  perform tests.eq(tests.c_try('c1', tests.resolve_sql('t3B', 't3B')), 'ERR:BTCF0', 'T3: stale redact gets conflict');
  perform tests.c_close('c1');
  perform tests.ok(not exists (select 1 from public.evidence_quotes where id = tests.id('t3T')), 'T3: testimony stays deleted');
  perform tests.eq((select answer_text from public.gap_answers where id = tests.id('t3aS')), '[removed]', 'T3: no text resurrected');
end $$;

-- ═════ T5: a token answer races a resolution that removes the question ═══════
select tests.shared_pair('t5');
select tests.flag('t5A');
do $$
declare v uuid;
begin
  insert into public.access_tokens (handover_id, created_by, purpose, token_hash, max_access_level, expires_at, max_uses)
  values (tests.id('t5h'), tests.id('ann'), 'gap_interview', sha256('t5-token'), 'everyone', now() + interval '1 day', 20) returning id into v;
  insert into public.access_token_questions (handover_id, token_id, gap_question_id) values (tests.id('t5h'), v, tests.id('t5q'));
end $$;
select tests.kv_put('t5A', tests.payload('t5A', 'keep', '{"gap_question":"remove"}'));
do $$
declare
  r text;
begin
  perform tests.c_open('c1', 'service'); perform tests.c_open('c2', 'service');
  perform tests.c_exec('c1', 'begin');
  perform tests.ok(tests.c_try('c1', tests.resolve_sql('t5A', 't5A')) like 'OK:%', 'T5: resolution runs');
  perform tests.c_send('c2', format($q$select public.submit_gap_answers_with_token(%L, 'Guest', %L)::text$q$, sha256('t5-token'),
                                    jsonb_build_array(jsonb_build_object('gapQuestionId', tests.id('t5q'), 'answerText', 'late'))));
  perform tests.ok(tests.c_blocked('c2'), 'T5: token answer waits');
  perform tests.c_exec('c1', 'commit');
  r := tests.c_result('c2');
  perform tests.eq(r, 'ERR:BTNF0', 'T5: then fails like an unknown question (now removed)');
  perform tests.c_close('c1'); perform tests.c_close('c2');
  perform tests.eq((select count(*) from public.gap_answers where gap_question_id = tests.id('t5q')), 1::bigint, 'T5: no silent extra surface');
end $$;

-- ═════ T6: verify_support writes a verdict while a resolution redacts the testimony ═
select tests.shared_pair('t6');
select tests.flag('t6A');
select tests.kv_put('t6A', tests.payload('t6A', 'keep', '{"gap_answer":"redact"}'));
do $$
declare
  v_link uuid; v_rev uuid; r text;
begin
  select id into v_link from public.point_evidence where evidence_id = tests.id('t6T') and point_id = tests.id('t6B');
  select current_revision_id into v_rev from public.handover_points where id = tests.id('t6B');
  perform tests.c_open('c1', 'service'); perform tests.c_open('c2', 'service');
  perform tests.c_exec('c1', 'begin');
  perform tests.ok(tests.c_try('c1', tests.resolve_sql('t6A', 't6A')) like 'OK:%', 'T6: resolution runs');
  -- the worker verified the OLD text
  perform tests.c_send('c2', format($q$select public.record_support_verdict(%L, %L, 'supports', 'r', '{}', %L)::text$q$,
                                    v_link, v_rev, sha256(convert_to('Original shared answer', 'UTF8'))));
  perform tests.ok(tests.c_blocked('c2'), 'T6: the worker waits');
  perform tests.c_exec('c1', 'commit');
  r := tests.c_result('c2');
  perform tests.eq(r, 'ERR:BTCF0', 'T6: verdict for replaced text refused');
  perform tests.c_close('c1'); perform tests.c_close('c2');
  perform tests.eq((select support_verdict from public.point_evidence where id = v_link), 'unchecked', 'T6: no verdict for replaced text');
end $$;

-- ═════ T7: failure half-way through a resolution rolls everything back ═══════
select tests.shared_pair('t7', true);
select tests.flag('t7A');
-- add a review note to A so the payload can fail on it after the answer has been redacted
do $$ begin
  insert into public.review_actions (handover_id, point_id, action, note) values (tests.id('t7h'), tests.id('t7A'), 'reopen', 'some note');
end $$;
select tests.kv_put('t7A', tests.payload('t7A', 'keep', '{"gap_answer":"redact","review_note":"redact","note_text":"   "}'));
do $$
declare
  v_before jsonb;
  v_after jsonb;
begin
  -- order surfaces so the answer is redacted first and the blank note fails afterwards
  perform tests.kv_put('t7A', jsonb_set(tests.kv('t7A'), '{surfaces}',
    (select jsonb_agg(s order by case s ->> 'kind' when 'gap_answer' then 0 else 1 end) from jsonb_array_elements(tests.kv('t7A') -> 'surfaces') s)));
  select jsonb_build_object(
    'answer', (select answer_text from public.gap_answers where id = tests.id('t7aS')),
    'testimony', (select quote_text from public.evidence_quotes where id = tests.id('t7T')),
    'flags', (select jsonb_agg(privacy_review order by id) from public.handover_points where handover_id = tests.id('t7h')),
    'rows', (select jsonb_agg(content || jsonb_build_object('hold', privacy_hold) order by id) from public.publication_points where handover_id = tests.id('t7h')),
    'pub', (select jsonb_agg(to_jsonb(p) order by id) from public.handover_publications p where handover_id = tests.id('t7h')),
    'actions', (select count(*) from public.review_actions where handover_id = tests.id('t7h')),
    'audit', (select count(*) from public.audit_logs where handover_id = tests.id('t7h')),
    'jobs', (select count(*) from public.processing_jobs where handover_id = tests.id('t7h')),
    'verdicts', (select jsonb_agg(support_verdict order by id) from public.point_evidence where handover_id = tests.id('t7h')))
  into v_before;
  perform tests.c_open('c1', 'service');
  perform tests.eq(tests.c_try('c1', tests.resolve_sql('t7A', 't7A')), 'ERR:BTVF0', 'T7: fails mid-way');
  perform tests.c_close('c1');
  select jsonb_build_object(
    'answer', (select answer_text from public.gap_answers where id = tests.id('t7aS')),
    'testimony', (select quote_text from public.evidence_quotes where id = tests.id('t7T')),
    'flags', (select jsonb_agg(privacy_review order by id) from public.handover_points where handover_id = tests.id('t7h')),
    'rows', (select jsonb_agg(content || jsonb_build_object('hold', privacy_hold) order by id) from public.publication_points where handover_id = tests.id('t7h')),
    'pub', (select jsonb_agg(to_jsonb(p) order by id) from public.handover_publications p where handover_id = tests.id('t7h')),
    'actions', (select count(*) from public.review_actions where handover_id = tests.id('t7h')),
    'audit', (select count(*) from public.audit_logs where handover_id = tests.id('t7h')),
    'jobs', (select count(*) from public.processing_jobs where handover_id = tests.id('t7h')),
    'verdicts', (select jsonb_agg(support_verdict order by id) from public.point_evidence where handover_id = tests.id('t7h')))
  into v_after;
  perform tests.eq(v_after, v_before, 'T7: full rollback');
end $$;

-- ═════ T8: erase_participant and resolve_privacy_review concurrently ═════════
select tests.shared_pair('t8');
select tests.cite('t8B', 't8s', 'carol', 1); -- carol's erasure will touch B
select tests.flag('t8A');
select tests.kv_put('t8A', tests.payload('t8A', 'keep', '{}'));
do $$
declare
  r text;
begin
  perform tests.c_open('c1', 'service'); perform tests.c_open('c2'); -- c2: owner (erasure has no app grant, H2)
  perform tests.c_exec('c1', 'begin');
  perform tests.ok(tests.c_try('c1', tests.resolve_sql('t8A', 't8A')) like 'OK:%', 'T8: resolution runs');
  perform tests.c_send('c2', format('select public.erase_participant(gen_random_uuid(), %L, ''phone'', %L, %L, null, %L)::text',
                                    tests.id('t8h'), sha256(convert_to('carol', 'UTF8')), 'p1', tests.id('ann')));
  perform tests.ok(tests.c_blocked('c2'), 'T8: erasure waits');
  perform tests.c_exec('c1', 'commit');
  r := tests.c_result('c2');
  perform tests.ok(r like 'OK:%', 'T8: erasure then completes: ' || r);
  perform tests.c_close('c1'); perform tests.c_close('c2');
  perform tests.eq((select privacy_review from public.handover_points where id = tests.id('t8A')), 'cleared', 'T8: resolution applied');
  perform tests.eq((select privacy_review from public.handover_points where id = tests.id('t8B')), 'required', 'T8: erasure applied after');
end $$;

-- ═════ T9: opposite-order resolutions never deadlock ═════════════════════════
select tests.shared_pair('t9');
select tests.flag('t9A'); select tests.flag('t9B');
select tests.kv_put('t9A', tests.payload('t9A', 'keep', '{}'));
select tests.kv_put('t9B', tests.payload('t9B', 'keep', '{}'));
do $$
declare
  r1 text; r2 text;
begin
  perform tests.c_open('c1', 'service'); perform tests.c_open('c2', 'service');
  -- autocommit: whichever takes the handover lock first commits, the other then proceeds
  perform tests.c_send('c1', tests.resolve_sql('t9B', 't9B'));
  perform tests.c_send('c2', tests.resolve_sql('t9A', 't9A'));
  r1 := tests.c_result('c1');
  r2 := tests.c_result('c2');
  perform tests.ok(r1 not like '%40P01%' and r2 not like '%40P01%', 'T9: no deadlock (' || r1 || ', ' || r2 || ')');
  perform tests.ok((r1 like 'OK:%' or r1 = 'ERR:BTCF0') and (r2 like 'OK:%' or r2 = 'ERR:BTCF0'), 'T9: both complete or conflict');
  perform tests.c_close('c1'); perform tests.c_close('c2');
end $$;

-- ═════ T10/T15: acknowledgement races a resolution that changes the current publication ═
-- (a) resolution first: the acknowledgement waits, then acknowledges the CHANGED publication.
select tests.shared_pair('ta', true);
select tests.flag('taA');
select tests.kv_put('taA', tests.payload('taA', 'keep', '{"gap_answer":"redact"}'));
do $$
declare
  r text;
begin
  perform tests.c_open('c1', 'service'); perform tests.c_open('c2', 'inc1');
  perform tests.c_exec('c1', 'begin');
  perform tests.ok(tests.c_try('c1', tests.resolve_sql('taA', 'taA')) like 'OK:%', 'T10a: resolution runs');
  perform tests.c_send('c2', format($q$select public.acknowledge_publication(tests.actor(), %L, 'v1')::text$q$, tests.id('tapub')));
  perform tests.ok(tests.c_blocked('c2'), 'T10a: acknowledgement waits');
  perform tests.c_exec('c1', 'commit');
  r := tests.c_result('c2');
  perform tests.ok(r like 'OK:%', 'T10a: acknowledgement commits after: ' || r);
  perform tests.c_close('c1'); perform tests.c_close('c2');
  perform tests.ok((select redacted_at is not null from public.handover_publications where id = tests.id('tapub')), 'T10a: publication had changed');
  perform tests.ok((select acknowledged_at > (select redacted_at from public.handover_publications where id = tests.id('tapub'))
                      from public.acknowledgements where publication_id = tests.id('tapub') and invalidated_at is null),
                   'T10a: the valid acknowledgement is of the changed publication');
end $$;
-- (b) acknowledgement first (the final one): it commits, then the resolution invalidates it and returns to approved.
select tests.shared_pair('tb', true);
do $$ begin
  perform tests.as_user('inc1'); perform public.acknowledge_publication(tests.actor(), tests.id('tbpub'), 'v1'); perform tests.as_owner();
end $$;
select tests.flag('tbA');
select tests.kv_put('tbA', tests.payload('tbA', 'keep', '{"gap_answer":"redact"}'));
do $$
declare
  r text;
begin
  perform tests.c_open('c1', 'inc2'); perform tests.c_open('c2', 'service');
  perform tests.c_exec('c1', 'begin');
  perform tests.ok(tests.c_try('c1', format($q$select public.acknowledge_publication(tests.actor(), %L, 'v1')::text$q$, tests.id('tbpub'))) like 'OK:%',
                   'T15b: final acknowledgement runs');
  perform tests.c_send('c2', tests.resolve_sql('tbA', 'tbA'));
  perform tests.ok(tests.c_blocked('c2'), 'T15b: resolution waits');
  perform tests.c_exec('c1', 'commit');
  r := tests.c_result('c2');
  perform tests.ok(r like 'OK:%', 'T15b: resolution commits after: ' || r);
  perform tests.c_close('c1'); perform tests.c_close('c2');
  perform tests.eq((select state from public.handovers where id = tests.id('tbh')), 'approved', 'T15b: never acknowledged on superseded content');
  perform tests.eq((select count(*) from public.acknowledgements where publication_id = tests.id('tbpub') and invalidated_at is null), 0::bigint,
                   'T15b: both acknowledgements invalidated');
end $$;

-- ═════ T12: two final acknowledgements at the same time ══════════════════════
select tests.shared_pair('tc', true);
do $$
declare
  r1 text; r2 text;
begin
  perform tests.c_open('c1', 'inc1'); perform tests.c_open('c2', 'inc2');
  perform tests.c_exec('c1', 'begin');
  r1 := tests.c_try('c1', format($q$select public.acknowledge_publication(tests.actor(), %L, 'v1')::text$q$, tests.id('tcpub')));
  perform tests.c_send('c2', format($q$select public.acknowledge_publication(tests.actor(), %L, 'v1')::text$q$, tests.id('tcpub')));
  perform tests.ok(tests.c_blocked('c2'), 'T12: second acknowledgement waits (FOR UPDATE first)');
  perform tests.c_exec('c1', 'commit');
  r2 := tests.c_result('c2');
  perform tests.ok(r1 like 'OK:%' and r2 like 'OK:%', 'T12: both commit (' || r1 || ', ' || r2 || ')');
  perform tests.c_close('c1'); perform tests.c_close('c2');
  perform tests.eq((select state from public.handovers where id = tests.id('tch')), 'acknowledged', 'T12: acknowledged');
  perform tests.eq((select count(*) from public.audit_logs where handover_id = tests.id('tch') and action = 'handover.transition'
                    and after ->> 'state' = 'acknowledged'), 1::bigint, 'T12: exactly one transition');
end $$;

-- ═════ T13: publish races erase_participant ══════════════════════════════════
-- (a) erasure first → publish recomputes readiness under its lock and refuses.
select tests.shared_pair('td');
select tests.cite('tdA', 'tds', 'carol', 1);
select tests.member('tdh', 'inc1', 'incoming');
select tests.approve_all('tdh');
do $$
declare
  r text;
begin
  perform tests.c_open('c1'); perform tests.c_open('c2', 'ann');
  perform tests.c_exec('c1', 'begin');
  perform tests.ok(tests.c_try('c1', format('select public.erase_participant(gen_random_uuid(), %L, ''phone'', %L, %L, null, %L)::text',
                   tests.id('tdh'), sha256(convert_to('carol', 'UTF8')), 'p1', tests.id('ann'))) like 'OK:%', 'T13a: erasure runs');
  perform tests.c_send('c2', format('select public.publish_handover(tests.actor(), %L)::text', tests.id('tdh')));
  perform tests.ok(tests.c_blocked('c2'), 'T13a: publish waits');
  perform tests.c_exec('c1', 'commit');
  r := tests.c_result('c2');
  perform tests.eq(r, 'ERR:BTPF0', 'T13a: publish refuses while a point is required');
  perform tests.c_close('c1'); perform tests.c_close('c2');
end $$;
-- (b) publish first → the erasure then redacts the new publication.
select tests.shared_pair('te');
select tests.cite('teA', 'tes', 'carol', 1);
select tests.member('teh', 'inc1', 'incoming');
select tests.approve_all('teh');
do $$
declare
  r text; v_pub uuid;
begin
  perform tests.c_open('c1', 'ann'); perform tests.c_open('c2');
  perform tests.c_exec('c1', 'begin');
  r := tests.c_try('c1', format('select public.publish_handover(tests.actor(), %L)::text', tests.id('teh')));
  perform tests.ok(r like 'OK:%', 'T13b: publish runs');
  v_pub := substr(r, 4)::uuid;
  perform tests.c_send('c2', format('select public.erase_participant(gen_random_uuid(), %L, ''phone'', %L, %L, null, %L)::text',
                                    tests.id('teh'), sha256(convert_to('carol', 'UTF8')), 'p1', tests.id('ann')));
  perform tests.ok(tests.c_blocked('c2'), 'T13b: erasure waits');
  perform tests.c_exec('c1', 'commit');
  perform tests.ok(tests.c_result('c2') like 'OK:%', 'T13b: erasure completes');
  perform tests.c_close('c1'); perform tests.c_close('c2');
  perform tests.ok(not exists (select 1 from public.publication_points pp, jsonb_array_elements(pp.content -> 'evidence') e
                                join public.evidence_quotes q on q.id = (e ->> 'evidenceId')::uuid
                                where pp.publication_id = v_pub and q.author_identity_hash = sha256(convert_to('carol', 'UTF8'))),
                   'T13b: no committed publication contains erased evidence');
  perform tests.ok((select bool_and(privacy_hold) from public.publication_points where publication_id = v_pub and point_id = tests.id('teA')),
                   'T13b: the partly affected row is held');
end $$;

-- ═════ T14: publish races resolve_privacy_review ═════════════════════════════
select tests.shared_pair('tf');
select tests.member('tfh', 'inc1', 'incoming');
select tests.approve_all('tfh');
select tests.flag('tfA');
select tests.kv_put('tfA', tests.payload('tfA', 'keep', '{}'));
do $$
declare
  r text;
begin
  perform tests.c_open('c1', 'service'); perform tests.c_open('c2', 'ann');
  perform tests.c_exec('c1', 'begin');
  perform tests.ok(tests.c_try('c1', tests.resolve_sql('tfA', 'tfA')) like 'OK:%', 'T14: resolution runs');
  perform tests.c_send('c2', format('select public.publish_handover(tests.actor(), %L)::text', tests.id('tfh')));
  perform tests.ok(tests.c_blocked('c2'), 'T14: publish waits');
  perform tests.c_exec('c1', 'commit');
  r := tests.c_result('c2');
  -- After "keep" the point is cleared but pending, so readiness (under the lock) still blocks.
  perform tests.eq(r, 'ERR:BTPF0', 'T14: publish uses the resolved state and never snapshots an unreviewed point');
  perform tests.c_close('c1'); perform tests.c_close('c2');
  perform tests.ok(not exists (select 1 from public.handover_publications where handover_id = tests.id('tfh')), 'T14: nothing published');
end $$;

-- ═════ T16: lock modes, then mixed load without deadlocks ════════════════════
select tests.shared_pair('tg', true);
do $$
declare
  v_pid int;
  v_mode text;
begin
  -- A child-row writer holds FOR SHARE; a parent-row writer must ask for FOR UPDATE (AccessExclusive tuple lock).
  perform tests.c_open('c1', 'rev'); perform tests.c_open('c2', 'inc1');
  perform tests.c_exec('c1', 'begin');
  perform tests.ok(tests.c_try('c1', format($q$select public.create_gap_question(tests.actor(), %L, null, 'owner', 'q?', null, 'optional')::text$q$,
                                            tests.id('tgh'))) like 'OK:%', 'T16: child writer runs');
  perform tests.ok(exists (select 1 from pg_locks l join pg_stat_activity a on a.pid = l.pid
                            where a.application_name = 'c1' and l.locktype = 'transactionid'), 'T16: child writer holds its xact');
  perform tests.c_send('c2', format($q$select public.acknowledge_publication(tests.actor(), %L, 'v1')::text$q$, tests.id('tgpub')));
  perform tests.ok(tests.c_blocked('c2'), 'T16: parent writer waits behind FOR SHARE');
  perform pg_stat_clear_snapshot();
  select a.pid into v_pid from pg_stat_activity a where a.application_name = 'c2';
  select l.mode into v_mode from pg_locks l where l.pid = v_pid and l.locktype = 'tuple'
     and l.relation = 'public.handovers'::regclass;
  perform tests.eq(v_mode, 'AccessExclusiveLock', 'T16: the parent writer''s first handover lock is FOR UPDATE');
  perform tests.c_exec('c1', 'commit');
  perform tests.ok(tests.c_result('c2') like 'OK:%', 'T16: parent writer completes');
  perform tests.c_close('c1'); perform tests.c_close('c2');
end $$;

-- Mixed load: child writers (exclude/restore evidence, gap questions), a parent writer (creator-transfer
-- offers) and a privacy function (no-op erasures) hammer one handover from four sessions.
select tests.set_state('tgh', 'in_review');
do $$
declare
  v_link uuid;
  v_member uuid;
  r text;
  i int;
  n_ok int := 0;
  n_deadlock int := 0;
  c text;
begin
  select id into v_link from public.point_evidence where point_id = tests.id('tgB') and evidence_id <> tests.id('tgT') limit 1;
  select id into v_member from public.handover_members where handover_id = tests.id('tgh') and profile_id = tests.id('rev');
  perform tests.c_open('m1', 'rev'); perform tests.c_open('m2', 'rev'); perform tests.c_open('m3', 'ann'); perform tests.c_open('m4');
  for i in 1..25 loop
    perform tests.c_send('m1', format($q$select public.exclude_evidence(tests.actor(), %L, %L, 'stress')::text$q$, tests.id('tgB'), v_link));
    perform tests.c_send('m2', format($q$select public.create_gap_question(tests.actor(), %L, null, 'risk', 'stress?', null, 'optional')::text$q$, tests.id('tgh')));
    perform tests.c_send('m3', format('select public.offer_creator_transfer(tests.actor(), %L, %L)::text', tests.id('tgh'), v_member));
    perform tests.c_send('m4', format('select public.erase_participant(gen_random_uuid(), %L, ''phone'', %L, %L, null, %L)::text',
                                      tests.id('tgh'), sha256(convert_to('nobody' || i, 'UTF8')), 'p1', tests.id('ann')));
    foreach c in array array['m1', 'm2', 'm3', 'm4'] loop
      r := tests.c_result(c);
      if r = 'ERR:40P01' then n_deadlock := n_deadlock + 1; elsif r like 'OK:%' then n_ok := n_ok + 1; end if;
    end loop;
    perform tests.c_send('m1', format('select public.restore_evidence(tests.actor(), %L, %L)::text', tests.id('tgB'), v_link));
    perform tests.c_result('m1');
  end loop;
  foreach c in array array['m1', 'm2', 'm3', 'm4'] loop perform tests.c_close(c); end loop;
  perform tests.eq(n_deadlock, 0, 'T16: zero deadlocks under mixed load');
  perform tests.ok(n_ok >= 75, 'T16: the load actually ran (' || n_ok || ' successful calls)');
end $$;

-- ═════ M4: job claim vs run close never deadlock (fixed order: jobs → run) ═══
create function tests.run_fixture(p text) returns uuid language plpgsql as $f$
declare
  v_run uuid;
begin
  perform tests.handover(p || 'h', 'ann', 'outgoing');
  perform tests.set_state(p || 'h', 'processing');
  insert into public.processing_runs (handover_id, status, source_ids, pipeline_version, ai_provider, ai_config)
  values (tests.id(p || 'h'), 'queued', '{}', '1', 'fake', '{}') returning id into v_run;
  insert into public.processing_jobs (handover_id, run_id, stage, input_hash, next_attempt_at)
  select tests.id(p || 'h'), v_run, s, '\x00', now() from unnest(array['extract', 'analyze', 'prepare_review']) s;
  return tests.put(p || 'run', v_run);
end $f$;
grant execute on all functions in schema tests to anon, authenticated, service_role;

select tests.run_fixture('m4a');
select tests.run_fixture('m4b');
do $$
declare
  r text;
begin
  -- (a) a worker claims jobs and holds its transaction; closing the run waits, then completes.
  perform tests.c_open('c1', 'service'); perform tests.c_open('c2', 'service');
  perform tests.c_exec('c1', 'begin');
  perform tests.ok(tests.c_try('c1', 'select count(*)::text from public.claim_processing_jobs(10, 60)') like 'OK:%', 'M4a: claim runs');
  perform tests.c_send('c2', format($q$select public.finish_processing_run(%L, 'failed', 'processing_failed', 'x')::text$q$, tests.id('m4arun')));
  perform tests.ok(tests.c_blocked('c2'), 'M4a: closing waits for the claim');
  perform tests.c_exec('c1', 'commit');
  r := tests.c_result('c2');
  perform tests.ok(r like 'OK:%', 'M4a: close completes without deadlock: ' || r);
  perform tests.c_close('c1'); perform tests.c_close('c2');
  perform tests.eq((select status from public.processing_runs where id = tests.id('m4arun')), 'failed', 'M4a: run closed');

  -- (b) closing holds its transaction; a concurrent claim skips the locked jobs and never deadlocks.
  perform tests.c_open('c1', 'service'); perform tests.c_open('c2', 'service');
  perform tests.c_exec('c1', 'begin');
  perform tests.ok(tests.c_try('c1', format($q$select public.finish_processing_run(%L, 'failed', 'processing_failed', 'x')::text$q$,
                                            tests.id('m4brun'))) like 'OK:%', 'M4b: close runs');
  perform tests.c_send('c2', 'select count(*)::text from public.claim_processing_jobs(10, 60)');
  perform pg_sleep(0.3);
  perform tests.c_exec('c1', 'commit');
  r := tests.c_result('c2');
  perform tests.ok(r like 'OK:%' and r <> 'ERR:40P01', 'M4b: claim completes without deadlock: ' || r);
  perform tests.c_close('c1'); perform tests.c_close('c2');
  perform tests.eq((select count(*) from public.processing_jobs where run_id = tests.id('m4brun') and status = 'running'), 0::bigint,
                   'M4b: no job of a closed run was claimed');
end $$;

select 'ok' as concurrency;
