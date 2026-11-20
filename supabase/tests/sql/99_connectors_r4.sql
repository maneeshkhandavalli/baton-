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
-- Message times are in 2099: after consent, inside the open capture window (§9 tests the window boundaries).
do $$
declare
  v jsonb;
  v_link uuid := tests.id('link');
begin
  perform tests.as_service();
  v := public.connector_buffer_messages(v_link, '[{"provider_message_id":"1","sent_at":"2099-11-19T09:00:00Z","author_label":"Asha","kind":"text","text":"hi"}]');
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

  v := public.connector_buffer_messages(v_link, '[{"provider_message_id":"1","sent_at":"2099-11-19T09:00:00Z","author_label":"Asha","kind":"text","text":"hi"},
                                                  {"provider_message_id":"2","sent_at":"2099-11-19T09:01:00Z","author_label":"Ravi","kind":"text","text":"yo"}]');
  perform tests.eq(v ->> 'inserted', '2', 'two messages buffered');
  v := public.connector_buffer_messages(v_link, '[{"provider_message_id":"1","sent_at":"2099-11-19T09:00:00Z","author_label":"Asha","kind":"text","text":"edited","edited_at":"2099-11-19T09:05:00Z"}]');
  perform tests.eq(v ->> 'updated', '1', 'an edit replaces the buffered message');
  perform tests.eq(tests.buf_body('1'), 'edited', 'edited body kept');

  perform tests.throws(format($q$select public.connector_set_link_state('provider', null, %L, 'capturing')$q$, v_link), 'BTFB0', 'a provider cannot resume capture');
  perform tests.eq((public.connector_set_link_state('provider', null, v_link, 'paused')) ->> 'state', 'paused', 'a provider can pause');
  v := public.connector_buffer_messages(v_link, '[{"provider_message_id":"3","sent_at":"2099-11-19T09:02:00Z","author_label":"Asha","kind":"text","text":"x"}]');
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
  perform tests.ok(public.connector_take_flush_batch(v_link, 5000) is null, 'a second flush cannot take the batch while the first holds the lease');
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

-- ── 7. deleting an account revokes the installations that person connected ───
do $$
declare
  v_inst uuid;
begin
  perform tests.as_service();
  v_inst := (public.connector_upsert_installation('user', tests.id('mal'), 'slack', 'T9', 'Mal workspace', '{}', 'c1.iv.tag.ct') ->> 'id')::uuid;
  perform tests.as_owner();
  update public.profiles set deleted_at = now() where id = tests.id('mal');
  perform tests.as_service();
  perform tests.eq((public.connector_get_installation(v_inst)) ->> 'status', 'revoked', 'account deletion revokes the installation');
  perform tests.ok(public.connector_installation_credentials(v_inst) is null, 'and deletes its sealed credentials');
  perform tests.as_owner();
end $$;

-- ── 8. notices name a live account by display name only ──────────────────────
do $$
begin
  perform tests.as_service();
  perform tests.ok(public.connector_actor_display_name(tests.id('ann')) is not null, 'a live account has a display name for notices');
  perform tests.ok(public.connector_actor_display_name(tests.id('ann')) !~ '@', 'the notice name is not an email');
  perform tests.ok(public.connector_actor_display_name(tests.id('mal')) is null, 'a deleted account is never named');
  perform tests.as_reader('ann');
  perform tests.throws(format($q$select public.connector_actor_display_name(%L)$q$, tests.id('ann')), '42501', 'browser sessions cannot call it');
  perform tests.as_owner();
end $$;

-- ── 9. capture windows: the database enforces the consent boundary ───────────
-- A message is stored only when its send time is inside an authorised window and an edit lies in the SAME window.
-- Calls go straight to the functions (as the server does), so the app cannot be the only gate.
create function tests.wbuf(p_link uuid, p_id text, p_sent text, p_edited text default null, p_text text default 'x') returns jsonb
language sql as $$
  select public.connector_buffer_messages(p_link, jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
    'provider_message_id', p_id, 'sent_at', p_sent, 'edited_at', p_edited, 'author_label', 'Asha', 'kind', 'text', 'text', p_text))))
$$;
grant execute on function tests.wbuf(uuid, text, text, text, text) to service_role;
do $$
declare
  v_inst uuid;
  v_link uuid;
  v_link2 uuid;
begin
  perform tests.as_service();
  v_inst := (public.connector_upsert_installation('user', tests.id('ann'), 'telegram', '-1009', 'Window QA', '{}', null) ->> 'id')::uuid;
  v_link := (public.connector_link_channel('user', tests.id('ann'), v_inst, tests.id('h'), '-1009', 'Window QA', '{}') ->> 'id')::uuid;
  perform public.connector_record_capture_consent('user', tests.id('ann'), v_link, 'connector-capture-v1');
  perform tests.as_owner();
  perform tests.eq((select count(*)::int from public.connector_capture_windows where link_id = v_link and closed_at is null), 1, 'consent opens exactly one window');
  -- a fixed timeline: window A [08:00, 09:00), paused, window B [10:00, …)
  delete from public.connector_capture_windows where link_id = v_link;
  insert into public.connector_capture_windows (link_id, opened_at, closed_at)
  values (v_link, '2030-01-01T08:00:00Z', '2030-01-01T09:00:00Z'), (v_link, '2030-01-01T10:00:00Z', null);

  perform tests.as_service();
  perform tests.eq(tests.wbuf(v_link, 'm0', '2030-01-01T07:59:59Z') ->> 'outside_window', '1', 'sent before consent → outside');
  perform tests.eq(tests.wbuf(v_link, 'm1', '2030-01-01T08:00:00Z') ->> 'inserted', '1', 'sent at the opening second → inside');
  perform tests.eq(tests.wbuf(v_link, 'm2', '2030-01-01T08:59:59Z') ->> 'inserted', '1', 'last second of window A → inside');
  perform tests.eq(tests.wbuf(v_link, 'm3', '2030-01-01T09:00:00Z') ->> 'outside_window', '1', 'the pause second → outside');
  perform tests.eq(tests.wbuf(v_link, 'm4', '2030-01-01T09:30:00Z') ->> 'outside_window', '1', 'sent during the pause → outside');
  perform tests.eq(tests.wbuf(v_link, 'm4', '2030-01-01T09:30:00Z', '2030-01-01T10:30:00Z') ->> 'outside_window', '1',
                   'sent during the pause, edited after resuming → outside');
  perform tests.eq(tests.wbuf(v_link, 'm0', '2030-01-01T07:59:59Z', '2030-01-01T08:30:00Z') ->> 'outside_window', '1',
                   'sent before consent, edited after consent → outside');

  perform tests.eq(tests.wbuf(v_link, 'e1', '2030-01-01T08:30:00Z', null, 'valid') ->> 'inserted', '1', 'valid message in window A');
  perform tests.eq(tests.wbuf(v_link, 'e1', '2030-01-01T08:30:00Z', '2030-01-01T09:30:00Z', 'edited while paused') ->> 'outside_window', '1',
                   'an edit made during the pause is refused');
  perform tests.eq(tests.wbuf(v_link, 'e1', '2030-01-01T08:30:00Z', '2030-01-01T10:30:00Z', 'edited in window B') ->> 'outside_window', '1',
                   'an edit in a different window is refused');
  perform tests.eq(tests.buf_body('e1'), 'valid', 'refused edits never overwrite the valid buffered body');
  perform tests.eq(tests.wbuf(v_link, 'e1', '2030-01-01T08:30:00Z', '2030-01-01T08:45:00Z', 'edited in window A') ->> 'updated', '1',
                   'an edit inside the same window updates');
  perform tests.eq(tests.buf_body('e1'), 'edited in window A', 'same-window edit applied');

  perform tests.eq(tests.wbuf(v_link, 'd1', '2030-01-01T08:40:00Z') ->> 'inserted', '1',
                   'a delayed delivery from an earlier valid window is accepted while capturing');
  perform tests.eq(tests.wbuf(v_link, 'b1', '2030-01-01T10:30:00Z') ->> 'inserted', '1', 'window B accepts new messages');
  perform tests.eq(tests.wbuf(v_link, 'x1', 'not-a-time') ->> 'outside_window', '1', 'a malformed send time is refused, not an error');
  perform tests.eq(tests.wbuf(v_link, 'x2', '2030-01-01T08:10:00Z', 'not-a-time') ->> 'outside_window', '1', 'a malformed edit time is refused');
  perform tests.eq(tests.buf_count(v_link), 5, 'exactly the authorised rows exist');

  -- pause closes, resume opens, disconnect closes (maintained by the functions themselves)
  perform public.connector_set_link_state('user', tests.id('ann'), v_link, 'paused');
  perform tests.as_owner();
  perform tests.eq((select count(*)::int from public.connector_capture_windows where link_id = v_link and closed_at is null), 0, 'pause closes the window');
  perform tests.as_service();
  perform public.connector_set_link_state('user', tests.id('ann'), v_link, 'capturing');
  perform tests.as_owner();
  perform tests.eq((select count(*)::int from public.connector_capture_windows where link_id = v_link and closed_at is null), 1, 'resume opens a new window');
  perform tests.as_service();
  perform public.connector_revoke_link('user', tests.id('ann'), v_link, 'creator_unlinked');
  perform tests.as_owner();
  perform tests.eq((select count(*)::int from public.connector_capture_windows where link_id = v_link and closed_at is null), 0, 'disconnect closes the window');
  perform tests.eq((select count(*)::int from public.connector_capture_windows where link_id = v_link), 3, 'window history is kept');

  -- consented history days back-date only the first window
  perform tests.as_service();
  v_link2 := (public.connector_link_channel('user', tests.id('ann'), v_inst, tests.id('h'), '-1010', 'History QA', '{}') ->> 'id')::uuid;
  perform public.connector_update_link_settings('user', tests.id('ann'), v_link2, '{"historyDays": 7}');
  perform public.connector_record_capture_consent('user', tests.id('ann'), v_link2, 'connector-capture-v1');
  perform tests.as_owner();
  perform tests.ok((select opened_at from public.connector_capture_windows where link_id = v_link2) = now() - interval '7 days',
                   'the first window starts at the consented history days');
  perform tests.eq(public._connector_history_days('{"historyDays": 999}'), 30, 'history days are capped at 30');
  perform tests.eq(public._connector_history_days('{"historyDays": "x"}'), 0, 'non-numeric history days count as 0');

  -- backfill reconstructs windows from the audit log (consented → open, paused → close, resumed → open)
  delete from public.connector_capture_windows where link_id = v_link2;
  perform tests.ok(public._connector_backfill_capture_windows() >= 1, 'backfill processes links without windows');
  perform tests.eq((select count(*)::int from public.connector_capture_windows where link_id = v_link2 and closed_at is null), 1, 'backfill reopens the capturing link');
  perform tests.ok((select opened_at from public.connector_capture_windows where link_id = v_link2) = now() - interval '7 days',
                   'backfill applies the consented history days from the audit time');
end $$;

-- ── 10. capture windows stay server-only ─────────────────────────────────────
do $$
begin
  perform tests.as_reader('ann');
  perform tests.throws('select * from public.connector_capture_windows', '42501', 'browser sessions cannot read capture windows');
  perform tests.as_service();
  perform tests.throws('select * from public.connector_capture_windows', '42501', 'service_role reads windows only through the functions');
  perform tests.throws(format($q$select public._connector_open_capture_window(%L, now())$q$, gen_random_uuid()), '42501', 'internal window helpers are not callable');
  perform tests.throws('select public._connector_backfill_capture_windows()', '42501', 'the backfill is not callable by API roles');
  perform tests.as_owner();
end $$;

-- ── 11. deletions are privacy tombstones (2026-11-20 review) ──────────────────
-- The app sends a deletion as kind 'deleted', empty body and NO edited_at (lib/connectors/ingest.ts sanitizeMessages),
-- so the database checks only the original send time: a tombstone for a message from an earlier authorised window is
-- applied while capturing, and a tombstone for a message sent outside every window creates nothing.
create function tests.tomb(p_link uuid, p_id text, p_sent text, p_edited text default null) returns jsonb
language sql as $$
  select public.connector_buffer_messages(p_link, jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
    'provider_message_id', p_id, 'sent_at', p_sent, 'edited_at', p_edited, 'author_label', 'Asha', 'kind', 'deleted', 'text', ''))))
$$;
grant execute on function tests.tomb(uuid, text, text, text) to service_role;
create function tests.buf_kind(p_msg text) returns text language sql security definer as
  $$ select kind from public.connector_buffered_messages where provider_message_id = p_msg $$;
grant execute on function tests.buf_kind(text) to service_role;
do $$
declare
  v_inst uuid;
  v_link uuid;
begin
  perform tests.as_service();
  v_inst := (public.connector_upsert_installation('user', tests.id('ann'), 'slack', 'T0TOMB', 'Tombstone QA', '{}', null) ->> 'id')::uuid;
  v_link := (public.connector_link_channel('user', tests.id('ann'), v_inst, tests.id('h'), 'C0TOMB', '#tomb', '{}') ->> 'id')::uuid;
  perform public.connector_record_capture_consent('user', tests.id('ann'), v_link, 'connector-capture-v1');
  perform tests.as_owner();
  delete from public.connector_capture_windows where link_id = v_link;
  insert into public.connector_capture_windows (link_id, opened_at, closed_at)
  values (v_link, '2031-01-01T08:00:00Z', '2031-01-01T09:00:00Z'), (v_link, '2031-01-01T10:00:00Z', null);

  perform tests.as_service();
  perform tests.eq(tests.wbuf(v_link, 'tA', '2031-01-01T08:30:00Z', null, 'deleted later') ->> 'inserted', '1', 'window-A message buffered');
  perform tests.eq(tests.tomb(v_link, 'tA', '2031-01-01T08:30:00Z') ->> 'updated', '1',
                   'a tombstone for a window-A message, delivered in window B, is applied');
  perform tests.eq(tests.buf_kind('tA'), 'deleted', 'the row is now a tombstone');
  perform tests.eq(tests.buf_body('tA'), '', 'the deleted text is gone');
  perform tests.eq(tests.tomb(v_link, 'tP', '2031-01-01T09:30:00Z') ->> 'outside_window', '1', 'a tombstone for a message sent during the pause creates nothing');
  perform tests.eq(tests.tomb(v_link, 'tC', '2031-01-01T07:30:00Z') ->> 'outside_window', '1', 'a tombstone for a message sent before consent creates nothing');
  perform tests.eq(tests.tomb(v_link, 'tN', '2031-01-01T08:40:00Z') ->> 'inserted', '1',
                   'a tombstone for an authorised message no longer buffered is a contentless marker');
  perform tests.eq(tests.buf_body('tN'), '', 'the marker has no body');
  -- defence in depth: the database itself still window-checks an edited_at if one is supplied (the app never sends one)
  perform tests.eq(tests.tomb(v_link, 'tA', '2031-01-01T08:30:00Z', '2031-01-01T10:30:00Z') ->> 'outside_window', '1',
                   'a tombstone that carries a cross-window edit time is refused by the database');
  perform tests.eq(tests.buf_count(v_link), 2, 'only tA and tN exist');
  perform tests.as_owner();
end $$;
