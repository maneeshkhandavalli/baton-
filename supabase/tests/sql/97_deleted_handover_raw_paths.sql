-- Round 3 (Agent 3, R3-D5): migration 20261113200200, list_deleted_handover_raw_paths, and that the
-- existing mark_source_raw_deleted records the deletion for sources of a soft-deleted handover.
\set ON_ERROR_STOP 1

select tests.user(u) from unnest(array['ann', 'bob', 'eve']) u;
select tests.handover('h', 'ann', 'outgoing');
select tests.member('h', 'bob', 'outgoing');
select tests.handover('other', 'ann', 'outgoing');

create temp table sha (name text primary key, hex text);
insert into sha select n, encode(sha256(convert_to('synthetic discard ' || n, 'UTF8')), 'hex')
  from unnest(array['p', 'u', 'r', 'm', 'o']) n;
grant all on sha to public;

select tests.as_user('ann');
select tests.put('p', public.create_source(tests.actor(), tests.id('h'), 'whatsapp_export', 'p.txt', 'text/plain', 10, (select hex from sha where name = 'p')));
select tests.put('u', public.create_source(tests.actor(), tests.id('h'), 'pdf', 'u.pdf', 'application/pdf', 10, (select hex from sha where name = 'u')));
select tests.put('r', public.create_source(tests.actor(), tests.id('h'), 'markdown', 'r.md', 'text/markdown', 10, (select hex from sha where name = 'r')));
select tests.put('m', public.create_source(tests.actor(), tests.id('h'), 'markdown', 'm.md', 'text/markdown', 10, (select hex from sha where name = 'm')));
select tests.put('o', public.create_source(tests.actor(), tests.id('other'), 'markdown', 'o.md', 'text/markdown', 10, (select hex from sha where name = 'o')));
select tests.as_owner();
insert into storage.objects (bucket_id, name, metadata)
select 'source-uploads', raw_storage_path, '{"size": "10"}'::jsonb from public.sources where id = tests.id('u');
select tests.as_user('ann');
select public.confirm_source_uploaded(tests.actor(), tests.id('u'), 10, (select hex from sha where name = 'u'));
select public.remove_source(tests.actor(), tests.id('r'));                 -- storage delete "failed": path kept
select public.remove_source(tests.actor(), tests.id('m'));
select tests.as_service();
select public.mark_source_raw_deleted(tests.id('m'));                      -- this one was deleted normally
select tests.as_owner();
select tests.source('h', 'parsed1');                                       -- parsed, raw already gone (no path)

-- ── grants ───────────────────────────────────────────────────────────────────
select tests.as_reader('ann');
select tests.throws(format('select public.list_deleted_handover_raw_paths(%L, %L)', tests.id('ann'), tests.id('h')),
                    '42501', 'authenticated cannot list raw paths');
select tests.as_anon();
select tests.throws(format('select public.list_deleted_handover_raw_paths(%L, %L)', tests.id('ann'), tests.id('h')),
                    '42501', 'anon cannot list raw paths');
select tests.as_owner();
select tests.ok(has_function_privilege('service_role', 'public.list_deleted_handover_raw_paths(uuid, uuid)', 'execute'), 'service_role may list');

-- ── a live handover is refused ──────────────────────────────────────────────
select tests.as_user('ann');
select tests.throws(format('select public.list_deleted_handover_raw_paths(%L, %L)', tests.id('ann'), tests.id('h')),
                    'BTPF0', 'a live draft''s uploads can never be listed for deletion');

-- ── after discard ───────────────────────────────────────────────────────────
select public.delete_handover(tests.actor(), tests.id('h'));
select tests.as_owner();
create temp table before_rows as select count(*) as n from public.sources where handover_id = tests.id('h');
grant all on before_rows to public;

select tests.as_user('ann');
create temp table listed as
  select x->>'sourceId' as source_id, x->>'rawStoragePath' as path, ord
    from jsonb_array_elements(public.list_deleted_handover_raw_paths(tests.actor(), tests.id('h'))) with ordinality as t(x, ord);
select tests.eq((select array_agg(source_id order by ord) from listed),
                array[tests.id('p')::text, tests.id('u')::text, tests.id('r')::text],
                'pending, uploaded and removed-with-path sources are listed in creation order');
select tests.ok((select bool_and(path = 'raw/' || tests.id('h') || '/' || source_id) from listed), 'paths are raw/{handover}/{source}');
select tests.ok(not exists (select 1 from listed where source_id in (tests.id('m')::text, tests.id('parsed1')::text)),
                'sources whose raw path is already null are not listed');
select tests.ok(not exists (select 1 from listed where source_id = tests.id('o')::text), 'another handover''s sources are never listed');

-- authorisation
select tests.as_user('bob');
select tests.throws(format('select public.list_deleted_handover_raw_paths(%L, %L)', tests.id('bob'), tests.id('h')),
                    'BTNF0', 'a member who neither created nor deleted the handover sees nothing');
select tests.as_user('eve');
select tests.throws(format('select public.list_deleted_handover_raw_paths(%L, %L)', tests.id('eve'), tests.id('h')),
                    'BTNF0', 'an outsider sees nothing');
select tests.throws(format('select public.list_deleted_handover_raw_paths(%L, %L)', tests.id('eve'), gen_random_uuid()),
                    'BTNF0', 'an unknown handover is not found');
select tests.as_user('ann');
select tests.throws(format('select public.list_deleted_handover_raw_paths(%L, %L)', tests.id('bob'), tests.id('h')),
                    'BTFB0', 'the actor must match the session');
select tests.as_service();
select tests.throws(format('select public.list_deleted_handover_raw_paths(null, %L)', tests.id('h')), 'BTUA0', 'an actor is required');

-- the actor recorded as the deleter may list too (e.g. after a creator transfer)
select tests.as_owner();
insert into public.audit_logs (handover_id, actor_profile_id, action, entity_type, entity_id)
values (tests.id('h'), tests.id('bob'), 'handover.deleted', 'handover', tests.id('h'));
select tests.as_user('bob');
select tests.eq(jsonb_array_length(public.list_deleted_handover_raw_paths(tests.actor(), tests.id('h'))), 3, 'the deleting actor may list');

-- ── recording the deletion with the existing marker ─────────────────────────
select tests.as_owner();
create temp table audit_before as select count(*) as n from public.audit_logs where action = 'source.raw_deleted';
grant all on audit_before to public;
select tests.as_service();
select public.mark_source_raw_deleted(tests.id('u'));
select public.mark_source_raw_deleted(tests.id('u'));                     -- idempotent retry
select tests.as_owner();
select tests.eq((select raw_storage_path from public.sources where id = tests.id('u')), null::text, 'mark_source_raw_deleted applies on a deleted handover');
select tests.ok((select raw_deleted_at is not null from public.sources where id = tests.id('u')), 'raw_deleted_at is set');
select tests.eq((select count(*) from public.audit_logs where action = 'source.raw_deleted') - (select n from audit_before), 1::bigint,
                'one audit row; the retry adds none');
select tests.as_user('ann');
select tests.eq(jsonb_array_length(public.list_deleted_handover_raw_paths(tests.actor(), tests.id('h'))), 2, 'a recorded path is no longer listed');

-- ── nothing is purged ───────────────────────────────────────────────────────
select tests.as_owner();
select tests.eq((select count(*) from public.sources where handover_id = tests.id('h')), (select n from before_rows), 'no source row is deleted');
select tests.ok((select deleted_at is not null from public.handovers where id = tests.id('h')), 'the handover stays soft-deleted (purge untouched)');
