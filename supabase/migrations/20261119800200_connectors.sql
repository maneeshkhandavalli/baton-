-- Round 4: provider connectors (GitHub, Discord, Slack, Telegram). docs/round4/connectors-contract.md §1, §7.
-- REQUIRES APPROVAL BEFORE ANY HOSTED APPLY.
--
-- ADDITIVE: four new server-only tables and service-role-only SECURITY DEFINER functions. No existing table or
-- function changes. Mirrors lib/connectors/store-memory.ts (the unit-test store) rule for rule:
--
--   * installations   one provider account per Baton user. A live account connected by another Baton user is a
--                     conflict (no takeover). Credentials are an opaque AES-GCM envelope sealed by the server;
--                     the database never sees plaintext. Revocation is terminal and deletes the envelope.
--   * channel links   one channel/repository → one handover. Linking needs the actor to be the handover's creator
--                     AND the installer. Capture needs the creator's versioned consent. Only `capturing` links
--                     accept messages. A provider (uninstall webhook) can pause or revoke, never resume.
--   * events          the de-duplication ledger: (provider, delivery_id) unique, no content. A `failed` delivery,
--                     or one stuck `received` for 5 minutes, is processed again on the provider's retry.
--   * buffered msgs   normalised messages waiting for a flush into a chat_import source. Deleted on revoke and after
--                     a confirmed flush; bounded per link. Content: masked later by the parser, like a raw upload.
--
-- No browser role can read or write any of it (RLS on, no policies, all grants revoked). Every lifecycle change is
-- audited (`connector.*`). Errors use the existing BT codes (lib/db/errors.ts).

-- ── 1. tables ────────────────────────────────────────────────────────────────

create table public.connector_installations (
  id uuid primary key default gen_random_uuid(),
  provider text not null check (provider in ('github', 'discord', 'slack', 'telegram')),
  external_account_id text not null check (external_account_id ~ '^-?[A-Za-z0-9_]{1,200}$'),
  account_label text not null default '' check (char_length(account_label) <= 200),
  status text not null default 'active' check (status in ('active', 'suspended', 'revoked', 'error')),
  status_reason text check (status_reason is null or status_reason ~ '^[a-z0-9_]{1,60}$'),
  installed_by_profile_id uuid references public.profiles (id) on delete set null,
  scopes text[] not null default '{}' check (cardinality(scopes) <= 50),
  credentials text check (credentials is null or char_length(credentials) <= 8192),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  revoked_at timestamptz,
  constraint connector_installations_revoked check ((status = 'revoked') = (revoked_at is not null)),
  constraint connector_installations_revoked_no_credentials check (status <> 'revoked' or credentials is null)
);
create unique index connector_installations_live_uq
  on public.connector_installations (provider, external_account_id) where status <> 'revoked';
create index connector_installations_owner_idx on public.connector_installations (installed_by_profile_id);

create table public.connector_channel_links (
  id uuid primary key default gen_random_uuid(),
  installation_id uuid not null references public.connector_installations (id) on delete cascade,
  handover_id uuid not null references public.handovers (id) on delete cascade,
  external_channel_id text not null check (external_channel_id ~ '^-?[A-Za-z0-9_.:-]{1,200}$'),
  channel_label text not null default '' check (char_length(channel_label) <= 200),
  state text not null default 'pending_consent' check (state in ('pending_consent', 'capturing', 'paused', 'revoked')),
  settings jsonb not null default '{}' check (jsonb_typeof(settings) = 'object' and pg_column_size(settings) <= 8192),
  consent_version text check (consent_version is null or consent_version ~ '^[a-z0-9-]{1,80}$'),
  consented_at timestamptz,
  consented_by_profile_id uuid references public.profiles (id) on delete set null,
  source_id uuid references public.sources (id) on delete set null,
  pull_cursor text check (pull_cursor is null or char_length(pull_cursor) <= 200),
  last_event_at timestamptz,
  last_flush_at timestamptz,
  last_flush_error text check (last_flush_error is null or last_flush_error ~ '^[a-z0-9_]{1,60}$'),
  -- A flush in progress holds this short lease, so a scheduled sweep and "Bring in new messages" never write the
  -- same buffered messages into two sources. Cleared on completion or error; expires on its own if a flush dies.
  flush_lease_until timestamptz,
  created_by_profile_id uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  revoked_at timestamptz,
  constraint connector_links_capture_needs_consent check (state <> 'capturing' or (consent_version is not null and consented_at is not null)),
  constraint connector_links_revoked check ((state = 'revoked') = (revoked_at is not null))
);
create unique index connector_links_live_uq
  on public.connector_channel_links (installation_id, external_channel_id, handover_id) where state <> 'revoked';
create index connector_links_handover_idx on public.connector_channel_links (handover_id);
create index connector_links_channel_idx on public.connector_channel_links (installation_id, external_channel_id) where state = 'capturing';

create table public.connector_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null check (provider in ('github', 'discord', 'slack', 'telegram')),
  delivery_id text not null check (char_length(delivery_id) between 1 and 200),
  external_account_id text check (external_account_id is null or char_length(external_account_id) <= 200),
  event_type text not null check (char_length(event_type) between 1 and 100),
  status text not null default 'received' check (status in ('received', 'processed', 'ignored', 'failed')),
  detail text check (detail is null or detail ~ '^[a-z0-9_]{1,60}$'),
  attempts int not null default 1 check (attempts >= 1),
  received_at timestamptz not null default clock_timestamp(),
  finished_at timestamptz,
  unique (provider, delivery_id)
);
create index connector_events_received_idx on public.connector_events (received_at);

create table public.connector_buffered_messages (
  id uuid primary key default gen_random_uuid(),
  link_id uuid not null references public.connector_channel_links (id) on delete cascade,
  provider_message_id text not null check (char_length(provider_message_id) between 1 and 200),
  sent_at timestamptz not null,
  author_label text not null check (char_length(author_label) <= 120),
  kind text not null check (kind in ('text', 'system', 'media_omitted', 'deleted')),
  body text not null default '' check (char_length(body) <= 20000),
  reply_to_id text check (reply_to_id is null or char_length(reply_to_id) <= 200),
  edited_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  unique (link_id, provider_message_id)
);
create index connector_buffer_link_idx on public.connector_buffered_messages (link_id, sent_at, created_at);

alter table public.connector_installations enable row level security;
alter table public.connector_channel_links enable row level security;
alter table public.connector_events enable row level security;
alter table public.connector_buffered_messages enable row level security;
-- no policies: server only

create trigger connector_installations_touch before update on public.connector_installations
  for each row execute function public._touch_updated_at();
create trigger connector_channel_links_touch before update on public.connector_channel_links
  for each row execute function public._touch_updated_at();

-- ── 2. helpers ───────────────────────────────────────────────────────────────

-- The actor of a connector change: a verified user (profile re-checked), the provider (webhook) or the system.
create function public._connector_actor(p_kind text, p_profile_id uuid)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if coalesce(current_setting('role', true), '') in ('anon', 'authenticated') then
    raise exception 'mutations are server-only' using errcode = 'BTFB0';
  end if;
  if p_kind = 'user' then
    return public._require_actor(p_profile_id);
  elsif p_kind in ('provider', 'system') and p_profile_id is null then
    return null;
  end if;
  raise exception 'invalid actor' using errcode = 'BTVF0';
end $$;

create function public._connector_installation_json(i public.connector_installations)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', i.id, 'provider', i.provider, 'external_account_id', i.external_account_id, 'account_label', i.account_label,
    'status', i.status, 'status_reason', i.status_reason, 'installed_by_profile_id', i.installed_by_profile_id,
    'scopes', to_jsonb(i.scopes), 'has_credentials', i.credentials is not null,
    'created_at', i.created_at, 'updated_at', i.updated_at)
$$;

create function public._connector_link_json(l public.connector_channel_links)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', l.id, 'installation_id', l.installation_id,
    'provider', (select i.provider from public.connector_installations i where i.id = l.installation_id),
    'handover_id', l.handover_id, 'external_channel_id', l.external_channel_id, 'channel_label', l.channel_label,
    'state', l.state, 'settings', l.settings, 'consent_version', l.consent_version, 'consented_at', l.consented_at,
    'consented_by_profile_id', l.consented_by_profile_id, 'source_id', l.source_id,
    'buffered_count', (select count(*) from public.connector_buffered_messages b where b.link_id = l.id),
    'last_event_at', l.last_event_at, 'last_flush_at', l.last_flush_at, 'last_flush_error', l.last_flush_error,
    'pull_cursor', l.pull_cursor, 'created_at', l.created_at, 'updated_at', l.updated_at)
$$;

-- A link row locked for update; not_found when missing.
create function public._connector_lock_link(p_link_id uuid)
returns public.connector_channel_links
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_l public.connector_channel_links;
begin
  select * into v_l from public.connector_channel_links where id = p_link_id for update;
  if not found then
    raise exception 'connection not found' using errcode = 'BTNF0';
  end if;
  return v_l;
end $$;

-- Creator of a live handover, else forbidden (not_found when the handover does not exist or is deleted).
create function public._connector_require_creator(p_actor uuid, p_handover_id uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.handovers h where h.id = p_handover_id and h.deleted_at is null) then
    raise exception 'handover not found' using errcode = 'BTNF0';
  end if;
  if p_actor is null or not public._is_creator_as(p_actor, p_handover_id) then
    raise exception 'only the creator can manage connected channels' using errcode = 'BTFB0';
  end if;
end $$;

-- Revokes one link: deletes its buffered messages (content never flushed) and audits.
create function public._connector_revoke_link_row(p_link_id uuid, p_actor uuid, p_actor_kind text, p_reason text)
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
  perform public._audit(v_l.handover_id, p_actor, null, 'connector.channel_unlinked', 'connector_link', v_l.id,
                        jsonb_build_object('state', v_l.state),
                        jsonb_build_object('state', 'revoked', 'reason', p_reason, 'by', p_actor_kind, 'bufferedDeleted', v_deleted));
end $$;

-- ── 3. events ────────────────────────────────────────────────────────────────

create function public.connector_record_event(p_provider text, p_delivery_id text, p_external_account_id text, p_event_type text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_e public.connector_events;
  v_prev text;
begin
  insert into public.connector_events (provider, delivery_id, external_account_id, event_type)
  values (p_provider, p_delivery_id, p_external_account_id, p_event_type)
  on conflict (provider, delivery_id) do nothing
  returning id into v_id;
  if v_id is not null then
    return jsonb_build_object('event_id', v_id, 'process', true, 'previous_status', null, 'attempts', 1);
  end if;
  select * into v_e from public.connector_events where provider = p_provider and delivery_id = p_delivery_id for update;
  v_prev := v_e.status;
  if v_e.status = 'failed' or (v_e.status = 'received' and v_e.received_at < clock_timestamp() - interval '5 minutes') then
    update public.connector_events
       set status = 'received', attempts = attempts + 1, received_at = clock_timestamp(), detail = null, finished_at = null
     where id = v_e.id
    returning * into v_e;
    return jsonb_build_object('event_id', v_e.id, 'process', true, 'previous_status', v_prev, 'attempts', v_e.attempts);
  end if;
  return jsonb_build_object('event_id', v_e.id, 'process', false, 'previous_status', v_prev, 'attempts', v_e.attempts);
end $$;

create function public.connector_finish_event(p_event_id uuid, p_status text, p_detail text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_status not in ('processed', 'ignored', 'failed') then
    raise exception 'invalid status' using errcode = 'BTVF0';
  end if;
  update public.connector_events set status = p_status, detail = p_detail, finished_at = clock_timestamp() where id = p_event_id;
  if not found then
    raise exception 'event not found' using errcode = 'BTNF0';
  end if;
end $$;

-- Ledger retention: finished deliveries older than p_days (default 30) are removed (they hold no content).
create function public.connector_prune_events(p_days int default 30)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n int;
begin
  delete from public.connector_events
   where status <> 'received' and received_at < now() - make_interval(days => greatest(p_days, 7));
  get diagnostics v_n = row_count;
  return v_n;
end $$;

-- ── 4. installations ─────────────────────────────────────────────────────────

create function public.connector_upsert_installation(p_actor_kind text, p_actor_profile_id uuid,
  p_provider text, p_external_account_id text, p_account_label text, p_scopes text[], p_credentials text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := public._connector_actor(p_actor_kind, p_actor_profile_id);
  v_i public.connector_installations;
begin
  if p_actor_kind <> 'user' then
    raise exception 'a person connects an account' using errcode = 'BTFB0';
  end if;
  select * into v_i from public.connector_installations
   where provider = p_provider and external_account_id = p_external_account_id and status <> 'revoked'
   for update;
  if found then
    if v_i.installed_by_profile_id is distinct from v_actor then
      raise exception 'this account is already connected to Baton by someone else' using errcode = 'BTCF0';
    end if;
    update public.connector_installations
       set account_label = coalesce(p_account_label, ''), scopes = coalesce(p_scopes, '{}'),
           credentials = coalesce(p_credentials, credentials), status = 'active', status_reason = null
     where id = v_i.id
    returning * into v_i;
    perform public._audit(null, v_actor, null, 'connector.installation_updated', 'connector_installation', v_i.id, null,
                          jsonb_build_object('provider', v_i.provider, 'scopes', to_jsonb(v_i.scopes)));
  else
    insert into public.connector_installations (provider, external_account_id, account_label, installed_by_profile_id, scopes, credentials)
    values (p_provider, p_external_account_id, coalesce(p_account_label, ''), v_actor, coalesce(p_scopes, '{}'), p_credentials)
    returning * into v_i;
    perform public._audit(null, v_actor, null, 'connector.installed', 'connector_installation', v_i.id, null,
                          jsonb_build_object('provider', v_i.provider, 'scopes', to_jsonb(v_i.scopes)));
  end if;
  return public._connector_installation_json(v_i);
end $$;

create function public.connector_find_installation(p_provider text, p_external_account_id text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select public._connector_installation_json(i) from public.connector_installations i
   where i.provider = p_provider and i.external_account_id = p_external_account_id
   order by (i.status <> 'revoked') desc, i.created_at desc
   limit 1
$$;

create function public.connector_get_installation(p_installation_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select public._connector_installation_json(i) from public.connector_installations i where i.id = p_installation_id
$$;

create function public.connector_installation_credentials(p_installation_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select i.credentials from public.connector_installations i where i.id = p_installation_id and i.status <> 'revoked'
$$;

create function public.connector_set_installation_status(p_actor_kind text, p_actor_profile_id uuid,
  p_installation_id uuid, p_status text, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := public._connector_actor(p_actor_kind, p_actor_profile_id);
  v_i public.connector_installations;
begin
  if p_status not in ('active', 'suspended', 'error') then
    raise exception 'invalid status' using errcode = 'BTVF0';
  end if;
  select * into v_i from public.connector_installations where id = p_installation_id for update;
  if not found then
    raise exception 'connection not found' using errcode = 'BTNF0';
  end if;
  if v_i.status = 'revoked' then
    raise exception 'this connection was disconnected' using errcode = 'BTIT0';
  end if;
  if p_actor_kind = 'user' and v_i.installed_by_profile_id is distinct from v_actor then
    raise exception 'only the person who connected it can change it' using errcode = 'BTFB0';
  end if;
  update public.connector_installations set status = p_status, status_reason = p_reason where id = v_i.id;
  perform public._audit(null, v_actor, null, 'connector.installation_' || p_status, 'connector_installation', v_i.id,
                        jsonb_build_object('status', v_i.status), jsonb_build_object('status', p_status, 'reason', p_reason, 'by', p_actor_kind));
end $$;

create function public.connector_revoke_installation(p_actor_kind text, p_actor_profile_id uuid, p_installation_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := public._connector_actor(p_actor_kind, p_actor_profile_id);
  v_i public.connector_installations;
  v_link uuid;
begin
  select * into v_i from public.connector_installations where id = p_installation_id for update;
  if not found then
    raise exception 'connection not found' using errcode = 'BTNF0';
  end if;
  if p_actor_kind = 'user' and v_i.installed_by_profile_id is distinct from v_actor then
    raise exception 'only the person who connected it can disconnect it' using errcode = 'BTFB0';
  end if;
  if v_i.status = 'revoked' then return; end if;
  for v_link in select id from public.connector_channel_links where installation_id = v_i.id and state <> 'revoked' loop
    perform public._connector_revoke_link_row(v_link, v_actor, p_actor_kind, coalesce(p_reason, 'installation_revoked'));
  end loop;
  update public.connector_installations
     set status = 'revoked', status_reason = p_reason, credentials = null, revoked_at = now()
   where id = v_i.id;
  perform public._audit(null, v_actor, null, 'connector.installation_revoked', 'connector_installation', v_i.id,
                        jsonb_build_object('status', v_i.status), jsonb_build_object('reason', p_reason, 'by', p_actor_kind));
end $$;

-- Deleting an account (profiles.deleted_at set by delete_account_data) revokes every connector installation the
-- person connected: links revoked, buffered messages and sealed credentials deleted, so nothing keeps capturing
-- on behalf of a person who left. The provider-side app is left for workspace admins to remove.
create function public._connector_revoke_on_account_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  for v_id in select id from public.connector_installations where installed_by_profile_id = new.id and status <> 'revoked' loop
    perform public.connector_revoke_installation('system', null, v_id, 'account_deleted');
  end loop;
  return new;
end $$;

revoke all on function public._connector_revoke_on_account_delete() from public, anon, authenticated;

create trigger connector_revoke_on_account_delete
  after update of deleted_at on public.profiles
  for each row when (old.deleted_at is null and new.deleted_at is not null)
  execute function public._connector_revoke_on_account_delete();

create function public.connector_list_installations_for_profile(p_profile_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(public._connector_installation_json(i) order by i.created_at), '[]'::jsonb)
    from public.connector_installations i
   where i.installed_by_profile_id = p_profile_id and i.status <> 'revoked'
$$;

-- ── 5. links ─────────────────────────────────────────────────────────────────

create function public.connector_link_channel(p_actor_kind text, p_actor_profile_id uuid,
  p_installation_id uuid, p_handover_id uuid, p_external_channel_id text, p_channel_label text, p_settings jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := public._connector_actor(p_actor_kind, p_actor_profile_id);
  v_i public.connector_installations;
  v_l public.connector_channel_links;
begin
  perform public._connector_require_creator(v_actor, p_handover_id);
  select * into v_i from public.connector_installations where id = p_installation_id for share;
  if not found then
    raise exception 'connection not found' using errcode = 'BTNF0';
  end if;
  if v_i.status <> 'active' then
    raise exception 'this connection is not active' using errcode = 'BTIT0';
  end if;
  if v_i.installed_by_profile_id is distinct from v_actor then
    raise exception 'only the person who connected this account can link its channels' using errcode = 'BTFB0';
  end if;
  select * into v_l from public.connector_channel_links
   where installation_id = v_i.id and external_channel_id = p_external_channel_id and handover_id = p_handover_id and state <> 'revoked';
  if found then
    return public._connector_link_json(v_l);
  end if;
  insert into public.connector_channel_links (installation_id, handover_id, external_channel_id, channel_label, settings, created_by_profile_id)
  values (v_i.id, p_handover_id, p_external_channel_id, coalesce(p_channel_label, ''), coalesce(p_settings, '{}'), v_actor)
  returning * into v_l;
  perform public._audit(p_handover_id, v_actor, null, 'connector.channel_linked', 'connector_link', v_l.id, null,
                        jsonb_build_object('provider', v_i.provider, 'state', v_l.state));
  return public._connector_link_json(v_l);
end $$;

create function public.connector_record_capture_consent(p_actor_kind text, p_actor_profile_id uuid, p_link_id uuid, p_consent_version text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := public._connector_actor(p_actor_kind, p_actor_profile_id);
  v_l public.connector_channel_links := public._connector_lock_link(p_link_id);
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
  update public.connector_channel_links
     set state = 'capturing', consent_version = p_consent_version, consented_at = now(), consented_by_profile_id = v_actor,
         last_flush_error = null
   where id = v_l.id
  returning * into v_l;
  perform public._audit(v_l.handover_id, v_actor, null, 'connector.capture_consented', 'connector_link', v_l.id, null,
                        jsonb_build_object('consentVersion', p_consent_version));
  return public._connector_link_json(v_l);
end $$;

create function public.connector_set_link_state(p_actor_kind text, p_actor_profile_id uuid, p_link_id uuid, p_state text)
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
    perform public._audit(v_l.handover_id, v_actor, null,
                          case when p_state = 'paused' then 'connector.capture_paused' else 'connector.capture_resumed' end,
                          'connector_link', v_l.id, jsonb_build_object('state', v_before),
                          jsonb_build_object('state', p_state, 'by', p_actor_kind));
  end if;
  return public._connector_link_json(v_l);
end $$;

create function public.connector_revoke_link(p_actor_kind text, p_actor_profile_id uuid, p_link_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := public._connector_actor(p_actor_kind, p_actor_profile_id);
  v_l public.connector_channel_links := public._connector_lock_link(p_link_id);
begin
  if p_actor_kind = 'user' then
    perform public._connector_require_creator(v_actor, v_l.handover_id);
  end if;
  perform public._connector_revoke_link_row(v_l.id, v_actor, p_actor_kind, coalesce(p_reason, 'unlinked'));
end $$;

create function public.connector_update_link_settings(p_actor_kind text, p_actor_profile_id uuid, p_link_id uuid, p_settings jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := public._connector_actor(p_actor_kind, p_actor_profile_id);
  v_l public.connector_channel_links := public._connector_lock_link(p_link_id);
begin
  perform public._connector_require_creator(v_actor, v_l.handover_id);
  if v_l.state = 'revoked' then
    raise exception 'this channel was disconnected' using errcode = 'BTIT0';
  end if;
  update public.connector_channel_links set settings = coalesce(p_settings, '{}') where id = v_l.id returning * into v_l;
  perform public._audit(v_l.handover_id, v_actor, null, 'connector.settings_changed', 'connector_link', v_l.id, null, v_l.settings);
  return public._connector_link_json(v_l);
end $$;

create function public.connector_get_link(p_link_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select public._connector_link_json(l) from public.connector_channel_links l where l.id = p_link_id
$$;

create function public.connector_list_links_for_handover(p_actor_kind text, p_actor_profile_id uuid, p_handover_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid := public._connector_actor(p_actor_kind, p_actor_profile_id);
begin
  perform public._connector_require_creator(v_actor, p_handover_id);
  return (select coalesce(jsonb_agg(public._connector_link_json(l) order by l.created_at), '[]'::jsonb)
            from public.connector_channel_links l where l.handover_id = p_handover_id);
end $$;

create function public.connector_capturing_links(p_provider text, p_external_account_id text, p_external_channel_id text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(public._connector_link_json(l) order by l.created_at), '[]'::jsonb)
    from public.connector_channel_links l
    join public.connector_installations i on i.id = l.installation_id
    join public.handovers h on h.id = l.handover_id
   where i.provider = p_provider and i.external_account_id = p_external_account_id and i.status = 'active'
     and l.external_channel_id = p_external_channel_id and l.state = 'capturing' and h.deleted_at is null
$$;

create function public.connector_capturing_links_for_provider(p_provider text, p_limit int)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(x.j), '[]'::jsonb) from (
    select public._connector_link_json(l) as j
      from public.connector_channel_links l
      join public.connector_installations i on i.id = l.installation_id
      join public.handovers h on h.id = l.handover_id
     where i.provider = p_provider and i.status = 'active' and l.state = 'capturing' and h.deleted_at is null
     order by l.last_event_at nulls first, l.created_at
     limit least(greatest(p_limit, 1), 200)
  ) x
$$;

-- ── 6. buffer and flush ──────────────────────────────────────────────────────

create function public.connector_buffer_messages(p_link_id uuid, p_messages jsonb)
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
  v_is_new boolean;
  v_count int;
begin
  if v_l.state <> 'capturing'
     or not exists (select 1 from public.connector_installations i where i.id = v_l.installation_id and i.status = 'active')
     or exists (select 1 from public.handovers h where h.id = v_l.handover_id and h.deleted_at is not null) then
    return jsonb_build_object('inserted', 0, 'updated', 0, 'refused', true);
  end if;
  if jsonb_typeof(p_messages) <> 'array' or jsonb_array_length(p_messages) > 100 then
    raise exception 'invalid messages' using errcode = 'BTVF0';
  end if;
  select count(*) into v_count from public.connector_buffered_messages where link_id = v_l.id;
  for v_m in select * from jsonb_array_elements(p_messages) loop
    if v_count >= 20000 and not exists (
      select 1 from public.connector_buffered_messages where link_id = v_l.id and provider_message_id = v_m->>'provider_message_id'
    ) then
      raise exception 'too many messages are waiting for this channel' using errcode = 'BTPF0';
    end if;
    insert into public.connector_buffered_messages (link_id, provider_message_id, sent_at, author_label, kind, body, reply_to_id, edited_at)
    values (v_l.id, v_m->>'provider_message_id', (v_m->>'sent_at')::timestamptz, coalesce(v_m->>'author_label', ''),
            v_m->>'kind', coalesce(v_m->>'text', ''), v_m->>'reply_to_id', (v_m->>'edited_at')::timestamptz)
    on conflict (link_id, provider_message_id) do update
      set sent_at = excluded.sent_at, author_label = excluded.author_label, kind = excluded.kind, body = excluded.body,
          reply_to_id = excluded.reply_to_id, edited_at = excluded.edited_at
    returning (xmax = 0) into v_is_new;
    if v_is_new then v_inserted := v_inserted + 1; v_count := v_count + 1; else v_updated := v_updated + 1; end if;
  end loop;
  update public.connector_channel_links set last_event_at = now() where id = v_l.id;
  return jsonb_build_object('inserted', v_inserted, 'updated', v_updated, 'refused', false);
end $$;

create function public.connector_links_due_for_flush(p_limit int)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(x.id), '[]'::jsonb) from (
    select l.id
      from public.connector_channel_links l
      join public.handovers h on h.id = l.handover_id
     where l.state in ('capturing', 'paused') and l.consented_by_profile_id is not null and h.deleted_at is null
       and exists (select 1 from public.connector_buffered_messages b where b.link_id = l.id)
     order by (select min(b.created_at) from public.connector_buffered_messages b where b.link_id = l.id)
     limit least(greatest(p_limit, 1), 200)
  ) x
$$;

-- The next batch of a link, oldest first, with the CURRENT version of the link's source lineage (a version activated
-- since the last flush supersedes the id stored on the link) and the consenting creator the flush acts as.
-- Takes the link's flush lease when there is something to flush; null while another flush holds it.
create function public.connector_take_flush_batch(p_link_id uuid, p_limit int)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_l public.connector_channel_links;
  v_source uuid;
  v_messages jsonb;
begin
  select * into v_l from public.connector_channel_links where id = p_link_id for update;
  if not found or v_l.state = 'revoked' or v_l.consented_by_profile_id is null then return null; end if;
  if v_l.flush_lease_until is not null and v_l.flush_lease_until > now() then return null; end if;
  if v_l.source_id is not null then
    select coalesce(
      (select c.id from public.sources s join public.sources c on c.lineage_id = s.lineage_id
        where s.id = v_l.source_id and c.version_number is not null and c.superseded_at is null and c.deleted_at is null
        limit 1),
      v_l.source_id) into v_source;
  end if;
  v_messages := coalesce((
      select jsonb_agg(jsonb_build_object('buffer_id', b.id, 'provider_message_id', b.provider_message_id, 'sent_at', b.sent_at,
                                          'author_label', b.author_label, 'kind', b.kind, 'text', b.body,
                                          'reply_to_id', b.reply_to_id, 'edited_at', b.edited_at) order by b.sent_at, b.created_at)
        from (select * from public.connector_buffered_messages where link_id = v_l.id
               order by sent_at, created_at limit least(greatest(p_limit, 1), 5000)) b), '[]'::jsonb);
  if jsonb_array_length(v_messages) > 0 then
    update public.connector_channel_links set flush_lease_until = now() + interval '2 minutes' where id = v_l.id;
  end if;
  return jsonb_build_object(
    'handover_id', v_l.handover_id, 'actor_profile_id', v_l.consented_by_profile_id, 'source_id', v_source,
    'channel_label', v_l.channel_label,
    'provider', (select i.provider from public.connector_installations i where i.id = v_l.installation_id),
    'messages', v_messages);
end $$;

create function public.connector_complete_flush(p_link_id uuid, p_buffer_ids uuid[], p_source_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_l public.connector_channel_links := public._connector_lock_link(p_link_id);
  v_n int;
begin
  if v_l.state = 'revoked' then
    -- disconnected while the flush ran: the buffer is already gone; never point a revoked link at a source
    raise exception 'connection not found' using errcode = 'BTNF0';
  end if;
  if not exists (select 1 from public.sources s where s.id = p_source_id and s.handover_id = v_l.handover_id and s.kind = 'chat_import') then
    raise exception 'source not found' using errcode = 'BTNF0';
  end if;
  delete from public.connector_buffered_messages where link_id = v_l.id and id = any (p_buffer_ids);
  get diagnostics v_n = row_count;
  update public.connector_channel_links
     set source_id = p_source_id, last_flush_at = now(), last_flush_error = null, flush_lease_until = null
   where id = v_l.id;
  perform public._audit(v_l.handover_id, null, null, 'connector.flushed', 'connector_link', v_l.id, null,
                        jsonb_build_object('sourceId', p_source_id, 'messages', v_n));
end $$;

create function public.connector_record_flush_error(p_link_id uuid, p_code text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.connector_channel_links set last_flush_error = p_code, flush_lease_until = null where id = p_link_id;
  if not found then
    raise exception 'connection not found' using errcode = 'BTNF0';
  end if;
end $$;

create function public.connector_set_pull_cursor(p_link_id uuid, p_cursor text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_cursor is null or char_length(p_cursor) not between 1 and 200 then
    raise exception 'invalid cursor' using errcode = 'BTVF0';
  end if;
  update public.connector_channel_links set pull_cursor = p_cursor where id = p_link_id and state <> 'revoked';
  if not found then
    raise exception 'connection not found' using errcode = 'BTNF0';
  end if;
end $$;

-- The profile a flush of this link acts as (lib/db/actor.ts getConnectorFlushActor): the creator who consented, only
-- while the link is live, its installation active, the handover live, and that profile still the creator.
create function public.connector_flush_actor(p_link_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select l.consented_by_profile_id
    from public.connector_channel_links l
    join public.connector_installations i on i.id = l.installation_id
    join public.handovers h on h.id = l.handover_id
    join public.profiles p on p.id = l.consented_by_profile_id
   where l.id = p_link_id and l.state in ('capturing', 'paused') and i.status = 'active'
     and h.deleted_at is null and p.deleted_at is null
     and public._is_creator_of(l.handover_id, l.consented_by_profile_id)
$$;

-- Handovers the actor created that can take a connected channel's source (draft or in review), for /connect.
create function public.connector_creator_handovers(p_actor_profile_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid := public._require_actor(p_actor_profile_id);
begin
  return (select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'title', x.title)), '[]'::jsonb) from (
    select h.id, h.title from public.handovers h
     where h.deleted_at is null and h.state in ('draft', 'in_review') and public._is_creator_of(h.id, v_actor)
     order by h.updated_at desc limit 50) x);
end $$;

-- ── 7. grants: service role only ─────────────────────────────────────────────

revoke all on public.connector_installations, public.connector_channel_links, public.connector_events,
  public.connector_buffered_messages from public, anon, authenticated, service_role;

revoke execute on function
  public._connector_actor(text, uuid),
  public._connector_installation_json(public.connector_installations),
  public._connector_link_json(public.connector_channel_links),
  public._connector_lock_link(uuid),
  public._connector_require_creator(uuid, uuid),
  public._connector_revoke_link_row(uuid, uuid, text, text),
  public.connector_record_event(text, text, text, text),
  public.connector_finish_event(uuid, text, text),
  public.connector_prune_events(int),
  public.connector_upsert_installation(text, uuid, text, text, text, text[], text),
  public.connector_find_installation(text, text),
  public.connector_get_installation(uuid),
  public.connector_installation_credentials(uuid),
  public.connector_set_installation_status(text, uuid, uuid, text, text),
  public.connector_revoke_installation(text, uuid, uuid, text),
  public.connector_list_installations_for_profile(uuid),
  public.connector_link_channel(text, uuid, uuid, uuid, text, text, jsonb),
  public.connector_record_capture_consent(text, uuid, uuid, text),
  public.connector_set_link_state(text, uuid, uuid, text),
  public.connector_revoke_link(text, uuid, uuid, text),
  public.connector_update_link_settings(text, uuid, uuid, jsonb),
  public.connector_get_link(uuid),
  public.connector_list_links_for_handover(text, uuid, uuid),
  public.connector_capturing_links(text, text, text),
  public.connector_capturing_links_for_provider(text, int),
  public.connector_buffer_messages(uuid, jsonb),
  public.connector_links_due_for_flush(int),
  public.connector_take_flush_batch(uuid, int),
  public.connector_complete_flush(uuid, uuid[], uuid),
  public.connector_record_flush_error(uuid, text),
  public.connector_set_pull_cursor(uuid, text),
  public.connector_flush_actor(uuid),
  public.connector_creator_handovers(uuid)
  from public, anon, authenticated, service_role;

grant execute on function
  public.connector_record_event(text, text, text, text),
  public.connector_finish_event(uuid, text, text),
  public.connector_prune_events(int),
  public.connector_upsert_installation(text, uuid, text, text, text, text[], text),
  public.connector_find_installation(text, text),
  public.connector_get_installation(uuid),
  public.connector_installation_credentials(uuid),
  public.connector_set_installation_status(text, uuid, uuid, text, text),
  public.connector_revoke_installation(text, uuid, uuid, text),
  public.connector_list_installations_for_profile(uuid),
  public.connector_link_channel(text, uuid, uuid, uuid, text, text, jsonb),
  public.connector_record_capture_consent(text, uuid, uuid, text),
  public.connector_set_link_state(text, uuid, uuid, text),
  public.connector_revoke_link(text, uuid, uuid, text),
  public.connector_update_link_settings(text, uuid, uuid, jsonb),
  public.connector_get_link(uuid),
  public.connector_list_links_for_handover(text, uuid, uuid),
  public.connector_capturing_links(text, text, text),
  public.connector_capturing_links_for_provider(text, int),
  public.connector_buffer_messages(uuid, jsonb),
  public.connector_links_due_for_flush(int),
  public.connector_take_flush_batch(uuid, int),
  public.connector_complete_flush(uuid, uuid[], uuid),
  public.connector_record_flush_error(uuid, text),
  public.connector_set_pull_cursor(uuid, text),
  public.connector_flush_actor(uuid),
  public.connector_creator_handovers(uuid)
  to service_role;
