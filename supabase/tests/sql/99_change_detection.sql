-- R3 Task 05D: change-review items, the detection record, the lifecycle (ready / stale) and the publication gate
-- (migration 20261118500100_change_detection). Synthetic data only.
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
  update public.source_change_review_items
     set state = p_state, state_changed_at = now(),
         decided_by = case when p_state in ('accepted', 'rejected') then tests.id('rev') end, -- 05E: who and when
         decided_at = case when p_state in ('accepted', 'rejected') then now() end
   where id = p_item;
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
select tests.eq(tests.run(tests.record_sql('ja', (select id from public.source_version_changes where to_source_id = tests.id('v2')), tests.kv('items'))),
                '{"inserted": 0, "items": 5}'::jsonb, 'repeated detection inserts nothing');
select tests.as_owner();
do $$
begin
  perform tests.eq(tests.items(tests.id('v2')), 5, 'exactly five items');
  perform tests.eq((select array_agg(kind order by kind) from public.source_change_review_items),
                   array['evidence_missing', 'evidence_moved', 'new_information', 'possible_contradiction', 'support_changed'], 'every kind');
  perform tests.eq((select count(*)::int from public.source_change_review_items where state = 'open' and base_publication_id = tests.id('pub1')
                      and run_id = tests.id('run2') and detector_version = 'change-detect@1'), 5, 'all open, against publication 1, from this run');
  perform tests.eq((select new_source_message_id from public.source_change_review_items where kind = 'evidence_moved'), tests.msg('v2', 'bob', 1),
                   'moved: mapped to the new message');
  perform tests.eq((select (base_revision_id = (select revision_id from public.publication_points where publication_id = tests.id('pub1') and point_id = tests.id('p3')))
                      from public.source_change_review_items where kind = 'evidence_missing'), true, 'missing: the published revision is the base');
  perform tests.eq((select candidate_point_id from public.source_change_review_items where kind = 'new_information'), tests.id('p9'),
                   'new information references the candidate point (no second point is created)');
  perform tests.eq((select review_state from public.handover_points where id = tests.id('p9')), 'pending', 'and it stays pending');
  perform tests.eq((select count(*)::int from public.handover_points where handover_id = tests.id('h')), 4, 'no point was created by detection');
  perform tests.ok((tests.change(tests.id('v2'))).detected_at is not null and (tests.change(tests.id('v2'))).detection_run_id = tests.id('run2')
                   and (tests.change(tests.id('v2'))).state = 'processing', 'detection recorded; the update stays processing until the run closes');
  perform tests.eq((select count(*)::int from public.audit_logs where action = 'source_update.changes_detected' and handover_id = tests.id('h')), 2,
                   'each detection is audited');
  perform tests.ok(not exists (select 1 from public.audit_logs where handover_id = tests.id('h') and action like 'source_update.%'
                                and (after::text like '%message 1 about%' or after::text like '%message 4 about%')), 'audit metadata carries no message text');
  -- historical evidence is untouched
  perform tests.eq((select jsonb_agg(to_jsonb(q) order by q.id) from public.evidence_quotes q where q.source_id = tests.id('s1')), tests.kv('s1_evidence'),
                   'the previous version''s evidence is byte-for-byte unchanged');
  perform tests.eq((select count(*)::int from public.point_evidence where id in (tests.id('l1'), tests.id('l2'), tests.id('l3')) and excluded_at is null), 3,
                   'and still active (missing evidence never removes a link)');
  perform tests.eq((select review_state from public.handover_points where id = tests.id('p3')), 'approved', 'the point with missing evidence keeps its decision');
end $$;

-- direct writes: denied for API roles, refused by the guard for the owner
select tests.as_reader('ann');
select tests.throws(format('update public.source_change_review_items set state = %L', 'accepted'), '42501', 'authenticated: no direct update');
select tests.throws(format('delete from public.source_change_review_items'), '42501', 'authenticated: no direct delete');
select tests.as_service();
select tests.throws(format('update public.source_change_review_items set state = %L', 'accepted'), '42501', 'service_role: no direct update either');
select tests.as_owner();
select tests.throws(format('update public.source_change_review_items set state = %L', 'accepted'), 'BTIT0', 'owner: no decision without the checked path');
select tests.throws(format('update public.source_change_review_items set point_id = %L where kind = %L', tests.id('p2'), 'evidence_missing'), 'BTIT0',
                    'references are immutable');
select tests.throws(format('delete from public.source_change_review_items'), 'BTIT0', 'items are never deleted directly');
select tests.throws(format($q$insert into public.source_change_review_items (handover_id, change_id, kind, point_id, base_revision_id, old_evidence_id, dedupe_key, detector_version)
                            select handover_id, change_id, kind, point_id, base_revision_id, old_evidence_id, dedupe_key || 'f', detector_version
                              from public.source_change_review_items where kind = 'evidence_missing'$q$), 'BTIT0', 'items are created only by detection');
select tests.throws(format('update public.source_version_changes set detected_at = now() where to_source_id = %L', tests.id('v2')), 'BTIT0',
                    'the detection record is written only by the detector');

-- RLS: a review role sees them, the incoming member and an outsider do not
select tests.as_reader('ann');
select tests.eq((select count(*)::int from public.source_change_review_items), 5, 'creator: sees the items');
select tests.eq(jsonb_array_length(tests.read(format('select public.api_list_change_review_items(%L)', tests.id('h')))), 5, 'creator: the read API lists them');
select tests.ok(tests.read(format('select public.api_list_change_review_items(%L)', tests.id('h')))::text not like '%about the bank%', 'the read API carries no message text');
select tests.as_reader('rev');
select tests.eq((select count(*)::int from public.source_change_review_items), 5, 'reviewer: sees the items');
select tests.as_reader('inc');
select tests.eq((select count(*)::int from public.source_change_review_items), 0, 'incoming member: none');
select tests.ok(tests.read(format('select public.api_list_change_review_items(%L)', tests.id('h'))) is null, 'incoming member: the read API returns nothing');
select tests.as_reader('out');
select tests.eq((select count(*)::int from public.source_change_review_items), 0, 'outsider: none');
select tests.as_owner();

-- ── the run closes: extraction complete, run succeeded, detection recorded → ready ─
update public.processing_jobs set status = 'succeeded', finished_at = now() where run_id = tests.id('run2');
select tests.as_service();
select public.finish_processing_run(tests.id('run2'), 'succeeded', null, null);
select tests.as_owner();
select tests.eq((tests.change(tests.id('v2'))).state, 'ready', 'fully evaluated: ready');
select tests.eq((select after ->> 'openReviewItems' from public.audit_logs where action = 'source_update.evaluated' and handover_id = tests.id('h')), '5',
                'evaluation audited with its open items');
-- a stale worker (the closed run's claim) cannot add items afterwards
select tests.as_service();
select tests.throws(tests.record_sql('ja', (select id from public.source_version_changes where to_source_id = tests.id('v2')), tests.kv('items')), 'BTLL0',
                    'a stale detector run cannot write after the run closed');
select tests.as_owner();

-- ── the publication gate ─────────────────────────────────────────────────────
select tests.approve_all('h'); -- p9 decided in the ordinary review: only the change reviews remain
select tests.as_user('ann');
select tests.eq((select jsonb_agg(b ->> 'kind') from jsonb_array_elements(tests.read(format('select public.api_get_readiness(%L)', tests.id('h'))) -> 'blockers') b),
                '["change_reviews_open"]'::jsonb, 'readiness: the open change reviews are the only blocker');
select tests.eq(tests.read(format('select public.api_get_readiness(%L)', tests.id('h'))) ->> 'canPublish', 'false', 'readiness never says ready');
select tests.throws(tests.pub_sql('h'), 'BTPF0', 'open items block publication');
select tests.throws(tests.pub_sql('h', '[]'), 'BTPF0', 'with the acknowledgement path too (it never lifts a change review)');
select tests.as_owner();
select tests.throws(format($q$insert into public.handover_publications (handover_id, version, published_by) values (%L, 9, %L)$q$,
                           tests.id('h'), tests.id('ann')), 'BTPF0', 'a direct publication row is refused');
do $$
begin
  perform set_config('baton.publishing', 'on', true);
  perform tests.throws(format('select public.transition_handover(%L, %L, %L)', tests.id('h'), 'approved', tests.id('ann')), 'BTPF0',
                       'the direct in_review → approved transition is refused');
  perform set_config('baton.publishing', 'off', true);
end $$;
select tests.eq((select count(*)::int from public.handover_publications where handover_id = tests.id('h')), 1, 'refusals left no publication');
select tests.eq((select count(*)::int from public.publication_source_acknowledgements where handover_id = tests.id('h')), 0, 'and no acknowledgement');
select tests.eq((select count(*)::int from public.audit_logs where handover_id = tests.id('h') and action = 'handover.published'), 1, 'and no audit of a publication');
do $$
declare e text;
begin
  perform public._assert_source_updates_settled(tests.id('h'));
exception when others then
  get stacked diagnostics e = message_text;
  perform tests.ok(e like 'change_review_open:%', 'the refusal names the open change reviews');
end $$;

-- investigating still blocks; accepted / rejected do not
select tests.decide(id, 'investigating') from public.source_change_review_items where kind = 'evidence_missing';
select tests.decide(id, 'accepted') from public.source_change_review_items where kind in ('evidence_moved', 'new_information');
select tests.decide(id, 'rejected') from public.source_change_review_items where kind in ('possible_contradiction', 'support_changed');
select tests.eq((select count(*)::int from public._blocking_change_reviews(tests.id('h'))), 1, 'only the investigating item blocks');
select tests.as_user('ann');
select tests.throws(tests.pub_sql('h'), 'BTPF0', 'an investigating item blocks publication');
select tests.as_owner();
select tests.throws(format('select tests.decide(id, %L) from public.source_change_review_items where kind = %L', 'open', 'evidence_moved'), 'BTIT0',
                    'a decided item is final');
do $$
begin
  perform tests.decide(id, 'accepted') from public.source_change_review_items where kind = 'evidence_missing';
  perform tests.eq((select count(*)::int from public._blocking_change_reviews(tests.id('h'))), 0, 'every item decided: nothing blocks');
  perform tests.as_user('ann');
  perform tests.eq(tests.read(format('select public.api_get_readiness(%L)', tests.id('h'))) ->> 'canPublish', 'true', 'readiness: ready');
  perform public.publish_handover(tests.actor(), tests.id('h'), 'v2');
  perform tests.as_owner();
  perform tests.eq((select count(*)::int from public.handover_publications where handover_id = tests.id('h')), 2, 'published');
  raise exception 'undo' using errcode = 'TZRB0';
exception when sqlstate 'TZRB0' then
  null;
end $$;
select tests.as_owner();
select tests.eq((select count(*)::int from public.handover_publications where handover_id = tests.id('h')), 1, 'undone: one publication');

-- ── a newer version supersedes the update: unresolved items become stale, decisions stay ─
select tests.put('v3', tests.new_version(tests.id('v2'), tests.hx('c')));
do $$
begin
  perform tests.eq((tests.change(tests.id('v2'))).state, 'superseded', 'the ready update is superseded');
  perform tests.eq((select state || ':' || stale_reason from public.source_change_review_items where kind = 'evidence_missing'), 'stale:superseded',
                   'its investigating item is stale');
  perform tests.eq((select array_agg(state order by kind) from public.source_change_review_items where kind <> 'evidence_missing'),
                   array['accepted', 'accepted', 'rejected', 'rejected'], 'decided items keep their decision');
  perform tests.eq(tests.items(tests.id('v2')), 5, 'nothing is deleted');
  perform tests.eq((select (after ->> 'items')::int from public.audit_logs where action = 'source_update.review_items_stale' and handover_id = tests.id('h')), 1,
                   'the stale transition is audited');
  perform tests.eq((select count(*)::int from public._blocking_change_reviews(tests.id('h'))), 0, 'stale items do not block');
  perform tests.eq((select count(*)::int from public._blocking_source_updates(tests.id('h'))), 1, 'the new version itself blocks until processed');
  perform tests.eq((tests.change(tests.id('v3'))).base_publication_id, tests.id('pub1'), 'v3''s baseline is still publication 1');
end $$;

-- ── the published snapshot never moved ───────────────────────────────────────
select tests.eq((select jsonb_agg(to_jsonb(pp) order by pp.id) from public.publication_points pp where pp.publication_id = tests.id('pub1')),
                tests.kv('pub1_points'), 'publication 1 is byte-for-byte what was published');
select tests.as_user('inc');
select tests.eq(tests.read(format('select public.api_get_published_handover(%L)', tests.id('h'))), tests.kv('published_v1'),
                'the incoming member reads publication 1 unchanged');
select tests.as_owner();

-- ── a run that succeeded WITHOUT recording detection is never ready ───────────
select tests.put('run3', tests.start('h', 'run3', array[tests.id('v3')]));
update public.sources set state = 'parsed' where id = tests.id('v3');
update public.processing_jobs set status = 'succeeded', finished_at = now(), attempt = 1, progress_done = 1, progress_total = 1 where run_id = tests.id('run3');
select tests.as_service();
select public.finish_processing_run(tests.id('run3'), 'succeeded', null, null);
select tests.as_owner();
select tests.eq(((tests.change(tests.id('v3'))).state, (tests.change(tests.id('v3'))).error_code)::text, '(failed,detection_incomplete)',
                'no detection: failed (detection_incomplete), still blocking');
select tests.eq((select count(*)::int from public._blocking_source_updates(tests.id('h'))), 1, 'and it blocks publication');

-- ── an update processed before this migration (awaiting_detection) is retried by the next scoped run ─
do $$
begin
  alter table public.source_version_changes disable trigger source_version_changes_guard;
  update public.source_version_changes set state = 'awaiting_detection', error_code = null where to_source_id = tests.id('v3');
  alter table public.source_version_changes enable trigger source_version_changes_guard;
  perform tests.as_user('ann');
  perform tests.eq(public.source_update_processing_scope(tests.actor(), tests.id('h')), jsonb_build_object('mode', 'scoped', 'sourceIds', jsonb_build_array(tests.id('v3'))),
                   'awaiting_detection is part of the next scoped run');
  perform tests.as_owner();
  raise exception 'undo' using errcode = 'TZRB0';
exception when sqlstate 'TZRB0' then
  null;
end $$;

-- ── removing the source makes its unresolved items stale ─────────────────────
select tests.put('run4', tests.start('h', 'run4', array[tests.id('v3')]));
select tests.claim_analyze(tests.id('run4'), 'j4');
select tests.as_service();
select tests.eq(tests.run(tests.record_sql('j4', (select id from public.source_version_changes where to_source_id = tests.id('v3')),
                  jsonb_build_array(jsonb_build_object('kind', 'evidence_missing', 'dedupeKey', 'evidence_missing:' || tests.id('e1new') || ':' || tests.id('p1'),
                    'pointId', tests.id('p1'), 'baseRevisionId', (select current_revision_id from public.handover_points where id = tests.id('p1')),
                    'oldEvidenceId', tests.id('e1new'), 'detail', '{"match": "not_found"}'::jsonb)))) ->> 'inserted',
                '1', 'v3: the evidence of v2 is now the previous version''s evidence');
select tests.as_owner();
update public.processing_jobs set status = 'succeeded', finished_at = now() where run_id = tests.id('run4');
select tests.as_service();
select public.finish_processing_run(tests.id('run4'), 'cancelled', null, null);
select tests.as_owner();
select tests.eq(((tests.change(tests.id('v3'))).state, (tests.change(tests.id('v3'))).error_code)::text, '(failed,run_cancelled)',
                'a cancelled run: failed, never ready (its recorded items stay)');
select tests.eq((select count(*)::int from public._blocking_change_reviews(tests.id('h'))), 1, 'its open item blocks');
select tests.as_user('ann');
select public.remove_source(tests.actor(), tests.id('v3'));
select tests.as_owner();
select tests.eq((select i.state || ':' || i.stale_reason from public.source_change_review_items i join public.source_version_changes c on c.id = i.change_id
                  where c.to_source_id = tests.id('v3')), 'stale:source_removed', 'removing the source makes its open item stale');
select tests.eq((select count(*)::int from public._blocking_change_reviews(tests.id('h'))), 0, 'nothing blocks any more');

-- ── a never-published handover: no baseline, no new_information item ────────
select tests.handover('h2', 'ann', 'outgoing');
select tests.source('h2', 'q1');
update public.sources set consent_ai_provider = 'fake' where handover_id = tests.id('h2');
insert into public.processing_runs (handover_id, status, source_ids, pipeline_version, ai_provider, ai_config, created_at, finished_at)
values (tests.id('h2'), 'succeeded', array[tests.id('q1')], 'pv-test', 'fake', '{}', clock_timestamp() - interval '1 hour', now());
insert into public.processing_jobs (handover_id, run_id, source_id, stage, status, attempt, input_hash, progress_done, progress_total)
select tests.id('h2'), r.id, tests.id('q1'), 'extract', 'succeeded', 1, '\x01', 1, 1 from public.processing_runs r where r.handover_id = tests.id('h2');
select tests.set_state('h2', 'in_review');
select tests.put('q2', tests.new_version(tests.id('q1'), tests.hx('d')));
select tests.ok((tests.change(tests.id('q2'))).base_publication_id is null, 'never published: no baseline');
update public.sources set state = 'parsed' where id = tests.id('q2');
insert into public.source_participants (handover_id, source_id, local_id, display_label, identity_kind, identity_hash, identity_pepper_version, message_count)
select handover_id, tests.id('q2'), local_id, display_label, identity_kind, identity_hash, identity_pepper_version, 1 from public.source_participants where source_id = tests.id('q1');
insert into public.source_messages (handover_id, source_id, participant_id, seq, sent_at, kind, body, body_sha256)
select tests.id('h2'), tests.id('q2'), sp.id, 0, timestamptz '2026-07-01', 'text', 'Alice message 7 about the bank account handover',
       sha256(convert_to('a7', 'UTF8')) from public.source_participants sp where sp.source_id = tests.id('q2') and sp.local_id = 'p_alice';
select tests.start('h2', 'r2', array[tests.id('q2')]);
select tests.point('h2', 'n1');
select tests.cite('n1', 'q2', 'alice', 7, 'supports', 'exact', 'ln1');
select tests.claim_analyze(tests.id('r2'), 'jn');
select tests.as_service();
select tests.throws(tests.record_sql('jn', (select id from public.source_version_changes where to_source_id = tests.id('q2')),
                      jsonb_build_array(jsonb_build_object('kind', 'new_information', 'dedupeKey', 'new_information:' || tests.id('n1'),
                        'candidatePointId', tests.id('n1'), 'newEvidenceId', (select evidence_id from public.point_evidence where id = tests.id('ln1')),
                        'detail', '{}'::jsonb))), 'BTFB0', 'never published: new points stay in the initial review, not a change item');
select tests.eq(tests.run(tests.record_sql('jn', (select id from public.source_version_changes where to_source_id = tests.id('q2')), '[]'::jsonb)),
                '{"inserted": 0, "items": 0}'::jsonb, 'an empty detection is recorded');
-- attempt-only fence (no generation) still works while unambiguous; a reclaimed job's old claim does not
select tests.as_owner();
update public.processing_jobs set lease_expires_at = now() - interval '1 second', next_attempt_at = now() - interval '1 hour'
 where id = (tests.kv('jn') ->> 'id')::uuid;
select tests.as_service();
select tests.kv_put('jn2', (select to_jsonb(c) from public.claim_ready_processing_jobs(10, 300) c where c.id = (tests.kv('jn') ->> 'id')::uuid));
select tests.eq((tests.kv('jn2') ->> 'attempt')::int, 2, 'lost lease: reclaimed as attempt 2');
select tests.throws(tests.record_sql('jn', (select id from public.source_version_changes where to_source_id = tests.id('q2')), '[]'::jsonb), 'BTLL0',
                    'the worker that lost its lease cannot record detection');
select tests.eq(tests.run(tests.record_sql('jn2', (select id from public.source_version_changes where to_source_id = tests.id('q2')), '[]'::jsonb)),
                '{"inserted": 0, "items": 0}'::jsonb, 'the new claim records the same (empty) set');
select tests.as_owner();
select tests.eq(tests.items(tests.id('q2')), 0, 'no items for the never-published handover');
