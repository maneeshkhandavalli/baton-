-- R3 backend (Agent 2), C5: interrupted-upload retry in create_source (migration 20261113100300).
-- Synthetic data only.
\set ON_ERROR_STOP 1

select tests.user(u) from unnest(array['ann', 'out2', 'rev', 'eve']) u;
select tests.handover('h', 'ann', 'outgoing');
select tests.member('h', 'out2', 'outgoing');
select tests.member('h', 'rev', 'reviewer');

-- create_source as the server acting for p_user; checksum = p_char repeated 64 times.
create function tests.src_sql(p_user text, p_handover text, p_char text, p_file text default 'chat.txt', p_size int default 100)
returns text language sql volatile as $$
  select format('select public.create_source(%L, %L, %L, %L, %L, %s, %L)::text', tests.id(p_user), tests.id(p_handover),
                'text', p_file, 'text/plain', p_size, repeat(p_char, 64))
$$;
create function tests.src(p_user text, p_handover text, p_char text, p_file text default 'chat.txt', p_size int default 100)
returns uuid language plpgsql volatile as $$
declare v text;
begin
  execute tests.src_sql(p_user, p_handover, p_char, p_file, p_size) into v;
  return v::uuid;
end $$;
create function tests.put_object(p_source uuid, p_size int) returns void language sql as $$
  insert into storage.objects (bucket_id, name, metadata)
  select 'source-uploads', raw_storage_path, jsonb_build_object('size', p_size) from public.sources where id = p_source
$$;
grant execute on all functions in schema tests to anon, authenticated, service_role;

select tests.ok(has_function_privilege('service_role', 'public.create_source(uuid,uuid,text,text,text,bigint,text,text)', 'EXECUTE')
                and not has_function_privilege('authenticated', 'public.create_source(uuid,uuid,text,text,text,bigint,text,text)', 'EXECUTE')
                and not has_function_privilege('anon', 'public.create_source(uuid,uuid,text,text,text,bigint,text,text)', 'EXECUTE'),
                'create_source keeps its server-only grant after CREATE OR REPLACE');

-- ── REUSE: the upload never arrived ─────────────────────────────────────────
select tests.as_user('ann');
select tests.put('s1', tests.src('ann', 'h', 'a', 'chat.txt', 100));
select tests.put('s1b', tests.src('ann', 'h', 'a', 'chat (1).txt', 100));
select tests.as_owner();
select tests.eq(tests.id('s1b'), tests.id('s1'), 'a retry of an unfinished upload reuses the same source');
select tests.eq((select count(*)::int from public.sources where handover_id = tests.id('h') and deleted_at is null), 1,
                'no second row and no extra source slot');
select tests.ok((select state = 'pending_upload' and original_filename = 'chat (1).txt'
                        and raw_storage_path = 'raw/' || tests.id('h') || '/' || tests.id('s1')
                   from public.sources where id = tests.id('s1')), 'the reused row keeps its path and takes the new metadata');
select tests.eq((select count(*)::int from public.audit_logs where entity_id = tests.id('s1') and action = 'source.upload_restarted'), 1,
                'the restart is audited');

-- the user may upload to the reused path (bucket INSERT policy)
select tests.as_reader('ann');
select tests.ok(public.can_upload_source_object('source-uploads', 'raw/' || tests.id('h') || '/' || tests.id('s1')),
                'the fresh ticket for the reused path is usable');
select tests.as_owner();

-- ── REPLACE: the upload arrived but was never confirmed ─────────────────────
select tests.put_object(tests.id('s1'), 100);
select tests.as_user('ann');
select tests.put('s2', tests.src('ann', 'h', 'a', 'chat.txt', 100));
select tests.as_owner();
select tests.ok(tests.id('s2') <> tests.id('s1'), 'an occupied path gets a new source row');
select tests.ok((select deleted_at is not null and state = 'removed'
                        and raw_storage_path = 'raw/' || tests.id('h') || '/' || tests.id('s1')
                   from public.sources where id = tests.id('s1')),
                'the old row is removed and keeps its raw path for the retention sweep');
select tests.eq((select raw_storage_path from public.sources where id = tests.id('s2')), 'raw/' || tests.id('h') || '/' || tests.id('s2'),
                'the new row has its own path');
select tests.eq((select after ->> 'replaces' from public.audit_logs where entity_id = tests.id('s2') and action = 'source.created'),
                tests.id('s1')::text, 'the creation records which row it replaced');
select tests.eq((select after ->> 'reason' from public.audit_logs where entity_id = tests.id('s1') and action = 'source.removed'),
                'upload_retried', 'the removal records why');
select tests.as_reader('ann');
select tests.ok(not public.can_upload_source_object('source-uploads', 'raw/' || tests.id('h') || '/' || tests.id('s1')),
                'the replaced path can no longer be uploaded to');
select tests.ok(public.can_upload_source_object('source-uploads', 'raw/' || tests.id('h') || '/' || tests.id('s2')),
                'the new path can');
select tests.as_owner();

-- ── a confirmed upload is still a duplicate ─────────────────────────────────
select tests.put_object(tests.id('s2'), 100);
select tests.as_user('ann');
select public.confirm_source_uploaded(tests.actor(), tests.id('s2'), 100, repeat('a', 64));
select tests.throws(tests.src_sql('ann', 'h', 'a'), 'BTCF0', 'a live uploaded duplicate is still conflict');
select tests.as_owner();
update public.sources set state = 'parsed' where id = tests.id('s2');
select tests.as_user('ann');
select tests.throws(tests.src_sql('ann', 'h', 'a'), 'BTCF0', 'a live parsed duplicate is still conflict');
select tests.as_owner();
update public.sources set state = 'failed' where id = tests.id('s2');
select tests.as_user('ann');
select tests.throws(tests.src_sql('ann', 'h', 'a'), 'BTCF0', 'a live failed duplicate is still conflict');
select tests.as_owner();

-- ── someone else's unfinished upload is never taken over ────────────────────
select tests.as_user('out2');
select tests.put('p1', tests.src('out2', 'h', 'b'));
select tests.as_user('ann');
select tests.throws(tests.src_sql('ann', 'h', 'b'), 'BTCF0', 'another member''s pending upload of the same file is conflict');
select tests.as_user('out2');
select tests.eq(tests.src('out2', 'h', 'b'), tests.id('p1'), 'its own uploader can still retry it');
select tests.as_owner();

-- ── access rules are unchanged ──────────────────────────────────────────────
select tests.as_user('eve');
select tests.throws(tests.src_sql('eve', 'h', 'b'), 'BTNF0', 'a non-member gets not_found');
select tests.as_user('rev');
select tests.throws(tests.src_sql('rev', 'h', 'b'), 'BTFB0', 'a reviewer who is not the creator is forbidden');
select tests.as_user('ann');
select tests.throws(format('select public.create_source(%L, %L, %L, %L, %L, 10, %L)', tests.actor(), tests.id('h'), 'text', 'x.txt',
                           'text/plain', 'NOT-A-HASH'), 'BTVF0', 'a malformed checksum is validation_failed');
select tests.as_owner();
select tests.handover('q', 'ann', 'outgoing');
select tests.as_user('ann');
select tests.put('q1', tests.src('ann', 'q', 'c'));
select tests.as_owner();
select tests.set_state('q', 'processing');
select tests.as_user('ann');
select tests.throws(tests.src_sql('ann', 'q', 'c'), 'BTIT0', 'no retry while processing');
select tests.as_owner();

-- ── the 10-source limit ─────────────────────────────────────────────────────
select tests.handover('L', 'ann', 'outgoing');
select tests.source('L', 'l' || g) from generate_series(1, 9) g;
select tests.as_user('ann');
select tests.put('l10', tests.src('ann', 'L', 'd'));
select tests.eq(tests.src('ann', 'L', 'd'), tests.id('l10'), 'a reuse at the limit succeeds (no new slot)');
select tests.as_owner();
select tests.put_object(tests.id('l10'), 100);
select tests.as_user('ann');
select tests.ok(tests.src('ann', 'L', 'd') <> tests.id('l10'), 'a replacement at the limit succeeds (the old row frees its slot)');
select tests.throws(tests.src_sql('ann', 'L', 'e'), 'BTPF0', 'a new file at the limit is still precondition_failed');
select tests.as_owner();

-- ── concurrent double submit: one row ───────────────────────────────────────
do $$
declare
  r1 text;
  r2 text;
begin
  perform tests.c_open('c1', 'ann'); perform tests.c_open('c2', 'ann');
  perform tests.c_exec('c1', 'begin');
  r1 := tests.c_try('c1', tests.src_sql('ann', 'h', 'f'));
  perform tests.c_send('c2', tests.src_sql('ann', 'h', 'f'));
  perform tests.ok(tests.c_blocked('c2'), 'the second submission waits for the first');
  perform tests.c_exec('c1', 'commit');
  r2 := tests.c_result('c2');
  perform tests.c_close('c1'); perform tests.c_close('c2');
  perform tests.ok(r1 like 'OK:%', 'the first submission creates the source: ' || r1);
  perform tests.eq(r2, r1, 'the concurrent second submission reuses it');
  perform tests.eq((select count(*)::int from public.sources where handover_id = tests.id('h') and sha256 = decode(repeat('f', 64), 'hex')), 1,
                   'exactly one row');
end $$;
