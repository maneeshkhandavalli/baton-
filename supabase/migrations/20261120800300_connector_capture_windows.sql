-- Round 4 (2026-11-20): capture windows — the consent boundary for connector messages.
--
-- Problem (audit 2026-11-20): connector_buffer_messages only checked that a link was capturing NOW. A message sent
-- before consent, or while capture was paused, could enter Baton later through an edit (Telegram edited_message,
-- Slack message_changed, GitHub "edited" events all keep the ORIGINAL send time and add an edit time).
--
-- Model (additive): every period in which capture was authorised is a row in connector_capture_windows.
--   * first consent        opens a window at the consent time, back-dated ONLY by the history days the creator
--                          explicitly consented to (settings.historyDays, max 30)
--   * re-consent / resume  opens a window at that moment (never back-dated)
--   * pause / disconnect   closes the open window
-- A message is stored only when its original send time lies inside a window AND, for an edit, its edit time lies
-- inside the SAME window. Anything else is counted as "outside_window" and never inserts or updates a row, so an
-- unauthorised edit can never overwrite valid buffered content. Windows are kept as history, so a delayed delivery
-- from an earlier valid window is still accepted while the link is capturing.
-- Boundaries: a window is [opened, closed) at second precision (providers such as Telegram report whole seconds):
-- a message from the same second as consent is inside; one from the second of a pause is outside.
-- Existing links are backfilled from the audit log (consented / paused / resumed / unlinked), not from updated_at.

create table public.connector_capture_windows (
  id uuid primary key default gen_random_uuid(),
  link_id uuid not null references public.connector_channel_links (id) on delete cascade,
  opened_at timestamptz not null,
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint connector_capture_windows_order check (closed_at is null or closed_at >= opened_at)
);
create unique index connector_capture_windows_one_open on public.connector_capture_windows (link_id) where closed_at is null;
create index connector_capture_windows_link_idx on public.connector_capture_windows (link_id, opened_at);
alter table public.connector_capture_windows enable row level security;
revoke all on public.connector_capture_windows from public, anon, authenticated, service_role;

-- ── helpers (internal; not callable by any API role) ──────────────────────────

create function public._connector_history_days(p_settings jsonb)
returns int
language sql
immutable
set search_path = ''
as $$
  select case when coalesce(p_settings ->> 'historyDays', '') ~ '^[0-9]{1,3}$'
              then least((p_settings ->> 'historyDays')::int, 30) else 0 end
$$;

create function public._connector_open_capture_window(p_link_id uuid, p_opened_at timestamptz)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.connector_capture_windows (link_id, opened_at)
  select p_link_id, p_opened_at
   where not exists (select 1 from public.connector_capture_windows w where w.link_id = p_link_id and w.closed_at is null);
end $$;

create function public._connector_close_capture_window(p_link_id uuid, p_closed_at timestamptz)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.connector_capture_windows set closed_at = greatest(p_closed_at, opened_at)
   where link_id = p_link_id and closed_at is null;
end $$;

-- The window of a link that contains p_at, or null.
create function public._connector_capture_window_at(p_link_id uuid, p_at timestamptz)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select w.id from public.connector_capture_windows w
   where w.link_id = p_link_id
     and p_at is not null
     and date_trunc('second', w.opened_at) <= p_at
     and (w.closed_at is null or p_at < date_trunc('second', w.closed_at))
   order by w.opened_at desc
   limit 1
$$;

-- ── consent / pause / resume / disconnect maintain the windows ────────────────

create or replace function public.connector_record_capture_consent(p_actor_kind text, p_actor_profile_id uuid, p_link_id uuid, p_consent_version text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := public._connector_actor(p_actor_kind, p_actor_profile_id);
  v_l public.connector_channel_links := public._connector_lock_link(p_link_id);
  v_first boolean;
  v_was_capturing boolean;
begin
  perform public._connector_require_creator(v_actor, v_l.handover_id);
  if v_l.state = 'revoked' then
    raise exception 'this channel was disconnected' using errcode = 'BTIT0';
  end if;
  if p_consent_version is null or p_consent_version !~ '^[a-z0-9-]{1,80}$' then
    raise exception 'consent statement is required' using errcode = 'BTVF0';
  end if;
  if not exists (select 1 from public.connector_installations i where i.id = v_l.installation_id and i.status = 'active') then
    raise exception 'this connection is not active' using errcode = 'BTIT0';
  end if;
  v_first := v_l.consented_at is null;
  v_was_capturing := v_l.state = 'capturing';
  update public.connector_channel_links
     set state = 'capturing', consent_version = p_consent_version, consented_at = now(), consented_by_profile_id = v_actor,
         last_flush_error = null
   where id = v_l.id
  returning * into v_l;
  if not v_was_capturing then
    perform public._connector_open_capture_window(
      v_l.id,
      case when v_first then v_l.consented_at - make_interval(days => public._connector_history_days(v_l.settings))
           else v_l.consented_at end);
  end if;
  perform public._audit(v_l.handover_id, v_actor, null, 'connector.capture_consented', 'connector_link', v_l.id, null,
                        jsonb_build_object('consentVersion', p_consent_version));
  return public._connector_link_json(v_l);
end $$;

create or replace function public.connector_set_link_state(p_actor_kind text, p_actor_profile_id uuid, p_link_id uuid, p_state text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := public._connector_actor(p_actor_kind, p_actor_profile_id);
  v_l public.connector_channel_links := public._connector_lock_link(p_link_id);
  v_before text := v_l.state;
begin
  if p_state not in ('capturing', 'paused') then
    raise exception 'invalid state' using errcode = 'BTVF0';
  end if;
  if p_actor_kind = 'user' then
    perform public._connector_require_creator(v_actor, v_l.handover_id);
  end if;
  if v_l.state = 'revoked' then
    raise exception 'this channel was disconnected' using errcode = 'BTIT0';
  end if;
  if p_state = 'capturing' then
    if p_actor_kind <> 'user' then
      raise exception 'only a person can resume capture' using errcode = 'BTFB0';
    end if;
    if v_l.consent_version is null then
      raise exception 'capture needs consent first' using errcode = 'BTIT0';
    end if;
    if not exists (select 1 from public.connector_installations i where i.id = v_l.installation_id and i.status = 'active') then
      raise exception 'this connection is not active' using errcode = 'BTIT0';
    end if;
  end if;
  if v_l.state <> p_state then
    update public.connector_channel_links set state = p_state where id = v_l.id returning * into v_l;
    if p_state = 'paused' then
      perform public._connector_close_capture_window(v_l.id, now());
    else
      perform public._connector_open_capture_window(v_l.id, now());
    end if;
    perform public._audit(v_l.handover_id, v_actor, null,
                          case when p_state = 'paused' then 'connector.capture_paused' else 'connector.capture_resumed' end,
                          'connector_link', v_l.id, jsonb_build_object('state', v_before),
                          jsonb_build_object('state', p_state, 'by', p_actor_kind));
  end if;
  return public._connector_link_json(v_l);
end $$;

create or replace function public._connector_revoke_link_row(p_link_id uuid, p_actor uuid, p_actor_kind text, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_l public.connector_channel_links;
  v_deleted int;
begin
  select * into v_l from public.connector_channel_links where id = p_link_id for update;
  if not found or v_l.state = 'revoked' then return; end if;
  delete from public.connector_buffered_messages where link_id = p_link_id;
  get diagnostics v_deleted = row_count;
  update public.connector_channel_links set state = 'revoked', revoked_at = now() where id = p_link_id;
  perform public._connector_close_capture_window(p_link_id, now());
  perform public._audit(v_l.handover_id, p_actor, null, 'connector.channel_unlinked', 'connector_link', v_l.id,
                        jsonb_build_object('state', v_l.state),
                        jsonb_build_object('state', 'revoked', 'reason', p_reason, 'by', p_actor_kind, 'bufferedDeleted', v_deleted));
end $$;

-- ── buffering enforces the window (the database is the boundary, not the app) ──

create or replace function public.connector_buffer_messages(p_link_id uuid, p_messages jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_l public.connector_channel_links := public._connector_lock_link(p_link_id);
  v_m jsonb;
  v_inserted int := 0;
  v_updated int := 0;
  v_outside int := 0;
  v_is_new boolean;
  v_count int;
  v_sent timestamptz;
  v_edit timestamptz;
  v_window uuid;
  v_ok boolean;
begin
  if v_l.state <> 'capturing'
     or not exists (select 1 from public.connector_installations i where i.id = v_l.installation_id and i.status = 'active')
     or exists (select 1 from public.handovers h where h.id = v_l.handover_id and h.deleted_at is not null) then
    return jsonb_build_object('inserted', 0, 'updated', 0, 'outside_window', 0, 'refused', true);
  end if;
  if jsonb_typeof(p_messages) <> 'array' or jsonb_array_length(p_messages) > 100 then
    raise exception 'invalid messages' using errcode = 'BTVF0';
  end if;
  select count(*) into v_count from public.connector_buffered_messages where link_id = v_l.id;
  for v_m in select * from jsonb_array_elements(p_messages) loop
    -- 1. both timestamps parse; 2. the send time is inside a window; 3. an edit lies in the SAME window
    v_ok := true;
    begin
      v_sent := (v_m ->> 'sent_at')::timestamptz;
      v_edit := nullif(v_m ->> 'edited_at', '')::timestamptz;
    exception when others then
      v_ok := false;
    end;
    if v_ok then
      v_window := public._connector_capture_window_at(v_l.id, v_sent);
      if v_window is null or (v_edit is not null and public._connector_capture_window_at(v_l.id, v_edit) is distinct from v_window) then
        v_ok := false;
      end if;
    end if;
    if not v_ok then
      v_outside := v_outside + 1;
      continue;
    end if;
    if v_count >= 20000 and not exists (
      select 1 from public.connector_buffered_messages where link_id = v_l.id and provider_message_id = v_m->>'provider_message_id'
    ) then
      raise exception 'too many messages are waiting for this channel' using errcode = 'BTPF0';
    end if;
    insert into public.connector_buffered_messages (link_id, provider_message_id, sent_at, author_label, kind, body, reply_to_id, edited_at)
    values (v_l.id, v_m->>'provider_message_id', v_sent, coalesce(v_m->>'author_label', ''),
            v_m->>'kind', coalesce(v_m->>'text', ''), v_m->>'reply_to_id', v_edit)
    on conflict (link_id, provider_message_id) do update
      set sent_at = excluded.sent_at, author_label = excluded.author_label, kind = excluded.kind, body = excluded.body,
          reply_to_id = excluded.reply_to_id, edited_at = excluded.edited_at
    returning (xmax = 0) into v_is_new;
    if v_is_new then v_inserted := v_inserted + 1; v_count := v_count + 1; else v_updated := v_updated + 1; end if;
  end loop;
  if v_inserted + v_updated > 0 then
    update public.connector_channel_links set last_event_at = now() where id = v_l.id;
  end if;
  return jsonb_build_object('inserted', v_inserted, 'updated', v_updated, 'outside_window', v_outside, 'refused', false);
end $$;

-- ── backfill existing links from the audit log ────────────────────────────────

create function public._connector_backfill_capture_windows()
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_l public.connector_channel_links;
  v_a record;
  v_first boolean;
  v_n int := 0;
begin
  for v_l in select * from public.connector_channel_links where consented_at is not null order by created_at loop
    if exists (select 1 from public.connector_capture_windows w where w.link_id = v_l.id) then continue; end if;
    v_first := true;
    for v_a in
      select a.action, a.created_at from public.audit_logs a
       where a.entity_type = 'connector_link' and a.entity_id = v_l.id
         and a.action in ('connector.capture_consented', 'connector.capture_paused', 'connector.capture_resumed', 'connector.channel_unlinked')
       order by a.created_at, a.id
    loop
      if v_a.action = 'connector.capture_consented' then
        perform public._connector_open_capture_window(
          v_l.id, case when v_first then v_a.created_at - make_interval(days => public._connector_history_days(v_l.settings)) else v_a.created_at end);
        v_first := false;
      elsif v_a.action = 'connector.capture_resumed' then
        perform public._connector_open_capture_window(v_l.id, v_a.created_at);
      else
        perform public._connector_close_capture_window(v_l.id, v_a.created_at);
      end if;
    end loop;
    -- Reconcile with the current state, conservatively: a capturing link without history opens only from now;
    -- a non-capturing link never keeps an open window (zero-length close: nothing further is accepted).
    if v_l.state = 'capturing' then
      perform public._connector_open_capture_window(v_l.id, now());
    else
      update public.connector_capture_windows set closed_at = opened_at where link_id = v_l.id and closed_at is null;
    end if;
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;

select public._connector_backfill_capture_windows();

revoke execute on function
  public._connector_history_days(jsonb),
  public._connector_open_capture_window(uuid, timestamptz),
  public._connector_close_capture_window(uuid, timestamptz),
  public._connector_capture_window_at(uuid, timestamptz),
  public._connector_backfill_capture_windows()
  from public, anon, authenticated, service_role;
