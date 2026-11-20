-- 2026-11-20 (Round 4): a connector's version 2 (a chat_import flush) is an UPLOADED CANDIDATE without consent. The
-- processing page now collects its consent; this suite pins the server-side behaviour that UI relies on:
-- without consent v2 stays a candidate; consent activates it (v1 superseded but intact, v1 evidence kept); the next
-- run is the SCOPED update run over v2 only; existing points, revisions and review decisions are not changed.
-- Synthetic data only.
\set ON_ERROR_STOP 1

select tests.user(u) from unnest(array['ann', 'inc']) u;

-- ── a processed, published handover: two sources + a connector chat_import v1 ──
select tests.handover('h', 'ann', 'outgoing');
select tests.member('h', 'inc', 'incoming');
select tests.source('h', 's1');
select tests.source('h', 's2');
select tests.source('h', 'tg1');
update public.sources set kind = 'chat_import', title = 'Telegram · treasurer group' where id = tests.id('tg1');
update public.sources set consent_ai_provider = 'fake' where handover_id = tests.id('h');
insert into public.processing_runs (handover_id, status, source_ids, pipeline_version, ai_provider, ai_config, created_at, finished_at)
values (tests.id('h'), 'succeeded', array[tests.id('s1'), tests.id('s2'), tests.id('tg1')], 'pv-test', 'fake', '{}',
        clock_timestamp() - interval '1 hour', now());
insert into public.processing_jobs (handover_id, run_id, source_id, stage, status, attempt, input_hash, progress_done, progress_total)
select tests.id('h'), r.id, s, 'extract', 'succeeded', 1, '\x01', 2, 2
  from public.processing_runs r cross join unnest(array[tests.id('s1'), tests.id('s2'), tests.id('tg1')]) s where r.handover_id = tests.id('h');
select tests.point('h', 'p1');
select tests.cite('p1', 's1', 'alice', 1);
select tests.point('h', 'p2');
select tests.cite('p2', 'tg1', 'bob', 1); -- evidence that references the connector's version 1
select tests.set_state('h', 'in_review');
select tests.approve_all('h');
select tests.as_user('ann');

select tests.put('pub1', public.publish_handover(tests.actor(), tests.id('h'), 'v1'));
select public.start_revision(tests.actor(), tests.id('h'));
select tests.as_owner();

-- what must never change: points, their revisions, evidence links and review decisions; v1's own rows
create function tests.points_snapshot() returns jsonb language sql security definer as $$
  select jsonb_build_object(
    'points', (select jsonb_agg(jsonb_build_array(p.id, p.review_state, p.evidence_status, p.current_revision_id) order by p.id)
                 from public.handover_points p where p.handover_id = tests.id('h')),
    'revisions', (select count(*) from public.point_revisions where handover_id = tests.id('h')),
    'evidence', (select jsonb_agg(jsonb_build_array(pe.id, pe.point_id, pe.evidence_id, pe.excluded_at) order by pe.id)
                   from public.point_evidence pe where pe.handover_id = tests.id('h')))
$$;
create function tests.v1_snapshot() returns jsonb language sql security definer as $$
  select jsonb_build_object('state', s.state, 'sha', encode(s.sha256, 'hex'), 'deleted', s.deleted_at is not null,
                            'messages', (select count(*) from public.source_messages m where m.source_id = s.id),
                            'quotes', (select count(*) from public.evidence_quotes q where q.source_id = s.id))
    from public.sources s where s.id = tests.id('tg1')
$$;
grant execute on all functions in schema tests to anon, authenticated, service_role;
select tests.kv_put('points_before', tests.points_snapshot());
select tests.kv_put('pub1_snapshot', (select jsonb_agg(to_jsonb(pp) order by pp.id) from public.publication_points pp where pp.publication_id = tests.id('pub1')));
select tests.kv_put('v1_before', tests.v1_snapshot());

-- ── the flush: an uploaded chat_import candidate, NO consent ────────────────────
do $$
declare v uuid;
begin
  perform tests.as_user('ann');
  v := (public.create_source_version(tests.actor(), tests.id('tg1'), 'chat_import', 'telegram-v2.jsonl', 'application/x-ndjson', 394,
                                     repeat('c', 64)) ->> 'source_id')::uuid;
  perform tests.put('tg2', v);
  perform tests.as_owner();
  insert into storage.objects (bucket_id, name, metadata)
  select 'source-uploads', raw_storage_path, '{"size": 394}' from public.sources where id = v;
  perform tests.as_user('ann');
  perform public.confirm_source_uploaded(tests.actor(), v, 394, repeat('c', 64));
  perform tests.as_owner();
end $$;

-- without consent: v2 remains a candidate and nothing about v1 or the points changes
select tests.eq((select state from public.sources where id = tests.id('tg2')), 'uploaded', 'candidate uploaded');
select tests.ok((select version_number is null and consent_recorded_at is null from public.sources where id = tests.id('tg2')),
                'without consent v2 remains a candidate (no version number, no consent)');
select tests.ok((select superseded_at is null from public.sources where id = tests.id('tg1')), 'v1 is still the current version');
select tests.eq((select count(*)::int from public.source_version_changes where to_source_id = tests.id('tg2')), 0, 'no update recorded yet');
select tests.as_user('ann');
select tests.throws(format('select public.start_source_update_processing(%L, %L, %L, %L, %L)', tests.id('ann'), tests.id('h'), 'pv-test',
                           '{"provider":"fake"}', '[]'), 'BTPF0', 'no scoped run is possible before consent');
select tests.as_owner();

-- ── consent (record_source_consent, the server action's RPC) activates v2 ──────
select tests.as_user('ann');
select public.record_source_consent(tests.actor(), tests.id('tg2'), 'consent@1', 'fake', 'everyone', 'Asia/Kolkata');
select tests.as_owner();
select tests.eq((select version_number from public.sources where id = tests.id('tg2')), 2, 'consent activates v2 as version 2');
select tests.ok((select superseded_at is not null and superseded_by_source_id = tests.id('tg2') from public.sources where id = tests.id('tg1')),
                'v1 is superseded by v2');
select tests.eq(tests.v1_snapshot(), tests.kv('v1_before'), 'v1 itself is intact (state, checksum, messages, evidence quotes)');
select tests.eq((select state from public.source_version_changes where to_source_id = tests.id('tg2')), 'awaiting_processing',
                'the update awaits processing');
select tests.eq(tests.points_snapshot(), tests.kv('points_before'),
                'consent changes no point, revision, evidence link or review decision (v1 evidence still linked)');

-- ── the next run is the SCOPED update run over v2 only ─────────────────────────
select tests.as_service();
select tests.eq(public.source_update_processing_scope(tests.id('ann'), tests.id('h')),
                jsonb_build_object('mode', 'scoped', 'sourceIds', jsonb_build_array(tests.id('tg2'))),
                'scope: only v2 (no full reprocessing of s1, s2 or v1)');
select tests.as_owner();
create function tests.jobs_for(p_sources uuid[]) returns jsonb language sql volatile as $$
  select (select jsonb_agg(j) from (
            select jsonb_build_object('stage', st, 'sourceId', s, 'inputHash', md5(st || s::text)) as j
              from unnest(p_sources) s cross join unnest(array['parse', 'extract', 'verify_quotes']) st
             where st <> 'parse' or (select state from public.sources where id = s) <> 'parsed'
            union all
            select jsonb_build_object('stage', w, 'sourceId', null, 'inputHash', md5(w))
              from unnest(array['verify_support', 'analyze', 'prepare_review']) w) x)
$$;
grant execute on function tests.jobs_for(uuid[]) to anon, authenticated, service_role;
select tests.as_user('ann');
select tests.throws(format('select public.start_source_update_processing(%L, %L, %L, %L, %L)', tests.id('ann'), tests.id('h'), 'pv-test',
                           '{"provider":"fake"}', tests.jobs_for(array[tests.id('tg2'), tests.id('s1')])), 'BTCF0',
                    'an extract job for an already-processed source is refused in the update run');
select tests.put('run2', public.start_source_update_processing(tests.actor(), tests.id('h'), 'pv-test', '{"provider":"fake"}',
                                                               tests.jobs_for(array[tests.id('tg2')])));
select tests.as_owner();
select tests.eq((select array_agg(distinct source_id order by source_id) from public.processing_jobs where run_id = tests.id('run2') and source_id is not null),
                array[tests.id('tg2')], 'source jobs only for v2 (its two messages are parsed and extracted)');
select tests.eq((select count(*)::int from public.processing_jobs where run_id = tests.id('run2') and source_id = tests.id('tg2') and stage = 'parse'),
                1, 'v2 is parsed (it was never parsed)');
select tests.eq(tests.points_snapshot(), tests.kv('points_before'), 'starting the update run changes no point either');
select tests.eq(tests.v1_snapshot(), tests.kv('v1_before'), 'v1 still intact');
select tests.eq((select jsonb_agg(to_jsonb(pp) order by pp.id) from public.publication_points pp where pp.publication_id = tests.id('pub1')),
                tests.kv('pub1_snapshot'), 'the published snapshot is byte-for-byte unchanged by the new version and its run');

-- ── provider-agnostic: four connector lineages (Telegram, Discord, Slack, GitHub) in one handover ──
-- Every connector writes kind chat_import through the shared flush, so the database path is identical; this pins it
-- for one lineage per provider: candidate without consent, activation by consent, v1 intact, scope = exactly the v2s.
select tests.handover('h2', 'ann', 'outgoing');
select tests.member('h2', 'inc', 'incoming');
select tests.source('h2', 'base');
create function tests.connector_v1(p_name text, p_title text) returns uuid language plpgsql as $$
declare v uuid;
begin
  v := tests.source('h2', p_name);
  update public.sources set kind = 'chat_import', title = p_title where id = v;
  return v;
end $$;
select tests.connector_v1('tg_1', 'Telegram - Treasurer group');
select tests.connector_v1('dc_1', 'Discord - #treasury');
select tests.connector_v1('sl_1', 'Slack - #core-team');
select tests.connector_v1('gh_1', 'GitHub - acme sponsors');
update public.sources set consent_ai_provider = 'fake' where handover_id = tests.id('h2');
insert into public.processing_runs (handover_id, status, source_ids, pipeline_version, ai_provider, ai_config, created_at, finished_at)
select tests.id('h2'), 'succeeded', array_agg(id), 'pv-test', 'fake', '{}', clock_timestamp() - interval '1 hour', now()
  from public.sources where handover_id = tests.id('h2');
insert into public.processing_jobs (handover_id, run_id, source_id, stage, status, attempt, input_hash, progress_done, progress_total)
select tests.id('h2'), r.id, s.id, 'extract', 'succeeded', 1, '\x01', 2, 2
  from public.processing_runs r join public.sources s on s.handover_id = r.handover_id where r.handover_id = tests.id('h2');
select tests.point('h2', 'q1');
select tests.cite('q1', 'base', 'alice', 1);
select tests.set_state('h2', 'in_review');
select tests.approve_all('h2');
select tests.as_user('ann');
select tests.put('pub2', public.publish_handover(tests.actor(), tests.id('h2'), 'v1'));
select public.start_revision(tests.actor(), tests.id('h2'));
select tests.as_owner();
create function tests.lineage_snapshot() returns jsonb language sql security definer as $$
  select jsonb_object_agg(s.title, jsonb_build_array(s.state, encode(s.sha256, 'hex'),
                                                    (select count(*) from public.source_messages m where m.source_id = s.id)))
    from public.sources s where s.handover_id = tests.id('h2') and s.kind = 'chat_import' and s.version_number = 1
$$;
grant execute on all functions in schema tests to anon, authenticated, service_role;
select tests.kv_put('h2_v1_before', tests.lineage_snapshot());
select tests.kv_put('h2_points_before', (select jsonb_agg(jsonb_build_array(p.id, p.review_state, p.current_revision_id) order by p.id)
                                           from public.handover_points p where p.handover_id = tests.id('h2')));

do $$
declare
  p record;
  v uuid;
  hex text;
begin
  for p in select * from (values ('tg', 'd'), ('dc', 'e'), ('sl', 'f'), ('gh', '0')) t(name, ch) loop
    hex := repeat(p.ch, 64);
    perform tests.as_user('ann');
    v := (public.create_source_version(tests.actor(), tests.id(p.name || '_1'), 'chat_import', p.name || '-v2.jsonl', 'application/x-ndjson',
                                       200, hex) ->> 'source_id')::uuid;
    perform tests.put(p.name || '_2', v);
    perform tests.as_owner();
    insert into storage.objects (bucket_id, name, metadata) select 'source-uploads', raw_storage_path, '{"size": 200}' from public.sources where id = v;
    perform tests.as_user('ann');
    perform public.confirm_source_uploaded(tests.actor(), v, 200, hex);
    perform tests.as_owner();
    perform tests.ok((select version_number is null and state = 'uploaded' from public.sources where id = v),
                     p.name || ': the flushed version is an uploaded candidate until consent');
  end loop;

  -- consent (the same server action for every provider) activates each candidate
  for p in select unnest(array['tg', 'dc', 'sl', 'gh']) as name loop
    perform tests.as_user('ann');
    perform public.record_source_consent(tests.actor(), tests.id(p.name || '_2'), 'consent@1', 'fake', 'everyone', 'Asia/Kolkata');
    perform tests.as_owner();
    perform tests.eq((select version_number from public.sources where id = tests.id(p.name || '_2')), 2, p.name || ': consent activates version 2');
    perform tests.ok((select superseded_by_source_id = tests.id(p.name || '_2') from public.sources where id = tests.id(p.name || '_1')),
                     p.name || ': version 1 is superseded by its own version 2');
  end loop;
end $$;
select tests.eq(tests.lineage_snapshot(), tests.kv('h2_v1_before'), 'every provider''s version 1 is intact');
select tests.eq((select jsonb_agg(jsonb_build_array(p.id, p.review_state, p.current_revision_id) order by p.id)
                   from public.handover_points p where p.handover_id = tests.id('h2')), tests.kv('h2_points_before'),
                'no point or review decision changed');
select tests.as_service();
select tests.eq((select array_agg(x order by x) from jsonb_array_elements_text(
                   public.source_update_processing_scope(tests.id('ann'), tests.id('h2')) -> 'sourceIds') x),
                (select array_agg(id::text order by id::text) from public.sources where id in (tests.id('tg_2'), tests.id('dc_2'), tests.id('sl_2'), tests.id('gh_2'))),
                'scope: exactly the four new versions (base and every version 1 are not reprocessed)');
select tests.eq(public.source_update_processing_scope(tests.id('ann'), tests.id('h2')) ->> 'mode', 'scoped', 'the scoped update run');
select tests.as_owner();
