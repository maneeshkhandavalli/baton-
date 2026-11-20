-- R3 Task 05E: deciding change-review items (migration 20261118600100_change_review_decisions). Synthetic data only.
-- The fixture (a published handover, version 2 of its chat, five detected items) is the one of 99_change_detection.
\set ON_ERROR_STOP 1

select tests.user(u) from unnest(array['ann', 'rev', 'inc', 'out']) u;

-- ── helpers (as in 99_scoped_version_processing) ─────────────────────────────
create function tests.hx(p_char text) returns text language sql immutable as $$ select repeat(p_char, 64) $$;
create function tests.new_version(p_prev uuid, p_hex text) returns uuid language plpgsql as $$
declare v uuid;
begin
  perform tests.as_user('ann');
  v := (public.create_source_version(tests.actor(), p_prev, 'whatsapp_export', 'chat v.txt', 'text/plain', 100, p_hex) ->> 'source_id')::uuid;
  perform tests.as_owner();
  insert into storage.objects (bucket_id, name, metadata)
  select 'source-uploads', raw_storage_path, '{"size": 100}' from public.sources where id = v;
  perform tests.as_user('ann');
  perform public.confirm_source_uploaded(tests.actor(), v, 100, p_hex);
  perform public.record_source_consent(tests.actor(), v, 'consent@1', 'fake', 'everyone', 'Asia/Kolkata');
  perform tests.as_owner();
  return v;
end $$;
create function tests.scoped_jobs(p_sources uuid[]) returns jsonb language sql volatile as $$
  select coalesce((select jsonb_agg(j) from (
            select jsonb_build_object('stage', st, 'sourceId', s, 'inputHash', md5(st || s::text)) as j
              from unnest(p_sources) s cross join unnest(array['parse', 'extract', 'verify_quotes']) st
             where st <> 'parse' or (select state from public.sources where id = s) <> 'parsed'
            union all
            select jsonb_build_object('stage', w, 'sourceId', null, 'inputHash', md5(w))
              from unnest(array['verify_support', 'analyze', 'prepare_review']) w) x), '[]'::jsonb)
$$;
create function tests.start(p_h text, p_name text, p_sources uuid[]) returns uuid language plpgsql as $$
declare v uuid;
begin
  perform tests.as_user('ann');
  v := public.start_source_update_processing(tests.actor(), tests.id(p_h), 'pv-test', '{"provider":"fake"}', tests.scoped_jobs(p_sources));
  perform tests.as_owner();
  return tests.put(p_name, v);
end $$;
-- every job but analyze is done (extraction complete); the analyze job is claimed by a worker → its claim
create function tests.claim_analyze(p_run uuid, p_name text) returns void language plpgsql as $$
begin
  update public.processing_jobs set status = 'succeeded', finished_at = now(), attempt = 1, progress_done = 1, progress_total = 1
   where run_id = p_run and stage <> 'analyze';
  perform tests.as_service();
  perform tests.kv_put(p_name, (select to_jsonb(c) from public.claim_ready_processing_jobs(10, 300) c where c.run_id = p_run and c.stage = 'analyze'));
  perform tests.as_owner();
end $$;
create function tests.record_sql(p_claim text, p_change uuid, p_items jsonb, p_gen boolean default true) returns text language sql volatile as $$
  select format('select public.pipeline_record_change_detection(%L, %s, %L, %L, %L::jsonb, %L::jsonb%s)',
                tests.kv(p_claim) ->> 'id', tests.kv(p_claim) ->> 'attempt', p_change, 'change-detect@1', p_items,
                '{"evidenceCompared": 3, "newInformation": 1}',
                case when p_gen then ', ' || (tests.kv(p_claim) ->> 'claim_generation') else '' end)
$$;
create function tests.change(p_source uuid) returns public.source_version_changes language sql volatile as $$
  select * from public.source_version_changes where to_source_id = p_source
$$;
create function tests.items(p_source uuid, p_state text default null) returns int language sql volatile as $$
  select count(*)::int from public.source_change_review_items i join public.source_version_changes c on c.id = i.change_id
   where c.to_source_id = p_source and (p_state is null or i.state = p_state)
$$;
create function tests.pub_sql(p_h text, p_acks jsonb default null) returns text language sql as $$
  select case when p_acks is null then format('select public.publish_handover(%L, %L)', tests.id('ann'), tests.id(p_h))
              else format('select public.publish_handover(%L, %L, null, %L::jsonb)', tests.id('ann'), tests.id(p_h), p_acks) end
$$;
create function tests.decide(p_item uuid, p_state text) returns void language plpgsql as $$
begin
  perform set_config('baton.change_review', 'on', true); -- what Task 05E's checked function will do
  update public.source_change_review_items set state = p_state, state_changed_at = now() where id = p_item;
  perform set_config('baton.change_review', 'off', true);
end $$;
-- runs p_sql as the CURRENT role (the worker's service role), unlike tests.read (browser path)
create function tests.run(p_sql text) returns jsonb language plpgsql as $$
declare v jsonb;
begin
  execute p_sql into v;
  return v;
end $$;
grant execute on all functions in schema tests to anon, authenticated, service_role;

-- ── a processed, published handover: chat s1 (cited by p1, p2, p3) and chat s2 ─
select tests.handover('h', 'ann', 'outgoing');
select tests.member('h', 'rev', 'reviewer');
select tests.member('h', 'inc', 'incoming');
select tests.source('h', 's1');
select tests.source('h', 's2');
update public.sources set consent_ai_provider = 'fake' where handover_id = tests.id('h');
insert into public.processing_runs (handover_id, status, source_ids, pipeline_version, ai_provider, ai_config, created_at, finished_at)
values (tests.id('h'), 'succeeded', array[tests.id('s1'), tests.id('s2')], 'pv-test', 'fake', '{}', clock_timestamp() - interval '1 hour', now());
insert into public.processing_jobs (handover_id, run_id, source_id, stage, status, attempt, input_hash, progress_done, progress_total)
select tests.id('h'), r.id, s, 'extract', 'succeeded', 1, '\x01', 2, 2
  from public.processing_runs r cross join unnest(array[tests.id('s1'), tests.id('s2')]) s where r.handover_id = tests.id('h');
select tests.point('h', 'p1');
select tests.point('h', 'p2');
select tests.point('h', 'p3');
select tests.cite('p1', 's1', 'alice', 1, 'supports', 'exact', 'l1');
select tests.cite('p2', 's1', 'bob', 1, 'supports', 'exact', 'l2');
select tests.cite('p3', 's1', 'carol', 1, 'supports', 'exact', 'l3');
select tests.put('e1', (select evidence_id from public.point_evidence where id = tests.id('l1')));
select tests.put('e2', (select evidence_id from public.point_evidence where id = tests.id('l2')));
select tests.put('e3', (select evidence_id from public.point_evidence where id = tests.id('l3')));
select tests.set_state('h', 'in_review');
select tests.approve_all('h');
select tests.as_user('ann');
select tests.put('pub1', public.publish_handover(tests.actor(), tests.id('h'), 'v1'));
select tests.as_owner();
select tests.kv_put('pub1_points', (select jsonb_agg(to_jsonb(pp) order by pp.id) from public.publication_points pp where pp.publication_id = tests.id('pub1')));
select tests.kv_put('s1_evidence', (select jsonb_agg(to_jsonb(q) order by q.id) from public.evidence_quotes q where q.source_id = tests.id('s1')));
select tests.as_user('inc');
select tests.kv_put('published_v1', tests.read(format('select public.api_get_published_handover(%L)', tests.id('h'))));
select tests.as_owner();

-- ── grants: no API write, internals not executable, the writer is service-only ─
do $$
declare r text;
begin
  foreach r in array array['anon', 'authenticated', 'service_role'] loop
    perform tests.ok(not has_table_privilege(r, 'public.source_change_review_items', 'INSERT')
                     and not has_table_privilege(r, 'public.source_change_review_items', 'UPDATE')
                     and not has_table_privilege(r, 'public.source_change_review_items', 'DELETE')
                     and not has_table_privilege(r, 'public.source_change_review_items', 'TRUNCATE'), r || ': no write grant on review items');
    perform tests.ok(not has_function_privilege(r, 'public._blocking_change_reviews(uuid)', 'EXECUTE')
                     and not has_function_privilege(r, 'public._stale_change_review_items(uuid,text)', 'EXECUTE'), r || ': internals not executable');
  end loop;
  foreach r in array array['anon', 'authenticated'] loop
    perform tests.ok(not has_function_privilege(r, 'public.pipeline_record_change_detection(uuid,integer,uuid,text,jsonb,jsonb,bigint)', 'EXECUTE')
                     and not has_function_privilege(r, 'public.list_change_detection_input(uuid)', 'EXECUTE'), r || ': detector functions are server-only');
  end loop;
  perform tests.ok(not has_table_privilege('anon', 'public.source_change_review_items', 'SELECT'), 'anon cannot read review items');
  perform tests.ok(has_function_privilege('service_role', 'public.pipeline_record_change_detection(uuid,integer,uuid,text,jsonb,jsonb,bigint)', 'EXECUTE'),
                   'the worker records detection');
  perform tests.ok((select bool_and(p.proconfig @> array['search_path=""'])
                      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                     where n.nspname = 'public' and p.proname in ('pipeline_record_change_detection', 'list_change_detection_input',
                       '_blocking_change_reviews', '_stale_change_review_items', '_guard_source_change_review_items',
                       'api_list_change_review_items', '_trg_source_version_change_baseline', 'change_review_detail_safe')),
                   'every new function has a fixed, empty search_path');
end $$;

-- ── version 2 of s1: the baseline is the current publication ─────────────────
select tests.as_user('ann');
select public.start_revision(tests.actor(), tests.id('h'));
select tests.as_owner();
select tests.put('v2', tests.new_version(tests.id('s1'), tests.hx('b')));
select tests.eq((tests.change(tests.id('v2'))).base_publication_id, tests.id('pub1'), 'the update records its base publication');
-- the new version, parsed: alice 1 unchanged (same author and time), bob 1 at another time, carol 1 gone, carol 4 new
insert into public.source_participants (handover_id, source_id, local_id, display_label, identity_kind, identity_hash, identity_pepper_version, message_count)
select handover_id, tests.id('v2'), local_id, display_label, identity_kind, identity_hash, identity_pepper_version, 1
  from public.source_participants where source_id = tests.id('s1');
insert into public.source_messages (handover_id, source_id, participant_id, seq, sent_at, kind, body, body_sha256)
select tests.id('h'), tests.id('v2'), sp.id, x.seq, x.at, 'text', x.body, sha256(convert_to(x.body, 'UTF8'))
  from (values ('p_alice', 0, (select sent_at from public.source_messages where id = tests.msg('s1', 'alice', 1)), 'Alice message 1 about the bank account handover'),
               ('p_bob', 1, timestamptz '2026-06-20', 'Bob message 1 about the bank account handover'),
               ('p_carol', 2, timestamptz '2026-07-01', 'Carol message 4 about the bank account handover')) x(who, seq, at, body)
  join public.source_participants sp on sp.source_id = tests.id('v2') and sp.local_id = x.who;
update public.sources set state = 'parsed', message_count = 3 where id = tests.id('v2');

-- ── scoped processing: the run's analyze job is claimed; extraction attached evidence of v2 ─
select tests.start('h', 'run2', array[tests.id('v2')]);
select tests.eq((select count(*)::int from public.processing_jobs where run_id = tests.id('run2') and source_id = tests.id('s2')), 0,
                'the untouched source gets no source-specific job');
select tests.cite('p1', 'v2', 'alice', 1, 'contradicts', 'exact', 'l1new');          -- re-extraction: same point, new version
select tests.point('h', 'p9');                                                      -- a new point, backed only by v2
select tests.cite('p9', 'v2', 'carol', 4, 'supports', 'exact', 'l9');
select tests.put('e1new', (select evidence_id from public.point_evidence where id = tests.id('l1new')));
select tests.put('e9', (select evidence_id from public.point_evidence where id = tests.id('l9')));
select tests.claim_analyze(tests.id('run2'), 'ja');
select tests.ok(tests.kv('ja') is not null, 'the analyze job is claimed');

-- the detector's input (service read): the previous version's evidence, the new links, anchors
select tests.as_service();
do $$
declare i jsonb := public.list_change_detection_input(tests.id('run2'));
begin
  perform tests.eq(jsonb_array_length(i -> 'changes'), 1, 'input: the one update of the run');
  perform tests.eq(jsonb_array_length(i -> 'changes' -> 0 -> 'oldEvidence'), 3, 'input: the three retained evidence links of version 1');
  perform tests.eq(i -> 'changes' -> 0 ->> 'basePublicationId', tests.id('pub1')::text, 'input: the baseline');
  perform tests.eq((select bool_and((l ->> 'pointHasOtherEvidence')::boolean = (l ->> 'pointId' = tests.id('p1')::text))
                      from jsonb_array_elements(i -> 'changes' -> 0 -> 'newLinks') l), true, 'input: p9 is backed only by the new version');
  perform tests.ok(jsonb_array_length(i -> 'anchors') >= 3, 'input: the cited messages of live points');
end $$;
select tests.as_owner();

-- the items (what lib/signals/change-detection.ts produces for this data)
select tests.kv_put('items', jsonb_build_array(
  jsonb_build_object('kind', 'evidence_moved', 'dedupeKey', 'evidence_moved:' || tests.id('e2') || ':' || tests.id('p2'),
    'pointId', tests.id('p2'), 'baseRevisionId', (select current_revision_id from public.handover_points where id = tests.id('p2')),
    'oldEvidenceId', tests.id('e2'), 'newMessageId', tests.msg('v2', 'bob', 1), 'newQuoteStart', 0, 'newQuoteEnd', 13,
    'detail', jsonb_build_object('match', 'exact', 'location', 'time_changed', 'newPosition', 1, 'family', 'chat')),
  jsonb_build_object('kind', 'evidence_missing', 'dedupeKey', 'evidence_missing:' || tests.id('e3') || ':' || tests.id('p3'),
    'pointId', tests.id('p3'), 'baseRevisionId', (select current_revision_id from public.handover_points where id = tests.id('p3')),
    'oldEvidenceId', tests.id('e3'), 'detail', jsonb_build_object('match', 'not_found', 'candidates', 0, 'family', 'chat')),
  jsonb_build_object('kind', 'possible_contradiction', 'dedupeKey', 'possible_contradiction:' || tests.id('p1') || ':' || tests.msg('v2', 'carol', 4),
    'pointId', tests.id('p1'), 'baseRevisionId', (select current_revision_id from public.handover_points where id = tests.id('p1')),
    'newMessageId', tests.msg('v2', 'carol', 4), 'detail', jsonb_build_object('reasons', jsonb_build_array('newer', 'shared_topic'), 'score', 6, 'coverage', 'after_watermark')),
  jsonb_build_object('kind', 'support_changed', 'dedupeKey', 'support_changed:' || tests.id('e1') || ':' || tests.id('p1'),
    'pointId', tests.id('p1'), 'baseRevisionId', (select current_revision_id from public.handover_points where id = tests.id('p1')),
    'oldEvidenceId', tests.id('e1'), 'newEvidenceId', tests.id('e1new'), 'newMessageId', tests.msg('v2', 'alice', 1), 'newQuoteStart', 0, 'newQuoteEnd', 10,
    'detail', jsonb_build_object('from', 'supports', 'to', 'contradicts')),
  jsonb_build_object('kind', 'new_information', 'dedupeKey', 'new_information:' || tests.id('p9'),
    'candidatePointId', tests.id('p9'), 'newEvidenceId', tests.id('e9'), 'detail', jsonb_build_object('coverage', 'after_watermark', 'evidence', 1))));

-- refusals: each leaves nothing behind (one transaction)
select tests.as_service();
select tests.throws(tests.record_sql('ja', (select id from public.source_version_changes where to_source_id = tests.id('v2')), tests.kv('items') || jsonb_build_array(jsonb_build_object(
                      'kind', 'evidence_missing', 'dedupeKey', 'evidence_missing:' || tests.id('e1') || ':' || tests.id('p9'),
                      'pointId', tests.id('p9'), 'baseRevisionId', (select current_revision_id from public.handover_points where id = tests.id('p9')),
                      'oldEvidenceId', tests.id('e1'), 'detail', '{}'::jsonb))),
                    'BTFB0', 'an item naming evidence that is not linked to its point is refused (the whole batch)');
select tests.throws(tests.record_sql('ja', (select id from public.source_version_changes where to_source_id = tests.id('v2')),
                                     jsonb_build_array(jsonb_set(tests.kv('items') -> 1, '{detail}', '{"note": "Carol said the bank moved"}'))),
                    'BTFB0', 'message text in detail is refused');
select tests.throws(tests.record_sql('ja', (select id from public.source_version_changes where to_source_id = tests.id('v2')),
                                     jsonb_build_array(jsonb_set(tests.kv('items') -> 1, '{oldEvidenceId}', to_jsonb(tests.id('e9'))))),
                    'BTFB0', 'evidence of another version is never "old" evidence');
select tests.throws(tests.record_sql('ja', (select id from public.source_version_changes where to_source_id = tests.id('v2')),
                                     jsonb_build_array(jsonb_set(tests.kv('items') -> 0, '{newMessageId}', to_jsonb(tests.msg('s1', 'alice', 1))))),
                    'BTFB0', 'a position outside the new version is refused');
select tests.throws(tests.record_sql('ja', (select id from public.source_version_changes where to_source_id = tests.id('v2')),
                                     jsonb_build_array(tests.kv('items') -> 0, tests.kv('items') -> 0)), 'BTVF0', 'duplicate keys in one batch are refused');
select tests.throws(tests.record_sql('ja', (select id from public.source_version_changes where to_source_id = tests.id('v2')),
                                     jsonb_build_array(jsonb_set(tests.kv('items') -> 0, '{dedupeKey}', '"evidence_missing:x"'))), 'BTFB0',
                    'a key of another kind or shape is refused');
select tests.as_owner();
select tests.eq(tests.items(tests.id('v2')), 0, 'refused batches inserted nothing');
select tests.ok((tests.change(tests.id('v2'))).detected_at is null, 'and recorded no detection');

-- the detection: every kind, with its references
select tests.as_service();
select tests.eq(tests.run(tests.record_sql('ja', (select id from public.source_version_changes where to_source_id = tests.id('v2')), tests.kv('items'))),
                '{"inserted": 5, "items": 5}'::jsonb, 'five items recorded');
-- a worker retry / repeated request: the same set, nothing new
select tests.as_owner();
update public.processing_jobs set status = 'succeeded', finished_at = now() where run_id = tests.id('run2');
select tests.as_service();
select public.finish_processing_run(tests.id('run2'), 'succeeded', null, null);
select tests.as_owner();
select tests.eq((tests.change(tests.id('v2'))).state, 'ready', 'fixture: the update is ready with five open items');

-- ── helpers ──────────────────────────────────────────────────────────────────
create function tests.item(p_kind text) returns uuid language sql volatile as $$
  select i.id from public.source_change_review_items i join public.source_version_changes c on c.id = i.change_id
   where i.kind = p_kind and c.to_source_id = tests.id('v2')
$$;
create function tests.rev(p_point text) returns uuid language sql volatile as $$
  select current_revision_id from public.handover_points where id = tests.id(p_point)
$$;
-- the server deciding for the (verified) user p_actor
create function tests.decide_sql(p_actor text, p_kind text, p_decision text, p_expected text, p_rev uuid, p_note text default null,
                                 p_payload jsonb default null) returns text language sql volatile as $$
  select format('select public.decide_change_review_item(%L, %L, %L, %L, %L, %L, %L::jsonb)', tests.id(p_actor), tests.item(p_kind),
                p_decision, p_expected, p_rev, p_note, p_payload)
$$;
create function tests.decide(p_user text, p_kind text, p_decision text, p_expected text, p_rev uuid, p_note text default null,
                             p_payload jsonb default null) returns jsonb language plpgsql as $$
declare v jsonb;
begin
  perform tests.as_user(p_user);
  execute tests.decide_sql(p_user, p_kind, p_decision, p_expected, p_rev, p_note, p_payload) into v;
  perform tests.as_owner();
  return v;
end $$;
grant execute on all functions in schema tests to anon, authenticated, service_role;
select tests.kv_put('evidence_before', (select jsonb_agg(to_jsonb(q) order by q.id) from public.evidence_quotes q where q.source_id = tests.id('s1')));

-- ── grants and authorization ─────────────────────────────────────────────────
do $$
declare r text;
begin
  foreach r in array array['anon', 'authenticated'] loop
    perform tests.ok(not has_function_privilege(r, 'public.decide_change_review_item(uuid,uuid,text,text,uuid,text,jsonb)', 'EXECUTE'),
                     r || ': deciding is server-only');
    perform tests.ok(not has_table_privilege(r, 'public.source_change_review_decisions', 'INSERT')
                     and not has_table_privilege(r, 'public.source_change_review_decisions', 'UPDATE')
                     and not has_table_privilege(r, 'public.source_change_review_items', 'UPDATE'), r || ': no direct writes');
  end loop;
  foreach r in array array['anon', 'authenticated', 'service_role'] loop
    perform tests.ok(not has_function_privilege(r, 'public._change_review_quote(uuid,uuid,integer,integer)', 'EXECUTE')
                     and not has_function_privilege(r, 'public._utf16_slice(text,integer,integer)', 'EXECUTE'), r || ': internals not executable');
  end loop;
  perform tests.ok(has_function_privilege('service_role', 'public.decide_change_review_item(uuid,uuid,text,text,uuid,text,jsonb)', 'EXECUTE'),
                   'the server decides');
  perform tests.ok((select bool_and(p.proconfig @> array['search_path=""']) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                     where n.nspname = 'public' and p.proname in ('decide_change_review_item', 'api_get_change_reviews', '_change_review_quote',
                       '_change_review_link', '_utf16_slice', '_guard_source_change_review_decisions')), 'fixed, empty search_path');
end $$;
select tests.eq(public._utf16_slice('a😀bc', 1, 3), '😀', 'UTF-16 slicing: an astral character counts as two units');
select tests.ok(public._utf16_slice('a😀bc', 2, 3) is null, 'a span that cuts a character is refused');
select tests.as_reader('ann');
select tests.throws(tests.decide_sql('ann', 'evidence_missing', 'investigate', 'open', tests.rev('p3'), 'look'), '42501', 'a browser session cannot call it');
select tests.as_user('ann');
select tests.throws(tests.decide_sql('rev', 'evidence_missing', 'investigate', 'open', tests.rev('p3'), 'look'), 'BTFB0',
                    'the actor must be the verified session user (an arbitrary actor id is refused)');
select tests.as_owner();
select tests.throws(format('select tests.decide(%L, %L, %L, %L, %L, %L)', 'inc', 'evidence_missing', 'investigate', 'open', tests.rev('p3'), 'look'), 'BTNF0',
                    'the incoming member cannot see or decide it');
select tests.throws(format('select tests.decide(%L, %L, %L, %L, %L, %L)', 'out', 'evidence_missing', 'investigate', 'open', tests.rev('p3'), 'look'), 'BTNF0',
                    'an outsider cannot');
select tests.as_reader('inc');
select tests.ok(tests.read(format('select public.api_get_change_reviews(%L)', tests.id('h'))) is null, 'the incoming member reads no change review');
select tests.eq((select count(*)::int from public.source_change_review_decisions), 0, 'nor any decision');
select tests.as_reader('rev');
select tests.eq(jsonb_array_length(tests.read(format('select public.api_get_change_reviews(%L)', tests.id('h')))), 5, 'a reviewer reads all five');
select tests.as_owner();
select tests.throws(format('update public.source_change_review_items set state = %L where id = %L', 'accepted', tests.item('evidence_moved')), 'BTIT0',
                    'the owner cannot decide around the checked function');

-- ── investigate: stays unresolved and blocks; a repeat writes nothing ─────────
select tests.throws(format('select tests.decide(%L, %L, %L, %L, %L)', 'rev', 'evidence_missing', 'investigate', 'open', tests.rev('p3')), 'BTVF0',
                    'investigating needs a note');
select tests.eq(tests.decide('rev', 'evidence_missing', 'investigate', 'open', tests.rev('p3'), 'Checking the new export with Meera.') ->> 'state',
                'investigating', 'investigate → investigating');
select tests.eq(tests.decide('rev', 'evidence_missing', 'investigate', 'open', tests.rev('p3'), 'Checking the new export with Meera.') ->> 'outcome',
                'unchanged', 'the same request repeated writes nothing');
select tests.eq(tests.decide('rev', 'evidence_missing', 'investigate', 'investigating', tests.rev('p3'), 'Checking the new export with Meera.') ->> 'outcome',
                'unchanged', 'the same note again writes nothing');
select tests.eq((select count(*)::int from public.source_change_review_decisions where item_id = tests.item('evidence_missing')), 1, 'one decision row');
select tests.eq((select count(*)::int from public.audit_logs where action = 'source_update.review_decided'), 1, 'one audit entry');
select tests.approve_all('h');
select tests.as_user('ann');
select tests.throws(tests.pub_sql('h'), 'BTPF0', 'an investigating item blocks publication');
select tests.throws(tests.pub_sql('h', '[]'), 'BTPF0', 'the acknowledgement path does not bypass it');
select tests.as_owner();

-- ── evidence_missing accept: a re-attestation, never replacement evidence ─────
select tests.throws(format('select tests.decide(%L, %L, %L, %L, %L, %L)', 'rev', 'evidence_missing', 'accept', 'investigating', tests.rev('p3'), 'ok'), 'BTVF0',
                    're-attestation needs an explanation');
select tests.throws(format('select tests.decide(%L, %L, %L, %L, %L, %L)', 'rev', 'evidence_missing', 'accept', 'open', tests.rev('p3'),
                           'Meera confirmed in person the keys stay with her.'), 'BTCF0', 'a stale expected state is a conflict');
select tests.kv_put('quotes_before', to_jsonb((select count(*) from public.evidence_quotes where handover_id = tests.id('h'))));
select tests.eq(tests.decide('rev', 'evidence_missing', 'accept', 'investigating', tests.rev('p3'), 'Meera confirmed in person the keys stay with her.') ->> 'state',
                'accepted', 're-attested');
do $$
begin
  perform tests.eq(to_jsonb((select count(*) from public.evidence_quotes where handover_id = tests.id('h'))), tests.kv('quotes_before'), 'no evidence fabricated');
  perform tests.eq((select count(*)::int from public.point_evidence where id = tests.id('l3') and excluded_at is null), 1, 'the historical evidence stays linked');
  perform tests.eq((select review_state from public.handover_points where id = tests.id('p3')), 'approved', 'the point keeps its decision');
  perform tests.ok((select decided_by = tests.id('rev') and decided_at is not null from public.source_change_review_items where id = tests.item('evidence_missing')),
                   'who and when are recorded');
  perform tests.eq((select count(*)::int from public.review_actions where point_id = tests.id('p3') and action = 'change_review'), 2,
                   'the point''s own history records both decisions');
  perform tests.ok(not exists (select 1 from public.audit_logs where action like 'source_update.review_decided%' and after::text like '%Meera%'),
                   'notes never reach the audit log');
end $$;
select tests.throws(format('select tests.decide(%L, %L, %L, %L, %L, %L)', 'ann', 'evidence_missing', 'reject', 'investigating', tests.rev('p3'), 'no'), 'BTCF0',
                    'another reviewer cannot overwrite a decision');

-- ── evidence_moved: reject keeps everything; accept links the relocated quotation ─
do $$
declare v_rev uuid := tests.rev('p2'); v_links int := (select count(*) from public.point_evidence where point_id = tests.id('p2'));
begin
  perform tests.decide('rev', 'evidence_moved', 'reject', 'open', v_rev, 'The new line is a different reimbursement thread.');
  perform tests.eq(tests.rev('p2'), v_rev, 'reject: the point keeps its revision');
  perform tests.eq((select count(*)::int from public.point_evidence where point_id = tests.id('p2')), v_links, 'reject: no evidence added');
  perform tests.eq((select state from public.source_change_review_items where id = tests.item('evidence_moved')), 'rejected', 'rejected');
  raise exception 'undo' using errcode = 'TZRB0';
exception when sqlstate 'TZRB0' then null;
end $$;
select tests.kv_put('moved', tests.decide('rev', 'evidence_moved', 'accept', 'open', tests.rev('p2')));
do $$
declare v_link uuid := (tests.kv('moved') ->> 'pointEvidenceId')::uuid;
begin
  perform tests.eq(tests.kv('moved') ->> 'state', 'accepted', 'accepted');
  perform tests.eq((select q.source_id from public.point_evidence pe join public.evidence_quotes q on q.id = pe.evidence_id where pe.id = v_link), tests.id('v2'),
                   'the new evidence belongs to the current version');
  perform tests.eq((select q.quote_text || '|' || q.quote_check from public.point_evidence pe join public.evidence_quotes q on q.id = pe.evidence_id where pe.id = v_link),
                   'Bob message 1|exact', 'an exact slice of the new message at the detected span');
  perform tests.eq((select count(*)::int from public.point_evidence where id = tests.id('l2') and excluded_at is null), 1, 'the historical evidence stays');
  perform tests.eq((select point_evidence_id from public.source_change_review_decisions where item_id = tests.item('evidence_moved')), v_link, 'recorded');
end $$;

-- ── possible_contradiction: a human correction with supporting evidence from the new version ─
select tests.throws(format('select tests.decide(%L, %L, %L, %L, %L, %L)', 'rev', 'possible_contradiction', 'accept', 'open', tests.rev('p1'), 'Corrected.'), 'BTVF0',
                    'accepting needs the corrected point and its quotation');
select tests.throws(format('select tests.decide(%L, %L, %L, %L, %L, %L, %L)', 'rev', 'possible_contradiction', 'accept', 'open', tests.rev('p1'), 'Corrected.',
                           '{"title": "T", "statement": "S", "attributes": {}, "evidenceStart": 0, "evidenceEnd": 5}'), 'BTVF0',
                    'a fragment is not supporting evidence');
select tests.throws(format('select tests.decide(%L, %L, %L, %L, %L, %L, %L)', 'rev', 'possible_contradiction', 'accept', 'open', tests.rev('p1'), 'Corrected.',
                           '{"title": "T", "statement": "S", "attributes": {}, "evidenceStart": 0, "evidenceEnd": 9999}'), 'BTVF0',
                    'a span outside the message is refused');
do $$
declare v_rev uuid := tests.rev('p1');
begin
  perform tests.decide('rev', 'possible_contradiction', 'reject', 'open', v_rev, 'The later message is about a different mandate.');
  perform tests.eq(tests.rev('p1'), v_rev, 'reject: the point keeps its content');
  raise exception 'undo' using errcode = 'TZRB0';
exception when sqlstate 'TZRB0' then null;
end $$;
select tests.kv_put('p1_rev1', to_jsonb(tests.rev('p1')));
select tests.kv_put('contra', tests.decide('rev', 'possible_contradiction', 'accept', 'open', tests.rev('p1'), 'Carol took over the mandate.',
  '{"title": "Bank account handover", "statement": "Carol now handles the bank account handover", "attributes": {}, "evidenceStart": 0, "evidenceEnd": 15}'));
do $$
begin
  perform tests.eq(tests.kv('contra') ->> 'state', 'accepted', 'accepted');
  perform tests.eq(tests.rev('p1'), (tests.kv('contra') ->> 'pointRevisionId')::uuid, 'a new revision through edit_point');
  perform tests.eq((select statement || '|' || author_kind || '|' || edit_reason from public.point_revisions where id = tests.rev('p1')),
                   'Carol now handles the bank account handover|profile|Carol took over the mandate.', 'the human wording, not a copied suggestion');
  perform tests.eq((select review_state from public.handover_points where id = tests.id('p1')), 'pending', 'the corrected point goes back to review');
  perform tests.ok(exists (select 1 from public.point_revisions where id = (tests.kv('p1_rev1') #>> '{}')::uuid), 'the previous revision is kept');
  perform tests.eq((select q.quote_text from public.point_evidence pe join public.evidence_quotes q on q.id = pe.evidence_id
                     where pe.id = (tests.kv('contra') ->> 'pointEvidenceId')::uuid), 'Carol message 4', 'supported by the new version');
end $$;

-- ── support_changed: a stale revision is refused; a human confirmation is recorded ─
select tests.throws(format('select tests.decide(%L, %L, %L, %L, %L, %L)', 'rev', 'support_changed', 'accept', 'open', (tests.kv('p1_rev1') #>> '{}')::uuid,
                           'The new assessment is right, see the reversal.'), 'BTCF0', 'a decision on a point that changed since it was loaded is refused');
select tests.eq(tests.decide('rev', 'support_changed', 'accept', 'open', tests.rev('p1'), 'The new assessment is right, see the reversal.') ->> 'state',
                'accepted', 'confirmed on the current revision');

-- ── new_information: through the normal approval; reject leaves no invalid rows ─
update public.handover_points set review_state = 'pending' where id = tests.id('p9'); -- approve_all above approved it: review it here instead
do $$
begin
  perform tests.decide('rev', 'new_information', 'reject', 'open', tests.rev('p9'), 'Not handover material.');
  perform tests.eq((select review_state from public.handover_points where id = tests.id('p9')), 'rejected', 'reject: the candidate is rejected by reject_point');
  perform tests.eq((select count(*)::int from public.review_actions where point_id = tests.id('p9') and action = 'reject'), 1, 'with its review action');
  perform tests.eq((select count(*)::int from public.handover_points where handover_id = tests.id('h')), 4, 'no point created or left behind');
  raise exception 'undo' using errcode = 'TZRB0';
exception when sqlstate 'TZRB0' then null;
end $$;
select tests.eq(tests.decide('rev', 'new_information', 'accept', 'open', tests.rev('p9')) ->> 'state', 'accepted', 'new information accepted');
select tests.eq((select review_state from public.handover_points where id = tests.id('p9')), 'approved', 'approved by approve_point (no duplicate)');
select tests.eq((select count(*)::int from public.handover_points where handover_id = tests.id('h')), 4, 'no duplicate point');

-- ── all resolved: the normal publication path; publication 1 never changed ────
select tests.eq((select count(*)::int from public._blocking_change_reviews(tests.id('h'))), 0, 'nothing blocks');
select tests.approve_all('h'); -- the corrected point p1 is approved in the ordinary review
select tests.as_user('ann');
select tests.eq(tests.read(format('select public.api_get_readiness(%L)', tests.id('h'))) ->> 'canPublish', 'true', 'readiness: ready');
select tests.put('pub2', public.publish_handover(tests.actor(), tests.id('h'), 'v2'));
select tests.as_owner();
select tests.eq((select jsonb_agg(to_jsonb(pp) order by pp.id) from public.publication_points pp where pp.publication_id = tests.id('pub1')),
                tests.kv('pub1_points'), 'publication 1 is byte-for-byte unchanged');
select tests.eq((select revision_id from public.publication_points where publication_id = tests.id('pub2') and point_id = tests.id('p1')), tests.rev('p1'),
                'publication 2 carries the corrected revision');
select tests.eq((select jsonb_agg(to_jsonb(q) order by q.id) from public.evidence_quotes q where q.source_id = tests.id('s1')), tests.kv('evidence_before'),
                'version 1''s evidence is unchanged');
select tests.throws(format('select tests.decide(%L, %L, %L, %L, %L, %L)', 'rev', 'evidence_moved', 'reject', 'accepted', tests.rev('p2'), 'x'), 'BTVF0',
                    'a terminal state is never an expected starting state');

-- ── stale: a newer version makes undecided items stale; they cannot be decided ─
select tests.as_user('ann');
select public.start_revision(tests.actor(), tests.id('h'));
select tests.as_owner();
select tests.put('v3', tests.new_version(tests.id('v2'), tests.hx('c')));
update public.sources set state = 'parsed' where id = tests.id('v3');
select tests.start('h', 'run3', array[tests.id('v3')]);
select tests.claim_analyze(tests.id('run3'), 'j3');
select tests.as_service();
select tests.run(tests.record_sql('j3', (select id from public.source_version_changes where to_source_id = tests.id('v3')),
                 jsonb_build_array(jsonb_build_object('kind', 'evidence_missing', 'dedupeKey', 'evidence_missing:' || tests.id('e3') || ':' || tests.id('p3'),
                   'pointId', tests.id('p3'), 'baseRevisionId', tests.rev('p3'), 'oldEvidenceId', tests.id('e3'), 'detail', '{}'::jsonb))));
select tests.as_owner();
update public.processing_jobs set status = 'succeeded', finished_at = now() where run_id = tests.id('run3');
select tests.as_service();
select public.finish_processing_run(tests.id('run3'), 'succeeded', null, null);
select tests.as_owner();
create function tests.item3() returns uuid language sql volatile as $$
  select i.id from public.source_change_review_items i join public.source_version_changes c on c.id = i.change_id where c.to_source_id = tests.id('v3')
$$;
grant execute on function tests.item3() to anon, authenticated, service_role;
select tests.eq((select base_publication_id from public.source_change_review_items where id = tests.item3()), tests.id('pub2'), 'v3''s item is against publication 2');
select tests.put('v4', tests.new_version(tests.id('v3'), tests.hx('d')));
select tests.eq((select state from public.source_change_review_items where id = tests.item3()), 'stale', 'superseded: stale');
select tests.as_user('rev');
select tests.throws(format('select public.decide_change_review_item(%L, %L, %L, %L, %L, %L)', tests.id('rev'), tests.item3(), 'accept', 'open', tests.rev('p3'),
                           'The keys are still with Meera, confirmed.'), 'BTIT0', 'a stale item cannot be decided');
select tests.as_owner();
select tests.eq((select count(*)::int from public.source_change_review_decisions where item_id = tests.item3()), 0, 'and nothing was recorded');
select tests.eq((select count(*)::int from public.source_change_review_decisions), 6, 'every earlier decision is kept (investigate + 5 accepts)');
