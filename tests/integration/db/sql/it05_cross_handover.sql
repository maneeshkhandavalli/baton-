-- IT-05: cross-handover access is denied, and indistinguishable from "does not exist" (§8.3, §8.5, §6.0).
-- ann creates H1; bob creates H2. Every read and every mutation ann attempts on H2 ids behaves exactly like
-- the same call with a random id. Ids from H2 smuggled into H1 calls are refused.
\set ON_ERROR_STOP 1

select tests.user(u) from unnest(array['ann', 'rev', 'bob', 'cara', 'eve']) u;
select tests.handover('h1', 'ann', 'outgoing');
select tests.member('h1', 'rev', 'reviewer');
select tests.source('h1', 's1');
select tests.point('h1', 'q1');
select tests.cite('q1', 's1', 'alice', 1, 'supports', 'exact', 'pe1');

select tests.handover('h2', 'bob', 'outgoing');
select tests.member('h2', 'cara', 'incoming');
select tests.source('h2', 's2');
select tests.point('h2', 'q2');
select tests.cite('q2', 's2', 'alice', 1, 'supports', 'exact', 'pe2');
select it.raw_source('h2', 'r2');
select tests.put('part2', (select id from public.source_participants where source_id = tests.id('s2') order by local_id limit 1));
select tests.set_state('h1', 'in_review');
select tests.set_state('h2', 'in_review');

-- H2 content created through the real mutation paths.
select tests.as_user('bob');
select tests.put('gq2', public.create_gap_question(p_actor_profile_id => tests.actor(), p_handover_id => tests.id('h2'),
  p_point_id => null, p_category => 'owner', p_question => 'Who holds the keys?', p_context => null, p_priority => 'optional'));
select tests.put('tok2', public.create_gap_interview_link(tests.actor(), tests.id('h2'), sha256('it05-tok2'::bytea),
  array[tests.id('gq2')], 'everyone', now() + interval '1 day', 20));
select public.submit_gap_answers(tests.actor(), jsonb_build_array(jsonb_build_object('gapQuestionId', tests.id('gq2'), 'answerText', 'Bob has them')));
select tests.put('ans2', (select id from public.gap_answers where gap_question_id = tests.id('gq2')));
select tests.put('ex2', public.add_exclusion(p_actor_profile_id => tests.actor(), p_source_id => tests.id('r2'), p_kind => 'participant',
  p_scope => 'handover', p_identity_kind => 'name', p_participant_identity_hash_hex => repeat('ab', 32), p_pepper_version => 'p1'));

select tests.as_user('ann');
select tests.put('gq1', public.create_gap_question(p_actor_profile_id => tests.actor(), p_handover_id => tests.id('h1'),
  p_point_id => null, p_category => 'owner', p_question => 'Who signs cheques?', p_context => null, p_priority => 'optional'));
select tests.put('tok1', public.create_gap_interview_link(tests.actor(), tests.id('h1'), sha256('it05-tok1'::bytea),
  array[tests.id('gq1')], 'everyone', now() + interval '1 day', 20));

-- ── Reads through the browser path (RLS) ────────────────────────────────────
select tests.as_reader('ann');
select it.read_like_missing('select public.api_get_handover(%L)', tests.id('h2'), 'getHandover');
select it.read_like_missing('select public.api_list_members(%L)', tests.id('h2'), 'listMembers');
select it.read_like_missing('select public.api_list_sources(%L)', tests.id('h2'), 'listSources');
select it.read_like_missing('select public.api_get_processing_status(%L)', tests.id('h2'), 'getProcessingStatus');
select it.read_like_missing('select public.api_list_points(%L)', tests.id('h2'), 'listPoints');
select it.read_like_missing('select public.api_get_point(%L)', tests.id('q2'), 'getPoint');
select it.read_like_missing('select public.api_get_source(%L)', tests.id('s2'), 'getSource (R1)');
select it.read_like_missing('select public.api_get_source_message_context(%L)', tests.id('pe2'), 'getSourceMessageContext');
select it.read_like_missing('select public.api_list_gap_questions(%L)', tests.id('h2'), 'listGapQuestions');
select it.read_like_missing('select public.api_get_readiness(%L)', tests.id('h2'), 'getReadiness');
select it.read_like_missing('select public.api_get_published_handover(%L)', tests.id('h2'), 'getPublishedHandover');
select it.read_like_missing('select public.api_list_participants(%L)', tests.id('h2'), 'listParticipants');
select it.read_like_missing('select public.api_list_exclusions(%L)', tests.id('h2'), 'listExclusions');
select it.read_like_missing('select public.list_access_tokens(%L)', tests.id('h2'), 'listAccessTokens');
select tests.ok(public.api_get_handover(tests.id('h2')) is null, 'H2 is invisible');
select tests.ok(public.api_get_handover(tests.id('h1')) is not null, 'control: H1 is visible');
-- a filter on H1 cannot reach H2 rows either
select tests.eq(public.api_list_participants(tests.id('h1'), tests.id('s2')), null::jsonb, 'participants: a source of H2 under H1 is not found');

-- direct PostgREST-style selects return nothing of H2
select tests.eq((select count(*)::int from public.handovers where id = tests.id('h2')), 0, 'handovers');
select tests.eq((select count(*)::int from public.handover_members where handover_id = tests.id('h2')), 0, 'members');
select tests.eq((select count(*)::int from public.handover_member_directory where handover_id = tests.id('h2')), 0, 'directory');
select tests.eq((select count(*)::int from public.sources where handover_id = tests.id('h2')), 0, 'sources');
select tests.eq((select count(*)::int from public.source_messages where handover_id = tests.id('h2')), 0, 'messages');
select tests.eq((select count(id)::int from public.source_participants where handover_id = tests.id('h2')), 0, 'participants');
select tests.eq((select count(id)::int from public.evidence_quotes where handover_id = tests.id('h2')), 0, 'evidence');
select tests.eq((select count(*)::int from public.handover_points where handover_id = tests.id('h2')), 0, 'points');
select tests.eq((select count(*)::int from public.point_evidence where handover_id = tests.id('h2')), 0, 'links');
select tests.eq((select count(*)::int from public.gap_questions where handover_id = tests.id('h2')), 0, 'gap questions');
select tests.eq((select count(*)::int from public.gap_answers where handover_id = tests.id('h2')), 0, 'gap answers');
select tests.eq((select count(*)::int from public.audit_logs where handover_id = tests.id('h2')), 0, 'audit');
select tests.eq((select count(*)::int from public.processing_jobs where handover_id = tests.id('h2')), 0, 'jobs');
select tests.eq((select count(id)::int from public.source_exclusions where handover_id = tests.id('h2')), 0, 'exclusions');

-- an outsider sees nothing of H1 either
select tests.as_reader('eve');
select it.read_like_missing('select public.api_get_handover(%L)', tests.id('h1'), 'outsider: getHandover');
select it.read_like_missing('select public.api_get_point(%L)', tests.id('q1'), 'outsider: getPoint');
select tests.eq(public.api_list_my_handovers(), '[]'::jsonb, 'outsider: no handovers listed');

-- ── Mutations: the server acting for ann (service role + verified actor) ────
select tests.as_user('ann');
select it.hidden_like_missing(format('select public.start_processing(%L, %%L, %L, %L, %L)', tests.actor(), 'it', '{"provider":"fake"}', '[]'),
                              tests.id('h2'), 'BTNF0', 'startProcessing');
select it.hidden_like_missing(format('select public.cancel_processing(%L, %%L)', tests.actor()), tests.id('h2'), 'BTNF0', 'cancelProcessing');
select it.hidden_like_missing(format('select public.publish_handover(%L, %%L, null)', tests.actor()), tests.id('h2'), 'BTNF0', 'publishHandover');
select it.hidden_like_missing(format('select public.start_revision(%L, %%L)', tests.actor()), tests.id('h2'), 'BTNF0', 'startRevision');
select it.hidden_like_missing(format('select public.delete_handover(%L, %%L)', tests.actor()), tests.id('h2'), 'BTNF0', 'deleteHandover');
select it.hidden_like_missing(format('select public.offer_creator_transfer(%L, %%L, %L)', tests.actor(), tests.id('h2/cara')),
                              tests.id('h2'), 'BTNF0', 'offerCreatorTransfer');
select it.hidden_like_missing(format('select public.respond_to_creator_transfer(%L, %%L, true)', tests.actor()), tests.id('h2'), 'BTNF0',
                              'respondToCreatorTransfer');
select it.hidden_like_missing(format('select public.invite_member(%L, %%L, %L, %L, null, %L, %L)', tests.actor(), 'x@example.test',
                                     'incoming', sha256('it05-inv'::bytea), now() + interval '1 day'),
                              tests.id('h2'), 'BTNF0', 'inviteMember');
select it.hidden_like_missing(format('select public.create_manual_point(%L, %%L, %L, %L, %L, %L)', tests.actor(), 'decision',
                                     'A title', 'A statement', '{}'), tests.id('h2'), 'BTNF0', 'createManualPoint');
select it.hidden_like_missing(format($q$select public.create_gap_question(%L, %%L, null, 'owner', 'Q?', null, 'optional')$q$, tests.actor()),
                              tests.id('h2'), 'BTNF0', 'createGapQuestion');
select it.hidden_like_missing(format('select public.create_source(%L, %%L, %L, %L, %L, 10, %L)', tests.actor(), 'text', 'a.txt',
                                     'text/plain', repeat('cd', 32)), tests.id('h2'), 'BTNF0', 'createSourceUpload');

-- points, evidence, sources, members, tokens, answers and participants of H2
select it.hidden_like_missing(format('select public.approve_point(%L, %%L, %L, false, null, false)', tests.actor(),
                                     (select current_revision_id from public.handover_points where id = tests.id('q2'))),
                              tests.id('q2'), 'BTNF0', 'approve');
select it.hidden_like_missing(format('select public.reject_point(%L, %%L, %L)', tests.actor(), 'no'), tests.id('q2'), 'BTNF0', 'reject');
select it.hidden_like_missing(format('select public.change_point_access(%L, %%L, %L)', tests.actor(), 'reviewer_only'),
                              tests.id('q2'), 'BTNF0', 'changeAccess');
select it.hidden_like_missing(format('select public.confirm_inferred(%L, %%L, null)', tests.actor()), tests.id('q2'), 'BTNF0', 'confirmInferred');
select it.hidden_like_missing(format('select public.record_source_consent(%L, %%L, %L, %L, %L, %L)', tests.actor(), 'v1', 'fake',
                                     'everyone', 'Asia/Kolkata'), tests.id('r2'), 'BTNF0', 'recordSourceConsent');
select it.hidden_like_missing(format($q$select public.add_exclusion(p_actor_profile_id => %L, p_source_id => %%L, p_kind => 'date_range',
                                       p_range_start => now() - interval '1 day', p_range_end => now())$q$, tests.actor()),
                              tests.id('r2'), 'BTNF0', 'addExclusion');
select it.hidden_like_missing(format('select public.remove_source(%L, %%L)', tests.actor()), tests.id('s2'), 'BTNF0', 'removeSource');
select it.hidden_like_missing(format('select public.source_upload_target(%L, %%L)', tests.actor()), tests.id('r2'), 'BTNF0', 'uploadTarget');
select it.hidden_like_missing(format('select public.source_preview_target(%L, %%L)', tests.actor()), tests.id('r2'), 'BTNF0', 'previewTarget (R2)');
select it.hidden_like_missing(format('select public.confirm_identity_match(%L, %%L, %L, %L)', tests.actor(), tests.id('ex2'), 'same_person'),
                              tests.id('r2'), 'BTNF0', 'confirmIdentityMatch');
select it.hidden_like_missing(format('select public.erasure_target(%L, %%L)', tests.actor()), tests.id('part2'), 'BTNF0', 'erasureTarget');
select it.hidden_like_missing(format('select public.update_member_clearance(%L, %%L, %L)', tests.actor(), 'leads_only'),
                              tests.id('h2/cara'), 'BTNF0', 'updateMemberClearance');
select it.hidden_like_missing(format('select public.remove_member(%L, %%L)', tests.actor()), tests.id('h2/cara'), 'BTNF0', 'removeMember');
select it.hidden_like_missing(format('select public.revoke_access_token(%L, %%L)', tests.actor()), tests.id('tok2'), 'BTNF0', 'revokeAccessToken');
select it.hidden_like_missing(format('select public.review_gap_answer(%L, %%L, %L)', tests.actor(), 'accept'), tests.id('ans2'), 'BTNF0',
                              'reviewGapAnswer');

-- ── Smuggling H2 ids into H1 calls ──────────────────────────────────────────
select it.hidden_like_missing(format('select public.exclude_evidence(%L, %L, %%L, %L)', tests.actor(), tests.id('q1'), 'x'),
                              tests.id('pe2'), 'BTNF0', 'H1 point + H2 evidence link');
select it.hidden_like_missing(format($q$select public.create_gap_question(%L, %L, %%L, null, 'Q?', null, 'optional')$q$,
                                     tests.actor(), tests.id('h1')), tests.id('q2'), 'BTNF0', 'H1 question about an H2 point');
select it.hidden_like_missing(format($q$select public.create_gap_question(%L, %L, null, 'owner', 'Q?', null, 'optional', 'everyone', %%L)$q$,
                                     tests.actor(), tests.id('h1')), tests.id('h2/cara'), 'BTNF0', 'H1 question assigned to an H2 member');
select it.hidden_like_missing(format('select public.create_gap_interview_link(%L, %L, %L, array[%%L]::uuid[], %L, %L, 20)',
                                     tests.actor(), tests.id('h1'), sha256('it05-x'::bytea), 'everyone', now() + interval '1 day'),
                              tests.id('gq2'), 'BTNF0', 'H1 link scoped to an H2 question');
select it.hidden_like_missing(format($q$select public.submit_gap_answers(%L, jsonb_build_array(
                                          jsonb_build_object('gapQuestionId', %L, 'answerText', 'a'),
                                          jsonb_build_object('gapQuestionId', %%L, 'answerText', 'b')))$q$,
                                     tests.actor(), tests.id('gq1')), tests.id('gq2'), 'BTNF0', 'answers mixing H1 and H2 questions');
select tests.eq((select count(*)::int from public.gap_answers where gap_question_id = tests.id('gq1')), 0,
                'the rejected mixed batch wrote nothing (one transaction)');

-- a H1 Gap Interview token cannot reach H2 questions
select tests.as_service();
select it.hidden_like_missing(format($q$select public.submit_gap_answers_with_token(%L, 'Visitor',
                                          jsonb_build_array(jsonb_build_object('gapQuestionId', %%L, 'answerText', 'x')))$q$,
                                     sha256('it05-tok1'::bytea)), tests.id('gq2'), 'BTNF0', 'token of H1 answering an H2 question');
select tests.eq((select array_agg(q ->> 'id') from jsonb_array_elements(public.get_gap_interview(sha256('it05-tok1'::bytea)) -> 'questions') q),
                array[tests.id('gq1')::text], 'the H1 token lists only its own question');
select tests.throws(format('select public.get_gap_interview(%L)', sha256('it05-unknown'::bytea)), 'BTTI0', 'an unknown token is token_invalid');

-- control: the helper does fail when the id is visible (and the call's effects are rolled back)
select tests.as_user('ann');
select tests.ok(tests.try(format($q$select it.hidden_like_missing(%L, %L, 'BTNF0', 'control')$q$,
                                 format('select public.reject_point(%L, %%L, %L)', tests.actor(), 'no'), tests.id('q1'))) like 'ERR:%',
                'control: hidden_like_missing rejects a visible id');
select tests.as_owner();
select tests.eq((select review_state from public.handover_points where id = tests.id('q1')), 'pending', 'control rolled back');

-- the reviewer of H1 is also a stranger to H2
select tests.as_user('rev');
select it.hidden_like_missing(format('select public.reject_point(%L, %%L, %L)', tests.actor(), 'no'), tests.id('q2'), 'BTNF0',
                              'reviewer of H1 on an H2 point');
select tests.as_owner();
select tests.eq((select review_state from public.handover_points where id = tests.id('q2')), 'pending', 'H2 point untouched');
select tests.eq((select state from public.handovers where id = tests.id('h2')), 'in_review', 'H2 state untouched');
select tests.ok((select deleted_at is null from public.handovers where id = tests.id('h2')), 'H2 not deleted');
