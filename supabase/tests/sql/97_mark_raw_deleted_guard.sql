-- Round 3 (Agent 3): QA-L1 — migration 20261113200300. mark_source_raw_deleted records a raw delete only for
-- parsed or removed sources, or sources of a soft-deleted handover; it refuses one whose raw upload is still needed.
\set ON_ERROR_STOP 1

select tests.user(u) from unnest(array['ann']) u;
select tests.handover('h', 'ann', 'outgoing');
select tests.handover('gone', 'ann', 'outgoing');

create temp table sha (name text primary key, hex text);
insert into sha select n, encode(sha256(convert_to('synthetic guard ' || n, 'UTF8')), 'hex')
  from unnest(array['pend', 'up', 'fail', 'parsing', 'rem', 'gpend', 'gup']) n;
grant all on sha to public;

create function pg_temp.mk(p_handover text, p_name text) returns uuid language plpgsql as $$
begin
  perform tests.as_user('ann');
  perform tests.put(p_name, public.create_source(tests.actor(), tests.id(p_handover), 'markdown', p_name || '.md', 'text/markdown', 10,
                                                 (select hex from sha where name = p_name)));
  perform tests.as_owner();
  return tests.id(p_name);
end $$;
create function pg_temp.upload(p_name text) returns void language plpgsql as $$
begin
  insert into storage.objects (bucket_id, name, metadata)
  select 'source-uploads', raw_storage_path, '{"size": "10"}'::jsonb from public.sources where id = tests.id(p_name);
  perform tests.as_user('ann');
  perform public.confirm_source_uploaded(tests.actor(), tests.id(p_name), 10, (select hex from sha where name = p_name));
  perform tests.as_owner();
end $$;

select pg_temp.mk('h', n) from unnest(array['pend', 'up', 'fail', 'parsing', 'rem']) n;
select pg_temp.mk('gone', n) from unnest(array['gpend', 'gup']) n;
select pg_temp.upload(n) from unnest(array['up', 'fail', 'parsing', 'gup']) n;
select tests.as_service();
select public.mark_source_parse_failed(tests.id('fail'), 'parse_failed');
select tests.as_owner();
set session_replication_role = replica;
update public.sources set state = 'parsing' where id = tests.id('parsing');
set session_replication_role = origin;
select tests.source('h', 'parsed');                                     -- parsed; give it a raw path that was never deleted
set session_replication_role = replica;
update public.sources set raw_storage_path = 'raw/' || handover_id || '/' || id where id = tests.id('parsed');
set session_replication_role = origin;
select tests.as_user('ann');
select public.remove_source(tests.actor(), tests.id('rem'));           -- removed, raw path still set
select public.delete_handover(tests.actor(), tests.id('gone'));
select tests.as_owner();

-- grants unchanged by the replace
select tests.ok(has_function_privilege('service_role', 'public.mark_source_raw_deleted(uuid)', 'execute'), 'service_role keeps execute');
select tests.ok(not has_function_privilege('authenticated', 'public.mark_source_raw_deleted(uuid)', 'execute'), 'authenticated still has none');
select tests.as_reader('ann');
select tests.throws(format('select public.mark_source_raw_deleted(%L)', tests.id('parsed')), '42501', 'browser roles cannot call it');

-- ── refused: the raw upload is still needed ──────────────────────────────────
select tests.as_owner();
create temp table audit_before as select count(*) as n from public.audit_logs where action = 'source.raw_deleted';
grant all on audit_before to public;
select tests.as_service();
select tests.throws(format('select public.mark_source_raw_deleted(%L)', tests.id(n)), 'BTIT0', n || ' on a live draft is refused (QA-L1)')
  from unnest(array['pend', 'up', 'fail', 'parsing']) n;
select tests.throws(format('select public.mark_source_raw_deleted(%L)', gen_random_uuid()), 'BTNF0', 'unknown source');
select tests.as_owner();
select tests.ok((select bool_and(raw_storage_path is not null and raw_deleted_at is null) from public.sources
                  where id in (tests.id('pend'), tests.id('up'), tests.id('fail'), tests.id('parsing'))), 'refusals change nothing');
select tests.eq((select count(*) from public.audit_logs where action = 'source.raw_deleted'), (select n from audit_before),
                'refusals write no audit rows');

-- ── allowed ─────────────────────────────────────────────────────────────────
select tests.as_service();
select public.mark_source_raw_deleted(tests.id(n)) from unnest(array['parsed', 'rem', 'gpend', 'gup']) n;
select tests.as_owner();
select tests.ok((select bool_and(raw_storage_path is null and raw_deleted_at is not null) from public.sources
                  where id in (tests.id('parsed'), tests.id('rem'), tests.id('gpend'), tests.id('gup'))),
                'parsed, removed and discarded-draft sources (pending and uploaded) are recorded');
select tests.eq((select count(*) from public.audit_logs where action = 'source.raw_deleted') - (select n from audit_before), 4::bigint,
                'one audit row each');

-- ── idempotent: an already-recorded delete is a no-op in any state ──────────
select tests.as_service();
select public.mark_source_raw_deleted(tests.id('parsed'));
select tests.as_owner();
set session_replication_role = replica;
update public.sources set raw_storage_path = null, raw_deleted_at = now() where id = tests.id('fail');
set session_replication_role = origin;
select tests.as_service();
select public.mark_source_raw_deleted(tests.id('fail'));               -- failed, but nothing left to record
select tests.as_owner();
select tests.eq((select count(*) from public.audit_logs where action = 'source.raw_deleted') - (select n from audit_before), 4::bigint,
                'no-op retries add no audit rows');
