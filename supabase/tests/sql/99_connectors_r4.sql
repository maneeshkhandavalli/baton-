-- Round 4: connectors (migrations 20261119800100 chat_import kind, 20261119800200 connectors). Synthetic data only.
-- Mirrors lib/connectors/__tests__/core.test.ts (MemoryConnectorStore) for the database implementation.
\set ON_ERROR_STOP 1

select tests.user(u) from unnest(array['ann', 'rev', 'mal']) u;
select tests.handover('h', 'ann', 'outgoing');
select tests.member('h', 'rev', 'reviewer');
select tests.handover('hm', 'mal', 'outgoing');

-- Owner-side probes (service_role has no table grants; content is reachable only through the functions).
create function tests.buf_count(p_link uuid default null) returns int language sql security definer as
  $$ select count(*)::int from public.connector_buffered_messages where p_link is null or link_id = p_link $$;
create function tests.buf_body(p_msg text) returns text language sql security definer as
  $$ select body from public.connector_buffered_messages where provider_message_id = p_msg $$;
grant execute on function tests.buf_count(uuid), tests.buf_body(text) to service_role;

-- ── 0. browser roles have no access at all ───────────────────────────────────
do $$
begin
  perform tests.as_reader('ann'); -- the browser session
  perform tests.throws('select * from public.connector_installations', '42501', 'authenticated cannot read installations');
  perform tests.throws('select * from public.connector_buffered_messages', '42501', 'authenticated cannot read buffered messages');
  perform tests.throws($q$select public.connector_record_event('slack', 'x', 'T1', 'message')$q$, '42501', 'authenticated cannot call connector functions');
  perform tests.as_anon();
  perform tests.throws($q$select public.connector_flush_actor(gen_random_uuid())$q$, '42501', 'anon cannot call connector functions');
  perform tests.as_service();
  perform tests.throws('select * from public.connector_buffered_messages', '42501', 'even service_role reads content only through the functions');
  perform tests.as_owner();
end $$;

-- ── 1. installations and links: creator + installer, no takeover ─────────────
do $$
declare
  v jsonb;
  v_inst uuid;
  v_link uuid;
begin
  perform tests.as_service();
  perform tests.throws(format($q$select public.connector_upsert_installation('provider', null, 'slack', 'T1', 'X', '{}', null)$q$),
                       'BTFB0', 'only a person installs');
  v := public.connector_upsert_installation('user', tests.id('ann'), 'slack', 'T1', 'CodeCell', array['channels:history'], 'c1.iv.tag.ct');
  v_inst := (v ->> 'id')::uuid;
  perform tests.put('inst', v_inst);
  perform tests.eq(v ->> 'has_credentials', 'true', 'credentials stored as an envelope');
  perform tests.ok(not (v ? 'credentials'), 'the installation json never contains credentials');
  perform tests.throws(format($q$select public.connector_upsert_installation('user', %L, 'slack', 'T1', 'X', '{}', null)$q$, tests.id('mal')),
                       'BTCF0', 'another Baton user cannot take over a live installation');
  perform tests.eq((public.connector_upsert_installation('user', tests.id('ann'), 'slack', 'T1', 'CodeCell 2', '{}', null)) ->> 'account_label',
                   'CodeCell 2', 'the installer can reconnect (update)');
  perform tests.eq(public.connector_installation_credentials(v_inst), 'c1.iv.tag.ct', 'a reconnect without credentials keeps the envelope');

  perform tests.throws(format($q$select public.connector_link_channel('user', %L, %L, %L, 'C1', '#core', '{}')$q$, tests.id('rev'), v_inst, tests.id('h')),
                       'BTFB0', 'a reviewer (not the creator) cannot link');
  perform tests.throws(format($q$select public.connector_link_channel('user', %L, %L, %L, 'C1', '#core', '{}')$q$, tests.id('mal'), v_inst, tests.id('hm')),
                       'BTFB0', 'a creator who did not install the account cannot link its channels');
  v := public.connector_link_channel('user', tests.id('ann'), v_inst, tests.id('h'), 'C1', '#core', '{}');
  v_link := (v ->> 'id')::uuid;
  perform tests.put('link', v_link);
  perform tests.eq(v ->> 'state', 'pending_consent', 'a new link waits for consent');
  perform tests.eq((public.connector_link_channel('user', tests.id('ann'), v_inst, tests.id('h'), 'C1', '#core', '{}')) ->> 'id',
                   v_link::text, 'linking twice is idempotent');
  perform tests.as_owner();
end $$;

-- ── 2. consent gate, buffer, edits ───────────────────────────────────────────
do $$
declare
  v jsonb;
  v_link uuid := tests.id('link');
begin
  perform tests.as_service();
  v := public.connector_buffer_messages(v_link, '[{"provider_message_id":"1","sent_at":"2026-11-19T09:00:00Z","author_label":"Asha","kind":"text","text":"hi"}]');
  perform tests.eq(v ->> 'refused', 'true', 'nothing is buffered before consent');
  perform tests.eq(tests.buf_count(), 0, 'no rows before consent');
  perform tests.eq(jsonb_array_length(public.connector_capturing_links('slack', 'T1', 'C1')), 0, 'not capturing before consent');

  perform tests.throws(format($q$select public.connector_set_link_state('user', %L, %L, 'capturing')$q$, tests.id('ann'), v_link),
                       'BTIT0', 'resume without consent is refused');
  perform tests.throws(format($q$select public.connector_record_capture_consent('user', %L, %L, 'connector-capture-v1')$q$, tests.id('rev'), v_link),
                       'BTFB0', 'only the creator consents');
  v := public.connector_record_capture_consent('user', tests.id('ann'), v_link, 'connector-capture-v1');
  perform tests.eq(v ->> 'state', 'capturing', 'consent starts capture');
  perform tests.eq(jsonb_array_length(public.connector_capturing_links('slack', 'T1', 'C1')), 1, 'routing finds the capturing link');
  perform tests.eq(jsonb_array_length(public.connector_capturing_links('slack', 'T1', 'C-other')), 0, 'other channels are not routed');

  v := public.connector_buffer_messages(v_link, '[{"provider_message_id":"1","sent_at":"2026-11-19T09:00:00Z","author_label":"Asha","kind":"text","text":"hi"},
                                                  {"provider_message_id":"2","sent_at":"2026-11-19T09:01:00Z","author_label":"Ravi","kind":"text","text":"yo"}]');
  perform tests.eq(v ->> 'inserted', '2', 'two messages buffered');
  v := public.connector_buffer_messages(v_link, '[{"provider_message_id":"1","sent_at":"2026-11-19T09:00:00Z","author_label":"Asha","kind":"text","text":"edited","edited_at":"2026-11-19T09:05:00Z"}]');
  perform tests.eq(v ->> 'updated', '1', 'an edit replaces the buffered message');
  perform tests.eq(tests.buf_body('1'), 'edited', 'edited body kept');

  perform tests.throws(format($q$select public.connector_set_link_state('provider', null, %L, 'capturing')$q$, v_link), 'BTFB0', 'a provider cannot resume capture');
  perform tests.eq((public.connector_set_link_state('provider', null, v_link, 'paused')) ->> 'state', 'paused', 'a provider can pause');
  v := public.connector_buffer_messages(v_link, '[{"provider_message_id":"3","sent_at":"2026-11-19T09:02:00Z","author_label":"Asha","kind":"text","text":"x"}]');
  perform tests.eq(v ->> 'refused', 'true', 'a paused link stores nothing new');
  perform tests.eq((public.connector_set_link_state('user', tests.id('ann'), v_link, 'capturing')) ->> 'state', 'capturing', 'the creator resumes');
  perform tests.as_owner();
end $$;

-- ── 3. event ledger: de-duplication and retry ────────────────────────────────
do $$
declare
  v jsonb;
  v_id uuid;
begin
  perform tests.as_service();
  v := public.connector_record_event('slack', 'Ev1', 'T1', 'message');
  v_id := (v ->> 'event_id')::uuid;
  perform tests.eq(v ->> 'process', 'true', 'first delivery is processed');
  perform tests.eq((public.connector_record_event('slack', 'Ev1', 'T1', 'message')) ->> 'process', 'false', 'a concurrent duplicate is not');
  perform public.connector_finish_event(v_id, 'processed', null);
  perform tests.eq((public.connector_record_event('slack', 'Ev1', 'T1', 'message')) ->> 'process', 'false', 'a processed delivery is not processed again');
  perform tests.eq((public.connector_record_event('discord', 'Ev1', 'G1', 'pull')) ->> 'process', 'true', 'delivery ids are per provider');

  v := public.connector_record_event('slack', 'Ev2', 'T1', 'message');
  perform public.connector_finish_event((v ->> 'event_id')::uuid, 'failed', 'internal');
  v := public.connector_record_event('slack', 'Ev2', 'T1', 'message');
  perform tests.eq(v ->> 'process', 'true', 'a failed delivery is processed on retry');
  perform tests.eq(v ->> 'attempts', '2', 'attempts counted');

  perform tests.as_owner();
  update public.connector_events set received_at = clock_timestamp() - interval '10 minutes' where delivery_id = 'Ev2';
  perform tests.as_service();
  perform tests.eq((public.connector_record_event('slack', 'Ev2', 'T1', 'message')) ->> 'process', 'true', 'a delivery stuck in received is reclaimed');
  perform tests.throws($q$select public.connector_finish_event(gen_random_uuid(), 'bogus', null)$q$, 'BTVF0', 'unknown status refused');
  perform tests.as_owner();
end $$;

-- ── 4. flush: batch, actor, source check ─────────────────────────────────────
do $$
declare
  v jsonb;
  v_link uuid := tests.id('link');
  v_src uuid;
  v_wa uuid;
  v_ids uuid[];
begin
  perform tests.as_service();
  perform tests.eq(public.connector_flush_actor(v_link), tests.id('ann'), 'the flush acts as the consenting creator');
  perform tests.eq(public.connector_links_due_for_flush(10) -> 0 ->> 0, v_link::text, 'the link is due');
  v := public.connector_take_flush_batch(v_link, 5000);
  perform tests.eq(jsonb_array_length(v -> 'messages'), 2, 'batch holds the buffered messages');
  perform tests.eq(v -> 'messages' -> 0 ->> 'provider_message_id', '1', 'oldest first');
  perform tests.eq(v ->> 'actor_profile_id', tests.id('ann')::text, 'batch names the actor');
  select array_agg((m ->> 'buffer_id')::uuid) into v_ids from jsonb_array_elements(v -> 'messages') m;
  perform tests.as_owner();

  v_wa := tests.source('h', 'wa');
  insert into public.sources (handover_id, uploaded_by, kind, title, original_filename, mime_type, size_bytes, sha256, state, access_level, timezone)
  values (tests.id('h'), tests.id('ann'), 'chat_import', 'Slack - #core', 'Slack - #core.jsonl', 'application/x-ndjson', 100,
          sha256(convert_to('chat-import-1', 'UTF8')), 'uploaded', 'everyone', 'Asia/Kolkata')
  returning id into v_src;

  perform tests.as_service();
  perform tests.throws(format($q$select public.connector_complete_flush(%L, %L, %L)$q$, v_link, v_ids, v_wa), 'BTNF0',
                       'a flush can only complete into a chat_import source of the same handover');
  perform public.connector_complete_flush(v_link, v_ids, v_src);
  perform tests.eq(tests.buf_count(v_link), 0, 'flushed rows deleted');
  perform tests.eq((public.connector_get_link(v_link)) ->> 'source_id', v_src::text, 'the link remembers its source');
  perform tests.eq(jsonb_array_length(public.connector_links_due_for_flush(10)), 0, 'nothing due after the flush');
  perform public.connector_record_flush_error(v_link, 'handover_not_accepting_updates');
  perform tests.eq((public.connector_get_link(v_link)) ->> 'last_flush_error', 'handover_not_accepting_updates', 'flush errors are shown');
  perform public.connector_set_pull_cursor(v_link, '1234567890');
  perform tests.eq((public.connector_get_link(v_link)) ->> 'pull_cursor', '1234567890', 'pull cursor stored');
  perform tests.eq(jsonb_array_length(public.connector_creator_handovers(tests.id('ann'))), 1, 'creator handovers for /connect');
  perform tests.eq(jsonb_array_length(public.connector_creator_handovers(tests.id('rev'))), 0, 'members who are not creators see none');
  perform tests.throws(format($q$select public.connector_list_links_for_handover('user', %L, %L)$q$, tests.id('rev'), tests.id('h')), 'BTFB0',
                       'only the creator lists connected channels');
  perform tests.as_owner();
end $$;

-- ── 5. revocation is terminal and deletes buffered content and credentials ───
do $$
declare
  v_link uuid := tests.id('link');
  v_inst uuid := tests.id('inst');
begin
  perform tests.as_service();
  perform public.connector_buffer_messages(v_link, '[{"provider_message_id":"9","sent_at":"2026-11-19T10:00:00Z","author_label":"Asha","kind":"text","text":"later"}]');
  perform tests.throws(format($q$select public.connector_revoke_installation('user', %L, %L, 'x')$q$, tests.id('mal'), v_inst), 'BTFB0',
                       'only the installer disconnects');
  perform public.connector_revoke_installation('provider', null, v_inst, 'provider_uninstalled');
  perform tests.eq((public.connector_get_installation(v_inst)) ->> 'status', 'revoked', 'installation revoked');
  perform tests.eq(public.connector_installation_credentials(v_inst), null::text, 'credentials deleted');
  perform tests.eq((public.connector_get_link(v_link)) ->> 'state', 'revoked', 'links revoked with it');
  perform tests.eq(tests.buf_count(), 0, 'buffered content deleted');
  perform tests.eq(public.connector_flush_actor(v_link), null::uuid, 'no flush actor for a revoked link');
  perform tests.throws(format($q$select public.connector_record_capture_consent('user', %L, %L, 'connector-capture-v1')$q$, tests.id('ann'), v_link),
                       'BTIT0', 'a revoked link cannot be consented again');
  perform public.connector_revoke_installation('provider', null, v_inst, 'again'); -- idempotent
  perform tests.ok((public.connector_upsert_installation('user', tests.id('mal'), 'slack', 'T1', 'X', '{}', null)) ->> 'status' = 'active',
                   'after revocation the account can be connected again (by anyone who installs it)');
  perform tests.as_owner();
  perform tests.ok(exists (select 1 from public.audit_logs where action = 'connector.installation_revoked'), 'revocation audited');
  perform tests.ok(exists (select 1 from public.audit_logs where action = 'connector.capture_consented' and handover_id = tests.id('h')), 'consent audited');
end $$;

-- ── 6. the kind CHECK accepts chat_import and still refuses unknown kinds ─────
do $$
begin
  perform tests.throws(format($q$insert into public.sources (handover_id, uploaded_by, kind, title, original_filename, mime_type, size_bytes, sha256, state, access_level, timezone)
    values (%L, %L, 'telegram_export', 't', 't', 'text/plain', 1, sha256('x'::bytea), 'uploaded', 'everyone', 'UTC')$q$, tests.id('h'), tests.id('ann')),
    '23514', 'unknown source kinds are still refused');
end $$;

select 'connectors r4: ok';
