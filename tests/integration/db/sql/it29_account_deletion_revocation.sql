-- IT-29: account deletion clears every secret and ends every session (audit 3.9a, S7, F17; migration
-- 20261121100500_account_deletion_revocation.sql). Extends IT-19 with the assertions it did not make.
--
-- Part A (structural): revoke_deleted_account_sessions is executable by service_role only; D27 stays closed
--   (purge_handover and erase_participant are executable by no API role).
-- Part B: delete_own_account clears, for the deleted account: the identity vault rows (handover_people) and the raw
--   retention items of the purged handovers, the sealed connector credentials, every channel link and every buffered
--   message of the installations the person connected. Another person's installation is untouched.
-- Part C: revoke_deleted_account_sessions ends every session and refresh token of the deleted account only; it
--   refuses a live account; it is idempotent; it audits counts only; it is a no-op where the auth tables are absent.
\set ON_ERROR_STOP 1

-- ── Part A ───────────────────────────────────────────────────────────────────
select tests.eq((select array_agg(r order by r) from unnest(array['anon', 'authenticated', 'service_role', 'public']) r
                  where has_function_privilege(r, 'public.revoke_deleted_account_sessions(uuid)', 'EXECUTE')),
                array['service_role'], 'revoke_deleted_account_sessions: service_role only');
select tests.eq((select array_agg(f || ':' || r order by f, r)
                   from unnest(array['public.purge_handover(uuid,uuid,uuid)', 'public.erase_participant(uuid,uuid,text,bytea,text,uuid,uuid)']) f,
                        unnest(array['anon', 'authenticated', 'service_role', 'public']) r
                  where has_function_privilege(r, f::regprocedure, 'EXECUTE')),
                null::text[], 'D27: purge_handover and erase_participant stay closed to every API role');

-- ── fixtures ─────────────────────────────────────────────────────────────────
select tests.user(u) from unnest(array['ann', 'bob']) u;
select tests.handover('h1', 'ann', 'outgoing');
select tests.source('h1', 's1');
select tests.handover('hb', 'bob', 'outgoing');
select tests.source('hb', 'sb');

-- Probes (service_role has no table grants; the owner reads the tables directly).
create function tests.buf_count_for(p_link uuid) returns int language sql security definer as
  $$ select count(*)::int from public.connector_buffered_messages where link_id = p_link $$;

-- The identity vault and raw retention rows of both handovers (synthetic bytes, no real label).
insert into public.handover_people (handover_id, ordinal, person_key, sealed_label, key_version) values
  (tests.id('h1'), 1, decode(repeat('a1', 32), 'hex'), decode(repeat('c1', 40), 'hex'), 'k1'),
  (tests.id('h1'), 2, decode(repeat('a2', 32), 'hex'), decode(repeat('c2', 40), 'hex'), 'k1'),
  (tests.id('hb'), 1, decode(repeat('b1', 32), 'hex'), decode(repeat('d1', 40), 'hex'), 'k1');
insert into public.raw_retention_items (source_id, handover_id, object_path, reason) values
  (tests.id('s1'), tests.id('h1'), 'raw/' || tests.id('h1') || '/' || tests.id('s1'), 'parsed_raw_pending'),
  (tests.id('sb'), tests.id('hb'), 'raw/' || tests.id('hb') || '/' || tests.id('sb'), 'parsed_raw_pending');

-- Connectors: ann's Slack installation (credentials envelope) linked to her handover, with buffered messages; bob's
-- Telegram installation linked to his handover.
do $$
declare
  v_inst uuid;
  v_link uuid;
  v jsonb;
begin
  perform tests.as_service();
  v_inst := (public.connector_upsert_installation('user', tests.id('ann'), 'slack', 'T1', 'Synthetic', array['channels:history'], 'c1.iv.tag.ct') ->> 'id')::uuid;
  v_link := (public.connector_link_channel('user', tests.id('ann'), v_inst, tests.id('h1'), 'C1', '#core', '{}') ->> 'id')::uuid;
  perform public.connector_record_capture_consent('user', tests.id('ann'), v_link, 'connector-capture-v1');
  v := public.connector_buffer_messages(v_link, '[{"provider_message_id":"1","sent_at":"2099-11-19T09:00:00Z","author_label":"Asha","kind":"text","text":"hi"},
                                                  {"provider_message_id":"2","sent_at":"2099-11-19T09:01:00Z","author_label":"Ravi","kind":"text","text":"yo"}]');
  perform tests.eq(v ->> 'inserted', '2', 'fixture: two messages buffered for ann''s link');
  perform tests.put('inst_ann', v_inst);
  perform tests.put('link_ann', v_link);

  v_inst := (public.connector_upsert_installation('user', tests.id('bob'), 'telegram', '-1001', 'Bob group', '{}', null) ->> 'id')::uuid;
  v_link := (public.connector_link_channel('user', tests.id('bob'), v_inst, tests.id('hb'), '-1001', 'Bob group', '{}') ->> 'id')::uuid;
  perform public.connector_record_capture_consent('user', tests.id('bob'), v_link, 'connector-capture-v1');
  v := public.connector_buffer_messages(v_link, '[{"provider_message_id":"9","sent_at":"2099-11-19T09:00:00Z","author_label":"Asha","kind":"text","text":"keep"}]');
  perform tests.eq(v ->> 'inserted', '1', 'fixture: one message buffered for bob''s link');
  perform tests.put('inst_bob', v_inst);
  perform tests.put('link_bob', v_link);
  perform tests.as_owner();
end $$;

-- Supabase's session tables, as on the Auth server (user_id is varchar in refresh_tokens and uuid in sessions).
create table auth.sessions (id uuid primary key default gen_random_uuid(), user_id uuid not null, created_at timestamptz default now());
create table auth.refresh_tokens (id bigserial primary key, token varchar(255), user_id varchar(255),
                                  session_id uuid references auth.sessions (id) on delete cascade, revoked boolean default false);
do $$
declare
  s uuid;
  who text;
begin
  foreach who in array array['ann', 'ann', 'bob'] loop
    insert into auth.sessions (user_id) values (tests.id(who)) returning id into s;
    insert into auth.refresh_tokens (token, user_id, session_id) values ('synthetic-' || left(md5(random()::text), 12), tests.id(who)::text, s);
  end loop;
  -- a legacy refresh token of ann's without a session row
  insert into auth.refresh_tokens (token, user_id, session_id) values ('synthetic-legacy', tests.id('ann')::text, null);
end $$;

-- ── Part C (before deletion): a live account can never be signed out through this function ─────────────────
select tests.as_service();
select tests.eq(tests.try(format('select public.revoke_deleted_account_sessions(%L)::text', tests.id('ann'))), 'ERR:BTPF0',
                'a live account is refused');
select tests.eq(tests.try('select public.revoke_deleted_account_sessions(null)::text'), 'ERR:BTPF0', 'no profile is refused');
select tests.as_owner();
select tests.eq((select count(*)::int from auth.sessions where user_id = tests.id('ann')), 2, 'ann''s sessions untouched by the refusal');

-- ── Part B: the deletion ─────────────────────────────────────────────────────
select tests.as_user('ann');
select tests.kv_put('result', public.delete_own_account(tests.id('ann'), 'DELETE', array[tests.id('h1')]));
select tests.as_owner();
select tests.eq((tests.kv('result') ->> 'purgedHandovers')::int, 1, 'ann''s handover purged');

select tests.eq((select count(*)::int from public.handover_people where handover_id = tests.id('h1')), 0, 'vault rows of the purged handover are gone');
select tests.eq((select count(*)::int from public.raw_retention_items where handover_id = tests.id('h1')), 0, 'raw retention items of the purged handover are gone');
select tests.ok((select status = 'revoked' and credentials is null and revoked_at is not null
                   from public.connector_installations where id = tests.id('inst_ann')),
                'ann''s installation is revoked and its sealed credentials are deleted');
select tests.eq((select count(*)::int from public.connector_installations where installed_by_profile_id = tests.id('ann') and credentials is not null), 0,
                'no credentials of ann remain anywhere');
select tests.eq((select count(*)::int from public.connector_channel_links l join public.connector_installations i on i.id = l.installation_id
                  where i.installed_by_profile_id = tests.id('ann') and l.state <> 'revoked'), 0, 'every link of ann''s installations is revoked');
select tests.eq(tests.buf_count_for(tests.id('link_ann')), 0, 'buffered messages of ann''s link are deleted');
select tests.ok(exists (select 1 from public.audit_logs where action = 'connector.installation_revoked' and entity_id = tests.id('inst_ann')),
                'the local revocation is audited');

select tests.eq((select count(*)::int from public.handover_people where handover_id = tests.id('hb')), 1, 'bob''s vault rows survive');
select tests.eq((select count(*)::int from public.raw_retention_items where handover_id = tests.id('hb')), 1, 'bob''s retention item survives');
select tests.ok((select status = 'active' and credentials is null from public.connector_installations where id = tests.id('inst_bob')),
                'bob''s installation is untouched');
select tests.eq(tests.buf_count_for(tests.id('link_bob')), 1, 'bob''s buffered message survives');

-- ── Part C: every session of the deleted account ends ────────────────────────
select tests.as_service();
select tests.kv_put('sessions', public.revoke_deleted_account_sessions(tests.id('ann')));
select tests.as_owner();
select tests.eq((tests.kv('sessions') ->> 'sessions')::int, 2, 'both of ann''s sessions ended');
select tests.eq((tests.kv('sessions') ->> 'refreshTokens')::int, 3, 'all three of ann''s refresh tokens deleted (including the legacy one)');
select tests.eq((select count(*)::int from auth.sessions where user_id = tests.id('ann')), 0, 'no session of ann remains');
select tests.eq((select count(*)::int from auth.refresh_tokens where user_id = tests.id('ann')::text), 0, 'no refresh token of ann remains');
select tests.eq((select count(*)::int from auth.sessions where user_id = tests.id('bob')), 1, 'bob stays signed in');
select tests.eq((select count(*)::int from auth.refresh_tokens where user_id = tests.id('bob')::text), 1, 'bob''s refresh token survives');
select tests.ok((select after = '{"sessions": 2, "refreshTokens": 3}'::jsonb from public.audit_logs
                  where action = 'account.sessions_revoked' and entity_id = tests.id('ann')),
                'audited with counts only');
select tests.ok(not exists (select 1 from public.audit_logs where action = 'account.sessions_revoked' and after::text ~ '(synthetic|@example)'),
                'the audit row holds no token or email');

select tests.as_service();
select tests.kv_put('again', public.revoke_deleted_account_sessions(tests.id('ann')));
select tests.as_owner();
select tests.eq(tests.kv('again'), '{"sessions": 0, "refreshTokens": 0}'::jsonb, 'idempotent: a retry finds nothing left');

drop table auth.refresh_tokens;
drop table auth.sessions;
select tests.as_service();
select tests.kv_put('absent', public.revoke_deleted_account_sessions(tests.id('ann')));
select tests.as_owner();
select tests.eq(tests.kv('absent'), '{"sessions": 0, "refreshTokens": 0}'::jsonb, 'without the auth session tables it is a safe no-op');
