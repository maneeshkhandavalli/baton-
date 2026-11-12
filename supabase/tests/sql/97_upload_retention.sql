-- Round 3 (Agent 3, D3): migration 20261113200100, list_orphan_upload_candidates (read-only orphan
-- detection), plus the upload lifecycle shapes that produce orphans. Synthetic data only.
\set ON_ERROR_STOP 1

select tests.user(u) from unnest(array['ann', 'bob', 'rev', 'eve']) u;
select tests.handover('h', 'ann', 'outgoing');
select tests.member('h', 'bob', 'outgoing');
select tests.member('h', 'rev', 'reviewer');
select tests.handover('gone', 'ann', 'outgoing');

create temp table sha (name text primary key, hex text);
insert into sha select n, encode(sha256(convert_to('synthetic file ' || n, 'UTF8')), 'hex')
  from unnest(array['a', 'b', 'c', 'd', 'e', 'f', 'g', 'z']) n;
grant all on sha to public;

-- Sources through the real create_source path (state pending_upload, raw path set at creation).
select tests.as_user('ann');
select tests.put('a', public.create_source(tests.actor(), tests.id('h'), 'whatsapp_export', 'a.txt', 'text/plain', 10, (select hex from sha where name = 'a')));
select tests.put('c', public.create_source(tests.actor(), tests.id('h'), 'pdf', 'c.pdf', 'application/pdf', 10, (select hex from sha where name = 'c')));
select tests.put('d', public.create_source(tests.actor(), tests.id('h'), 'markdown', 'd.md', 'text/markdown', 10, (select hex from sha where name = 'd')));
select tests.put('e', public.create_source(tests.actor(), tests.id('h'), 'markdown', 'e.md', 'text/markdown', 10, (select hex from sha where name = 'e')));
select tests.put('g', public.create_source(tests.actor(), tests.id('gone'), 'whatsapp_export', 'g.txt', 'text/plain', 10, (select hex from sha where name = 'g')));
select tests.as_user('bob');
select tests.put('b', public.create_source(tests.actor(), tests.id('h'), 'whatsapp_export', 'b.txt', 'text/plain', 10, (select hex from sha where name = 'b')));
select tests.as_owner();

-- ── grants: browser roles cannot reach the function ─────────────────────────
select tests.as_reader('ann');
select tests.throws('select public.list_orphan_upload_candidates()', '42501', 'authenticated cannot list orphan candidates');
select tests.as_anon();
select tests.throws('select public.list_orphan_upload_candidates()', '42501', 'anon cannot list orphan candidates');
select tests.as_owner();
select tests.ok(not has_function_privilege('authenticated', 'public.list_orphan_upload_candidates(interval, interval, int)', 'execute'), 'no execute for authenticated');
select tests.ok(has_function_privilege('service_role', 'public.list_orphan_upload_candidates(interval, interval, int)', 'execute'), 'service_role may list');

-- c and d are uploaded (confirmed)
select tests.as_owner();
insert into storage.objects (bucket_id, name, metadata)
select 'source-uploads', raw_storage_path, '{"size": "10"}'::jsonb from public.sources where id in (tests.id('c'), tests.id('d'));
select tests.as_user('ann');
select public.confirm_source_uploaded(tests.actor(), tests.id('c'), 10, (select hex from sha where name = 'c'));
select public.confirm_source_uploaded(tests.actor(), tests.id('d'), 10, (select hex from sha where name = 'd'));

-- the wizard's retry flow today: remove the unfinished row, then the same file can be created again
select public.remove_source(tests.actor(), tests.id('a'));
select tests.ok(public.create_source(tests.actor(), tests.id('h'), 'whatsapp_export', 'a.txt', 'text/plain', 10, (select hex from sha where name = 'a')) is not null,
                'after removing the unfinished row the same file can be uploaded again');
select tests.as_owner();

-- ── list_orphan_upload_candidates ───────────────────────────────────────────
-- Discard the second draft (the hosted D3 shape: pending_upload row, no object, soft-deleted handover).
select tests.as_user('ann');
select public.delete_handover(tests.actor(), tests.id('gone'));
-- e: removed while its storage delete "failed" (raw path still set).
select public.remove_source(tests.actor(), tests.id('e'));
select tests.as_owner();

-- Age rows without firing the updated_at trigger.
set session_replication_role = replica;
update public.sources set created_at = now() - interval '3 days' where id = tests.id('b');                -- pending, expired
update public.sources set created_at = now() - interval '8 days' where id = tests.id('c');                -- uploaded, past ceiling
update public.sources set created_at = now() - interval '2 days' where id = tests.id('d');                -- uploaded, within ceiling
set session_replication_role = origin;

-- f: parsed source whose post-commit raw delete failed (helper inserts parsed rows without a path).
select tests.source('h', 'f');
set session_replication_role = replica;
update public.sources set raw_storage_path = 'raw/' || handover_id || '/' || id, updated_at = now() - interval '2 days'
 where id = tests.id('f');
set session_replication_role = origin;

create temp table audit_before as select count(*) as n from public.audit_logs;
create temp table sources_before as select id, state, raw_storage_path, deleted_at, updated_at from public.sources;
grant all on audit_before, sources_before to public;

select tests.as_service();
create temp table cand as
  select x->>'sourceId' as source_id, x->>'reason' as reason, (x->>'rawObjectPresent')::boolean as present, x->>'state' as state
    from jsonb_array_elements(public.list_orphan_upload_candidates()) x;
select tests.as_owner();

select tests.eq((select reason from cand where source_id = tests.id('g')::text), 'handover_deleted',
                'a pending row on a discarded draft is reported (the hosted D3 case)');
select tests.eq((select present from cand where source_id = tests.id('g')::text), false, 'and no object ever arrived');
select tests.eq((select reason from cand where source_id = tests.id('b')::text), 'pending_upload_expired',
                'a pending upload older than the grace period is reported');
select tests.eq((select reason from cand where source_id = tests.id('c')::text), 'raw_ceiling', 'an uploaded raw past the 7-day ceiling is reported');
select tests.eq((select present from cand where source_id = tests.id('c')::text), true, 'and its object is present');
select tests.eq((select reason from cand where source_id = tests.id('e')::text), 'removed_raw_pending', 'a removed source with a raw path is reported');
select tests.eq((select reason from cand where source_id = tests.id('f')::text), 'parsed_raw_pending', 'a parsed source with a raw path is reported');
select tests.ok(not exists (select 1 from cand where source_id = tests.id('d')::text), 'an uploaded source within the ceiling is not reported');
select tests.eq((select reason from cand where source_id = tests.id('a')::text), 'removed_raw_pending',
                'a removed unfinished row is reported until its (empty) raw path is marked deleted');
select tests.eq((select count(*)::int from cand group by source_id order by 1 desc limit 1), 1, 'each source is reported once');

-- a freshly created pending upload is never reported (the signed URL may still be in use)
select tests.ok(not exists (select 1 from cand c join public.sources s on s.id::text = c.source_id
                             where s.state = 'pending_upload' and s.created_at > now() - interval '1 hour'
                               and c.reason <> 'handover_deleted'),
                'fresh pending uploads on live drafts are not candidates');

-- read-only: nothing changed, nothing audited
select tests.eq((select count(*) from public.audit_logs), (select n from audit_before), 'listing writes no audit rows');
select tests.ok(not exists (
  select 1 from public.sources s join sources_before b using (id)
   where (s.state, s.raw_storage_path, s.deleted_at, s.updated_at) is distinct from (b.state, b.raw_storage_path, b.deleted_at, b.updated_at)),
  'listing changes no source row');

-- parameters
select tests.as_service();
select tests.throws($$select public.list_orphan_upload_candidates(interval '1 hour')$$, 'BTVF0', 'grace below the signed-URL lifetime is refused');
select tests.throws($$select public.list_orphan_upload_candidates(interval '1 day', interval '1 hour')$$, 'BTVF0', 'raw ceiling below a day is refused');
select tests.throws($$select public.list_orphan_upload_candidates(interval '1 day', interval '7 days', 0)$$, 'BTVF0', 'limit must be positive');
select tests.eq(jsonb_array_length(public.list_orphan_upload_candidates(interval '1 day', interval '7 days', 2)), 2, 'the limit caps the rows');
select tests.eq((select x->>'reason' from jsonb_array_elements(public.list_orphan_upload_candidates(interval '4 days')) x
                  where x->>'sourceId' = tests.id('b')::text), null::text, 'a longer grace no longer reports the 3-day-old pending row');
select tests.as_owner();
