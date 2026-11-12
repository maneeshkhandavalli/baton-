-- Handover lifecycle (§9.1), publication (§6.18), acknowledgement (D9) and review actions (§5).
\set ON_ERROR_STOP 1

select tests.user(u) from unnest(array['ann', 'oli', 'rev', 'inc1', 'inc2']) u;

-- ── Creation (D23) ───────────────────────────────────────────────────────────
do $$
declare
  v uuid;
begin
  perform tests.as_user('ann');
  perform tests.throws($q$select public.create_handover(tests.actor(), 'Treasurer handover', 'Robotics Club', null, null, 'incoming')$q$,
                       'BTVF0', 'creator role must be outgoing or reviewer');
  v := public.create_handover(tests.actor(), 'Treasurer handover', 'Robotics Club', 'Treasurer', null, 'reviewer');
  perform tests.put('h', v);
  perform tests.eq((select role || '/' || clearance from public.handover_members where handover_id = v), 'reviewer/reviewer_only',
                   'creator row created in the same transaction');
  perform tests.eq((tests.read(format('select public.api_get_handover(%L)', v)) ->> 'state'), 'draft', 'new handover is draft');
  perform tests.as_owner();
end $$;
select tests.member('h', 'oli', 'outgoing');
select tests.member('h', 'rev', 'reviewer');
select tests.member('h', 'inc1', 'incoming');

-- ── Processing (§9.1, §9.3) ──────────────────────────────────────────────────
do $$
declare
  v_s uuid; v_run uuid;
begin
  perform tests.as_user('oli');
  perform tests.throws(format($q$select public.start_processing(tests.actor(), %L, '1', '{"provider":"fake"}', '[]')$q$, tests.id('h')),
                       'BTPF0', 'no source ready');
  v_s := public.create_source(tests.actor(), tests.id('h'), 'text', 'notes.txt', 'text/plain', 100, repeat('b', 64));
  perform tests.throws(format($q$select public.create_source(tests.actor(), %L, 'text', 'again.txt', 'text/plain', 100, %L)$q$, tests.id('h'), repeat('b', 64)),
                       'BTCF0', 'duplicate upload is conflict');
  perform tests.throws(format('select public.confirm_source_uploaded(tests.actor(), %L, 100, %L)', v_s, repeat('b', 64)),
                       'BTPF0', 'upload must have arrived');
  perform tests.eq(public.source_upload_target(tests.actor(), v_s) ->> 'raw_storage_path', 'raw/' || tests.id('h') || '/' || v_s,
                   'server learns the object path to measure');
  perform tests.as_owner();
  -- Storage records 90 bytes although 100 were declared and "measured".
  insert into storage.objects (bucket_id, name, metadata)
  values ('source-uploads', 'raw/' || tests.id('h') || '/' || v_s, '{"size": 90}');
  perform tests.as_user('oli');
  -- M5: the client's declared size and checksum are never trusted.
  perform tests.throws(format('select public.confirm_source_uploaded(tests.actor(), %L, 99, %L)', v_s, repeat('b', 64)),
                       'BTVF0', 'M5: measured size differs from the declared size');
  perform tests.throws(format('select public.confirm_source_uploaded(tests.actor(), %L, 100, %L)', v_s, repeat('a', 64)),
                       'BTVF0', 'M5: measured SHA-256 differs from the declared checksum');
  perform tests.throws(format('select public.confirm_source_uploaded(tests.actor(), %L, 100, %L)', v_s, repeat('b', 64)),
                       'BTVF0', 'M5: Storage''s recorded size differs from the measured size');
  perform tests.throws(format('select public.confirm_source_uploaded(tests.actor(), %L, 100, %L)', v_s, 'not-hex'),
                       'BTVF0', 'M5: malformed checksum');
  perform tests.as_owner();
  perform tests.eq((select state from public.sources where id = v_s), 'pending_upload', 'M5: a mismatch changes nothing');
  update storage.objects set metadata = '{"size": 100}' where name = 'raw/' || tests.id('h') || '/' || v_s;
  perform tests.as_user('oli');
  perform public.confirm_source_uploaded(tests.actor(), v_s, 100, repeat('B', 64));
  perform tests.as_owner();
  perform tests.eq((select state from public.sources where id = v_s), 'uploaded', 'M5: matching measurements confirm the upload');
  perform tests.as_user('oli');
  perform tests.throws(format($q$select public.start_processing(tests.actor(), %L, '1', '{"provider":"fake"}', '[]')$q$, tests.id('h')),
                       'BTPF0', 'consent required before processing');
  perform public.record_source_consent(tests.actor(), v_s, 'consent-v1', 'other-provider', 'everyone', 'Asia/Kolkata');
  perform tests.throws(format($q$select public.start_processing(tests.actor(), %L, '1', '{"provider":"fake"}', '[]')$q$, tests.id('h')),
                       'BTPF0', 'consent must name the configured provider');
  perform public.record_source_consent(tests.actor(), v_s, 'consent-v1', 'fake', 'everyone', 'Asia/Kolkata');
  perform tests.as_user('rev');
  perform tests.throws(format($q$select public.start_processing(tests.actor(), %L, '1', '{"provider":"fake"}', '[]')$q$, tests.id('h')),
                       'BTFB0', 'reviewer cannot start processing');
  perform tests.as_user('oli');
  v_run := public.start_processing(tests.actor(), tests.id('h'), '1', '{"provider":"fake"}',
             jsonb_build_array(jsonb_build_object('stage', 'parse', 'sourceId', v_s, 'inputHash', repeat('ab', 32))));
  perform tests.eq((tests.read(format('select public.api_get_handover(%L)', tests.id('h'))) ->> 'state'), 'processing', 'draft → processing');
  perform tests.throws(format($q$select public.start_processing(tests.actor(), %L, '1', '{"provider":"fake"}', '[]')$q$, tests.id('h')),
                       'BTIT0', 'cannot start twice');
  perform tests.throws(format('select public.cancel_processing(tests.actor(), %L)', tests.id('h')), 'BTFB0', 'only the creator cancels');

  -- Worker: run fails with no earlier success → back to draft.
  perform tests.as_service();
  perform public.finish_processing_run(v_run, 'failed', 'processing_failed', 'stage_failed');
  perform tests.as_user('ann');
  perform tests.eq((tests.read(format('select public.api_get_handover(%L)', tests.id('h'))) ->> 'state'), 'draft', 'failed first run → draft');
  perform tests.put('src', v_s);
  perform tests.as_owner();
end $$;

-- Parse persistence (§10.3) through the worker path, then a successful run → in_review.
do $$
declare
  v_run uuid;
  v_old_run uuid;
begin
  -- N3: no active run (the first run failed) → workers cannot write.
  perform tests.as_service();
  perform tests.throws(format($q$select public.persist_parsed_source(%L, '{}', 'p1')$q$, tests.id('src')), 'BTIT0',
                       'N3: parse persistence needs an active run');
  select id into v_old_run from public.processing_runs where handover_id = tests.id('h') and status = 'failed';
  perform tests.throws(format($q$select public.insert_extracted_point(%L, %L, 'decision', 't', 's', '{}', null, 'everyone', '{"p":1}')$q$,
                              tests.id('h'), v_old_run), 'BTIT0', 'N3: extraction cannot write against a finished run');
  perform tests.as_user('oli');
  v_run := public.start_processing(tests.actor(), tests.id('h'), '1', '{"provider":"fake"}', '[]');
  perform tests.as_service();
  perform tests.throws(format($q$select public.insert_extracted_point(%L, %L, 'decision', 't', 's', '{}', null, 'everyone', '{"p":1}')$q$,
                              tests.id('h'), v_old_run), 'BTIT0', 'N3: extraction cannot write against another (old) run');
  perform tests.put('extracted', public.insert_extracted_point(tests.id('h'), v_run, 'decision', 'Extracted', 'Statement', '{}', null,
                                                              'everyone', '{"provider":"fake"}'));
  perform public.persist_parsed_source(tests.id('src'), $json${
    "kind": "text", "parserVersion": "1.0.0",
    "participants": [{"localId": "p_1", "displayLabel": "Asha", "identityKind": "name",
                      "identityHash": "aa11aa11aa11aa11aa11aa11aa11aa11aa11aa11aa11aa11aa11aa11aa11aa11", "identityPepperVersion": "p1",
                      "messageCount": 2}],
    "conversations": [{"localId": "c_1", "startedAt": "2026-07-01T10:00:00Z", "endedAt": "2026-07-01T11:00:00Z",
                       "messageCount": 2, "participantLocalIds": ["p_1"], "preview": "Bank account"}],
    "messages": [
      {"seq": 0, "conversationLocalId": "c_1", "participantLocalId": "p_1", "sentAt": "2026-07-01T10:00:00Z", "kind": "text",
       "body": "Asha holds the club bank account", "location": null},
      {"seq": 1, "conversationLocalId": "c_1", "participantLocalId": "p_1", "sentAt": "2026-07-01T11:00:00Z", "kind": "text",
       "body": "Card is in the drawer", "location": null}],
    "masking": {"counts": {"phone": 0}}, "stats": {}, "firstMessageAt": "2026-07-01T10:00:00Z",
    "lastMessageAt": "2026-07-01T11:00:00Z", "warnings": []}$json$::jsonb, 'p1');
  perform tests.throws(format($q$select public.persist_parsed_source(%L, '{}', 'p1')$q$, tests.id('src')), 'BTIT0', 'cannot parse twice');
  perform public.finish_processing_run(v_run, 'succeeded');
  -- N3: once the run is over (in_review), extraction-side writers are refused.
  perform tests.throws(format($q$select public.insert_extracted_point(%L, %L, 'decision', 't', 's', '{}', null, 'everyone', '{"p":1}')$q$,
                              tests.id('h'), v_run), 'BTIT0', 'N3: no extraction after the run finished');
  perform tests.throws(format($q$select public.create_system_gap_question(%L, null, 'owner', 'q?', null, 'optional', 'everyone')$q$,
                              tests.id('h')), 'BTIT0', 'N3: no system gap questions outside a run');
  -- the point written during the run is a normal reviewable point; reject it so later readiness checks are unaffected
  perform tests.as_user('rev');
  perform public.reject_point(tests.actor(), tests.id('extracted'), 'Created by the N3 test');
  perform tests.as_service();
  perform tests.as_owner();
  perform tests.eq((select state from public.handovers where id = tests.id('h')), 'in_review', 'successful run → in_review');
  perform tests.eq((select evidence_as_of from public.handovers where id = tests.id('h')), timestamptz '2026-07-01T11:00:00Z',
                   'evidence_as_of = latest message');
end $$;

-- Points to review.
select tests.point('h', 'sourced');  select tests.source('h', 's');
select tests.cite('sourced', 's', 'alice', 1);
select tests.point('h', 'inferred'); select tests.cite('inferred', 's', 'bob', 1, 'partial');
select tests.point('h', 'conflict'); select tests.cite('conflict', 's', 'alice', 2); select tests.cite('conflict', 's', 'bob', 2, 'contradicts');
select tests.point('h', 'missing');
select tests.point('h', 'doomed');

-- ── Review actions (§5.2, §5.3) ──────────────────────────────────────────────
do $$
declare
  r_inf uuid; r_con uuid; r_mis uuid; r_src uuid; v_new uuid;
begin
  select current_revision_id into r_inf from public.handover_points where id = tests.id('inferred');
  select current_revision_id into r_con from public.handover_points where id = tests.id('conflict');
  select current_revision_id into r_mis from public.handover_points where id = tests.id('missing');
  select current_revision_id into r_src from public.handover_points where id = tests.id('sourced');
  perform tests.as_user('rev');

  perform tests.throws(format('select public.approve_point(tests.actor(), %L, %L)', tests.id('inferred'), r_inf), 'BTPF0', 'inferred needs confirmInferred');
  perform public.approve_point(tests.actor(), tests.id('inferred'), r_inf, true);
  perform tests.throws(format('select public.approve_point(tests.actor(), %L, %L)', tests.id('conflict'), r_con), 'BTPF0', 'conflicting needs a note');
  perform public.approve_point(tests.actor(), tests.id('conflict'), r_con, false, 'Both are kept; the newer one is right');
  perform tests.throws(format('select public.approve_point(tests.actor(), %L, %L)', tests.id('missing'), r_mis), 'BTPF0', 'missing needs asKnownGap');
  perform public.approve_point(tests.actor(), tests.id('missing'), r_mis, false, null, true);
  perform tests.throws(format('select public.approve_point(tests.actor(), %L, %L)', tests.id('sourced'), gen_random_uuid()), 'BTCF0', 'stale expectedRevisionId');
  perform public.approve_point(tests.actor(), tests.id('sourced'), r_src);
  perform tests.throws(format('select public.approve_point(tests.actor(), %L, %L)', tests.id('sourced'), r_src), 'BTIT0', 'approve twice');
  perform tests.throws(format($q$select public.reject_point(tests.actor(), %L, '  ')$q$, tests.id('doomed')), 'BTVF0', 'reject needs a reason');
  perform public.reject_point(tests.actor(), tests.id('doomed'), 'Duplicate of another point');

  -- Edit: new revision, old verdicts stale → inferred, approved → pending; earlier text kept.
  v_new := public.edit_point(tests.actor(), tests.id('sourced'), r_src, 'New title', 'New statement', '{}', 'Clarified wording');
  perform tests.eq((select evidence_status || '/' || review_state from public.handover_points where id = tests.id('sourced')),
                   'inferred/pending', 'edit makes verdicts stale and reopens');
  perform tests.eq((select count(*) from public.point_revisions where point_id = tests.id('sourced')), 2::bigint, 'earlier revision kept');
  perform tests.eq((select title from public.point_revisions where id = r_src), 'Title of sourced', 'original text untouched');
  perform public.approve_point(tests.actor(), tests.id('sourced'), v_new, true);

  -- Access override only raises above the floor.
  perform public.change_point_access(tests.actor(), tests.id('missing'), 'leads_only');
  perform tests.as_owner();
  perform tests.eq((select access_level from public.handover_points where id = tests.id('missing')), 'leads_only', 'override raises');

  -- Audit never carries review notes (§12.7).
  perform tests.ok(not exists (select 1 from public.audit_logs where (coalesce(before, '{}') || coalesce(after, '{}'))::text
                               like '%newer one is right%' or (coalesce(before, '{}') || coalesce(after, '{}'))::text like '%Duplicate%'),
                   'audit is structural only');
end $$;

-- ── Publication readiness (§11.6) ────────────────────────────────────────────
do $$
begin
  perform tests.as_user('ann');
  perform tests.ok((tests.read(format('select public.api_get_readiness(%L)', tests.id('h'))) ->> 'canPublish')::boolean, 'ready with an incoming member');
  perform tests.as_owner();
  update public.handover_members set removed_at = now() where id = tests.id('h/inc1');
  perform tests.as_user('ann');
  perform tests.ok(tests.read(format('select public.api_get_readiness(%L)', tests.id('h'))) -> 'blockers' @> '[{"kind":"no_incoming_recipient"}]',
                   'no incoming recipient blocks');
  perform tests.throws(format('select public.publish_handover(tests.actor(), %L)', tests.id('h')), 'BTPF0', 'publish refuses while blocked');
  -- A pending incoming invite counts as a recipient (D9).
  perform public.invite_member(tests.actor(), tests.id('h'), 'inc2@example.test', 'incoming', null, sha256('invite-inc2'), now() + interval '7 days');
  perform tests.ok((tests.read(format('select public.api_get_readiness(%L)', tests.id('h'))) ->> 'canPublish')::boolean, 'pending incoming invite is a recipient');
  perform tests.as_user('oli');
  perform tests.throws(format('select public.publish_handover(tests.actor(), %L)', tests.id('h')), 'BTFB0', 'only the creator publishes (D1)');
  perform tests.as_user('ann');
  perform tests.put('pub1', public.publish_handover(tests.actor(), tests.id('h'), 'Summary'));
  perform tests.as_owner();
  update public.handover_members set removed_at = null where id = tests.id('h/inc1');

  perform tests.eq((select state from public.handovers where id = tests.id('h')), 'approved', 'in_review → approved');
  perform tests.eq((select count(*) from public.publication_points where publication_id = tests.id('pub1')), 4::bigint,
                   'every approved point snapshotted, rejected excluded');
  perform tests.eq((select jsonb_array_length(content -> 'evidence') from public.publication_points where point_id = tests.id('conflict')), 2,
                   'both sides of a conflict are published');
  perform tests.ok((select bool_and(e ? 'evidenceId' and e ->> 'stance' in ('supports', 'contradicts') and not (e ->> 'redacted')::boolean)
                      from public.publication_points pp, jsonb_array_elements(pp.content -> 'evidence') e
                     where pp.point_id = tests.id('conflict')), 'snapshot evidence items carry evidenceId and stance');
  perform tests.ok((select content -> 'conflictResolution' ->> 'note' from public.publication_points where point_id = tests.id('conflict'))
                   = 'Both are kept; the newer one is right', 'conflict resolution note snapshotted');
  perform tests.ok((select (content ->> 'isKnownGap')::boolean from public.publication_points where point_id = tests.id('missing')),
                   'missing point published as a known gap');
  perform tests.ok(not exists (select 1 from public.source_messages m where m.handover_id = tests.id('h')
                                and not exists (select 1 from public.evidence_quotes q where q.source_message_id = m.id)),
                   'unreferenced messages pruned at publish (§12.6)');
  perform tests.ok(exists (select 1 from public.evidence_quotes where handover_id = tests.id('h')), 'quotes survive pruning');
end $$;

-- ── Acknowledgement (D9) ─────────────────────────────────────────────────────
do $$
declare
  v_member jsonb;
begin
  perform tests.as_user('inc1');
  perform public.acknowledge_publication(tests.actor(), tests.id('pub1'), 'ack-v1');
  perform tests.throws(format($q$select public.acknowledge_publication(tests.actor(), %L, 'ack-v1')$q$, tests.id('pub1')), 'BTCF0', 'acknowledge once');
  perform tests.as_owner();
  perform tests.eq((select state from public.handovers where id = tests.id('h')), 'approved', 'pending incoming invite blocks acknowledged');

  -- H3: email and confirmation come from auth.users, never from the caller.
  perform tests.as_owner();
  perform tests.user('impostor');
  update auth.users set email = 'inc2@example.test', email_confirmed_at = null where id = tests.id('impostor');
  update auth.users set email = 'INC2@Example.TEST' where id = tests.id('inc2'); -- case-insensitive match
  perform tests.as_service();
  perform tests.throws(format('select public.redeem_member_invite(%L, %L)', sha256('invite-inc2'), tests.id('impostor')),
                       'BTTI0', 'H3: unconfirmed address cannot redeem, even with the invited email');
  perform tests.throws(format('select public.redeem_member_invite(%L, %L)', sha256('invite-inc2'), tests.id('rev')),
                       'BTTI0', 'H3: a confirmed but different address cannot redeem');
  perform tests.throws(format('select public.redeem_member_invite(%L, %L)', sha256('invite-inc2'), gen_random_uuid()),
                       'BTUA0', 'H3: unknown profile cannot redeem');
  perform tests.as_owner();
  perform tests.eq((select use_count from public.access_tokens where token_hash = sha256('invite-inc2')), 0,
                   'H3: failed attempts do not consume the invite');
  perform tests.ok(not exists (select 1 from public.handover_members where profile_id = tests.id('impostor')), 'H3: no membership created');
  perform tests.as_service();
  v_member := public.redeem_member_invite(sha256('invite-inc2'), tests.id('inc2'));
  perform tests.eq(v_member ->> 'role', 'incoming', 'H3: the confirmed invited address redeems');
  perform tests.throws(format('select public.redeem_member_invite(%L, %L)', sha256('invite-inc2'), tests.id('inc2')),
                       'BTTI0', 'single-use invite cannot be redeemed twice');
  perform tests.as_user('inc2');
  perform public.acknowledge_publication(tests.actor(), tests.id('pub1'), 'ack-v1');
  perform tests.as_owner();
  perform tests.eq((select state from public.handovers where id = tests.id('h')), 'acknowledged', 'all required acks → acknowledged');
  perform tests.eq((select count(*) from public.audit_logs where action = 'handover.transition'
                    and after ->> 'state' = 'acknowledged'), 1::bigint, 'exactly one transition audited');
end $$;

-- ── Revisions (§9.2) ─────────────────────────────────────────────────────────
do $$
begin
  perform tests.as_user('rev');
  perform tests.throws(format('select public.start_revision(tests.actor(), %L)', tests.id('h')), 'BTFB0', 'only the creator starts a revision');
  perform tests.throws(format($q$select public.reopen_point(tests.actor(), %L)$q$, tests.id('sourced')), 'BTIT0', 'no review outside in_review');
  perform tests.as_user('ann');
  perform public.start_revision(tests.actor(), tests.id('h'));
  perform tests.eq((tests.read(format('select public.api_get_handover(%L)', tests.id('h'))) ->> 'state'), 'in_review', 'acknowledged → in_review');
  perform tests.as_reader('inc1');
  perform tests.ok(tests.read(format('select public.api_get_published_handover(%L)', tests.id('h'))) is not null, 'current publication stays readable during a revision');
  perform tests.ok((tests.read(format('select public.api_get_published_handover(%L)', tests.id('h'))) ->> 'viewer_acknowledged_at') is not null, 'ack visible to its author');
  perform tests.as_user('ann');
  perform tests.throws(format('select public.start_revision(tests.actor(), %L)', tests.id('h')), 'BTIT0', 'illegal transition in_review → in_review');
  perform tests.put('pub2', public.publish_handover(tests.actor(), tests.id('h')));
  perform tests.eq((select version from public.handover_publications where id = tests.id('pub2')), 2, 'version 2');
  perform tests.eq((select supersedes_id from public.handover_publications where id = tests.id('pub2')), tests.id('pub1'), 'supersedes v1');
  perform tests.eq((select state from public.handovers where id = tests.id('h')), 'approved', 'new publication requires new acknowledgements');
  perform tests.as_user('inc1');
  perform tests.throws(format($q$select public.acknowledge_publication(tests.actor(), %L, 'ack-v1')$q$, tests.id('pub1')), 'BTIT0',
                       'superseded publication cannot be acknowledged');
  perform tests.as_owner();
end $$;

select 'ok' as lifecycle_review;
