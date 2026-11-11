-- Revision 8 reconciliation (docs/architecture/contract-reconciliation.md §4.2):
--   S2–S6  identity kinds, exclusion context, source_identity_confirmations, rule feed with modes;
--   S7     name erasures limited to one source; same-name participants reported, not erased;
--   S9     new read API (participants, exclusions, message context, access tokens, creator offers);
--   S10    a point question takes the point's category;
--   D25    typed DELETE confirmation and unique purge ids, checked by the database.
\set ON_ERROR_STOP 1

select tests.user(u) from unnest(array['ann', 'out', 'rev', 'inc', 'eve']) u;
select tests.handover('h', 'ann', 'outgoing');
select tests.member('h', 'out', 'outgoing');
select tests.member('h', 'rev', 'reviewer');
select tests.member('h', 'inc', 'incoming');
select tests.handover('other', 'eve', 'outgoing');
select tests.source('other', 'so');

-- An uploaded, consented source that has not been parsed yet.
create function tests.uploaded(p_handover text, p_name text) returns uuid language plpgsql as $$
declare v uuid;
begin
  insert into public.sources (handover_id, uploaded_by, kind, title, original_filename, mime_type, size_bytes, sha256, state,
                              access_level, timezone, consent_statement_version, consent_ai_provider, consent_recorded_at,
                              consent_recorded_by, raw_storage_path)
  select h.id, h.created_by, 'whatsapp_export', 'Upload ' || p_name, p_name || '.txt', 'text/plain', 100,
         sha256(convert_to('upload' || p_name, 'UTF8')), 'uploaded', 'everyone', 'Asia/Kolkata', 'v1', 'fake', now(),
         h.created_by, 'raw/' || h.id || '/' || p_name
    from public.handovers h where h.id = tests.id(p_handover)
  returning id into v;
  return tests.put(p_name, v);
end $$;

-- A one-participant ParsedSource whose only author has the given identity.
create function tests.parsed(p_kind text, p_who text, p_messages int default 1) returns jsonb language sql as $$
  select jsonb_build_object(
    'kind', 'whatsapp_export', 'parserVersion', '1.0.0',
    'participants', jsonb_build_array(jsonb_build_object(
      'localId', 'p_1', 'displayLabel', initcap(p_who), 'identityKind', p_kind,
      'identityHash', encode(sha256(convert_to(p_who, 'UTF8')), 'hex'), 'identityPepperVersion', 'p1',
      'messageCount', p_messages)),
    'conversations', '[]'::jsonb,
    'messages', coalesce((select jsonb_agg(jsonb_build_object(
      'seq', g - 1, 'conversationLocalId', null, 'participantLocalId', 'p_1', 'sentAt', '2026-07-01T10:00:00Z',
      'kind', 'text', 'body', 'message ' || g, 'location', null)) from generate_series(1, p_messages) g), '[]'::jsonb),
    'masking', jsonb_build_object('counts', jsonb_build_object('phone', 0)), 'stats', '{}'::jsonb,
    'firstMessageAt', '2026-07-01T10:00:00Z', 'lastMessageAt', '2026-07-01T10:00:00Z', 'warnings', '[]'::jsonb)
$$;

create function tests.hex(p_who text) returns text language sql as $$ select encode(sha256(convert_to(p_who, 'UTF8')), 'hex') $$;

-- Start a run over one source (as the creator) and return its id.
create function tests.start_run(p_source text) returns uuid language plpgsql as $$
declare v uuid;
begin
  perform tests.as_user('ann');
  v := public.start_processing(tests.actor(), tests.id('h'), '1', '{"provider":"fake"}',
         jsonb_build_array(jsonb_build_object('stage', 'parse', 'sourceId', tests.id(p_source), 'inputHash', repeat('ab', 32))));
  perform tests.as_owner();
  return v;
end $$;

create function tests.fail_run(p_run uuid) returns void language plpgsql as $$
begin
  perform tests.as_service();
  perform public.finish_processing_run(p_run, 'failed', 'precondition_failed', 'identity_confirmation_required');
  perform tests.as_owner();
end $$;

create function tests.rule_for(p_source text, p_exclusion uuid) returns jsonb language sql as $$
  select r from jsonb_array_elements(public.parse_exclusion_rules(tests.id(p_source))) r where r ->> 'ruleId' = p_exclusion::text
$$;

select tests.uploaded('h', 'sx');   -- where the excluded participant was picked
select tests.uploaded('h', 'sy');   -- a later upload that contains someone with the same saved name
select tests.uploaded('h', 'sz');   -- another later upload

-- ── addExclusion (S3, S12): derived handover, validation, companion row for a name rule ──────────────
do $$
declare
  v_name uuid;
  v_phone uuid;
  v_conv uuid;
  v_range uuid;
  v_rule jsonb;
begin
  perform tests.as_user('ann');
  v_name := public.add_exclusion(tests.actor(), tests.id('sx'), 'participant', 'handover', 'name', tests.hex('ravi'), 'p1',
                                 p_reason => 'asked to be left out');
  perform tests.put('ex_name', v_name);
  perform tests.eq((select handover_id from public.source_exclusions where id = v_name), tests.id('h'),
                   'S12: the handover is derived from the source');
  perform tests.ok((select source_id is null and participant_identity_kind = 'name' from public.source_exclusions where id = v_name),
                   'S3: handover-wide name exclusion stores its identity kind');
  perform tests.eq((select count(*)::int from public.source_exclusions
                     where source_id = tests.id('sx') and kind = 'participant' and participant_identity_kind = 'name'), 1,
                   'D29: the source the participant was picked from gets an explicit source-scoped rule');
  perform tests.eq(public.add_exclusion(tests.actor(), tests.id('sx'), 'participant', 'handover', 'name', tests.hex('ravi'), 'p1'),
                   v_name, 'replaying the same handover-wide exclusion returns the same row');
  v_phone := public.add_exclusion(tests.actor(), tests.id('sx'), 'participant', 'handover', 'phone', tests.hex('+919999900001'), 'p1');
  perform tests.put('ex_phone', v_phone);
  perform tests.ok(v_phone <> v_name, 'S3: the same hash under another identity kind is a different exclusion');

  v_conv := public.add_exclusion(tests.actor(), tests.id('sx'), 'conversation', 'source', p_conversation_local_id => 'c_2',
                                 p_parse_timezone => 'Asia/Kolkata', p_parse_date_order => null, p_parser_version => '1.0.0');
  v_rule := tests.rule_for('sx', v_conv);
  perform tests.ok(v_rule -> 'context' = '{"timezone": "Asia/Kolkata", "dateOrder": null, "parserVersion": "1.0.0"}'::jsonb,
                   'D32: a conversation rule carries its parse context, with dateOrder null for no date order');
  v_range := public.add_exclusion(tests.actor(), tests.id('sx'), 'date_range', 'handover',
                                  p_range_start => '2026-01-01T00:00:00Z', p_range_end => '2026-01-31T00:00:00Z');
  perform tests.ok(tests.rule_for('sz', v_range) ->> 'kind' = 'date_range', 'a handover-wide date range applies to other sources');

  -- validation (server-side, independent of the Zod schema)
  perform tests.throws(format($q$select public.add_exclusion(tests.actor(), %L, 'conversation', 'source', p_conversation_local_id => 'c_1')$q$,
                              tests.id('sx')), 'BTVF0', 'D32: a conversation exclusion without its parse context is refused');
  perform tests.throws(format($q$select public.add_exclusion(tests.actor(), %L, 'conversation', 'handover', p_conversation_local_id => 'c_1',
                                  p_parse_timezone => 'UTC', p_parser_version => '1')$q$, tests.id('sx')),
                       'BTVF0', 'conversation exclusions are always source-scoped');
  perform tests.throws(format($q$select public.add_exclusion(tests.actor(), %L, 'conversation', 'source', p_conversation_local_id => 'c_0',
                                  p_parse_timezone => 'UTC', p_parser_version => '1')$q$, tests.id('sx')),
                       'BTVF0', 'c_N needs N >= 1');
  perform tests.throws(format($q$select public.add_exclusion(tests.actor(), %L, 'participant', 'source', 'email', %L, 'p1')$q$,
                              tests.id('sx'), tests.hex('x')), 'BTVF0', 'unknown identity kind refused');
  perform tests.throws(format($q$select public.add_exclusion(tests.actor(), %L, 'participant', 'source', 'name', 'ABCD', 'p1')$q$,
                              tests.id('sx')), 'BTVF0', 'malformed hash refused');
  perform tests.throws(format($q$select public.add_exclusion(tests.actor(), %L, 'participant', 'source', 'name', %L, 'p2')$q$,
                              tests.id('sx'), tests.hex('x')), 'BTVF0', 'pepper version must be p1');
  perform tests.throws(format($q$select public.add_exclusion(tests.actor(), %L, 'date_range', 'source',
                                  p_range_start => '2026-02-01Z', p_range_end => '2026-01-01Z')$q$, tests.id('sx')),
                       'BTVF0', 'a date range must not end before it starts');
  perform tests.throws(format($q$select public.add_exclusion(tests.actor(), %L, 'participant', 'everywhere', 'name', %L, 'p1')$q$,
                              tests.id('sx'), tests.hex('x')), 'BTVF0', 'unknown scope refused');
  perform tests.as_user('rev');
  perform tests.throws(format($q$select public.add_exclusion(tests.actor(), %L, 'participant', 'source', 'name', %L, 'p1')$q$,
                              tests.id('sx'), tests.hex('x')), 'BTFB0', 'a reviewer does not manage sources');
  perform tests.as_user('eve');
  perform tests.throws(format($q$select public.add_exclusion(tests.actor(), %L, 'participant', 'source', 'name', %L, 'p1')$q$,
                              tests.id('sx'), tests.hex('x')), 'BTNF0', 'a non-member cannot see the source');
  perform tests.as_owner();
  perform tests.throws(format($q$insert into public.source_exclusions (handover_id, kind, participant_identity_hash,
                                  participant_identity_pepper_version, requested_via) values (%L, 'participant', '\x01', 'p1', 'uploader')$q$,
                              tests.id('h')), '23514', 'S3: identity kind, hash and pepper version are set together');
end $$;

-- ── Rule feed (S6): name rules are detect-only outside their source, phone rules apply ──────────────
do $$
declare
  v_comp uuid;
begin
  select id into v_comp from public.source_exclusions where source_id = tests.id('sx') and participant_identity_kind = 'name';
  perform tests.eq(tests.rule_for('sx', v_comp) ->> 'mode', 'apply', 'the picked source applies the name rule');
  perform tests.eq(tests.rule_for('sy', tests.id('ex_name')) ->> 'mode', 'detect',
                   'S6: another source only DETECTS a handover-wide name rule');
  perform tests.ok(tests.rule_for('sy', v_comp) is null, 'a source-scoped rule never reaches another source');
  perform tests.eq(tests.rule_for('sy', tests.id('ex_phone')) ->> 'mode', 'apply', 'a handover-wide phone rule applies everywhere');
  perform tests.ok(tests.rule_for('sy', tests.id('ex_name')) ?& array['ruleId', 'identityKind', 'participantIdentityHash',
                                                                       'identityPepperVersion', 'mode'],
                   'participant rules carry ruleId, kind, hash, pepper version and mode');
  perform tests.ok(not exists (select 1 from jsonb_array_elements(public.parse_exclusion_rules(tests.id('sy'))) r
                                where r ->> 'kind' = 'conversation'), 'conversation rules stay in their source');
end $$;

-- ── Final parse with an undecided name match fails before anything is persisted (§10.3 step 3) ──────
do $$
declare
  v_run uuid := tests.start_run('sy');
begin
  perform tests.as_service();
  perform tests.throws(format('select public.persist_parsed_source(%L, %L, %L)', tests.id('sy'), tests.parsed('name', 'ravi'), 'p1'),
                       'BTPF0', 'S6: an undecided name match blocks the parse (identity_confirmation_required)');
  perform tests.eq((select count(*)::int from public.source_participants where source_id = tests.id('sy')), 0, 'nothing persisted');
  perform tests.eq((select state from public.sources where id = tests.id('sy')), 'uploaded', 'source not parsed');
  perform tests.throws(format('select public.persist_parsed_source(%L, %L, %L)', tests.id('sy'),
                              jsonb_set(tests.parsed('name', 'ravi'), '{participants,0,identityKind}', '"email"'), 'p1'),
                       'BTVF0', 'S2: a participant without a valid identity kind is refused');
  -- confirm_identity_match is refused while the handover is processing
  perform tests.as_user('ann');
  perform tests.throws(format('select public.confirm_identity_match(tests.actor(), %L, %L, %L)', tests.id('sy'), tests.id('ex_name'),
                              'different_person'), 'BTIT0', 'no decision while a run is processing');
  perform tests.fail_run(v_run);
end $$;

-- ── confirmIdentityMatch (S5): creator only, name + handover-wide only, before the parse, audited ───
do $$
declare
  v_audit jsonb;
begin
  perform tests.as_user('out');
  perform tests.throws(format('select public.confirm_identity_match(tests.actor(), %L, %L, %L)', tests.id('sy'), tests.id('ex_name'),
                              'same_person'), 'BTFB0', 'an outgoing member who is not the creator cannot decide');
  perform tests.as_user('rev');
  perform tests.throws(format('select public.confirm_identity_match(tests.actor(), %L, %L, %L)', tests.id('sy'), tests.id('ex_name'),
                              'same_person'), 'BTFB0', 'a reviewer cannot decide');
  perform tests.as_user('eve');
  perform tests.throws(format('select public.confirm_identity_match(tests.actor(), %L, %L, %L)', tests.id('sy'), tests.id('ex_name'),
                              'same_person'), 'BTNF0', 'a non-member cannot see the source');
  perform tests.as_user('ann');
  perform tests.throws(format('select public.confirm_identity_match(tests.actor(), %L, %L, %L)', tests.id('sy'), tests.id('ex_name'),
                              'maybe'), 'BTVF0', 'unknown decision refused');
  perform tests.throws(format('select public.confirm_identity_match(tests.actor(), %L, %L, %L)', tests.id('sy'), tests.id('ex_phone'),
                              'same_person'), 'BTVF0', 'phone exclusions need no decision');
  perform tests.throws(format('select public.confirm_identity_match(tests.actor(), %L, %L, %L)', tests.id('sy'),
                              (select id from public.source_exclusions where source_id = tests.id('sx') and participant_identity_kind = 'name'),
                              'same_person'), 'BTVF0', 'source-scoped exclusions need no decision');
  perform tests.throws(format('select public.confirm_identity_match(tests.actor(), %L, %L, %L)', tests.id('sy'), gen_random_uuid(),
                              'same_person'), 'BTNF0', 'unknown exclusion');

  perform public.confirm_identity_match(tests.actor(), tests.id('sy'), tests.id('ex_name'), 'different_person');
  perform tests.ok(tests.rule_for('sy', tests.id('ex_name')) is null, 'different_person: the rule is not passed for that source');
  perform tests.eq(tests.rule_for('sz', tests.id('ex_name')) ->> 'mode', 'detect', 'a decision is per source');
  perform public.confirm_identity_match(tests.actor(), tests.id('sy'), tests.id('ex_name'), 'same_person');
  perform tests.eq(tests.rule_for('sy', tests.id('ex_name')) ->> 'mode', 'apply', 'same_person: the rule applies to that source');
  perform tests.eq((select count(*)::int from public.source_identity_confirmations where source_id = tests.id('sy')), 1,
                   'changing a decision replaces the row');
  select jsonb_agg(jsonb_build_object('before', before, 'after', after) order by id) into v_audit
    from public.audit_logs where action = 'source.identity_match_decided';
  perform tests.eq(jsonb_array_length(v_audit), 2, 'every decision is audited');
  perform tests.ok(v_audit::text not like '%' || tests.hex('ravi') || '%', 'the audit never holds the identity hash');

  -- clients and the service role cannot write decisions directly
  perform tests.as_service();
  perform tests.throws(format($q$insert into public.source_identity_confirmations (handover_id, source_id, exclusion_id, decision)
                                  values (%L, %L, %L, 'same_person')$q$, tests.id('h'), tests.id('sz'), tests.id('ex_name')),
                       '42501', 'no direct writes, even with the secret key');
  perform tests.as_owner();
  perform tests.throws(format($q$insert into public.source_identity_confirmations (handover_id, source_id, exclusion_id, decision)
                                  values (%L, %L, %L, 'same_person')$q$, tests.id('h'), tests.id('sz'), tests.id('ex_phone')),
                       'BTVF0', 'the trigger refuses a decision about a phone exclusion');
  -- review roles read decisions; other members do not
  perform tests.as_reader('rev');
  perform tests.eq((select count(*)::int from public.source_identity_confirmations), 1, 'review roles read decisions');
  perform tests.as_reader('inc');
  perform tests.eq((select count(*)::int from public.source_identity_confirmations), 0, 'incoming members do not');
  perform tests.as_owner();
end $$;

-- ── same_person: the parse must drop ravi; different_person: ravi is kept (S6 defence in depth) ─────
do $$
declare
  v_run uuid := tests.start_run('sy');
begin
  perform tests.as_service();
  perform tests.throws(format('select public.persist_parsed_source(%L, %L, %L)', tests.id('sy'), tests.parsed('name', 'ravi', 2), 'p1'),
                       'BTCF0', 'same_person: a parse that still contains the excluded participant is refused');
  perform tests.fail_run(v_run);
  perform tests.as_user('ann');
  perform public.confirm_identity_match(tests.actor(), tests.id('sy'), tests.id('ex_name'), 'different_person');
  perform tests.as_owner();
  v_run := tests.start_run('sy');
  perform tests.as_service();
  perform public.persist_parsed_source(tests.id('sy'), tests.parsed('name', 'ravi', 2), 'p1');
  perform tests.eq((select identity_kind from public.source_participants where source_id = tests.id('sy')), 'name',
                   'S2: the participant is stored with its identity kind');
  perform tests.ok(not exists (select 1 from public.source_participants
                                where source_id = tests.id('sy') and identity_kind = 'phone' and identity_hash = sha256(convert_to('ravi', 'UTF8'))),
                   'a name identity never matches a phone identity');
  perform tests.fail_run(v_run);
  perform tests.as_user('ann');
  perform tests.throws(format('select public.confirm_identity_match(tests.actor(), %L, %L, %L)', tests.id('sy'), tests.id('ex_name'),
                              'same_person'), 'BTIT0', 'no decision after the source is parsed');
  perform tests.throws(format($q$select public.add_exclusion(tests.actor(), %L, 'participant', 'source', 'name', %L, 'p1')$q$,
                              tests.id('sy'), tests.hex('x')), 'BTIT0', 'parsed sources take erasure, not exclusions');
  perform tests.as_owner();
end $$;

-- ── S7: a NAME erasure is limited to one source; same-name participants elsewhere are reported ──────
select tests.source('h', 'n1', 'everyone', 'name');
select tests.source('h', 'n2', 'everyone', 'name');
select tests.point('h', 'pn1');  select tests.cite('pn1', 'n1', 'alice', 1);
select tests.point('h', 'pn2');  select tests.cite('pn2', 'n2', 'alice', 1);
do $$
declare
  v_alice bytea := sha256(convert_to('alice', 'UTF8'));
  v_target jsonb;
  v_report jsonb;
  v_n1_alice uuid := (select id from public.source_participants where source_id = tests.id('n1') and local_id = 'p_alice');
begin
  -- erasure_target: what the manifest must bind, for the creator only
  perform tests.as_user('rev');
  perform tests.throws(format('select public.erasure_target(tests.actor(), %L)', v_n1_alice), 'BTFB0', 'only the creator erases');
  perform tests.as_user('eve');
  perform tests.throws(format('select public.erasure_target(tests.actor(), %L)', v_n1_alice), 'BTNF0', 'non-members see nothing');
  perform tests.as_user('ann');
  v_target := public.erasure_target(tests.actor(), v_n1_alice);
  perform tests.ok(v_target = jsonb_build_object('handoverId', tests.id('h'), 'identityKind', 'name', 'identityHashHex', tests.hex('alice'),
                                                 'pepperVersion', 'p1', 'scopeSourceId', tests.id('n1')),
                   'S7: a name target is scoped to the participant''s own source: ' || v_target::text);
  perform tests.as_owner();

  -- shape checks (erase_participant has no application grant, D27; exercised as the owner)
  perform tests.throws(format('select public.erase_participant(gen_random_uuid(), %L, %L, %L, %L, null, %L)', tests.id('h'), 'name',
                              v_alice, 'p1', tests.id('ann')), 'BTVF0', 'a name erasure must name its source');
  perform tests.throws(format('select public.erase_participant(gen_random_uuid(), %L, %L, %L, %L, %L, %L)', tests.id('h'), 'phone',
                              v_alice, 'p1', tests.id('n1'), tests.id('ann')), 'BTVF0', 'a phone erasure names no source');
  perform tests.throws(format('select public.erase_participant(gen_random_uuid(), %L, %L, %L, %L, %L, %L)', tests.id('h'), 'name',
                              v_alice, 'p1', tests.id('so'), tests.id('ann')), 'BTNF0', 'the scope source must belong to the handover');
  perform tests.throws(format('select public.erase_participant(gen_random_uuid(), %L, %L, %L, %L, %L, %L)', tests.id('h'), 'name',
                              v_alice, 'p1', gen_random_uuid(), tests.id('ann')), 'BTNF0', 'unknown scope source');

  v_report := public.erase_participant('00000000-0000-4000-8000-0000000000f1', tests.id('h'), 'name', v_alice, 'p1',
                                       tests.id('n1'), tests.id('ann'));
  perform tests.eq((v_report ->> 'messagesDeleted')::int, 3, 'only alice''s messages in n1 are deleted');
  perform tests.eq((v_report ->> 'quotesDeleted')::int, 1, 'only the n1 quote is erased');
  perform tests.eq((v_report ->> 'sameNameParticipantsElsewhere')::int, 1, 'alice in n2 is reported for separate review');
  perform tests.eq((select count(*)::int from public.source_messages m join public.source_participants sp on sp.id = m.participant_id
                     where sp.source_id = tests.id('n2') and sp.local_id = 'p_alice'), 3, 'alice in n2 keeps her messages');
  perform tests.ok((select not excluded and display_label = 'Alice' from public.source_participants
                     where source_id = tests.id('n2') and local_id = 'p_alice'), 'alice in n2 is untouched');
  perform tests.ok((select excluded and display_label = 'Removed participant' and message_count = 0 from public.source_participants
                     where source_id = tests.id('n1') and local_id = 'p_alice'), 'alice in n1 is removed');
  perform tests.eq((select message_count from public.sources where id = tests.id('n1')), 6, 'n1 recounted');
  perform tests.ok((select message_count from public.sources where id = tests.id('n2')) is null,
                   'n2 is not recounted (the fixture leaves it unset; only sources in scope are touched)');
  perform tests.ok((select erased_at is not null from public.handover_points where id = tests.id('pn1')), 'the n1-only point is erased');
  perform tests.ok((select erased_at is null from public.handover_points where id = tests.id('pn2')), 'the n2 point survives');
  perform tests.ok(exists (select 1 from public.participant_erasures
                            where id = '00000000-0000-4000-8000-0000000000f1' and identity_kind = 'name' and scope_source_id = tests.id('n1')),
                   'S7: participant_erasures records kind and scope source');
  perform tests.ok(exists (select 1 from public.source_exclusions where handover_id = tests.id('h') and source_id is null
                             and participant_identity_kind = 'name' and participant_identity_hash = v_alice
                             and requested_via = 'participant_request'),
                   'a handover-wide name exclusion is recorded (detected in later uploads)');
  perform tests.throws($q$insert into public.participant_erasures (id, handover_id, exclusion_id, identity_kind, scope_source_id)
                          select gen_random_uuid(), handover_id, exclusion_id, 'phone', scope_source_id from public.participant_erasures limit 1$q$,
                       '23514', 'a phone erasure row cannot carry a scope source');
  v_report := public.erase_participant('00000000-0000-4000-8000-0000000000f1', tests.id('h'), 'name', v_alice, 'p1',
                                       tests.id('n1'), tests.id('ann'));
  perform tests.ok((v_report ->> 'alreadyApplied')::boolean and (v_report ->> 'sameNameParticipantsElsewhere')::int = 0,
                   'replay is idempotent');
end $$;

-- ── S9: read API ─────────────────────────────────────────────────────────────
do $$
declare
  v jsonb;
  v_link uuid;
  v_invite uuid;
  v_gap uuid;
  v_pe uuid := (select pe.id from public.point_evidence pe where pe.point_id = tests.id('pn2'));
begin
  -- MemberSummary.isCreator / isViewer
  perform tests.as_user('inc');
  v := tests.read(format('select public.api_list_members(%L)', tests.id('h')));
  perform tests.eq((select count(*)::int from jsonb_array_elements(v) m where (m ->> 'is_viewer')::boolean), 1, 'exactly one isViewer row');
  perform tests.eq((select m ->> 'id' from jsonb_array_elements(v) m where (m ->> 'is_viewer')::boolean), tests.id('h/inc')::text,
                   'isViewer marks the viewer''s own row');
  perform tests.eq((select array_agg(m ->> 'id') from jsonb_array_elements(v) m where (m ->> 'is_creator')::boolean),
                   array[(select id from public.handover_members where handover_id = tests.id('h') and profile_id = tests.id('ann'))::text],
                   'isCreator marks the creator only');

  -- participants: review roles, no identity hash
  perform tests.as_user('rev');
  v := tests.read(format('select public.api_list_participants(%L, %L)', tests.id('h'), tests.id('n1')));
  perform tests.eq(jsonb_array_length(v), 3, 'participants of one source');
  perform tests.ok(v::text not like '%identity_hash%' and v::text not like '%' || tests.hex('alice') || '%', 'never the identity hash');
  perform tests.ok((select bool_and(p ->> 'identity_kind' = 'name') from jsonb_array_elements(v) p), 'identity kind listed');
  perform tests.ok((select (p ->> 'excluded')::boolean and p ->> 'display_label' = 'Removed participant'
                      from jsonb_array_elements(v) p where p ->> 'local_id' = 'p_alice'), 'erased participant listed as excluded');
  perform tests.ok(tests.read(format('select public.api_list_participants(%L, %L)', tests.id('h'), tests.id('so'))) is null,
                   'a source of another handover → not_found');
  perform tests.ok(tests.read(format('select public.api_list_participants(%L, %L)', tests.id('h'), gen_random_uuid())) is null,
                   'unknown source → not_found');
  v := tests.read(format('select public.api_list_exclusions(%L)', tests.id('h')));
  perform tests.ok(jsonb_array_length(v) >= 5 and v::text not like '%' || tests.hex('ravi') || '%', 'exclusions listed without hashes');
  perform tests.ok(exists (select 1 from jsonb_array_elements(v) e where e ->> 'scope' = 'handover' and e ->> 'identity_kind' = 'name'),
                   'scope and identity kind listed');
  perform tests.as_user('inc');
  perform tests.ok(tests.read(format('select public.api_list_participants(%L, null)', tests.id('h'))) is null,
                   'incoming members cannot list participants');
  perform tests.ok(tests.read(format('select public.api_list_exclusions(%L)', tests.id('h'))) is null,
                   'incoming members cannot list exclusions');

  -- source message context
  perform tests.as_user('rev');
  v := tests.read(format('select public.api_get_source_message_context(%L, 1, 1)', v_pe));
  -- the quoted message is the first of its source (seq 0): nothing before it, one after
  perform tests.ok((v ->> 'available')::boolean and jsonb_array_length(v -> 'messages') = 2
                   and (v -> 'messages' -> 0 ->> 'seq')::int = 0 and not (v ->> 'has_more_before')::boolean,
                   'window around the quoted message: ' || coalesce(v::text, 'null'));
  perform tests.eq(v -> 'messages' -> 0 ->> 'author_label', 'Alice', 'author label from the participant');
  perform tests.eq((select count(*)::int from jsonb_array_elements(v -> 'messages') m where (m ->> 'is_quoted')::boolean), 1,
                   'exactly one quoted message');
  perform tests.ok((v ->> 'has_more_after')::boolean, 'more messages after the window');
  v := tests.read(format('select public.api_get_source_message_context(%L, 50, 50)', v_pe));
  perform tests.ok(jsonb_array_length(v -> 'messages') <= 21 and not (v ->> 'has_more_before')::boolean
                   and not (v ->> 'has_more_after')::boolean, 'window clamped to 10 each side; whole source shown');
  perform tests.ok(tests.read(format('select public.api_get_source_message_context(%L, 3, 3)', gen_random_uuid())) is null,
                   'unknown link → not_found');
  perform tests.as_user('inc');
  perform tests.ok(tests.read(format('select public.api_get_source_message_context(%L, 3, 3)', v_pe)) is null,
                   'incoming members cannot read source context');
  perform tests.as_owner();
  delete from public.source_messages where id = (select source_message_id from public.evidence_quotes q
                                                    join public.point_evidence pe on pe.evidence_id = q.id where pe.id = v_pe);
  perform tests.as_user('rev');
  v := tests.read(format('select public.api_get_source_message_context(%L, 3, 3)', v_pe));
  perform tests.ok(not (v ->> 'available')::boolean and jsonb_array_length(v -> 'messages') = 0,
                   'a pruned quoted message → available false, no messages');

  -- access tokens: status, filters, visibility
  perform tests.as_user('ann');
  v_invite := public.invite_member(tests.actor(), tests.id('h'), 'new@example.test', 'lead', null, sha256('inv1'), now() + interval '7 days');
  perform public.invite_member(tests.actor(), tests.id('h'), 'old@example.test', 'lead', null, sha256('inv2'), now() + interval '7 days');
  perform tests.as_user('rev');
  v_gap := public.create_gap_question(tests.actor(), tests.id('h'), null, 'owner', 'Who holds the keys?', null, 'optional');
  v_link := public.create_gap_interview_link(tests.actor(), tests.id('h'), sha256('gap1'), array[v_gap], 'everyone', now() + interval '1 day');
  perform tests.as_owner();
  update public.access_tokens set use_count = max_uses where token_hash = sha256('inv2');
  perform tests.as_user('ann');
  v := tests.read(format('select public.list_access_tokens(%L)', tests.id('h')));
  perform tests.eq(jsonb_array_length(v), 3, 'the creator sees invitations and links');
  perform tests.ok(v::text not like '%token_hash%', 'never a hash');
  perform tests.eq((select t ->> 'recipient_email' from jsonb_array_elements(v) t where t ->> 'id' = v_invite::text), 'new@example.test',
                   'the creator sees the recipient');
  perform tests.eq((select t ->> 'status' from jsonb_array_elements(v) t where t ->> 'id' = v_invite::text), 'active', 'active');
  perform tests.eq((select t ->> 'max_access_level' from jsonb_array_elements(v) t where t ->> 'id' = v_link::text), 'everyone',
                   'maxAccessLevel listed');
  v := tests.read(format('select public.list_access_tokens(%L, %L, true)', tests.id('h'), 'member_invite'));
  perform tests.eq((select array_agg(t ->> 'id') from jsonb_array_elements(v) t), array[v_invite::text],
                   'pending invitations: active member invites only (the exhausted one is filtered)');
  perform tests.as_user('rev');
  v := tests.read(format('select public.list_access_tokens(%L)', tests.id('h')));
  perform tests.ok(jsonb_array_length(v) = 1 and v -> 0 ->> 'purpose' = 'gap_interview', 'other review roles see Gap Interview links only');
  perform tests.throws(format('select public.revoke_access_token(tests.actor(), %L)', v_invite), 'BTNF0',
                       'a reviewer cannot revoke (or see) an invitation');
  perform tests.as_user('out');
  perform public.revoke_access_token(tests.actor(), v_link);
  perform tests.eq((tests.read(format('select public.list_access_tokens(%L)', tests.id('h'))) -> 0 ->> 'status'), 'revoked',
                   'any review role revokes any Gap Interview link; status revoked');
  perform tests.as_user('ann');
  perform public.revoke_access_token(tests.actor(), v_invite);
  perform tests.eq(jsonb_array_length(tests.read(format('select public.list_access_tokens(%L, %L, true)', tests.id('h'), 'member_invite'))),
                   0, 'a revoked invitation is no longer pending');
  perform tests.as_owner();
  update public.access_tokens set revoked_at = null, expires_at = now() - interval '1 minute' where id = v_link;
  perform tests.as_user('ann');
  perform tests.eq((select t ->> 'status' from jsonb_array_elements(tests.read(format('select public.list_access_tokens(%L)', tests.id('h')))) t
                     where t ->> 'id' = v_link::text), 'expired', 'expired');
  perform tests.as_user('inc');
  perform tests.ok(tests.read(format('select public.list_access_tokens(%L)', tests.id('h'))) is null, 'incoming members: not_found');
  perform tests.as_owner();
end $$;

-- ── Creator transfer offers (S9): pendingCreatorTransfer and listMyCreatorTransferOffers ────────────
do $$
declare
  v jsonb;
begin
  perform tests.as_user('ann');
  perform public.offer_creator_transfer(tests.actor(), tests.id('h'), tests.id('h/rev'));
  v := tests.read(format('select public.api_get_handover(%L)', tests.id('h'))) -> 'pending_creator_transfer';
  perform tests.eq(v ->> 'to_member_id', tests.id('h/rev')::text, 'the creator sees the open offer');
  perform tests.as_user('rev');
  perform tests.eq(tests.read(format('select public.api_get_handover(%L)', tests.id('h'))) -> 'pending_creator_transfer' ->> 'to_member_id',
                   tests.id('h/rev')::text, 'the offered member sees it');
  v := tests.read('select public.api_list_my_creator_transfer_offers()');
  perform tests.ok(jsonb_array_length(v) = 1 and v -> 0 ->> 'handover_id' = tests.id('h')::text
                   and v -> 0 ->> 'handover_title' = 'Handover h' and v -> 0 ->> 'offered_by_label' = 'ann',
                   'the offered member lists the offer: ' || v::text);
  perform tests.as_user('inc');
  perform tests.ok(tests.read(format('select public.api_get_handover(%L)', tests.id('h'))) -> 'pending_creator_transfer' = 'null'::jsonb,
                   'other members do not see the offer');
  perform tests.eq(jsonb_array_length(tests.read('select public.api_list_my_creator_transfer_offers()')), 0, 'nor list it');
  perform tests.as_user('ann');
  perform tests.eq(jsonb_array_length(tests.read('select public.api_list_my_creator_transfer_offers()')), 0,
                   'offers BY the user are not offers TO the user');
  perform tests.as_user('rev');
  perform public.respond_to_creator_transfer(tests.actor(), tests.id('h'), false);
  perform tests.eq(jsonb_array_length(tests.read('select public.api_list_my_creator_transfer_offers()')), 0, 'a declined offer is gone');
  perform tests.as_owner();
end $$;

-- ── S10: a question about a point takes the point's category ────────────────
do $$
declare
  v uuid;
begin
  perform tests.as_user('rev');
  perform tests.throws(format('select public.create_gap_question(tests.actor(), %L, %L, %L, %L, null, %L)', tests.id('h'),
                              tests.id('pn2'), 'risk', 'Both?', 'optional'), 'BTVF0', 'S10: point and category together are refused');
  v := public.create_gap_question(tests.actor(), tests.id('h'), tests.id('pn2'), null, 'About pn2?', null, 'optional');
  perform tests.eq((select category from public.gap_questions where id = v),
                   (select category from public.handover_points where id = tests.id('pn2')), 'the server derives the category');
  perform tests.as_owner();
end $$;

-- ── D25: typed DELETE and unique purge ids, enforced by the database ─────────
do $$
declare
  v jsonb;
begin
  perform tests.as_user('eve');
  perform tests.throws(format('select public.check_account_deletion(tests.actor(), %L, %L)', 'delete', array[tests.id('other')]),
                       'BTVF0', 'D25: the word is case-sensitive');
  perform tests.throws(format('select public.check_account_deletion(tests.actor(), %L, %L)', 'DELETE ', array[tests.id('other')]),
                       'BTVF0', 'D25: exactly DELETE');
  perform tests.throws(format('select public.check_account_deletion(tests.actor(), null, %L)', array[tests.id('other')]),
                       'BTVF0', 'D25: the word is required');
  perform tests.throws(format('select public.check_account_deletion(tests.actor(), %L, %L)', 'DELETE',
                              array[tests.id('other'), tests.id('other')]), 'BTVF0', 'D25: each handover once');
  perform tests.throws(format('select public.check_account_deletion(tests.actor(), %L, %L)', 'DELETE',
                              array[tests.id('other'), tests.id('h')]), 'BTNF0', 'only handovers the user created');
  perform tests.throws(format('select public.check_account_deletion(tests.actor(), %L, %L)', 'DELETE', '{}'::uuid[]),
                       'BTPF0', 'an unlisted created handover still blocks');
  v := public.check_account_deletion(tests.actor(), 'DELETE', array[tests.id('other')]);
  perform tests.eq(v -> 'purgeHandoverIds', jsonb_build_array(tests.id('other')), 'a valid request returns the ids to purge');
  perform tests.throws(format('select public.delete_account_data(%L, %L)', tests.id('eve'), 'yes'), 'BTVF0',
                       'D25: delete_account_data checks the typed word again');
  perform tests.throws(format('select public.delete_account_data(%L, %L)', tests.id('eve'), 'DELETE'), 'BTPF0',
                       'and still refuses while a created handover exists');
  perform tests.as_owner();
  foreach v in array array['"check_account_deletion(uuid,text,uuid[])"', '"delete_account_data(uuid,text)"',
                           '"erasure_target(uuid,uuid)"', '"confirm_identity_match(uuid,uuid,uuid,text)"']::jsonb[] loop
    perform tests.ok(not has_function_privilege('authenticated', ('public.' || (v #>> '{}'))::regprocedure, 'EXECUTE')
                     and not has_function_privilege('anon', ('public.' || (v #>> '{}'))::regprocedure, 'EXECUTE')
                     and has_function_privilege('service_role', ('public.' || (v #>> '{}'))::regprocedure, 'EXECUTE'),
                     'server-only: ' || (v #>> '{}'));
  end loop;
  perform tests.ok(not has_function_privilege('service_role', 'public.erase_participant(uuid,uuid,text,bytea,text,uuid,uuid)', 'EXECUTE')
                   and not has_function_privilege('authenticated', 'public.erase_participant(uuid,uuid,text,bytea,text,uuid,uuid)', 'EXECUTE'),
                   'D27: erase_participant stays granted to no application role');
end $$;

-- ── Final audit F1: clients never read identity hashes, not even with a direct table select ─────────
do $$
declare
  v int;
begin
  perform tests.ok(not has_column_privilege('authenticated', 'public.source_participants', 'identity_hash', 'SELECT')
                   and not has_column_privilege('authenticated', 'public.source_exclusions', 'participant_identity_hash', 'SELECT')
                   and not has_column_privilege('authenticated', 'public.evidence_quotes', 'author_identity_hash', 'SELECT'),
                   'F1: no client SELECT on any identity-hash column');
  perform tests.ok(has_column_privilege('authenticated', 'public.source_participants', 'identity_kind', 'SELECT')
                   and has_column_privilege('authenticated', 'public.evidence_quotes', 'quote_text', 'SELECT'),
                   'F1: the other columns stay readable under RLS');
  perform tests.as_reader('rev');
  perform tests.throws('select identity_hash from public.source_participants', '42501', 'F1: participant hash not selectable');
  perform tests.throws('select * from public.source_exclusions', '42501', 'F1: select * on exclusions is refused');
  perform tests.throws('select author_identity_hash from public.evidence_quotes', '42501', 'F1: quote author hash not selectable');
  select count(*) into v from public.source_participants where identity_kind = 'name';
  perform tests.ok(v > 0, 'F1: a review role still reads participants (without hashes) under RLS');
  perform tests.as_owner();
end $$;

-- ── Final audit F2: identities are immutable; exclusions are append-only ─────────────────────────
do $$
declare
  v_p uuid := (select id from public.source_participants where source_id = tests.id('n2') and local_id = 'p_bob');
begin
  perform tests.throws(format($q$update public.source_participants set identity_hash = decode('00', 'hex') where id = %L$q$, v_p),
                       'BTIT0', 'F2: a participant hash cannot change');
  perform tests.throws(format($q$update public.source_participants set identity_kind = 'phone' where id = %L$q$, v_p),
                       'BTIT0', 'F2: a participant identity kind cannot change');
  perform tests.throws(format($q$update public.source_participants set display_label = 'Someone else' where id = %L$q$, v_p),
                       'BTIT0', 'F2: labels change only through participant erasure');
  perform tests.throws(format($q$update public.source_exclusions set participant_identity_kind = 'phone' where id = %L$q$, tests.id('ex_name')),
                       'BTIT0', 'F2: exclusions are append-only');
  perform tests.throws(format($q$update public.evidence_quotes set author_identity_kind = 'phone'
                                  where author_identity_kind = 'name' and id = (select min(id::text)::uuid from public.evidence_quotes
                                                                                where author_identity_kind = 'name')$q$),
                       'BTIT0', 'F2: a quote''s identity attribution is immutable');
end $$;

-- ── Final audit F1: identity hashes are not readable by clients, even by direct table select ────────
do $$
declare
  t text;
begin
  foreach t in array array['source_participants.identity_hash', 'source_exclusions.participant_identity_hash',
                           'evidence_quotes.author_identity_hash'] loop
    perform tests.ok(not has_column_privilege('authenticated', 'public.' || split_part(t, '.', 1), split_part(t, '.', 2), 'SELECT')
                     and not has_column_privilege('anon', 'public.' || split_part(t, '.', 1), split_part(t, '.', 2), 'SELECT'),
                     'F1: clients cannot select ' || t);
  end loop;
  perform tests.as_reader('ann'); -- the creator, a review role with full clearance
  perform tests.throws('select identity_hash from public.source_participants', '42501', 'F1: direct select of a participant hash refused');
  perform tests.throws('select * from public.source_exclusions', '42501', 'F1: select * cannot reach exclusion hashes');
  perform tests.throws('select author_identity_hash from public.evidence_quotes', '42501', 'F1: quote hashes refused');
  perform tests.ok((select count(*) from public.source_participants where identity_kind = 'name') > 0,
                   'F1: every other participant column stays readable under RLS');
  perform tests.ok((select count(*) from public.evidence_quotes where author_identity_kind is not null) > 0,
                   'F1: quotes stay readable without their hash');
  perform tests.as_owner();
end $$;

-- ── Final audit F2: participant identities and exclusions are immutable ─────────────────────────────
do $$
declare
  v_p uuid := (select id from public.source_participants where source_id = tests.id('n2') and local_id = 'p_bob');
begin
  perform tests.throws(format('update public.source_participants set display_label = %L where id = %L', 'Mallory', v_p),
                       'BTIT0', 'F2: participants change only through erasure');
  perform tests.throws(format('update public.source_participants set identity_kind = %L where id = %L', 'phone', v_p),
                       'BTIT0', 'F2: identity kind is immutable');
  perform set_config('baton.erasure', 'on', true);
  perform tests.throws(format($q$update public.source_participants set identity_hash = decode('00', 'hex') where id = %L$q$, v_p),
                       'BTIT0', 'F2: the hash is immutable even under the erasure flag');
  perform set_config('baton.erasure', 'off', true);
  perform tests.throws(format('update public.source_exclusions set participant_identity_kind = %L where id = %L', 'phone',
                              tests.id('ex_name')), 'BTIT0', 'F2: exclusions are append-only');
  perform tests.throws(format('update public.evidence_quotes set author_identity_kind = %L where author_identity_kind = %L',
                              'phone', 'name'), 'BTIT0', 'quote identity attribution is immutable');
end $$;
