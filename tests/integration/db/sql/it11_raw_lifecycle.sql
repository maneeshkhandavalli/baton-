-- IT-11 (database part): the raw upload lifecycle (§10.3, D14, QA-M7/R2, QA-L1) and exclusions enforced
-- again at persistence (§6.8.1, §12.2, D29).
--   * preview (R2) is actor-checked, read-only and only for uploaded/failed sources with raw + consent;
--   * a refused persist keeps nothing and keeps the raw upload;
--   * excluded participants' content and unresolved name matches can never be persisted.
\set ON_ERROR_STOP 1

select tests.user(u) from unnest(array['ann', 'out', 'rev', 'lead', 'eve']) u;
select tests.handover('h', 'ann', 'reviewer');   -- the creator is a reviewer; 'out' is a separate outgoing member
select tests.member('h', 'out', 'outgoing');
select tests.member('h', 'rev', 'reviewer');
select tests.member('h', 'lead', 'lead');
select it.raw_source('h', 'sa');
select it.raw_source('h', 'sb');
select it.raw_source('h', 'sc');
select it.raw_source('h', 'nocons', 'everyone', 'uploaded', false);
select it.raw_source('h', 'pending', 'everyone', 'pending_upload');

-- ── R2 source_preview_target ──────────────────────────────────────────────────
create temp table audit_before as select count(*) as n from public.audit_logs;
select tests.as_user('ann');
select tests.eq(public.source_preview_target(tests.actor(), tests.id('sa')) ->> 'raw_storage_path',
                (select raw_storage_path from public.sources where id = tests.id('sa')), 'creator can preview');
select tests.as_user('out');
select tests.ok(public.source_preview_target(tests.actor(), tests.id('sa')) is not null, 'an outgoing member can preview');
select tests.as_owner();
select tests.eq((select state from public.sources where id = tests.id('sa')), 'uploaded', 'preview never changes the source state');
select tests.ok((select raw_storage_path is not null from public.sources where id = tests.id('sa')), 'preview never deletes the raw upload');
select tests.eq((select count(*) from public.audit_logs), (select n from audit_before), 'preview writes nothing');

select tests.as_user('rev');
select it.fails(format('select public.source_preview_target(%L, %L)', tests.actor(), tests.id('sa')), 'BT', 'a reviewer cannot preview raw');
select tests.as_user('lead');
select it.fails(format('select public.source_preview_target(%L, %L)', tests.actor(), tests.id('sa')), 'BT', 'a lead cannot preview raw');
select tests.as_user('eve');
select it.hidden_like_missing(format('select public.source_preview_target(%L, %%L)', tests.actor()), tests.id('sa'), 'BTNF0',
                              'a non-member gets not_found');
select tests.as_user('ann');
select tests.throws(format('select public.source_preview_target(%L, %L)', tests.actor(), tests.id('nocons')), 'BTPF0', 'consent first');
select tests.throws(format('select public.source_preview_target(%L, %L)', tests.actor(), tests.id('pending')), 'BTIT0',
                    'nothing to preview before the upload is confirmed');
select tests.as_service();
select tests.throws(format('select public.source_preview_target(null, %L)', tests.id('sa')), 'BTUA0', 'an actor is required');

-- exclusions chosen during the preview (pre-parse only)
select tests.as_user('ann');
select tests.put('ex_phone', public.add_exclusion(p_actor_profile_id => tests.actor(), p_source_id => tests.id('sa'), p_kind => 'participant',
  p_scope => 'handover', p_identity_kind => 'phone', p_participant_identity_hash_hex => repeat('a1', 32), p_pepper_version => 'p1'));
select tests.put('ex_name', public.add_exclusion(p_actor_profile_id => tests.actor(), p_source_id => tests.id('sa'), p_kind => 'participant',
  p_scope => 'handover', p_identity_kind => 'name', p_participant_identity_hash_hex => repeat('b2', 32), p_pepper_version => 'p1'));
select tests.throws(format($q$select public.add_exclusion(p_actor_profile_id => %L, p_source_id => %L, p_kind => 'participant',
                               p_scope => 'handover', p_identity_kind => 'phone', p_participant_identity_hash_hex => %L, p_pepper_version => 'p2')$q$,
                           tests.actor(), tests.id('sa'), repeat('c3', 32)), 'BTVF0', 'only pepper p1 is accepted');

-- the parse rule feed: phone applies everywhere; the name rule applies in sa, is only detected in sb (D29)
select tests.as_service();
select tests.ok(public.parse_exclusion_rules(tests.id('sb')) @> jsonb_build_array(jsonb_build_object(
                  'identityKind', 'phone', 'participantIdentityHash', repeat('a1', 32), 'mode', 'apply')), 'phone rule applies to sb');
select tests.ok(public.parse_exclusion_rules(tests.id('sb')) @> jsonb_build_array(jsonb_build_object(
                  'identityKind', 'name', 'participantIdentityHash', repeat('b2', 32), 'mode', 'detect')), 'name rule is only detected in sb');
select tests.ok(public.parse_exclusion_rules(tests.id('sa')) @> jsonb_build_array(jsonb_build_object(
                  'identityKind', 'name', 'participantIdentityHash', repeat('b2', 32), 'mode', 'apply')), 'name rule applies in sa');

-- ── persistence re-checks the rules, all or nothing ──────────────────────────
select tests.as_user('ann');
select tests.throws(format('select public.start_processing(%L, %L, %L, %L, %L)', tests.actor(), tests.id('h'), 'it-1', '{"provider":"fake"}', '[]'),
                    'BTPF0', 'processing refuses a ready source without consent (§12.2)');
select tests.throws(format('select public.start_processing(%L, %L, %L, %L, %L)', tests.actor(), tests.id('h'), 'it-1', '{"provider":"other"}', '[]'),
                    'BTPF0', 'processing refuses a provider other than the one consented to (§11.8 rule 5)');
select public.remove_source(tests.actor(), tests.id('nocons'));
select tests.throws(format('select public.start_processing(%L, %L, %L, %L, %L)', tests.actor(), tests.id('h'), 'it-1', '{"provider":"other"}', '[]'),
                    'BTPF0', 'provider mismatch still refused once every source has consent');
select tests.put('run', public.start_processing(tests.actor(), tests.id('h'), 'it-1', '{"provider":"fake"}', jsonb_build_array(jsonb_build_object('stage','analyze','sourceId',null,'inputHash',md5('x')))));
select tests.as_owner(); -- DB-12-LEGACY: unfenced writer, owner-only since 20261113300500
select tests.throws(format('select public.persist_parsed_source(%L, %L, %L)', tests.id('sb'), it.parsed('phone', repeat('a1', 32)), 'p1'),
                    'BTCF0', 'messages of an excluded phone identity are refused');
select tests.throws(format('select public.persist_parsed_source(%L, %L, %L)', tests.id('sb'), it.parsed('name', repeat('b2', 32)), 'p1'),
                    'BTPF0', 'an unresolved name match must be decided first (identity_confirmation_required)');
select tests.throws(format('select public.persist_parsed_source(%L, %L, %L)', tests.id('sb'), it.parsed('phone', repeat('d4', 32)), 'p2'),
                    'BTVF0', 'an unknown pepper version is refused');
select tests.as_owner();
select tests.eq((select count(*)::int from public.source_participants where source_id = tests.id('sb')), 0, 'no participant row kept');
select tests.eq((select count(*)::int from public.source_messages where source_id = tests.id('sb')), 0, 'no message kept');
select tests.eq((select count(*)::int from public.source_conversations where source_id = tests.id('sb')), 0, 'no conversation kept');
select tests.ok((select state = 'uploaded' and raw_storage_path is not null from public.sources where id = tests.id('sb')),
                'the source stays unparsed with its raw upload');

-- the creator's per-source decision cannot change during a run; after it, "different person" lets sb parse
select tests.as_user('ann');
select tests.throws(format('select public.confirm_identity_match(%L, %L, %L, %L)', tests.actor(), tests.id('sb'), tests.id('ex_name'),
                           'different_person'), 'BTIT0', 'no identity decision while processing');
select public.cancel_processing(tests.actor(), tests.id('h'));
select tests.as_user('out');
select tests.throws(format('select public.confirm_identity_match(%L, %L, %L, %L)', tests.actor(), tests.id('sb'), tests.id('ex_name'),
                           'different_person'), 'BTFB0', 'only the creator decides identity matches');
select tests.as_user('ann');
select public.confirm_identity_match(tests.actor(), tests.id('sb'), tests.id('ex_name'), 'different_person');
select tests.put('run2', public.start_processing(tests.actor(), tests.id('h'), 'it-1', '{"provider":"fake"}', jsonb_build_array(jsonb_build_object('stage','analyze','sourceId',null,'inputHash',md5('x')))));
select tests.as_owner(); -- DB-12-LEGACY: unfenced writer, owner-only since 20261113300500
select public.persist_parsed_source(tests.id('sb'), it.parsed('name', repeat('b2', 32)), 'p1');
select tests.as_owner();
select tests.eq((select state from public.sources where id = tests.id('sb')), 'parsed', 'sb parsed after the decision');
select tests.ok((select raw_storage_path is not null from public.sources where id = tests.id('sb')),
                'persisting does not delete the raw upload; that happens after the commit (§10.3 step 4)');

-- after the parse: no preview, no new exclusion (late opt-out = erasure), no second parse
select tests.as_user('ann');
select tests.throws(format('select public.source_preview_target(%L, %L)', tests.actor(), tests.id('sb')), 'BTIT0', 'no preview after parsing');
select tests.throws(format($q$select public.add_exclusion(p_actor_profile_id => %L, p_source_id => %L, p_kind => 'date_range',
                               p_range_start => now() - interval '1 day', p_range_end => now())$q$, tests.actor(), tests.id('sb')),
                    'BTIT0', 'exclusions after the parse are refused (use erasure)');
select tests.as_owner(); -- DB-12-LEGACY: unfenced writer, owner-only since 20261113300500
select tests.throws(format('select public.persist_parsed_source(%L, %L, %L)', tests.id('sb'), it.parsed('phone', repeat('e5', 32)), 'p1'),
                    'BTIT0', 'a source is parsed once');

-- the raw delete after commit, then preview reports the upload is gone
select tests.as_service();
select public.mark_source_raw_deleted(tests.id('sb'));
select tests.as_owner();
select tests.ok((select raw_storage_path is null and raw_deleted_at is not null from public.sources where id = tests.id('sb')), 'raw deleted');
select tests.ok(exists (select 1 from public.audit_logs where entity_id = tests.id('sb') and action = 'source.raw_deleted'), 'and audited');

-- a failed source whose raw upload is gone cannot be previewed or re-parsed from raw
update public.sources set state = 'failed', raw_storage_path = null, raw_deleted_at = now() where id = tests.id('sc');
select tests.as_user('ann');
select tests.throws(format('select public.source_preview_target(%L, %L)', tests.actor(), tests.id('sc')), 'BTPF0', 'raw gone → re-upload');

-- QA-L1 (DB half, fixed by Agent 3 in 20261113200300_mark_raw_deleted_guard.sql): a raw delete is recorded
-- only for a parsed or removed source, or one whose handover is deleted; an uploaded/failed source on a live
-- draft keeps its raw upload for a (re)parse. The 7-day ceiling is a separate retention function.
select tests.as_service();
select tests.eq(tests.try(format('select public.mark_source_raw_deleted(%L)', tests.id('sa'))), 'ERR:BTIT0',
                'QA-L1 (fixed): mark_source_raw_deleted refuses an unparsed source on a live draft');
select tests.as_owner();
select tests.ok((select raw_storage_path is not null and raw_deleted_at is null from public.sources where id = tests.id('sa')),
                'QA-L1 (fixed): its raw upload is still recorded');
