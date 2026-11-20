-- Round 4 A (audit C5, C6): testimony reaches the publication snapshot with its date
-- (20261121300100_publish_testimony_evidence.sql).
\set ON_ERROR_STOP 1

select tests.user(u) from unnest(array['ann', 'inc']) u;
select tests.handover('h', 'ann', 'outgoing');
select tests.member('h', 'inc', 'incoming');
select tests.source('h', 's');
select tests.set_state('h', 'in_review');
select tests.point('h', 'pA'); select tests.cite('pA', 's', 'alice', 1);
select tests.point('h', 'pX'); select tests.cite('pX', 's', 'alice', 2, 'partial');

do $$
declare
  v_q uuid; v_a uuid; v_p uuid; v_pub uuid; v_ev jsonb; v_answered_at timestamptz; v_link uuid; v_content jsonb;
begin
  perform tests.as_user('ann');
  v_q := public.create_gap_question(tests.actor(), tests.id('h'), null, 'blocker', 'Is anything blocked right now?', null, 'required');
  perform public.submit_gap_answers(tests.actor(), jsonb_build_array(
    jsonb_build_object('gapQuestionId', v_q, 'answerText', 'The second instalment waits for a GST invoice.')));
  select id, created_at into v_a, v_answered_at from public.gap_answers where gap_question_id = v_q;
  perform public.review_gap_answer(tests.actor(), v_a, 'accept');
  select point_id into v_p from public.gap_questions where id = v_q;
  perform tests.put('pG', v_p);
  perform tests.as_owner();

  -- The link starts unchecked: no processing run has judged the testimony yet.
  perform tests.eq((select pe.support_verdict from public.point_evidence pe where pe.point_id = v_p), 'unchecked', 'setup: testimony unchecked');

  -- 1. The snapshot of an unchecked testimony point carries the testimony, dated with the answer, as supporting.
  v_content := public._build_publication_content(v_p);
  perform tests.eq(jsonb_array_length(v_content -> 'evidence'), 1, 'unchecked testimony: published');
  v_ev := v_content -> 'evidence' -> 0;
  perform tests.eq(v_ev ->> 'kind', 'testimony', 'kind testimony');
  perform tests.eq(v_ev ->> 'stance', 'supports', 'stance supports');
  perform tests.eq((v_ev ->> 'sentAt')::timestamptz, v_answered_at, 'dated with the answer time');
  perform tests.eq(v_ev ->> 'quote', 'The second instalment waits for a GST invoice.', 'answer text');
  perform tests.eq(v_content ->> 'evidenceStatus', 'inferred', 'evidence status unchanged (still inferred)');

  -- 2. Source quotations are unchanged: a partial verdict is still left out, a supports verdict is kept.
  perform tests.eq(jsonb_array_length(public._build_publication_content(tests.id('pX')) -> 'evidence'), 0, 'partial source quote: still left out');
  perform tests.eq(jsonb_array_length(public._build_publication_content(tests.id('pA')) -> 'evidence'), 1, 'supported source quote: kept');

  -- 3. Testimony the verifier rejected for the current wording is not published; contradicting stays contradicting.
  --    (Verdicts are recorded as verify_support records them: revision, provenance and time; see tests.cite.)
  select pe.id into v_link from public.point_evidence pe where pe.point_id = v_p;
  update public.point_evidence set support_verdict = 'irrelevant',
         verified_revision_id = (select current_revision_id from public.handover_points where id = v_p),
         verifier_provenance = '{"provider":"fake"}', verified_at = now()
   where id = v_link;
  perform tests.eq(jsonb_array_length(public._build_publication_content(v_p) -> 'evidence'), 0, 'irrelevant testimony: left out');
  update public.point_evidence set support_verdict = 'contradicts' where id = v_link;
  perform tests.eq(public._build_publication_content(v_p) -> 'evidence' -> 0 ->> 'stance', 'contradicts', 'contradicting testimony: contradicts');

  -- 4. A positive verdict for an earlier revision (the wording was edited after) still publishes the testimony.
  update public.point_evidence set support_verdict = 'supports' where id = v_link;
  perform tests.as_user('ann');
  perform public.edit_point(tests.actor(), v_p, (select current_revision_id from public.handover_points where id = v_p),
                            'Is anything blocked right now?', 'The second instalment waits for a GST invoice from the vendor.', '{}'::jsonb,
                            'Clearer wording');
  perform tests.as_owner();
  perform tests.ok((select verified_revision_id from public.point_evidence where id = v_link)
                   is distinct from (select current_revision_id from public.handover_points where id = v_p), 'setup: verdict is for the earlier revision');
  perform tests.eq(jsonb_array_length(public._build_publication_content(v_p) -> 'evidence'), 1, 'earlier-revision testimony: published');
  perform tests.eq(public._build_publication_content(v_p) -> 'evidence' -> 0 ->> 'stance', 'supports', 'earlier-revision testimony: supports');

  -- 5. End to end: the FIRST publication of the approved testimony point carries the dated testimony.
  perform tests.as_user('ann');
  perform public.approve_point(tests.actor(), tests.id('pA'), (select current_revision_id from public.handover_points where id = tests.id('pA')), true);
  perform public.reject_point(tests.actor(), tests.id('pX'), 'Not needed');
  perform public.approve_point(tests.actor(), v_p, (select current_revision_id from public.handover_points where id = v_p), true);
  v_pub := public.publish_handover(tests.actor(), tests.id('h'), 'First publish');
  perform tests.put('pub', v_pub);
  perform tests.as_owner();
  v_ev := (select content -> 'evidence' -> 0 from public.publication_points where publication_id = v_pub and point_id = v_p);
  perform tests.eq(v_ev ->> 'kind', 'testimony', 'v1: testimony in the first publication');
  perform tests.eq((v_ev ->> 'sentAt')::timestamptz, v_answered_at, 'v1: dated on first publish');
end $$;

-- 6. The incoming member reads the testimony in the first publication (RLS unchanged: everyone-level answer).
do $$
begin
  perform tests.as_reader('inc');
  perform tests.ok((select content -> 'evidence' -> 0 ->> 'kind' from public.publication_points
                     where publication_id = tests.id('pub') and point_id = tests.id('pG')) = 'testimony', 'incoming reads the testimony');
  perform tests.as_owner();
end $$;

select 'ok' as publish_testimony_evidence;
