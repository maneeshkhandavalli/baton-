-- RLS isolation and role access (§8.2–§8.5), exercised as each role through the same paths PostgREST uses.
\set ON_ERROR_STOP 1

select tests.user(u) from unnest(array['ann', 'rev', 'lead', 'inc', 'out', 'bob']) u;
select tests.handover('h1', 'ann', 'outgoing');
select tests.handover('h2', 'bob', 'reviewer');
select tests.member('h1', 'rev', 'reviewer');
select tests.member('h1', 'lead', 'lead');
select tests.member('h1', 'inc', 'incoming');
select tests.source('h1', 's_all', 'everyone');
select tests.source('h1', 's_leads', 'leads_only');
select tests.source('h1', 's_rev', 'reviewer_only');
select tests.source('h2', 's_h2');
select tests.point('h1', 'p_all');   select tests.cite('p_all', 's_all', 'alice', 1);
select tests.point('h1', 'p_leads'); select tests.cite('p_leads', 's_leads', 'bob', 1);
select tests.point('h1', 'p_rev');   select tests.cite('p_rev', 's_rev', 'carol', 1);
select tests.point('h2', 'p_h2');    select tests.cite('p_h2', 's_h2', 'alice', 1);
select tests.set_state('h1', 'in_review');
select tests.approve_all('h1');

-- Publish as the creator (readiness must pass under the lock).
do $$
begin
  perform tests.as_user('ann');
  perform tests.put('pub1', public.publish_handover(tests.actor(), tests.id('h1'), 'Summary from everyone-level points'));
  perform tests.as_owner();
end $$;

-- ── anon: nothing ────────────────────────────────────────────────────────────
do $$
begin
  perform tests.as_anon();
  perform tests.throws('select count(*) from public.handovers', '42501', 'anon cannot read handovers');
  perform tests.throws('select count(*) from public.publication_points', '42501', 'anon cannot read publications');
  perform tests.throws('select public.api_list_my_handovers()', '42501', 'anon cannot call the read API');
  perform tests.as_owner();
end $$;

-- ── Tenant isolation ─────────────────────────────────────────────────────────
do $$
begin
  perform tests.as_reader('out');
  perform tests.eq((select count(*) from public.handovers), 0::bigint, 'non-member sees no handovers');
  perform tests.eq((select count(*) from public.handover_points), 0::bigint, 'non-member sees no points');
  perform tests.eq((select count(*) from public.publication_points), 0::bigint, 'non-member sees no publication rows');
  perform tests.eq((select count(*) from public.handover_member_directory), 0::bigint, 'non-member sees no member names');
  perform tests.ok(public.api_get_handover(tests.id('h1')) is null, 'getHandover → not_found');
  perform tests.ok(public.api_get_point(tests.id('p_all')) is null, 'getPoint → not_found');
  perform tests.ok(public.api_get_published_handover(tests.id('h1')) is null, 'getPublishedHandover → not_found');
  perform tests.eq(public.api_list_my_handovers(), '[]'::jsonb, 'dashboard empty');

  perform tests.as_reader('bob');
  perform tests.eq((select count(*) from public.handovers), 1::bigint, 'bob sees only h2');
  perform tests.eq((select count(*) from public.handover_points), 1::bigint, 'bob sees only h2 points');
  perform tests.eq((select count(*) from public.evidence_quotes), 1::bigint, 'bob sees only h2 evidence');
  -- writes in another tenant look exactly like missing rows (the server acting for bob)
  perform tests.as_user('bob');
  perform tests.throws(format('select public.approve_point(tests.actor(), %L, %L)', tests.id('p_all'), gen_random_uuid()), 'BTNF0',
                       'acting on another handover''s point is not_found');
  perform tests.as_owner();
end $$;

-- ── Incoming: published view to own clearance, no review workspace ──────────
do $$
begin
  perform tests.as_reader('inc');
  perform tests.eq((select count(*) from public.handovers), 1::bigint, 'incoming sees the handover');
  perform tests.eq((select count(*) from public.handover_points), 0::bigint, 'incoming sees no review points');
  perform tests.eq((select count(*) from public.sources), 0::bigint, 'incoming sees no sources');
  perform tests.eq((select count(*) from public.evidence_quotes), 0::bigint, 'incoming sees no evidence');
  perform tests.eq((select count(*) from public.review_actions), 0::bigint, 'incoming sees no review history');
  perform tests.eq((select count(*) from public.audit_logs), 0::bigint, 'incoming sees no audit');
  perform tests.eq((select count(*) from public.publication_points), 1::bigint, 'incoming sees everyone-level rows only');
  perform tests.eq((select count(*) from public.handover_members), 1::bigint, 'incoming sees only their own member row');
  perform tests.eq((select count(*) from public.handover_member_directory where clearance is not null), 0::bigint,
                   'clearance hidden from non-creators');
  perform tests.eq((select count(*) from public.handover_member_directory), 4::bigint, 'incoming sees member names');
  perform tests.eq(public.api_list_points(tests.id('h1')), '[]'::jsonb, 'listPoints empty, no hint of hidden rows');
  perform tests.ok(public.api_get_readiness(tests.id('h1')) is null, 'readiness is review-roles only');
  perform tests.ok(public.api_get_point(tests.id('p_all')) is null, 'getPoint hidden from incoming');
  perform tests.eq(jsonb_array_length(public.api_get_published_handover(tests.id('h1')) -> 'sections'), 1,
                   'published view has one visible section');
  perform tests.throws('select count(*) from public.access_tokens', '42501', 'tokens never readable');
  perform tests.throws('select count(*) from public.participant_erasures', '42501', 'erasures never readable');
  perform tests.as_owner();
end $$;

-- ── Lead: published view to leads_only ───────────────────────────────────────
do $$
begin
  perform tests.as_reader('lead');
  perform tests.eq((select count(*) from public.publication_points), 2::bigint, 'lead sees everyone + leads_only rows');
  perform tests.eq((select count(*) from public.handover_points), 0::bigint, 'lead has no review workspace (D3)');
  perform tests.as_owner();
end $$;

-- ── Review roles see everything under review ─────────────────────────────────
do $$
begin
  perform tests.as_reader('rev');
  perform tests.eq((select count(*) from public.handover_points), 3::bigint, 'reviewer sees every point');
  perform tests.eq((select count(*) from public.sources), 3::bigint, 'reviewer sees every source');
  perform tests.eq((select count(*) from public.publication_points), 3::bigint, 'reviewer sees every published row');
  perform tests.eq(jsonb_array_length(public.api_list_points(tests.id('h1'))), 3, 'listPoints for reviewer');
  perform tests.ok(public.api_get_point(tests.id('p_rev')) is not null, 'reviewer can open a reviewer_only point');
  perform tests.ok(public.api_get_readiness(tests.id('h1')) is not null, 'reviewer gets readiness');
  perform tests.eq((select count(*) from public.handover_member_directory where clearance is not null), 0::bigint,
                   'reviewer (not creator) does not see clearances');
  perform tests.as_reader('ann');
  perform tests.eq((select count(*) from public.handover_member_directory where clearance is not null), 4::bigint,
                   'creator sees clearances');
  perform tests.as_owner();
end $$;

-- ── No client role can write any table directly ──────────────────────────────
do $$
declare
  u text;
begin
  foreach u in array array['ann', 'rev', 'inc'] loop
    perform tests.as_reader(u);
    perform tests.throws(format($q$insert into public.handover_points (handover_id, category, origin) values (%L, 'decision', 'manual')$q$, tests.id('h1')),
                         '42501', u || ': no INSERT on points');
    perform tests.throws(format($q$update public.handovers set title = 'x' where id = %L$q$, tests.id('h1')), '42501', u || ': no UPDATE on handovers');
    perform tests.throws($q$delete from public.review_actions$q$, '42501', u || ': no DELETE on review_actions');
    perform tests.throws($q$update public.handover_members set clearance = 'reviewer_only'$q$, '42501', u || ': cannot raise own clearance');
    perform tests.throws($q$insert into public.acknowledgements (handover_id, publication_id, profile_id, statement_version) values (gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), 'v')$q$,
                         '42501', u || ': no direct acknowledgement insert');
    perform tests.throws(format('select public.erase_participant(gen_random_uuid(), %L, ''phone'', %L, %L, null, %L)', tests.id('h1'), '\x00', 'p1', tests.id('ann')),
                         '42501', u || ': erase_participant is service-role only');
    perform tests.throws(format('select public.resolve_privacy_review(%L, %L, %L, %L)', tests.id('p_all'), '{}', 'x', tests.id('ann')),
                         '42501', u || ': resolve_privacy_review is service-role only');
    perform tests.throws(format('select public.transition_handover(%L, %L)', tests.id('h1'), 'acknowledged'),
                         '42501', u || ': transition_handover is internal');
  end loop;
  perform tests.as_owner();
end $$;

-- ── Role permissions (§8.2) ──────────────────────────────────────────────────
do $$
begin
  perform tests.as_user('rev');
  perform tests.throws(format('select public.start_revision(tests.actor(), %L)', tests.id('h1')), 'BTFB0', 'reviewer cannot start a revision');
  perform tests.throws(format('select public.invite_member(tests.actor(), %L, %L, %L, null, %L, now() + interval ''1 day'')',
                              tests.id('h1'), 'x@example.test', 'incoming', sha256('\x01')), 'BTFB0', 'reviewer cannot invite');
  perform tests.throws(format('select public.create_source(tests.actor(), %L, %L, %L, %L, 10, %L)', tests.id('h1'), 'text', 'a.txt', 'text/plain',
                              repeat('a', 64)), 'BTFB0', 'reviewer cannot upload sources');
  perform tests.as_user('inc');
  perform tests.throws(format('select public.publish_handover(tests.actor(), %L)', tests.id('h1')), 'BTFB0', 'incoming cannot publish');
  perform tests.as_user('lead');
  perform tests.throws(format('select public.acknowledge_publication(tests.actor(), %L, %L)', tests.id('pub1'), 'v1'), 'BTFB0',
                       'only incoming members acknowledge');
  perform tests.as_owner();
end $$;

-- ── Gap questions: assignment, clearance and privacy holds (§5.5, §8.4) ──────
do $$
declare
  v_q_open uuid; v_q_unassigned uuid; v_q_held uuid; v_q_leads uuid;
begin
  perform tests.set_state('h1', 'in_review');
  perform tests.as_user('ann');
  v_q_open := public.create_gap_question(tests.actor(), tests.id('h1'), null, 'owner', 'Who holds the keys?', null, 'required', 'everyone', tests.id('h1/inc'));
  v_q_unassigned := public.create_gap_question(tests.actor(), tests.id('h1'), null, 'owner', 'Unassigned?', null, 'optional', 'everyone', null);
  v_q_held := public.create_gap_question(tests.actor(), tests.id('h1'), tests.id('p_all'), null, 'About p_all?', null, 'optional', 'everyone', tests.id('h1/inc'));
  v_q_leads := public.create_gap_question(tests.actor(), tests.id('h1'), null, 'risk', 'Leads only?', null, 'optional', 'leads_only', tests.id('h1/inc'));
  perform tests.as_owner();
  -- p_all enters privacy review: its question is now held
  perform set_config('baton.erasure', 'on', true);
  perform public._flag_point_for_privacy(tests.id('p_all'), 'participant_erasure');
  perform set_config('baton.erasure', 'off', true);

  perform tests.as_reader('inc');
  perform tests.eq((select count(*) from public.gap_questions), 1::bigint,
                   'incoming sees only their assigned, open, cleared, non-held question');
  perform tests.eq((select id from public.gap_questions), v_q_open, 'the visible question is the open one');
  perform tests.eq((select count(*) from public.publication_points), 0::bigint, 'held publication rows vanish without placeholder');
  perform tests.as_user('inc'); -- the server submits on the member's behalf
  perform tests.throws(format('select public.submit_gap_answers(tests.actor(), %L)', jsonb_build_array(jsonb_build_object('gapQuestionId', v_q_held, 'answerText', 'x'))),
                       'BTNF0', 'answering a held question is not_found');
  perform tests.throws(format('select public.submit_gap_answers(tests.actor(), %L)', jsonb_build_array(jsonb_build_object('gapQuestionId', v_q_leads, 'answerText', 'x'))),
                       'BTNF0', 'answering above clearance is not_found');
  perform tests.throws(format('select public.submit_gap_answers(tests.actor(), %L)', jsonb_build_array(jsonb_build_object('gapQuestionId', v_q_unassigned, 'answerText', 'x'))),
                       'BTNF0', 'answering an unassigned question is not_found');
  perform tests.eq(public.submit_gap_answers(tests.actor(), jsonb_build_array(jsonb_build_object('gapQuestionId', v_q_open, 'answerText', 'Asha'))), 1,
                   'answering the assigned question works');
  perform tests.as_reader('inc');
  perform tests.eq((select count(*) from public.gap_answers), 1::bigint, 'incoming sees their own answer');

  perform tests.as_reader('rev');
  perform tests.eq((select count(*) from public.gap_questions), 4::bigint, 'review roles see every question, held or not');
  perform tests.ok((select (q ->> 'privacy_held')::boolean from jsonb_array_elements(public.api_list_gap_questions(tests.id('h1'))) q
                     where (q ->> 'id')::uuid = v_q_held), 'review roles see the held flag');
  perform tests.as_user('rev');
  perform tests.throws(format('select public.create_gap_question(tests.actor(), %L, %L, null, %L, null, %L)', tests.id('h1'), tests.id('p_all'), 'More?', 'optional'),
                       'BTPF0', 'createGapQuestion on a held point is precondition_failed');
  perform tests.as_owner();
end $$;

-- ── H1: the browser cannot call any mutation; the server path validates the actor ──
do $$
declare
  v_unexpected text;
  f text;
begin
  -- Exact allow-list of what the authenticated (browser) role may execute in public: RLS helpers and reads.
  select string_agg(p.oid::regprocedure::text, ', ' order by 1) into v_unexpected
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and has_function_privilege('authenticated', p.oid, 'EXECUTE')
     and p.proname not like 'dblink%'
     and p.proname not in (
       'access_rank', 'max_access', 'is_member', 'member_role', 'clearance', 'is_creator', 'is_review_role',
       'within_clearance', 'point_visible', 'source_visible', 'gap_question_privacy_held', 'gap_answer_privacy_held',
       'my_member_id', 'gap_question_visible_to_member', 'member_label', 'has_incoming_recipient', 'get_privacy_review',
       'readiness_report', 'can_upload_source_object', '_source_json',
       'api_list_my_handovers', 'api_get_handover', 'api_list_members', 'api_list_sources', 'api_get_processing_status',
       'api_list_points', 'api_get_point', 'api_list_gap_questions', 'api_get_readiness', 'api_get_published_handover',
       'api_list_participants', 'api_list_exclusions', 'api_get_source_message_context',
       'api_list_my_creator_transfer_offers', 'get_account_deletion_blockers', 'list_access_tokens');
  perform tests.ok(v_unexpected is null, 'authenticated executes only reads and RLS helpers; unexpected: ' || coalesce(v_unexpected, ''));
  perform tests.ok(not has_function_privilege('anon', 'public.api_list_my_handovers()', 'EXECUTE'), 'anon executes nothing');

  -- Every application mutation is server-only.
  foreach f in array array[
    'create_handover(uuid,text,text,text,text,text)', 'start_processing(uuid,uuid,text,jsonb,jsonb)', 'cancel_processing(uuid,uuid)',
    'publish_handover(uuid,uuid,text)', 'start_revision(uuid,uuid)', 'delete_handover(uuid,uuid)', 'acknowledge_publication(uuid,uuid,text)',
    'approve_point(uuid,uuid,uuid,boolean,text,boolean)', 'reject_point(uuid,uuid,text)', 'reopen_point(uuid,uuid,text)',
    'edit_point(uuid,uuid,uuid,text,text,jsonb,text)', 'confirm_inferred(uuid,uuid,text)', 'resolve_conflict(uuid,uuid,text)',
    'exclude_evidence(uuid,uuid,uuid,text)', 'restore_evidence(uuid,uuid,uuid)', 'change_point_access(uuid,uuid,text)',
    'create_manual_point(uuid,uuid,text,text,text,jsonb,text,text,text,text)',
    'create_gap_question(uuid,uuid,uuid,text,text,text,text,text,uuid)',
    'submit_gap_answers(uuid,jsonb)', 'review_gap_answer(uuid,uuid,text,text)',
    'create_source(uuid,uuid,text,text,text,bigint,text,text)',
    'source_upload_target(uuid,uuid)', 'confirm_source_uploaded(uuid,uuid,bigint,text)',
    'record_source_consent(uuid,uuid,text,text,text,text,text,date)',
    'add_exclusion(uuid,uuid,text,text,text,text,text,text,text,text,text,timestamp with time zone,timestamp with time zone,text)',
    'confirm_identity_match(uuid,uuid,uuid,text)',
    'remove_source(uuid,uuid)',
    'create_gap_interview_link(uuid,uuid,bytea,uuid[],text,timestamp with time zone,integer)', 'revoke_access_token(uuid,uuid)',
    'invite_member(uuid,uuid,text,text,text,bytea,timestamp with time zone)', 'update_member_clearance(uuid,uuid,text)',
    'remove_member(uuid,uuid)', 'offer_creator_transfer(uuid,uuid,uuid)', 'respond_to_creator_transfer(uuid,uuid,boolean)'] loop
    perform tests.ok(not has_function_privilege('authenticated', ('public.' || f)::regprocedure, 'EXECUTE'), 'browser cannot execute ' || f);
    perform tests.ok(has_function_privilege('service_role', ('public.' || f)::regprocedure, 'EXECUTE'), 'server can execute ' || f);
  end loop;

  -- A direct PostgREST call from the browser fails, even when it names itself as the actor.
  perform tests.as_reader('ann');
  perform tests.throws(format('select public.start_revision(%L, %L)', tests.id('ann'), tests.id('h1')), '42501',
                       'browser start_revision denied');
  perform tests.throws(format($q$select public.edit_point(%L, %L, %L, 't', 's', '{}', 'r')$q$, tests.id('rev'), tests.id('p_all'), gen_random_uuid()),
                       '42501', 'browser edit_point denied');
  perform tests.throws(format($q$select public.create_handover(%L, 'Title', 'Team', null, null, 'outgoing')$q$, tests.id('ann')),
                       '42501', 'browser create_handover denied');

  -- The server path still enforces the actor's own membership, role and existence.
  perform tests.as_service();
  perform tests.throws(format('select public.start_revision(%L, %L)', tests.id('out'), tests.id('h1')), 'BTNF0',
                       'non-member actor is not_found');
  perform tests.throws(format('select public.start_revision(%L, %L)', tests.id('rev'), tests.id('h1')), 'BTFB0',
                       'a reviewer actor cannot do creator-only work');
  perform tests.throws(format('select public.start_revision(%L, %L)', gen_random_uuid(), tests.id('h1')), 'BTUA0',
                       'unknown actor id is unauthenticated');
  perform tests.throws(format('select public.start_revision(null, %L)', tests.id('h1')), 'BTUA0', 'missing actor is unauthenticated');
  -- A session JWT for one person can never act as another.
  perform tests.as_user('rev');
  perform tests.throws(format('select public.start_revision(%L, %L)', tests.id('ann'), tests.id('h1')), 'BTFB0',
                       'actor must match the session subject');
  -- Defence in depth: a client API role is refused inside the function even if a grant were added.
  -- Simulate a mistaken grant: the in-function check still refuses the browser role.
  perform tests.as_owner();
  grant execute on function public._require_actor(uuid) to authenticated;
  perform tests.as_reader('ann');
  perform tests.throws(format('select public._require_actor(%L)', tests.id('ann')), 'BTFB0', 'client roles are refused by _require_actor');
  perform tests.as_owner();
  revoke execute on function public._require_actor(uuid) from authenticated;
  -- A deleted auth user cannot act.
  update auth.users set deleted_at = now() where id = tests.id('out');
  perform tests.as_service();
  perform tests.throws(format($q$select public.create_handover(%L, 'Title', 'Team', null, null, 'outgoing')$q$, tests.id('out')),
                       'BTUA0', 'deleted auth user cannot act');
  perform tests.as_owner();
end $$;

-- ── H2: erasure and purge are unreachable for every application role (D27 stays open) ──
do $$
declare
  r text;
begin
  foreach r in array array['anon', 'authenticated', 'service_role'] loop
    perform tests.ok(not has_function_privilege(r, 'public.erase_participant(uuid,uuid,text,bytea,text,uuid,uuid)', 'EXECUTE'), r || ' cannot erase');
    perform tests.ok(not has_function_privilege(r, 'public.purge_handover(uuid,uuid,uuid)', 'EXECUTE'), r || ' cannot purge');
  end loop;
  perform tests.ok(not exists (select 1 from pg_roles where rolname = 'baton_restore'), 'no baton_restore role is created (D27)');
  perform tests.as_service();
  perform tests.throws(format('select public.erase_participant(gen_random_uuid(), %L, ''phone'', %L, %L, null, %L)', tests.id('h1'), '\x00', 'p1', tests.id('ann')),
                       '42501', 'service_role erase denied');
  perform tests.throws(format('select public.purge_handover(gen_random_uuid(), %L, %L)', tests.id('h1'), tests.id('ann')),
                       '42501', 'service_role purge denied');
  perform tests.as_owner();
end $$;

select 'ok' as rls;
