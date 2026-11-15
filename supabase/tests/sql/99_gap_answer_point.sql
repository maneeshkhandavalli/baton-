-- QA-UI3-G1: an accepted Gap Interview answer always reaches the handover (20261115100100_gap_answer_point.sql).
\set ON_ERROR_STOP 1

select tests.user(u) from unnest(array['ann', 'rev', 'inc', 'led']) u;
select tests.handover('h', 'ann', 'outgoing');
select tests.member('h', 'rev', 'reviewer');
select tests.member('h', 'inc', 'incoming');
select tests.member('h', 'led', 'lead');
select tests.source('h', 's');
select tests.set_state('h', 'in_review');
select tests.point('h', 'pA'); select tests.cite('pA', 's', 'alice', 1);

do $$
declare
  v_qlink uuid; v_qcat uuid; v_qlead uuid; v_qrej uuid; v_qfree uuid;
  v_a uuid; v_p uuid; v_n bigint; v_pub uuid;
begin
  perform tests.as_user('rev');
  v_qlink := public.create_gap_question(tests.actor(), tests.id('h'), tests.id('pA'), null, 'Who confirmed A?', null, 'optional');
  v_qcat  := public.create_gap_question(tests.actor(), tests.id('h'), null, 'blocker', 'Is anything blocked right now?', null, 'required');
  v_qlead := public.create_gap_question(tests.actor(), tests.id('h'), null, 'contact', 'Who is the sponsor contact?', null, 'optional', 'leads_only');
  v_qrej  := public.create_gap_question(tests.actor(), tests.id('h'), null, 'risk', 'What could go wrong?', null, 'optional');
  v_qfree := public.create_gap_question(tests.actor(), tests.id('h'), null, null, 'Anything else the next person should know?', null, 'optional');
  perform public.submit_gap_answers(tests.actor(), jsonb_build_array(
    jsonb_build_object('gapQuestionId', v_qlink, 'answerText', 'Kabir confirmed A in the leads call.'),
    jsonb_build_object('gapQuestionId', v_qcat,  'answerText', 'The second instalment waits for a GST invoice.'),
    jsonb_build_object('gapQuestionId', v_qlead, 'answerText', 'Farah at Orbitstack handles sponsorship.'),
    jsonb_build_object('gapQuestionId', v_qrej,  'answerText', 'Nothing at all, ever.'),
    jsonb_build_object('gapQuestionId', v_qfree, 'answerText', 'The lab key is with the front desk.')));
  perform tests.put('qlink', v_qlink); perform tests.put('qcat', v_qcat); perform tests.put('qlead', v_qlead);
  perform tests.put('qrej', v_qrej); perform tests.put('qfree', v_qfree);
  -- A second person answers the same category question before anyone reviews (both stay 'submitted').
  perform tests.as_user('ann');
  perform public.submit_gap_answers(tests.actor(), jsonb_build_array(jsonb_build_object('gapQuestionId', v_qcat, 'answerText', 'Also: the venue form needs the Dean''s signature.')));
  perform tests.as_owner();

  select count(*) into v_n from public.handover_points where handover_id = tests.id('h');
  perform tests.eq(v_n, 1::bigint, 'setup: one point');

  -- 1. Linked question: the testimony goes to the existing point; no new point.
  perform tests.as_user('ann');
  select id into v_a from public.gap_answers where gap_question_id = v_qlink;
  perform public.review_gap_answer(tests.actor(), v_a, 'accept');
  perform tests.as_owner();
  perform tests.eq((select count(*) from public.handover_points where handover_id = tests.id('h')), 1::bigint, 'linked: no new point');
  perform tests.ok(exists (select 1 from public.point_evidence pe join public.evidence_quotes q on q.id = pe.evidence_id
                           where pe.point_id = tests.id('pA') and q.gap_answer_id = v_a), 'linked: testimony on pA');

  -- 2. Unlinked category question: a pending gap_answer point with the testimony; the question is linked to it.
  perform tests.as_user('ann');
  select id into v_a from public.gap_answers where gap_question_id = v_qcat and answer_text like 'The second instalment%';
  perform public.review_gap_answer(tests.actor(), v_a, 'accept', 'Thanks');
  perform tests.as_owner();
  select point_id into v_p from public.gap_questions where id = v_qcat;
  perform tests.ok(v_p is not null, 'unlinked: question now linked to a point');
  perform tests.put('pG', v_p);
  perform tests.eq((select origin from public.handover_points where id = v_p), 'gap_answer', 'unlinked: origin gap_answer');
  perform tests.eq((select category from public.handover_points where id = v_p), 'blocker', 'unlinked: question category');
  perform tests.eq((select review_state from public.handover_points where id = v_p), 'pending', 'unlinked: pending review');
  perform tests.eq((select evidence_status from public.handover_points where id = v_p), 'inferred', 'unlinked: testimony without a check is inferred');
  perform tests.eq((select r.statement from public.handover_points p join public.point_revisions r on r.id = p.current_revision_id where p.id = v_p),
                   'The second instalment waits for a GST invoice.', 'unlinked: statement is the answer');
  perform tests.eq((select r.title from public.handover_points p join public.point_revisions r on r.id = p.current_revision_id where p.id = v_p),
                   'Is anything blocked right now?', 'unlinked: title is the question');
  perform tests.ok(exists (select 1 from public.point_evidence pe join public.evidence_quotes q on q.id = pe.evidence_id
                           where pe.point_id = v_p and q.gap_answer_id = v_a and q.kind = 'testimony'), 'unlinked: testimony linked');
  perform tests.eq((select status from public.gap_questions where id = v_qcat), 'answered', 'unlinked: question answered');

  -- 3. A second accepted answer to the same question attaches to the SAME point (no duplicate).
  perform tests.as_user('ann');
  select id into v_a from public.gap_answers where gap_question_id = v_qcat and status = 'submitted';
  perform public.review_gap_answer(tests.actor(), v_a, 'accept');
  perform tests.as_owner();
  perform tests.eq((select count(*) from public.handover_points where origin = 'gap_answer' and category = 'blocker' and handover_id = tests.id('h')),
                   1::bigint, 'second answer: still one point');
  perform tests.eq((select count(*) from public.point_evidence where point_id = v_p), 2::bigint, 'second answer: two testimonies on it');

  -- 4. Rejected answers are never published: no evidence, no point.
  perform tests.as_user('ann');
  select id into v_a from public.gap_answers where gap_question_id = v_qrej;
  perform public.review_gap_answer(tests.actor(), v_a, 'reject', 'Not useful');
  perform tests.as_owner();
  perform tests.ok(not exists (select 1 from public.evidence_quotes where gap_answer_id = v_a), 'rejected: no testimony');
  perform tests.ok((select point_id from public.gap_questions where id = v_qrej) is null, 'rejected: no point');

  -- 5. Leads-only question: its point is leads-only too.
  perform tests.as_user('ann');
  select id into v_a from public.gap_answers where gap_question_id = v_qlead;
  perform public.review_gap_answer(tests.actor(), v_a, 'accept');
  perform tests.as_owner();
  select point_id into v_p from public.gap_questions where id = v_qlead;
  perform tests.put('pL', v_p);
  perform tests.eq((select access_level from public.handover_points where id = v_p), 'leads_only', 'leads-only: point inherits the level');

  -- 6. Uncategorised question: falls back to next_action.
  perform tests.as_user('ann');
  select id into v_a from public.gap_answers where gap_question_id = v_qfree;
  perform public.review_gap_answer(tests.actor(), v_a, 'accept');
  perform tests.as_owner();
  perform tests.put('pF', (select point_id from public.gap_questions where id = v_qfree));
  perform tests.eq((select category from public.handover_points where id = tests.id('pF')), 'next_action', 'uncategorised: next_action');

  -- 7. Publishing is blocked while the new points are pending (no bypass), then includes them once approved.
  perform tests.as_user('ann');
  perform tests.throws(format('select public.publish_handover(tests.actor(), %L)', tests.id('h')), 'BTPF0', 'publish refuses while gap points are pending');
  perform public.approve_point(tests.actor(), tests.id('pA'), (select current_revision_id from public.handover_points where id = tests.id('pA')), true);
  foreach v_p in array array[tests.id('pG'), tests.id('pL'), tests.id('pF')] loop
    perform public.approve_point(tests.actor(), v_p, (select current_revision_id from public.handover_points where id = v_p), true);
  end loop;
  v_pub := public.publish_handover(tests.actor(), tests.id('h'), 'With gap answers');
  perform tests.put('pub', v_pub);
  perform tests.as_owner();
  perform tests.ok(exists (select 1 from public.publication_points where publication_id = v_pub and point_id = tests.id('pG')),
                   'published: the gap answer point is in the publication');
  perform tests.ok((select content::text from public.publication_points where publication_id = v_pub and point_id = tests.id('pG')) like '%GST invoice%',
                   'published: the answer text is in the snapshot');
end $$;

-- 8. Recipient visibility: the incoming member reads the everyone-level answer, not the leads-only one; the lead reads both.
do $$
begin
  perform tests.as_reader('inc');
  perform tests.ok(exists (select 1 from public.publication_points where point_id = tests.id('pG')), 'incoming sees the gap answer point');
  perform tests.ok(not exists (select 1 from public.publication_points where point_id = tests.id('pL')), 'incoming does not see the leads-only answer');
  perform tests.as_reader('led');
  perform tests.ok(exists (select 1 from public.publication_points where point_id = tests.id('pL')), 'lead sees the leads-only answer');
  perform tests.as_owner();
end $$;

-- 9. Outside review, an answer to a question without a point is refused and nothing changes.
do $$
declare v_q uuid; v_a uuid; v_before bigint;
begin
  perform tests.as_user('ann');
  perform public.start_revision(tests.actor(), tests.id('h'));
  v_q := public.create_gap_question(tests.actor(), tests.id('h'), null, 'risk', 'Any risk with the printer?', null, 'optional');
  perform public.submit_gap_answers(tests.actor(), jsonb_build_array(jsonb_build_object('gapQuestionId', v_q, 'answerText', 'The nozzle jams.')));
  perform tests.as_owner();
  perform tests.set_state('h', 'approved');
  select id into v_a from public.gap_answers where gap_question_id = v_q;
  select count(*) into v_before from public.handover_points where handover_id = tests.id('h');
  perform tests.as_user('ann');
  perform tests.throws(format($q$select public.review_gap_answer(tests.actor(), %L, 'accept')$q$, v_a), 'BTIT0', 'not in review: refused');
  perform tests.as_owner();
  perform tests.eq((select status from public.gap_answers where id = v_a), 'submitted', 'not in review: answer untouched');
  perform tests.eq((select count(*) from public.handover_points where handover_id = tests.id('h')), v_before, 'not in review: no point');
end $$;

select 'ok' as gap_answer_point;
