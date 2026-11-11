-- Schema integrity: composite FKs (§6.0), append-only guards (§2), creator row (D23), pepper version
-- (§12.8 point 9), processing_jobs NULLS NOT DISTINCT, testimony sync, directContact floor (D5).
\set ON_ERROR_STOP 1

select tests.user('ann'); select tests.user('ben'); select tests.user('cat');
select tests.handover('h1', 'ann', 'outgoing');
select tests.handover('h2', 'ben', 'reviewer');
select tests.source('h1', 's1'); select tests.source('h2', 's2');
select tests.point('h1', 'p1'); select tests.point('h2', 'p2');
select tests.cite('p1', 's1', 'alice', 1);

do $$
declare
  v_q2 uuid;
begin
  -- §6.0: a point in h1 can never link to a quote in h2.
  select id into v_q2 from public.evidence_quotes where handover_id = tests.id('h2') limit 1;
  v_q2 := tests.cite('p2', 's2', 'bob', 1);
  select evidence_id into v_q2 from public.point_evidence where id = v_q2;
  perform tests.throws(format('insert into public.point_evidence (handover_id, point_id, evidence_id) values (%L, %L, %L)',
                              tests.id('h1'), tests.id('p1'), v_q2), '23503', 'cross-handover evidence link rejected');
  perform tests.throws(format('insert into public.point_evidence (handover_id, point_id, evidence_id) values (%L, %L, %L)',
                              tests.id('h2'), tests.id('p1'), v_q2), '23503', 'link with mismatched handover rejected');

  -- A quote's message must belong to the quote's source (§6.0 exceptions).
  perform tests.throws(format($q$insert into public.evidence_quotes (handover_id, kind, source_id, source_message_id, quote_text, access_level)
                                values (%L, 'source_quote', %L, %L, 'x', 'everyone')$q$,
                              tests.id('h1'), tests.id('s1'), tests.msg('s2', 'bob', 1)), 'BTVF0', 'message from another source rejected');

  -- Identity pepper: only p1 (§12.8 point 9).
  perform tests.throws(format($q$insert into public.source_participants (handover_id, source_id, local_id, display_label, identity_kind, identity_hash, identity_pepper_version)
                                values (%L, %L, 'p_x', 'X', 'phone', '\x01', 'p2')$q$, tests.id('h1'), tests.id('s1')),
                       '23514', 'pepper version p2 rejected');

  -- processing_jobs: UNIQUE NULLS NOT DISTINCT (run, stage, NULL source).
  insert into public.processing_runs (handover_id, status, source_ids, pipeline_version, ai_provider, ai_config)
  values (tests.id('h1'), 'succeeded', '{}', '1', 'fake', '{}') returning id into v_q2;
  insert into public.processing_jobs (handover_id, run_id, stage, input_hash) values (tests.id('h1'), v_q2, 'analyze', '\x00');
  perform tests.throws(format($q$insert into public.processing_jobs (handover_id, run_id, stage, input_hash) values (%L, %L, 'analyze', '\x00')$q$,
                              tests.id('h1'), v_q2), '23505', 'duplicate handover-level job rejected');

  -- Enum CHECKs.
  perform tests.throws(format($q$update public.handover_members set clearance = 'top_secret' where handover_id = %L$q$, tests.id('h1')),
                       '23514', 'unknown access level rejected');
  -- Review roles always reviewer_only.
  perform tests.throws(format($q$update public.handover_members set clearance = 'everyone' where handover_id = %L$q$, tests.id('h1')),
                       '23514', 'review role clearance is fixed');
end $$;

-- ── Creator row and lifecycle guards ─────────────────────────────────────────
do $$
begin
  perform tests.throws(format($q$update public.handover_members set role = 'incoming', clearance = 'everyone' where handover_id = %L and profile_id = %L$q$,
                              tests.id('h1'), tests.id('ann')), 'BTIT0', 'creator cannot become incoming');
  perform tests.throws(format($q$update public.handover_members set removed_at = now() where handover_id = %L and profile_id = %L$q$,
                              tests.id('h1'), tests.id('ann')), 'BTIT0', 'creator cannot be removed');
  perform tests.throws(format($q$delete from public.handover_members where handover_id = %L$q$, tests.id('h1')),
                       'BTIT0', 'members are never deleted');
  perform tests.throws(format($q$update public.handovers set state = 'approved' where id = %L$q$, tests.id('h1')),
                       'BTIT0', 'state changes only through transition_handover');
  perform tests.throws(format($q$update public.handovers set created_by = %L where id = %L$q$, tests.id('ben'), tests.id('h1')),
                       'BTIT0', 'created_by changes only through transfer_creator');
  perform tests.throws(format($q$delete from public.handovers where id = %L$q$, tests.id('h1')),
                       'BTIT0', 'handovers are purged, not deleted');
end $$;

-- ── Append-only tables (owner without a flag, and service_role) ──────────────
do $$
begin
  perform tests.as_owner();
  insert into public.review_actions (handover_id, point_id, action, note) values (tests.id('h1'), tests.id('p1'), 'reopen', 'note');
  perform tests.throws($q$update public.review_actions set note = 'changed'$q$, 'BTIT0', 'review_actions note immutable');
  perform tests.throws($q$delete from public.review_actions$q$, 'BTIT0', 'review_actions undeletable');
  perform tests.throws($q$update public.point_revisions set title = 'changed'$q$, 'BTIT0', 'revisions immutable');
  perform tests.throws($q$delete from public.point_revisions$q$, 'BTIT0', 'revisions undeletable');
  perform tests.throws($q$update public.audit_logs set action = 'x'$q$, 'BTIT0', 'audit immutable');
  perform tests.throws($q$delete from public.audit_logs$q$, 'BTIT0', 'audit undeletable');

  -- A flag set by an API role is not honoured (§2: only the definer paths may use it).
  perform tests.as_service();
  perform set_config('baton.erasure', 'on', false);
  perform tests.throws($q$update public.point_revisions set title = 'x', redacted_at = now(), redaction_kind = 'tombstone'$q$,
                       '42501', 'service_role has no UPDATE grant on point_revisions');
  perform tests.throws($q$truncate public.audit_logs$q$, '42501', 'service_role cannot truncate audit');
  perform set_config('baton.erasure', '', false);
  perform tests.as_owner();
end $$;

-- ── Testimony text always equals its answer (deferred check at commit) ───────
do $$
declare
  v_q uuid; v_a uuid; v_t uuid;
begin
  perform tests.set_state('h1', 'in_review');
  insert into public.gap_questions (handover_id, point_id, question, priority, access_level)
  values (tests.id('h1'), tests.id('p1'), 'Who holds the account?', 'required', 'everyone') returning id into v_q;
  insert into public.gap_answers (handover_id, gap_question_id, answered_by_profile_id, answer_text, answerer_label)
  values (tests.id('h1'), v_q, tests.id('ann'), 'Asha holds it', 'Ann') returning id into v_a;
  insert into public.evidence_quotes (handover_id, kind, gap_answer_id, quote_text, access_level)
  values (tests.id('h1'), 'testimony', v_a, 'something else', 'leads_only') returning id into v_t;
  -- the insert trigger copied text and access from the answer/question
  perform tests.eq((select quote_text from public.evidence_quotes where id = v_t), 'Asha holds it', 'testimony copies answer text');
  perform tests.eq((select access_level from public.evidence_quotes where id = v_t), 'everyone', 'testimony copies question access');
  perform tests.throws(format($q$update public.evidence_quotes set quote_text = 'x' where id = %L$q$, v_t),
                       'BTIT0', 'testimony text changes only through privacy review');
  perform tests.put('q1', v_q); perform tests.put('a1', v_a);
end $$;

-- The deferred sync check fires at COMMIT, so this must be its own transaction.
\set ON_ERROR_STOP 0
begin;
select set_config('baton.privacy_review', 'on', true);
update public.gap_answers set answer_text = 'changed' where id = tests.id('a1');
commit;
\set ON_ERROR_STOP 1
do $$ begin
  perform tests.eq((select answer_text from public.gap_answers where id = tests.id('a1')), 'Asha holds it',
                   'answer/testimony mismatch rolled back at commit');
end $$;

-- ── directContact (D5) and access_override (§8.4) ────────────────────────────
do $$
declare
  v_rev uuid;
begin
  perform tests.point('h1', 'c1', 'contact');
  perform tests.eq((select access_level from public.handover_points where id = tests.id('c1')), 'everyone', 'contact starts at everyone');
  insert into public.point_revisions (handover_id, point_id, revision_number, title, statement, attributes, author_kind, author_profile_id)
  values (tests.id('h1'), tests.id('c1'), 2, 'Asha', 'Bank contact',
          '{"nameLabel":"Asha","directContact":{"channel":"email","value":"asha@bank.test"}}', 'profile', tests.id('ann'))
  returning id into v_rev;
  update public.handover_points set current_revision_id = v_rev where id = tests.id('c1');
  perform tests.eq((select access_level from public.handover_points where id = tests.id('c1')), 'leads_only',
                   'direct contact raises the point to leads_only');
  perform tests.throws(format($q$update public.handover_points set access_override = null where id = %L$q$, tests.id('c1')),
                       'BTIT0', 'cannot drop below leads_only with a direct contact');

  -- Override can never be set below the evidence floor.
  update public.handover_points set access_floor = 'leads_only' where id = tests.id('p2');
  perform tests.throws(format($q$update public.handover_points set access_override = 'everyone' where id = %L$q$, tests.id('p2')),
                       'BTIT0', 'override below floor rejected');
end $$;

-- ── Gap answers to a held question are rejected for every role, incl. service_role ──
do $$
begin
  update public.handover_points set privacy_review = 'required', privacy_review_flagged_at = now() where id = tests.id('p1');
  perform tests.throws(format($q$insert into public.gap_answers (handover_id, gap_question_id, answered_by_profile_id, answer_text, answerer_label)
                                values (%L, %L, %L, 'x', 'Ann')$q$, tests.id('h1'), tests.id('q1'), tests.id('ann')),
                       'BTNF0', 'answer to held question rejected (owner)');
  update public.handover_points set privacy_review = 'none', privacy_review_flagged_at = null where id = tests.id('p1');
end $$;

select 'ok' as integrity;
