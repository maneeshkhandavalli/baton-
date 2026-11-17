-- R3 Task 05B: the source version model (migration 20261117500100_source_versions). Synthetic data only.
\set ON_ERROR_STOP 1

select tests.user(u) from unnest(array['ann', 'out', 'rev', 'inc', 'eve', 'bob']) u;

-- A synthetic checksum: one hex character × 64.
create function tests.hx(p_char text) returns text language sql immutable as $$ select repeat(p_char, 64) $$;
create function tests.sha_of(p_source text) returns text language sql volatile as $$
  select encode(sha256, 'hex') from public.sources where id = tests.id(p_source)
$$;
-- create_source_version as the server acting for p_user.
create function tests.ver_sql(p_user text, p_prev uuid, p_hex text, p_kind text default 'whatsapp_export')
returns text language sql volatile as $$
  select format('select public.create_source_version(%L, %L, %L, %L, %L, %s, %L)::text', tests.id(p_user), p_prev, p_kind,
                'Chat export v2.txt', 'text/plain', 100, p_hex)
$$;
create function tests.ver(p_user text, p_prev uuid, p_hex text, p_kind text default 'whatsapp_export') returns jsonb
language plpgsql volatile as $$
declare v text;
begin
  perform tests.as_user(p_user);
  execute tests.ver_sql(p_user, p_prev, p_hex, p_kind) into v;
  perform tests.as_owner();
  return v::jsonb;
end $$;
-- the file arrives in Storage
create function tests.put_object(p_source uuid) returns void language sql as $$
  insert into storage.objects (bucket_id, name, metadata)
  select 'source-uploads', raw_storage_path, jsonb_build_object('size', 100) from public.sources where id = p_source
$$;
-- the server confirms it (measured size and checksum)
create function tests.confirm(p_user text, p_source uuid, p_hex text) returns void language plpgsql as $$
begin
  perform tests.as_user(p_user);
  perform public.confirm_source_uploaded(tests.actor(), p_source, 100, p_hex);
  perform tests.as_owner();
end $$;
create function tests.consent_sql(p_user text, p_source uuid, p_access text) returns text language sql volatile as $$
  select format('select public.record_source_consent(%L, %L, %L, %L, %L, %L)::text', tests.id(p_user), p_source, 'consent@1',
                'fake', p_access, 'Asia/Kolkata')
$$;
create function tests.consent(p_user text, p_source uuid, p_access text default 'everyone') returns void language plpgsql as $$
begin
  perform tests.as_user(p_user);
  execute tests.consent_sql(p_user, p_source, p_access);
  perform tests.as_owner();
end $$;
-- a pending update whose file has arrived and been confirmed (not yet active)
create function tests.candidate(p_user text, p_prev uuid, p_hex text) returns uuid language plpgsql as $$
declare v uuid;
begin
  v := (tests.ver(p_user, p_prev, p_hex) ->> 'source_id')::uuid;
  perform tests.put_object(v);
  perform tests.confirm(p_user, v, p_hex);
  return v;
end $$;
-- a full new version: create, upload, confirm, consent
create function tests.new_version(p_user text, p_prev uuid, p_hex text, p_access text default 'everyone') returns uuid
language plpgsql as $$
declare v uuid;
begin
  v := tests.candidate(p_user, p_prev, p_hex);
  perform tests.consent(p_user, v, p_access);
  return v;
end $$;
create function tests.src_row(p_id uuid) returns public.sources language sql volatile as $$
  select * from public.sources where id = p_id
$$;
create function tests.start_sql(p_user text, p_h text, p_sources uuid[]) returns text language sql volatile as $$
  select format('select public.start_processing(%L, %L, %L, %L, %L)::text', tests.id(p_user), tests.id(p_h), 'pv-test',
                '{"provider":"fake"}',
                (select jsonb_agg(jsonb_build_object('stage', 'extract', 'sourceId', s, 'inputHash', md5(s::text))) from unnest(p_sources) s))
$$;
grant execute on all functions in schema tests to anon, authenticated, service_role;

select tests.handover('h', 'ann', 'outgoing');
select tests.member('h', 'out', 'outgoing');
select tests.member('h', 'rev', 'reviewer');
select tests.member('h', 'inc', 'incoming');
select tests.source('h', 's1');
select tests.source('h', 's2', 'leads_only');
update public.sources set consent_ai_provider = 'fake' where handover_id = tests.id('h');
select tests.point('h', 'p1');
select tests.cite('p1', 's1', 'alice', 1);

-- ── grants and RLS surface ───────────────────────────────────────────────────
select tests.ok(has_function_privilege('service_role', 'public.create_source_version(uuid,uuid,text,text,text,bigint,text,text)', 'EXECUTE')
                and not has_function_privilege('authenticated', 'public.create_source_version(uuid,uuid,text,text,text,bigint,text,text)', 'EXECUTE')
                and not has_function_privilege('anon', 'public.create_source_version(uuid,uuid,text,text,text,bigint,text,text)', 'EXECUTE'),
                'create_source_version is server-only');
select tests.ok(has_function_privilege('service_role', 'public.record_source_consent(uuid,uuid,text,text,text,text,text,date)', 'EXECUTE')
                and not has_function_privilege('authenticated', 'public.record_source_consent(uuid,uuid,text,text,text,text,text,date)', 'EXECUTE')
                and has_function_privilege('service_role', 'public.remove_source(uuid,uuid)', 'EXECUTE')
                and not has_function_privilege('authenticated', 'public.remove_source(uuid,uuid)', 'EXECUTE')
                and has_function_privilege('service_role', 'public.start_processing(uuid,uuid,text,jsonb,jsonb)', 'EXECUTE')
                and has_function_privilege('service_role', 'public.create_source(uuid,uuid,text,text,text,bigint,text,text)', 'EXECUTE')
                and has_function_privilege('authenticated', 'public._source_json(public.sources)', 'EXECUTE'),
                'replaced functions keep their grants');
do $$
declare r text;
begin
  foreach r in array array['anon', 'authenticated', 'service_role'] loop
    perform tests.ok(not has_table_privilege(r, 'public.source_version_changes', 'INSERT')
                     and not has_table_privilege(r, 'public.source_version_changes', 'UPDATE')
                     and not has_table_privilege(r, 'public.source_version_changes', 'DELETE')
                     and not has_table_privilege(r, 'public.sources', 'INSERT')
                     and not has_table_privilege(r, 'public.sources', 'UPDATE')
                     and not has_table_privilege(r, 'public.sources', 'DELETE'), r || ' cannot write versions or sources');
    perform tests.ok(not has_function_privilege(r, 'public._guard_source_versions()', 'EXECUTE')
                     and not has_function_privilege(r, 'public._guard_source_version_changes()', 'EXECUTE'), r || ' cannot run the guards');
  end loop;
end $$;
select tests.ok((select relrowsecurity from pg_class where oid = 'public.source_version_changes'::regclass), 'RLS is on');

-- ── 1. every source is version 1 of its own lineage (rows inserted without lineage too) ─
select tests.eq((select count(*)::int from public.sources
                  where handover_id = tests.id('h') and (lineage_id <> id or version_number <> 1 or supersedes_source_id is not null
                         or superseded_at is not null)), 0, '1: every plain source is version 1 of its own lineage');

-- ── publish a first version, so a published snapshot exists before any update ─
select tests.set_state('h', 'in_review');
select tests.approve_all('h');
select tests.as_user('ann');
select tests.put('pub1', public.publish_handover(tests.actor(), tests.id('h'), 'v1'));
select tests.as_owner();
create table tests.snap as
  select (select jsonb_agg(to_jsonb(pp) order by pp.id) from public.publication_points pp where pp.publication_id = tests.id('pub1')) as pts,
         (select to_jsonb(q) from public.evidence_quotes q
           join public.point_evidence pe on pe.evidence_id = q.id where pe.point_id = tests.id('p1')) as quote;
grant select on tests.snap to anon, authenticated, service_role;
select tests.as_user('inc');
select tests.kv_put('published_before', tests.read(format('select public.api_get_published_handover(%L)', tests.id('h'))));
select tests.as_owner();

-- after publishing the handover is approved: no version can be added until a revision is started
select tests.as_user('ann');
select tests.throws(tests.ver_sql('ann', tests.id('s1'), tests.hx('b')), 'BTIT0', 'no new version while the handover is approved');
select public.start_revision(tests.actor(), tests.id('h'));
select tests.as_owner();

-- ── 15. authorisation: only the creator creates a version ─────────────────────
select tests.as_user('out');
select tests.throws(tests.ver_sql('out', tests.id('s1'), tests.hx('b')), 'BTFB0', '15: an outgoing member (a source manager) cannot create a version');
select tests.as_user('rev');
select tests.throws(tests.ver_sql('rev', tests.id('s1'), tests.hx('b')), 'BTFB0', '15: a reviewer cannot');
select tests.as_user('inc');
select tests.throws(tests.ver_sql('inc', tests.id('s1'), tests.hx('b')), 'BTFB0', '15: the incoming member cannot');
select tests.as_user('eve');
select tests.throws(tests.ver_sql('eve', tests.id('s1'), tests.hx('b')), 'BTNF0', '15: a non-member gets not_found');
select tests.as_user('ann');
select tests.throws(tests.ver_sql('ann', gen_random_uuid(), tests.hx('b')), 'BTNF0', 'unknown source: not_found');
select tests.throws(tests.ver_sql('ann', tests.id('s1'), tests.hx('b'), 'pdf'), 'BTVF0', 'a version must be the same kind');
select tests.throws(tests.ver_sql('ann', tests.id('s1'), 'XYZ'), 'BTVF0', 'a malformed checksum is refused');
select tests.throws(tests.ver_sql('ann', tests.id('s1'), tests.sha_of('s2')), 'BTCF0', 'the file of another live source is a duplicate');
select tests.as_owner();
select tests.eq((select count(*)::int from public.sources where handover_id = tests.id('h')), 2, '15: no refused attempt wrote a row');

-- ── 8. identical content is a no-op ──────────────────────────────────────────
select tests.eq(tests.ver('ann', tests.id('s1'), tests.sha_of('s1')) ->> 'outcome', 'unchanged', '8: the same file again: unchanged');
select tests.eq((select count(*)::int from public.sources where handover_id = tests.id('h')), 2, '8: and nothing written');

-- ── 2. a new version links to its predecessor (two phases) ──────────────────
select tests.eq(tests.ver('ann', tests.id('s1'), tests.hx('b')) ->> 'outcome', 'created', '2: a pending update is created');
select tests.put('v2', (select id from public.sources where supersedes_source_id = tests.id('s1')));
do $$
declare c public.sources := tests.src_row(tests.id('v2'));
begin
  perform tests.eq(c.lineage_id, tests.id('s1'), '2: same lineage');
  perform tests.ok(c.version_number is null and c.state = 'pending_upload', '2: not active yet (no number until consent)');
  perform tests.eq(c.access_level, 'everyone', '2: the previous access level is the default');
  perform tests.eq(c.title, (tests.src_row(tests.id('s1'))).title, '2: the source keeps its name');
  perform tests.ok((tests.src_row(tests.id('s1'))).superseded_at is null, '2: the previous version is still current');
end $$;
-- retries of the same update before its file arrived reuse the row; afterwards they point to the next step
select tests.eq(tests.ver('ann', tests.id('s1'), tests.hx('b')), jsonb_build_object('handover_id', tests.id('h'), 'outcome', 'resumed', 'source_id', tests.id('v2')),
                '8: a retry reuses the pending update');
select tests.eq(tests.ver('ann', tests.id('s1'), tests.hx('c')) ->> 'outcome', 'update_in_progress', 'another file while one update is pending: refused');
select tests.put_object(tests.id('v2'));
select tests.eq(tests.ver('ann', tests.id('s1'), tests.hx('b')) ->> 'outcome', 'awaiting_confirmation', '8: the file arrived: confirm it');
select tests.confirm('ann', tests.id('v2'), tests.hx('b'));
select tests.eq(tests.ver('ann', tests.id('s1'), tests.hx('b')) ->> 'outcome', 'awaiting_consent', '8: confirmed: record consent');
select tests.eq((select count(*)::int from public.sources where lineage_id = tests.id('s1')), 2, '8: retries never added a row');

-- a pending update is never processed, and the 10-source cap does not count it
select tests.as_user('ann');
select tests.throws(tests.start_sql('ann', 'h', array[tests.id('v2')]), 'BTVF0', '12: a pending update is not part of a run');
select tests.as_owner();

-- activation is the creator's, refuses a broader visibility, and the version must have arrived
select tests.as_user('out');
select tests.throws(tests.consent_sql('out', tests.id('v2'), 'everyone'), 'BTFB0', '15: an outgoing member cannot activate a version');
select tests.as_owner();
update public.sources set date_order = 'dmy', document_date = '2026-01-05' where id = tests.id('s1');
select tests.consent('ann', tests.id('v2'), 'everyone');
select tests.ok((tests.src_row(tests.id('v2'))).date_order = 'dmy' and (tests.src_row(tests.id('v2'))).document_date = '2026-01-05',
                'the new version keeps the previous parse settings when none are given');
do $$
declare
  a public.sources := tests.src_row(tests.id('s1'));
  b public.sources := tests.src_row(tests.id('v2'));
  c public.source_version_changes;
begin
  perform tests.eq(b.version_number, 2, '3: numbered 2');
  perform tests.eq(b.supersedes_source_id, a.id, '2: links its predecessor');
  perform tests.eq(a.superseded_by_source_id, b.id, '2: the predecessor names its successor');
  perform tests.ok(a.superseded_at is not null and a.deleted_at is null and a.state = 'parsed', '2: the predecessor is superseded, not removed');
  perform tests.ok(b.consent_recorded_at is not null and b.consent_recorded_by = tests.id('ann'), '5: fresh consent recorded on the new version');
  select * into c from public.source_version_changes where to_source_id = b.id;
  perform tests.ok(c.from_source_id = a.id and c.from_version = 1 and c.to_version = 2 and c.state = 'awaiting_processing'
                   and c.lineage_id = a.id and c.created_by = tests.id('ann') and c.detector_version is null,
                   '2: one transition record, awaiting processing');
  perform tests.eq((select count(*)::int from public.audit_logs where entity_id = b.id and action = 'source.version_created'), 1, 'audited: version created');
  perform tests.eq((select count(*)::int from public.audit_logs where entity_id = a.id and action = 'source.superseded'), 1, 'audited: superseded');
  perform tests.eq((select count(*)::int from public.audit_logs where entity_id = b.id and action = 'source.version_upload_started'), 1, 'audited: upload started');
end $$;
-- a repeated consent is an ordinary consent update: no second version, no second record
select tests.consent('ann', tests.id('v2'), 'everyone');
select tests.eq((select count(*)::int from public.source_version_changes where lineage_id = tests.id('s1')), 1, '8: a repeated consent creates nothing new');
select tests.eq((tests.src_row(tests.id('v2'))).version_number, 2, '8: still version 2');

-- ── 6/9. the superseded version is stale; it cannot be changed or receive another successor ─
select tests.eq(tests.ver('ann', tests.id('s1'), tests.hx('d')), jsonb_build_object('handover_id', tests.id('h'), 'outcome', 'stale', 'source_id', tests.id('v2')),
                '9: an update of a superseded version is stale and names the current one');
select tests.as_user('ann');
select tests.throws(tests.consent_sql('ann', tests.id('s1'), 'reviewer_only'), 'BTIT0', '6: a superseded version cannot be changed');
select tests.as_owner();
select tests.throws(format('update public.sources set superseded_at = now(), superseded_by_source_id = %L where id = %L', tests.id('s2'), tests.id('s1')),
                    'BTIT0', '6: a superseded version cannot be superseded again (even by the owner)');

-- ── 13. historical evidence and the published snapshot are untouched ─────────
do $$
begin
  perform tests.eq((select jsonb_agg(to_jsonb(pp) order by pp.id) from public.publication_points pp where pp.publication_id = tests.id('pub1')),
                   (select pts from tests.snap), '13: the published snapshot is unchanged');
  perform tests.eq((select to_jsonb(q) from public.evidence_quotes q join public.point_evidence pe on pe.evidence_id = q.id
                     where pe.point_id = tests.id('p1')), (select quote from tests.snap), '13: the evidence quote is unchanged');
  perform tests.ok((select bool_and(pe.excluded_at is null) from public.point_evidence pe where pe.point_id = tests.id('p1')),
                   '13: the evidence of the earlier version stays active');
  perform tests.eq((select evidence_status from public.handover_points where id = tests.id('p1')), 'sourced', '13: the point stays sourced');
end $$;
select tests.as_user('inc');
select tests.eq(tests.read(format('select public.api_get_published_handover(%L)', tests.id('h'))), tests.kv('published_before'),
                '13: the incoming member reads exactly the same published handover');
select tests.as_user('rev');
select tests.eq((select count(*)::int from jsonb_array_elements(
                   tests.read(format('select public.api_get_point(%L)', tests.id('p1'))) -> 'evidence') e
                  where e ->> 'evidence_id' = (select quote ->> 'id' from tests.snap) and e ->> 'support_verdict' = 'supports'), 1,
                '13: the reviewer still reads the evidence of version 1');
select tests.eq((select count(*)::int from jsonb_array_elements(tests.read(format('select public.api_list_sources(%L)', tests.id('h')))) s
                  where s -> 'version' ->> 'superseded_by_source_id' = tests.id('v2')::text and (s -> 'version' ->> 'version_number')::int = 1),
                1, 'the read API reports the version chain');
select tests.eq((select count(*)::int from public.source_version_changes), 1, 'a reviewer with clearance reads the transition record');
select tests.as_reader('inc');
select tests.eq((select count(*)::int from public.source_version_changes), 0, 'the incoming member (no source visibility) reads no transition record');
select tests.as_owner();

-- ── 12. start_processing includes the current versions only ───────────────────
select tests.as_user('ann');
select tests.throws(tests.start_sql('ann', 'h', array[tests.id('s1')]), 'BTVF0', '12: a job for a superseded version is refused');
select tests.put('run1', public.start_processing(tests.actor(), tests.id('h'), 'pv-test', '{"provider":"fake"}',
                   jsonb_build_array(jsonb_build_object('stage', 'parse', 'sourceId', tests.id('v2'), 'inputHash', md5('v2')))));
select tests.as_owner();
select tests.eq((select source_ids from public.processing_runs where id = tests.id('run1')), array[tests.id('s2'), tests.id('v2')],
                '12: the run includes the current versions only (s2 and version 2 of s1, never version 1)');
-- while processing, the lineage is frozen
select tests.as_user('ann');
select tests.throws(tests.ver_sql('ann', tests.id('v2'), tests.hx('e')), 'BTIT0', 'no new version while processing');
select public.cancel_processing(tests.actor(), tests.id('h'));
select tests.as_owner();
select tests.set_state('h', 'in_review');

-- ── 3. version 3; the earlier transition record becomes superseded ────────────
select tests.put('v3', tests.new_version('ann', tests.id('v2'), tests.hx('e')));
do $$
begin
  perform tests.eq((tests.src_row(tests.id('v3'))).version_number, 3, '3: numbered 3');
  perform tests.eq((tests.src_row(tests.id('v3'))).lineage_id, tests.id('s1'), '3: same lineage');
  perform tests.eq((select array_agg(state order by from_version) from public.source_version_changes where lineage_id = tests.id('s1')),
                   array['superseded', 'awaiting_processing'], '3: 1→2 superseded by 2→3, which awaits processing');
  perform tests.eq((select count(*)::int from public.sources where lineage_id = tests.id('s1') and version_number is not null
                     and superseded_at is null and deleted_at is null), 1, 'exactly one current version per lineage');
end $$;

-- ── 4/5/16. the chain cannot be forged, even by direct writes ─────────────────
select tests.as_service();
select tests.throws(format('update public.sources set superseded_at = now() where id = %L', tests.id('s2')), '42501', '16: service_role cannot write sources');
select tests.throws(format('insert into public.source_version_changes (handover_id, lineage_id, from_source_id, to_source_id, from_version, to_version) values (%L, %L, %L, %L, 1, 2)',
                           tests.id('h'), tests.id('s2'), tests.id('s2'), tests.id('v3')), '42501', '16: service_role cannot write transition records');
select tests.as_reader('ann');
select tests.throws(format('update public.sources set version_number = 9 where id = %L', tests.id('s2')), '42501', '16: the browser cannot write sources');
select tests.as_owner();
-- owner writes still hit the invariants (no flag)
select tests.throws(format('update public.sources set supersedes_source_id = %L where id = %L', tests.id('s2'), tests.id('s2')), 'BTIT0',
                    '4: a source cannot supersede itself');
select tests.throws(format('update public.sources set lineage_id = %L where id = %L', tests.id('s1'), tests.id('s2')), 'BTIT0', '16: the lineage is immutable');
select tests.throws(format('update public.sources set version_number = 7 where id = %L', tests.id('v3')), 'BTIT0', '16: a version number never changes');
select tests.throws(format('update public.sources set superseded_at = null, superseded_by_source_id = null where id = %L', tests.id('s1')), 'BTIT0',
                    '16: a superseded version cannot become current again');
select tests.throws(format('update public.source_version_changes set state = %L where to_source_id = %L', 'superseded', tests.id('v3')), 'BTIT0',
                    '16: transition records change only through the transition');
select tests.throws(format('delete from public.source_version_changes where to_source_id = %L', tests.id('v3')), 'BTIT0', '16: and are never deleted directly');
select tests.throws(format($q$insert into public.sources (handover_id, uploaded_by, kind, title, original_filename, mime_type, size_bytes, sha256,
                          state, timezone, supersedes_source_id) values (%L, %L, 'whatsapp_export', 'x', 'x.txt', 'text/plain', 1, %L, 'pending_upload', 'UTC', %L)$q$,
                           tests.id('h'), tests.id('ann'), sha256('forged'), tests.id('s2')), 'BTIT0', '16: a version is created only through create_source_version');
-- with the internal flag, the owner still cannot link across handovers, to itself, or skip a number
select tests.handover('h2', 'bob', 'outgoing');
select tests.source('h2', 't1');
select tests.put('selfv', gen_random_uuid());
do $$
begin
  perform set_config('baton.versioning', 'on', true);
  perform tests.throws(format($q$insert into public.sources (handover_id, uploaded_by, kind, title, original_filename, mime_type, size_bytes, sha256,
                          state, timezone, supersedes_source_id) values (%L, %L, 'whatsapp_export', 'x', 'x.txt', 'text/plain', 1, %L, 'pending_upload', 'UTC', %L)$q$,
                          tests.id('h2'), tests.id('bob'), sha256('cross'), tests.id('s2')), 'BTIT0', '5: a version cannot replace a source of another handover');
  perform tests.throws(format($q$insert into public.sources (id, handover_id, uploaded_by, kind, title, original_filename, mime_type, size_bytes, sha256,
                          state, timezone, lineage_id, supersedes_source_id) values (%L, %L, %L, 'whatsapp_export', 'x', 'x.txt', 'text/plain', 1, %L, 'pending_upload', 'UTC', %L, %L)$q$,
                          tests.id('selfv'), tests.id('h'), tests.id('ann'), sha256('self'), tests.id('selfv'), tests.id('selfv')), 'BTIT0', '4: a new row cannot supersede itself');
  perform tests.throws(format('update public.sources set lineage_id = %L where id = %L', tests.id('t1'), tests.id('s2')), 'BTIT0', '5: no cross-handover lineage');
  perform set_config('baton.versioning', 'off', true);
end $$;

-- ── 14. exclusions and erasure rules reach every new version ──────────────────
-- s2 gets a source-scoped participant exclusion (bob) and a source-scoped date range; the handover has a
-- handover-wide phone exclusion (carol, as an erasure would create).
insert into public.source_exclusions (handover_id, source_id, kind, participant_identity_kind, participant_identity_hash,
                                      participant_identity_pepper_version, requested_via)
values (tests.id('h'), tests.id('s2'), 'participant', 'phone', sha256(convert_to('bob', 'UTF8')), 'p1', 'uploader'),
       (tests.id('h'), null, 'participant', 'phone', sha256(convert_to('carol', 'UTF8')), 'p1', 'participant_request');
insert into public.source_exclusions (handover_id, source_id, kind, range_start, range_end, requested_via)
values (tests.id('h'), tests.id('s2'), 'date_range', '2026-06-02', '2026-06-03', 'uploader');
select tests.put('s2v2', tests.candidate('ann', tests.id('s2'), tests.hx('f')));
select tests.eq((tests.src_row(tests.id('s2v2'))).access_level, 'leads_only', '6: the previous (stricter) access level is the default');
select tests.as_user('ann');
select tests.throws(tests.consent_sql('ann', tests.id('s2v2'), 'everyone'), 'BTVF0', '6: a new version cannot be visible to more people');
select tests.as_owner();
select tests.ok((tests.src_row(tests.id('s2'))).superseded_at is null and (tests.src_row(tests.id('s2v2'))).version_number is null
                and not exists (select 1 from public.source_version_changes where to_source_id = tests.id('s2v2')),
                'a refused activation changes nothing');
select tests.consent('ann', tests.id('s2v2'), 'reviewer_only');
select tests.eq((tests.src_row(tests.id('s2v2'))).access_level, 'reviewer_only', '6: a stricter level is allowed');
do $$
declare rules jsonb;
begin
  perform tests.eq((select count(*)::int from public.source_exclusions where source_id = tests.id('s2v2')), 2,
                   '14: the source-scoped participant and date-range exclusions are carried to the new version');
  select public.parse_exclusion_rules(tests.id('s2v2')) into rules;
  perform tests.eq((select count(*)::int from jsonb_array_elements(rules) r where r ->> 'kind' = 'participant'), 2,
                   '14: the parse of the new version drops bob (carried) and carol (handover-wide)');
  perform tests.eq((select count(*)::int from jsonb_array_elements(rules) r where r ->> 'kind' = 'date_range'), 1, '14: and the excluded dates');
  perform tests.eq((select (after ->> 'exclusionsCarried')::int from public.audit_logs where entity_id = tests.id('s2v2') and action = 'source.version_created'),
                   2, '14: audited');
end $$;
-- a conversation exclusion is positional: refused rather than risking that excluded content returns
insert into public.source_exclusions (handover_id, source_id, kind, conversation_local_id, parse_timezone, parser_version, requested_via)
values (tests.id('h'), tests.id('s2v2'), 'conversation', 'c_2', 'Asia/Kolkata', 'parser@1', 'uploader');
select tests.eq(tests.ver('ann', tests.id('s2v2'), tests.hx('9')) ->> 'outcome', 'exclusions_not_portable', '14: a conversation exclusion blocks a new version');
select tests.eq((select count(*)::int from public.sources where lineage_id = tests.id('s2')), 2, '14: nothing written');

-- ── 9. activation revalidates the replaced version ───────────────────────────
select tests.put('v4', tests.candidate('ann', tests.id('v3'), tests.hx('7')));
do $$
begin -- simulate a predecessor that stopped being current between upload and consent
  update public.sources set deleted_at = now(), state = 'removed' where id = tests.id('v3');
  perform tests.as_user('ann');
  perform tests.throws(tests.consent_sql('ann', tests.id('v4'), 'everyone'), 'BTCF0', '9: a stale predecessor at activation is a conflict');
  perform tests.as_owner();
  raise exception 'rollback' using errcode = 'TZRB0'; -- a private SQLSTATE: an assertion failure is NOT swallowed
exception when sqlstate 'TZRB0' then
  null; -- undo the simulation
end $$;
select tests.ok((tests.src_row(tests.id('v3'))).deleted_at is null, 'simulation undone');

-- ── 10. removal is never a version change ─────────────────────────────────────
select tests.as_user('ann');
select tests.throws(format('select public.remove_source(%L, %L)', tests.actor(), tests.id('v2')), 'BTIT0', '10: an earlier version cannot be removed on its own');
-- removing a pending update discards only it
select public.remove_source(tests.actor(), tests.id('v4'));
select tests.as_owner();
select tests.ok((tests.src_row(tests.id('v4'))).deleted_at is not null and (tests.src_row(tests.id('v3'))).deleted_at is null
                and (tests.src_row(tests.id('v3'))).superseded_at is null, '10: discarding a pending update keeps the current version');
-- removing the current version removes the source: every version, with the existing evidence exclusion
select tests.as_user('ann');
select public.remove_source(tests.actor(), tests.id('v3'));
select tests.as_owner();
select tests.eq((select count(*)::int from public.sources where lineage_id = tests.id('s1') and deleted_at is null), 0, '10: every version is removed');
select tests.ok((select bool_and(pe.excluded_at is not null and pe.exclusion_reason = 'source_removed') from public.point_evidence pe
                   join public.evidence_quotes q on q.id = pe.evidence_id where q.source_id = tests.id('s1')),
                '10: evidence of earlier versions is excluded like any removed source');
select tests.as_user('ann');
select tests.throws(tests.ver_sql('ann', tests.id('v3'), tests.hx('8')), 'BTNF0', '10: a removed source cannot receive a version');
select tests.throws(tests.ver_sql('ann', tests.id('s1'), tests.hx('8')), 'BTNF0', '10: nor can an earlier version of it');
select tests.as_owner();

-- ── 11. the 10-source cap counts current versions only ────────────────────────
select tests.handover('hc', 'ann', 'outgoing');
select tests.source('hc', 'c' || i) from generate_series(1, 9) i;
update public.sources set consent_ai_provider = 'fake' where handover_id = tests.id('hc');
select tests.put('c1v2', tests.candidate('ann', tests.id('c1'), tests.hx('a')));
create function tests.new_source_sql(p_h text, p_hex text) returns text language sql volatile as $$
  select format('select public.create_source(%L, %L, %L, %L, %L, %s, %L)::text', tests.id('ann'), tests.id(p_h), 'text', 'notes.txt', 'text/plain', 100, p_hex)
$$;
grant execute on function tests.new_source_sql(text, text) to service_role;
select tests.as_user('ann');
select tests.eq(left(tests.try(tests.new_source_sql('hc', tests.hx('1'))), 3), 'OK:', '11: a pending update takes no slot (10th source accepted)');
select tests.as_owner();
select tests.consent('ann', tests.id('c1v2'));
select tests.as_user('ann');
select tests.throws(tests.new_source_sql('hc', tests.hx('2')), 'BTPF0', '11: 10 current versions (11 rows): the cap applies');
select tests.as_owner();
select tests.eq((select count(*)::int from public.sources where handover_id = tests.id('hc') and deleted_at is null), 11,
                '11: the superseded version is kept but takes no slot');

-- ── 7. concurrency: exactly one update wins; activation and a new update serialise ─
select tests.handover('hk', 'ann', 'outgoing');
select tests.source('hk', 'k1');
update public.sources set consent_ai_provider = 'fake' where handover_id = tests.id('hk');
do $$
declare r1 text; r2 text;
begin
  perform tests.c_open('c1', 'ann'); perform tests.c_open('c2', 'ann');
  perform tests.c_exec('c1', 'begin');
  r1 := tests.c_try('c1', tests.ver_sql('ann', tests.id('k1'), tests.hx('a')));
  perform tests.ok(r1 like 'OK:%"created"%', '7: the first update runs: ' || r1);
  perform tests.c_send('c2', tests.ver_sql('ann', tests.id('k1'), tests.hx('b')));
  perform tests.ok(tests.c_blocked('c2'), '7: the second waits for the lineage lock');
  perform tests.c_exec('c1', 'commit');
  r2 := tests.c_result('c2');
  perform tests.ok(r2 like 'OK:%"update_in_progress"%', '7: the second is refused, nothing written: ' || r2);
  perform tests.c_close('c1'); perform tests.c_close('c2');
end $$;
select tests.eq((select count(*)::int from public.sources where lineage_id = tests.id('k1')), 2, '7: exactly one pending update');
select tests.put('k2', (select id from public.sources where supersedes_source_id = tests.id('k1')));
select tests.put_object(tests.id('k2'));
select tests.confirm('ann', tests.id('k2'), tests.hx('a'));
do $$
declare r1 text; r2 text;
begin
  perform tests.c_open('c1', 'ann'); perform tests.c_open('c2', 'ann');
  perform tests.c_exec('c1', 'begin');
  r1 := tests.c_try('c1', tests.consent_sql('ann', tests.id('k2'), 'everyone'));
  perform tests.ok(r1 like 'OK:%', '7: activation runs: ' || r1);
  perform tests.c_send('c2', tests.ver_sql('ann', tests.id('k1'), tests.hx('c')));
  perform tests.ok(tests.c_blocked('c2'), '7: a concurrent update of the same version waits');
  perform tests.c_exec('c1', 'commit');
  r2 := tests.c_result('c2');
  perform tests.ok(r2 like 'OK:%"stale"%', '7: and then finds its base stale: ' || r2);
  perform tests.c_close('c1'); perform tests.c_close('c2');
end $$;
select tests.eq((select count(*)::int from public.sources where lineage_id = tests.id('k1') and deleted_at is null), 2, '7: no extra row');
select tests.eq((select count(*)::int from public.source_version_changes where lineage_id = tests.id('k1')), 1, '7: one transition');

-- ── a purged handover takes its version chains with it ────────────────────────
do $$
begin
  perform set_config('baton.purge', 'on', true);
  delete from public.handovers where id = tests.id('hk');
  perform set_config('baton.purge', 'off', true);
  perform tests.eq((select count(*)::int from public.sources where handover_id = tests.id('hk')), 0, 'purge removes every version');
  perform tests.eq((select count(*)::int from public.source_version_changes where handover_id = tests.id('hk')), 0, 'and the transition records');
end $$;
