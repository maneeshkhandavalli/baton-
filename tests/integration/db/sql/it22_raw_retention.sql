-- IT-22 (Round 3 Task 02, PRIV-2): raw-upload retention (migration 20261117200200_raw_retention.sql).
--   * service_role only; retention records are never readable by the browser;
--   * the 7-day boundary (configurable), the pending-upload grace, failed parses, failed post-parse deletes and
--     discarded drafts are eligible; active processing is protected;
--   * the inventory (dry run) changes nothing; a claim re-checks under locks, applies the row change and clears
--     the raw path; completion records 'deleted' or 'failed' (with backoff) idempotently;
--   * normalized content (messages) is never touched; nothing in the report names a path, file or person.
\set ON_ERROR_STOP 1

do $$
declare
  r text;
  f text;
begin
  foreach r in array array['anon', 'authenticated'] loop
    perform tests.ok(not has_table_privilege(r, 'public.raw_retention_items', 'SELECT'), r || ' cannot read retention items');
    perform tests.ok(not has_table_privilege(r, 'public.raw_retention_runs', 'SELECT'), r || ' cannot read retention runs');
    foreach f in array array['public.raw_retention_inventory(interval,interval,int)', 'public.claim_raw_for_retention(uuid,interval,interval)',
                             'public.due_raw_retention_items(int)', 'public.complete_raw_retention_item(uuid,text,text)',
                             'public.record_raw_retention_run(text,text,timestamptz,jsonb,jsonb)', 'public.raw_retention_report(interval,interval)'] loop
      perform tests.ok(not has_function_privilege(r, f, 'EXECUTE'), r || ' cannot execute ' || f);
    end loop;
  end loop;
  perform tests.ok(not has_table_privilege('service_role', 'public.raw_retention_items', 'SELECT'), 'service_role only through the functions');
end $$;

-- ── fixtures ────────────────────────────────────────────────────────────────────────────────────────────
select tests.user('ann');
select tests.handover('h', 'ann', 'outgoing');
select it.raw_source('h', 'u_old');                       -- uploaded 7 days + 1 hour ago → raw_ceiling
select it.raw_source('h', 'u_edge');                      -- uploaded 7 days - 1 hour ago → not yet
select it.raw_source('h', 'f_old', 'everyone', 'failed'); -- failed parse 8 days ago → raw_ceiling
select it.raw_source('h', 'pend', 'everyone', 'pending_upload', false); -- unfinished upload 25 h ago → pending_upload_expired
select it.raw_source('h', 'fresh_pend', 'everyone', 'pending_upload', false); -- 1 h ago → not yet
select tests.handover('hp', 'ann', 'outgoing');
select it.raw_source('hp', 'prot');                       -- 9 days old but in an active run → protected
select tests.source('h', 'parsed_src');                   -- parsed, with messages; its post-parse delete "failed"
select tests.user('bo');
select tests.handover('hd', 'bo', 'outgoing');
select it.raw_source('hd', 'disc');                       -- a discarded draft's upload (fresh) → handover_deleted

select tests.as_owner();
set session_replication_role = replica; -- keep the backdated timestamps (the touch trigger would reset updated_at)
update public.sources set created_at = now() - interval '7 days 1 hour' where id = tests.id('u_old');
update public.sources set created_at = now() - interval '6 days 23 hours' where id = tests.id('u_edge');
update public.sources set created_at = now() - interval '8 days', error_code = 'unsupported_format' where id = tests.id('f_old');
update public.sources set created_at = now() - interval '25 hours' where id = tests.id('pend');
update public.sources set created_at = now() - interval '1 hour' where id = tests.id('fresh_pend');
update public.sources set created_at = now() - interval '9 days' where id = tests.id('prot');
update public.sources set raw_storage_path = 'raw/' || handover_id || '/' || id, updated_at = now() - interval '25 hours'
 where id = tests.id('parsed_src');
update public.handovers set deleted_at = now() where id = tests.id('hd');
set session_replication_role = origin;
insert into storage.objects (bucket_id, name) select 'source-uploads', raw_storage_path from public.sources where raw_storage_path is not null;

select tests.as_user('ann');
select tests.put('run', public.start_processing(tests.actor(), tests.id('hp'), 'it-1', '{"provider":"fake"}',
  jsonb_build_array(jsonb_build_object('stage', 'parse', 'sourceId', tests.id('prot'), 'inputHash', md5('parse-prot')))));
-- (start_processing snapshots every includable source of ITS handover into the run, so the protected case
-- lives in its own handover 'hp'.)
select tests.as_owner();
create temp table before as select id, state, raw_storage_path, error_code, deleted_at from public.sources;
grant select on before to service_role;

-- ── inventory (the dry run) ─────────────────────────────────────────────────────────────────────────────
select tests.as_service();
select tests.throws($q$select public.raw_retention_inventory(interval '1 hour', interval '7 days', 10)$q$, 'BTVF0', 'grace below 2 hours');
select tests.throws($q$select public.raw_retention_inventory(interval '24 hours', interval '12 hours', 10)$q$, 'BTVF0', 'ceiling below 1 day');
do $$
declare
  inv jsonb := public.raw_retention_inventory(interval '24 hours', interval '7 days', 100);
  ids uuid[];
begin
  select array_agg((c ->> 'sourceId')::uuid) into ids from jsonb_array_elements(inv -> 'candidates') c;
  perform tests.ok(tests.id('u_old') = any (ids), '7 days + 1 h: eligible');
  perform tests.ok(not tests.id('u_edge') = any (ids), '7 days - 1 h: not eligible (boundary)');
  perform tests.ok(tests.id('f_old') = any (ids), 'failed parse older than the ceiling: eligible');
  perform tests.ok(tests.id('pend') = any (ids), 'unfinished upload past the grace: eligible');
  perform tests.ok(not tests.id('fresh_pend') = any (ids), 'fresh unfinished upload: not eligible');
  perform tests.ok(tests.id('parsed_src') = any (ids), 'failed post-parse delete past the grace: eligible');
  perform tests.ok(tests.id('disc') = any (ids), 'discarded draft: eligible at once');
  perform tests.ok((select (c ->> 'protected')::boolean from jsonb_array_elements(inv -> 'candidates') c where (c ->> 'sourceId')::uuid = tests.id('prot')), 'active run: protected');
  perform tests.eq((inv ->> 'eligible')::int, 5, 'five eligible, unprotected');
  perform tests.eq((inv ->> 'protected')::int, 1, 'one protected');
  perform tests.ok((select bool_and((c ->> 'rawObjectPresent')::boolean) from jsonb_array_elements(inv -> 'candidates') c), 'objects present');
  perform tests.ok(inv::text !~ 'raw/', 'the inventory names no path');
  -- a configurable ceiling: 10 days → only nothing of the uploaded/failed ones
  inv := public.raw_retention_inventory(interval '24 hours', interval '10 days', 100);
  perform tests.ok(not exists (select 1 from jsonb_array_elements(inv -> 'candidates') c where c ->> 'reason' = 'raw_ceiling'), '10-day ceiling: none of them yet');
end $$;
select tests.as_owner();
select tests.eq((select count(*)::int from public.sources s join before b using (id)
                  where (s.state, s.raw_storage_path, s.error_code, s.deleted_at) is distinct from (b.state, b.raw_storage_path, b.error_code, b.deleted_at)), 0,
                'the dry run changed nothing');
select tests.eq((select count(*)::int from public.raw_retention_items), 0, 'and claimed nothing');

-- ── claims ──────────────────────────────────────────────────────────────────────────────────────────────
select tests.as_service();
select tests.eq(public.claim_raw_for_retention(tests.id('prot')) ->> 'why', 'protected', 'an active run protects its source');
select tests.eq(public.claim_raw_for_retention(tests.id('u_edge')) ->> 'why', 'not_eligible', 'the boundary is re-checked at claim time');
select tests.eq(public.claim_raw_for_retention(tests.id('u_old')) ->> 'reason', 'raw_ceiling', 'claimed');
select tests.eq(public.claim_raw_for_retention(tests.id('u_old')) ->> 'why', 'not_eligible', 'a second claim is a no-op');
select public.claim_raw_for_retention(tests.id('f_old'));
select public.claim_raw_for_retention(tests.id('pend'));
select public.claim_raw_for_retention(tests.id('parsed_src'));
select public.claim_raw_for_retention(tests.id('disc'));
select tests.as_owner();
select tests.eq((select state || '/' || error_code || '/' || coalesce(raw_storage_path, '-') from public.sources where id = tests.id('u_old')),
                'failed/raw_expired/-', 'uploaded past the ceiling → failed raw_expired, path cleared (cannot be processed)');
select tests.eq((select state || '/' || (deleted_at is not null)::text from public.sources where id = tests.id('pend')), 'removed/true', 'unfinished upload → removed');
select tests.eq((select state from public.sources where id = tests.id('parsed_src')), 'parsed', 'a parsed source stays parsed');
select tests.eq((select count(*)::int from public.source_messages where source_id = tests.id('parsed_src')), 9, 'normalized messages are untouched');
select tests.eq((select count(*)::int from public.raw_retention_items where status = 'pending'), 5, 'five items pending deletion');
select tests.eq((select object_path from public.raw_retention_items where source_id = tests.id('u_old')), 'raw/' || tests.id('h') || '/' || tests.id('u_old'),
                'the item keeps the exact object path');

-- a source whose path is not its own is never claimed
select tests.as_owner();
select it.raw_source('h', 'odd');
update public.sources set created_at = now() - interval '9 days', raw_storage_path = 'raw/' || tests.id('hd') || '/' || id where id = tests.id('odd');
select tests.as_service();
select tests.eq(public.claim_raw_for_retention(tests.id('odd')) ->> 'why', 'path_refused', 'a foreign path is refused');

-- ── completion: failed with backoff, then deleted, idempotent ───────────────────────────────────────────
select tests.as_service();
select tests.throws(format('select public.complete_raw_retention_item(%L, %L, %L)', tests.id('u_old'), 'failed', 'boom'), 'BTVF0', 'error classes are fixed');
select tests.eq(public.complete_raw_retention_item(tests.id('u_old'), 'failed', 'storage_error'), 'failed', 'a failed delete is recorded');
select tests.ok(not exists (select 1 from jsonb_array_elements(public.due_raw_retention_items(100)) i where (i ->> 'sourceId')::uuid = tests.id('u_old')),
                'it waits for its backoff');
select tests.as_owner();
select tests.ok((select next_attempt_at > now() + interval '4 minutes' and attempts = 1 and last_error = 'storage_error'
                   from public.raw_retention_items where source_id = tests.id('u_old')), 'backoff and the error class are visible');
update public.raw_retention_items set next_attempt_at = now() - interval '1 second' where source_id = tests.id('u_old');
select tests.as_service();
select tests.ok(exists (select 1 from jsonb_array_elements(public.due_raw_retention_items(100)) i where (i ->> 'sourceId')::uuid = tests.id('u_old')),
                'due again after the backoff');
select tests.eq(public.complete_raw_retention_item(tests.id('u_old'), 'deleted'), 'deleted', 'the retry succeeds');
select tests.eq(public.complete_raw_retention_item(tests.id('u_old'), 'failed', 'storage_error'), 'deleted', 'a late failure cannot undo a deletion');
select tests.as_owner();
select tests.ok((select raw_deleted_at is not null from public.sources where id = tests.id('u_old')), 'raw_deleted_at recorded');
select tests.eq((select attempts from public.raw_retention_items where source_id = tests.id('u_old')), 2, 'two attempts');
select tests.eq((select count(*)::int from public.audit_logs where entity_id = tests.id('u_old') and action = 'source.raw_deleted'), 1, 'one audit row');

-- ── report and run records: counts only ─────────────────────────────────────────────────────────────────
select tests.as_service();
select public.record_raw_retention_run('live', 'manual', now(), '{"rawCeilingDays":7}', '{"deleted":1}');
do $$
declare
  rep jsonb := public.raw_retention_report(interval '24 hours', interval '7 days');
begin
  perform tests.eq((rep -> 'items' ->> 'pending')::int, 4, 'four still pending');
  perform tests.eq((rep -> 'items' ->> 'deleted')::int, 1, 'one deleted');
  perform tests.eq((rep -> 'policy' ->> 'rawCeilingDays')::numeric, 7::numeric, 'the policy is in the report');
  perform tests.eq(jsonb_array_length(rep -> 'lastRuns'), 1, 'the last run is listed');
  perform tests.ok(rep::text !~ 'raw/|\.txt|Raw ', 'no path, file name or title in the report');
end $$;
