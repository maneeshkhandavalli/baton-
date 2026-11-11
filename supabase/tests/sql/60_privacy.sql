-- Participant erasure (§12.8) and privacy review resolution (§5.5), single-session cases.
-- Concurrent cases (T1–T16) are in 70_concurrency.sql.
\set ON_ERROR_STOP 1

select tests.user(u) from unnest(array['ann', 'rev', 'inc']) u;
select tests.handover('h', 'ann', 'outgoing');
select tests.member('h', 'rev', 'reviewer');
select tests.member('h', 'inc', 'incoming');
select tests.source('h', 's');
select tests.set_state('h', 'in_review');

-- pX: only alice → X. pP, pT: alice + others → P. pU, pB: no alice.
select tests.point('h', 'pX'); select tests.cite('pX', 's', 'alice', 1);
select tests.point('h', 'pP'); select tests.cite('pP', 's', 'alice', 2); select tests.cite('pP', 's', 'bob', 1);
select tests.point('h', 'pT'); select tests.cite('pT', 's', 'alice', 3); select tests.cite('pT', 's', 'bob', 2);
select tests.point('h', 'pU'); select tests.cite('pU', 's', 'carol', 1);
select tests.point('h', 'pB'); select tests.cite('pB', 's', 'bob', 3);

-- pP gets an edit, so it has an earlier revision (revision surfaces, T11).
do $$
begin
  perform tests.as_user('rev');
  perform public.edit_point(tests.actor(), tests.id('pP'), (select current_revision_id from public.handover_points where id = tests.id('pP')),
                            'Edited P title', 'Edited P statement', '{}', 'Clarify the owner');
  perform tests.as_owner();
end $$;

-- Gap questions and testimony:
--   qX on pX, answered (aX); its testimony tX backs pB only  → pB is "extra" (step 3, last bullet).
--   qT on pT, answered (aT); its testimony tT backs pT and pU → shared evidence (§5.5).
do $$
declare
  v_qx uuid; v_qt uuid; v_ax uuid; v_at uuid; v_tx uuid; v_tt uuid; r uuid;
begin
  perform tests.as_user('rev');
  v_qx := public.create_gap_question(tests.actor(), tests.id('h'), tests.id('pX'), null, 'Who decided X?', 'context X', 'optional');
  v_qt := public.create_gap_question(tests.actor(), tests.id('h'), tests.id('pT'), null, 'Who decided T?', 'context T', 'optional');
  perform public.submit_gap_answers(tests.actor(), jsonb_build_array(jsonb_build_object('gapQuestionId', v_qx, 'answerText', 'Answer X by Rev')));
  perform public.submit_gap_answers(tests.actor(), jsonb_build_array(jsonb_build_object('gapQuestionId', v_qt, 'answerText', 'Answer T by Rev')));
  perform tests.as_owner();
  select id into v_ax from public.gap_answers where gap_question_id = v_qx;
  select id into v_at from public.gap_answers where gap_question_id = v_qt;
  update public.gap_answers set status = 'accepted' where id in (v_ax, v_at);
  insert into public.evidence_quotes (handover_id, kind, gap_answer_id, quote_text, author_label, quote_check, access_level)
  values (tests.id('h'), 'testimony', v_ax, '', 'Rev', 'exact', 'everyone') returning id into v_tx;
  insert into public.evidence_quotes (handover_id, kind, gap_answer_id, quote_text, author_label, quote_check, access_level)
  values (tests.id('h'), 'testimony', v_at, '', 'Rev', 'exact', 'everyone') returning id into v_tt;
  for r in select unnest(array[tests.id('pB')]) loop
    insert into public.point_evidence (handover_id, point_id, evidence_id, support_verdict, verified_revision_id, verifier_provenance, verified_at)
    select tests.id('h'), r, v_tx, 'supports', current_revision_id, '{}', now() from public.handover_points where id = r;
  end loop;
  for r in select unnest(array[tests.id('pT'), tests.id('pU')]) loop
    insert into public.point_evidence (handover_id, point_id, evidence_id, support_verdict, verified_revision_id, verifier_provenance, verified_at)
    select tests.id('h'), r, v_tt, 'supports', current_revision_id, '{}', now() from public.handover_points where id = r;
  end loop;
  perform tests.put('qX', v_qx); perform tests.put('qT', v_qt); perform tests.put('aX', v_ax); perform tests.put('aT', v_at);
  perform tests.put('tX', v_tx); perform tests.put('tT', v_tt);
end $$;

select tests.approve_all('h');
do $$
begin
  perform tests.as_user('ann');
  perform tests.put('pub', public.publish_handover(tests.actor(), tests.id('h'), 'Summary'));
  perform tests.as_user('inc');
  perform public.acknowledge_publication(tests.actor(), tests.id('pub'), 'ack-v1');
  perform tests.as_owner();
  perform tests.eq((select state from public.handovers where id = tests.id('h')), 'acknowledged', 'setup: acknowledged');
  perform tests.eq((select count(*) from public.publication_points where publication_id = tests.id('pub')), 5::bigint, 'setup: 5 rows');
end $$;

-- ── Erasure ──────────────────────────────────────────────────────────────────
do $$
declare
  v_report jsonb;
  v_alice bytea := sha256(convert_to('alice', 'UTF8'));
  v_e uuid[];
begin
  select array_agg(id) into v_e from public.evidence_quotes where author_identity_hash = v_alice;
  perform tests.as_service();
  perform tests.throws(format('select public.erase_participant(gen_random_uuid(), %L, ''phone'', %L, %L, null, %L)', tests.id('h'), v_alice, 'p1', tests.id('ann')),
                       '42501', 'H2: the service role cannot erase until the recovery manifest exists');
  -- The function's own checks, exercised by the database owner (the only role with EXECUTE):
  perform tests.as_owner();
  perform tests.throws(format('select public.erase_participant(gen_random_uuid(), %L, ''phone'', %L, %L, null, %L)', tests.id('h'), v_alice, 'p1', tests.id('rev')),
                       'BTFB0', 'only the creator erases');
  perform tests.throws(format('select public.erase_participant(gen_random_uuid(), %L, ''phone'', %L, %L, null, %L)', tests.id('h'), v_alice, 'p2', tests.id('ann')),
                       'BTVF0', 'pepper version must be p1');
  v_report := public.erase_participant('00000000-0000-4000-8000-0000000000e1', tests.id('h'), 'phone', v_alice, 'p1', null, tests.id('ann'));
  perform tests.as_owner();

  perform tests.eq((v_report ->> 'quotesDeleted')::int, 3, 'three alice quotes deleted');
  perform tests.eq((v_report ->> 'pointsErased')::int, 1, 'pX erased');
  perform tests.eq((v_report ->> 'pointsFlaggedForPrivacyReview')::int, 3, 'pP, pT and pB flagged');
  perform tests.eq((v_report ->> 'acknowledgementsInvalidated')::int, 1, 'acknowledgement invalidated');
  perform tests.ok(not exists (select 1 from public.evidence_quotes where author_identity_hash = v_alice), 'no quote keeps the hash');
  perform tests.ok(not exists (select 1 from public.source_messages m join public.source_participants sp on sp.id = m.participant_id
                                where sp.identity_hash = v_alice), 'alice''s messages deleted');
  perform tests.ok(not exists (select 1 from public.source_participants where identity_hash = v_alice and (not excluded or display_label <> 'Removed participant')),
                   'participant row relabelled and excluded');
  perform tests.ok(exists (select 1 from public.source_exclusions where kind = 'participant' and source_id is null and participant_identity_hash = v_alice),
                   'handover-wide exclusion recorded');

  -- X: tombstoned everywhere.
  perform tests.ok((select erased_at is not null from public.handover_points where id = tests.id('pX')), 'pX erased_at');
  perform tests.ok(not exists (select 1 from public.point_revisions where point_id = tests.id('pX') and redaction_kind is distinct from 'tombstone'),
                   'every pX revision tombstoned');
  perform tests.eq((select status || '/' || question from public.gap_questions where id = tests.id('qX')), 'waived/[removed]', 'pX question waived');
  perform tests.eq((select content from public.publication_points where point_id = tests.id('pX')), '{"redacted": true}'::jsonb, 'pX snapshot tombstoned');

  -- P and extra: held for review.
  perform tests.eq((select string_agg(privacy_review || '/' || review_state, ',' order by id) from public.handover_points
                     where id in (tests.id('pP'), tests.id('pT'), tests.id('pB'))), 'required/pending,required/pending,required/pending',
                   'P and extra points require privacy review');
  perform tests.ok((select bool_and(privacy_hold) from public.publication_points where point_id in (tests.id('pP'), tests.id('pT'), tests.id('pB'))),
                   'their publication rows are held');
  perform tests.ok(not exists (select 1 from public.publication_points pp, jsonb_array_elements(pp.content -> 'evidence') e
                                where (e ->> 'evidenceId')::uuid = any (v_e) and not (e ->> 'redacted')::boolean),
                   'no snapshot keeps an erased evidence item');
  -- pT's alice quote was published (pP's was not: its edit made the verdicts stale before publishing).
  perform tests.ok((select (content ->> 'evidenceRedacted')::boolean
                           and (content -> 'evidence' -> -1 ->> 'redacted')::boolean
                           and ((content -> 'evidence' -> -1) - 'evidenceId') = '{"redacted": true}'::jsonb
                      from public.publication_points where point_id = tests.id('pT')),
                   'evidenceRedacted set; redacted item moved to the end with nothing but its id');
  perform tests.ok((select summary is null and redacted_at is not null from public.handover_publications where id = tests.id('pub')),
                   'summary cleared');
  perform tests.eq((select state from public.handovers where id = tests.id('h')), 'approved', 'acknowledged → approved');
  perform tests.ok(not exists (select 1 from public.audit_logs where after::text like '%' || encode(v_alice, 'hex') || '%'), 'audit holds no hash');

  -- Idempotent replay of the same event.
  perform tests.as_owner();
  v_report := public.erase_participant('00000000-0000-4000-8000-0000000000e1', tests.id('h'), 'phone', v_alice, 'p1', null, tests.id('ann'));
  perform tests.ok((v_report ->> 'alreadyApplied')::boolean, 'second call is a no-op');
  perform tests.as_owner();

  -- Readers: held and erased rows vanish; frozen point; no publishing.
  perform tests.as_reader('inc');
  perform tests.eq((select count(*) from public.publication_points), 1::bigint, 'incoming sees only pU');
  perform tests.as_reader('rev');
  perform tests.ok(tests.read(format('select public.api_get_point(%L)', tests.id('pX'))) is null, 'erased point is not_found');
  perform tests.as_user('rev');
  perform tests.throws(format($q$select public.reject_point(tests.actor(), %L, 'x')$q$, tests.id('pP')), 'BTIT0', 'no review outside in_review');
  perform tests.as_user('ann');
  perform public.start_revision(tests.actor(), tests.id('h'));
  perform tests.as_user('rev');
  perform tests.throws(format($q$select public.reject_point(tests.actor(), %L, 'x')$q$, tests.id('pP')), 'BTPF0', 'a held point is frozen');
  perform public.change_point_access(tests.actor(), tests.id('pP'), 'leads_only'); -- raising is allowed during a hold
  perform tests.throws(format($q$select public.change_point_access(tests.actor(), %L, null)$q$, tests.id('pP')), 'BTPF0', 'lowering is refused during a hold');
  perform tests.ok(tests.read(format('select public.api_get_readiness(%L)', tests.id('h'))) -> 'blockers' @> '[{"kind":"privacy_review_required"}]', 'readiness blocked');
  perform tests.as_user('ann');
  perform tests.throws(format('select public.publish_handover(tests.actor(), %L)', tests.id('h')), 'BTPF0', 'publish refuses');
  perform tests.as_owner();
end $$;

-- Helper: build a decision payload from the current review set. p_rules maps surface kind → decision;
-- redact replacements are generated; p_point_decision applies to the point surface.
create function pg_temp.payload(p_point text, p_point_decision text, p_rules jsonb, p_redacted jsonb default null) returns jsonb
language plpgsql as $$
declare
  v_detail jsonb;
begin
  perform tests.as_reader('rev');
  v_detail := tests.read(format('select public.api_get_point(%L)', tests.id(p_point)));
  perform tests.as_owner();
  return jsonb_build_object(
    'expectedRevisionId', v_detail ->> 'current_revision_id',
    'decision', p_point_decision,
    'redacted', p_redacted,
    'digest', v_detail -> 'privacy_review_set' ->> 'digest',
    'surfaces', coalesce((
      select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
               'kind', s ->> 'kind', 'id', s ->> 'id',
               'decision', coalesce(p_rules ->> (s ->> 'kind'), 'keep'),
               'replacement', case when p_rules ->> (s ->> 'kind') = 'redact' then
                 case s ->> 'kind'
                   when 'revision' then '{"title":"Redacted","statement":"Redacted","attributes":{}}'::jsonb
                   when 'review_note' then '{"note":"Redacted note"}'::jsonb
                   when 'evidence_note' then '{"exclusionReason":"Redacted"}'::jsonb
                   when 'gap_question' then '{"question":"Redacted question?"}'::jsonb
                   when 'gap_answer' then '{"answerText":"Redacted answer"}'::jsonb
                 end end)))
        from jsonb_array_elements(v_detail -> 'privacy_review_set' -> 'surfaces') s
       where s ->> 'kind' <> 'point'), '[]'::jsonb));
end $$;

create function pg_temp.resolve(p_point text, p jsonb, p_digest text default null) returns jsonb language plpgsql as $$
declare v jsonb;
begin
  perform tests.as_service();
  v := public.resolve_privacy_review(tests.id(p_point), p - 'digest', coalesce(p_digest, p ->> 'digest'), tests.id('rev'));
  perform tests.as_owner();
  return v;
end $$;

-- ── Resolution guards (T4 and shape) ─────────────────────────────────────────
do $$
declare
  p jsonb := pg_temp.payload('pP', 'keep', '{}');
  v_actions bigint := (select count(*) from public.review_actions);
  v_audit bigint := (select count(*) from public.audit_logs);
begin
  perform tests.ok(jsonb_array_length(p -> 'surfaces') >= 2, 'pP review set has the earlier revision and the edit note');
  perform tests.throws(format('select pg_temp.resolve(%L, %L, %L)', 'pP', p, 'stale'), 'BTCF0', 'T4: stale digest → conflict');
  perform tests.throws(format('select pg_temp.resolve(%L, %L)', 'pP', jsonb_set(p, '{surfaces}', '[]')), 'BTCF0', 'missing decisions → conflict');
  perform tests.throws(format('select pg_temp.resolve(%L, %L)', 'pP', jsonb_set(p, '{decision}', '"withdraw"')), 'BTVF0',
                       'withdraw with a kept revision → validation_failed');
  perform tests.throws(format('select pg_temp.resolve(%L, %L)', 'pP', jsonb_set(p, '{decision}', '"redact"')), 'BTVF0',
                       'redact without replacement → validation_failed');
  perform tests.throws(format('select pg_temp.resolve(%L, %L)', 'pP', jsonb_set(p, '{expectedRevisionId}', to_jsonb(gen_random_uuid()::text))),
                       'BTCF0', 'stale revision → conflict');
  perform tests.eq((select count(*) from public.review_actions), v_actions, 'T4: no review action written');
  perform tests.eq((select count(*) from public.audit_logs), v_audit, 'T4: no audit row written');
  perform tests.eq((select privacy_review from public.handover_points where id = tests.id('pP')), 'required', 'T4: still required');
end $$;

-- ── pT: redact the shared answer → pU flagged, testimony rewritten, snapshots redacted ──
do $$
declare
  v jsonb;
begin
  v := pg_temp.resolve('pT', pg_temp.payload('pT', 'keep', '{"gap_answer":"redact"}'));
  perform tests.eq((v ->> 'pointsFlagged')::int, 1, 'pU flagged');
  perform tests.eq((select privacy_review from public.handover_points where id = tests.id('pT')), 'cleared', 'pT cleared');
  perform tests.eq((select privacy_review from public.handover_points where id = tests.id('pU')), 'required', 'pU now required');
  perform tests.eq((select metadata ->> 'reason' from public.review_actions where point_id = tests.id('pU') and action = 'privacy_hold'),
                   'linked_evidence_changed', 'reason recorded');
  perform tests.eq((select quote_text from public.evidence_quotes where id = tests.id('tT')), 'Redacted answer', 'testimony follows the answer');
  perform tests.ok(not exists (select 1 from public.point_evidence where evidence_id = tests.id('tT') and support_verdict <> 'unchecked'),
                   'every verdict on the testimony re-run');
  perform tests.ok(not exists (select 1 from public.publication_points pp, jsonb_array_elements(pp.content -> 'evidence') e
                                where e ->> 'evidenceId' = tests.id('tT')::text and not (e ->> 'redacted')::boolean),
                   'testimony redacted in every snapshot');
  perform tests.ok(not exists (select 1 from public.publication_points where point_id = tests.id('pT') and privacy_hold), 'pT rows released');
  perform tests.ok(not exists (select 1 from public.audit_logs where (coalesce(after, '{}'))::text like '%Answer T by Rev%'
                                or (coalesce(after, '{}'))::text like '%Redacted answer%'), 'audit holds no text');
end $$;

-- ── pP: redact the point, remove the earlier revision and the edit note (T11) ──
do $$
declare
  v jsonb;
begin
  v := pg_temp.resolve('pP', pg_temp.payload('pP', 'redact', '{"revision":"remove","review_note":"remove"}',
                                             '{"title":"Owner redacted","statement":"Someone holds the account","attributes":{}}'));
  perform tests.ok(v ->> 'newRevisionId' is not null, 'redact inserts a new revision');
  -- T11: the original text survives nowhere.
  perform tests.ok(not exists (select 1 from public.point_revisions where title in ('Title of pP', 'Edited P title')
                                or statement in ('Statement of pP', 'Edited P statement')), 'not in point_revisions');
  perform tests.ok(not exists (select 1 from public.publication_points where content::text like '%of pP%' or content::text like '%Edited P%'),
                   'not in any publication');
  perform tests.ok(not exists (select 1 from public.audit_logs where coalesce(before, '{}')::text || coalesce(after, '{}')::text like '%of pP%'),
                   'not in audit');
  perform tests.ok(not exists (select 1 from public.review_actions where note like '%Clarify the owner%'), 'edit note removed');
  perform tests.as_reader('rev');
  perform tests.ok((select bool_and(r ->> 'title' not like '%of pP%' and r ->> 'title' not like 'Edited P%')
                      from jsonb_array_elements(tests.read(format('select public.api_get_point(%L)', tests.id('pP'))) -> 'revisions') r), 'not in PointDetail.revisions');
  perform tests.as_owner();
  perform tests.ok((select (content ->> 'textRedacted')::boolean and content ->> 'title' = 'Owner redacted'
                      from public.publication_points where point_id = tests.id('pP')), 'snapshot shows the replacement');
end $$;

-- ── pU: withdraw; pB: keep ───────────────────────────────────────────────────
do $$
declare
  v_q uuid;
  v_t uuid;
begin
  -- M2 setup: an open question on pU, assigned to the incoming member and in a Gap Interview link.
  insert into public.gap_questions (handover_id, point_id, assigned_member_id, question, priority, access_level)
  values (tests.id('h'), tests.id('pU'), tests.id('h/inc'), 'Who else knows?', 'optional', 'everyone') returning id into v_q;
  insert into public.access_tokens (handover_id, created_by, purpose, token_hash, max_access_level, expires_at, max_uses)
  values (tests.id('h'), tests.id('ann'), 'gap_interview', sha256('m2-token'), 'everyone', now() + interval '1 day', 20) returning id into v_t;
  insert into public.access_token_questions (handover_id, token_id, gap_question_id) values (tests.id('h'), v_t, v_q);
  perform tests.put('qU', v_q);

  -- withdraw, keeping the question's text (its own surface decision is "keep")
  perform pg_temp.resolve('pU', pg_temp.payload('pU', 'withdraw', '{}'));

  -- M2: the withdrawn point keeps no answerable question, for members and for links.
  perform tests.eq((select status from public.gap_questions where id = v_q), 'waived', 'M2: question waived on withdraw');
  perform tests.as_reader('inc');
  perform tests.eq((select count(*) from public.gap_questions where id = v_q), 0::bigint, 'M2: assignee no longer sees it');
  perform tests.as_user('inc');
  perform tests.throws(format('select public.submit_gap_answers(tests.actor(), %L)',
                              jsonb_build_array(jsonb_build_object('gapQuestionId', v_q, 'answerText', 'late'))),
                       'BTNF0', 'M2: in-app answer refused');
  perform tests.as_service();
  perform tests.eq(public.get_gap_interview(sha256('m2-token')) -> 'questions', '[]'::jsonb, 'M2: link shows no question');
  perform tests.throws(format($q$select public.submit_gap_answers_with_token(%L, 'Guest', %L)$q$, sha256('m2-token'),
                              jsonb_build_array(jsonb_build_object('gapQuestionId', v_q, 'answerText', 'late'))),
                       'BTNF0', 'M2: token answer refused');
  perform tests.as_owner();
  -- Defence in depth: even reopened by hand, a question on an erased point cannot be answered (insert guard).
  update public.gap_questions set status = 'open' where id = v_q;
  perform tests.throws(format($q$insert into public.gap_answers (handover_id, gap_question_id, answered_by_profile_id, answer_text, answerer_label)
                                values (%L, %L, %L, 'x', 'Inc')$q$, tests.id('h'), v_q, tests.id('inc')),
                       'BTNF0', 'M2: insert guard refuses answers to questions of erased points');
  update public.gap_questions set status = 'waived' where id = v_q;

  perform tests.ok((select erased_at is not null and review_state = 'rejected' from public.handover_points where id = tests.id('pU')), 'pU withdrawn');
  perform tests.ok((select redacted_at is not null from public.publication_points where point_id = tests.id('pU')), 'pU snapshot tombstoned');
  perform pg_temp.resolve('pB', pg_temp.payload('pB', 'keep', '{}'));
  perform tests.ok(not exists (select 1 from public.handover_points where privacy_review = 'required'), 'every review resolved');
  perform tests.as_reader('inc');
  perform tests.eq((select count(*) from public.publication_points), 3::bigint, 'pP, pT and pB readable again; pX and pU stay hidden');
  perform tests.as_owner();
end $$;

select 'ok' as privacy;
