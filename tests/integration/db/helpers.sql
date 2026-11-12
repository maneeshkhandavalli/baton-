-- Integration acceptance helpers (schema "it"). LOCAL TESTS ONLY: applied by tests/integration/db/run.sh
-- after supabase/tests/shim/10_test_helpers.sql, never to a Supabase project.

create schema if not exists it;
grant usage on schema it to anon, authenticated, service_role;

-- A finding that is still open on feature/main-integration: report it instead of failing the file.
-- When the condition starts to hold, say so, so the check can become a hard assertion.
create function it.todo(p_holds boolean, p_finding text, p_msg text) returns void language plpgsql as $$
begin
  if p_holds is distinct from true then
    raise notice 'TODO(open %): %', p_finding, p_msg;
  else
    raise notice 'NOW HOLDS % (make it a hard assertion): %', p_finding, p_msg;
  end if;
end $$;

-- §8.5: an id the caller may not see must fail exactly like an id that does not exist. p_fmt contains one
-- %L for the id; it runs once with p_real and once with a random uuid, and both must fail with p_state.
create function it.hidden_like_missing(p_fmt text, p_real uuid, p_state text, p_msg text) returns void
language plpgsql as $$
declare
  v_real text := tests.try(format(p_fmt, p_real));
  v_fake text := tests.try(format(p_fmt, gen_random_uuid()));
begin
  if v_real is distinct from 'ERR:' || p_state or v_fake is distinct from 'ERR:' || p_state then
    raise exception 'ASSERTION FAILED: % (expected ERR:% for both, got real=% random=%)', p_msg, p_state, v_real, v_fake;
  end if;
end $$;

-- The same for reads: both the real id and a random id must give the same (normally NULL) result.
create function it.read_like_missing(p_fmt text, p_real uuid, p_msg text) returns void language plpgsql as $$
declare
  v_real jsonb := tests.read(format(p_fmt, p_real));
  v_fake jsonb := tests.read(format(p_fmt, gen_random_uuid()));
begin
  if v_real is distinct from v_fake then
    raise exception 'ASSERTION FAILED: % (real=% random=%)', p_msg, v_real, v_fake;
  end if;
end $$;

-- Asserts that p_sql fails (any SQLSTATE starting with p_prefix) and returns the full SQLSTATE.
create function it.fails(p_sql text, p_prefix text, p_msg text) returns text language plpgsql as $$
declare
  v text := tests.try(p_sql);
begin
  if v not like 'ERR:' || p_prefix || '%' then
    raise exception 'ASSERTION FAILED: % (expected failure %, got %)', p_msg, p_prefix, v;
  end if;
  return substr(v, 5);
end $$;

-- A raw (uploaded, not yet parsed) source with consent for the fake provider and a raw object path.
create function it.raw_source(p_handover text, p_name text, p_access text default 'everyone', p_state text default 'uploaded',
                              p_consent boolean default true) returns uuid
language plpgsql as $$
declare
  v_h uuid := tests.id(p_handover);
  v uuid := gen_random_uuid();
  v_creator uuid;
begin
  select created_by into v_creator from public.handovers where id = v_h;
  insert into public.sources (id, handover_id, uploaded_by, kind, title, original_filename, mime_type, size_bytes, sha256, state,
                              access_level, timezone, raw_storage_path, consent_statement_version, consent_ai_provider,
                              consent_recorded_at, consent_recorded_by)
  values (v, v_h, v_creator, 'whatsapp_export', 'Raw ' || p_name, p_name || '.txt', 'text/plain', 1000,
          sha256(convert_to('raw:' || p_handover || p_name, 'UTF8')), p_state, p_access, 'Asia/Kolkata',
          'raw/' || v_h || '/' || v,
          case when p_consent then 'v1' end, case when p_consent then 'fake' end,
          case when p_consent then now() end, case when p_consent then v_creator end);
  return tests.put(p_name, v);
end $$;

-- A minimal ParsedSource (§11.4) with one participant of the given identity and one message.
create function it.parsed(p_kind text, p_hash_hex text, p_body text default 'A synthetic kept message body') returns jsonb
language sql immutable as $$
  select jsonb_build_object(
    'kind', 'whatsapp_export', 'parserVersion', 'it-1',
    'parseContext', jsonb_build_object('timezone', 'Asia/Kolkata', 'dateOrder', 'dmy', 'parserVersion', 'it-1'),
    'participants', jsonb_build_array(jsonb_build_object('localId', 'p_1', 'displayLabel', 'Participant 1',
        'identityKind', p_kind, 'identityHash', p_hash_hex, 'identityPepperVersion', 'p1', 'messageCount', 1)),
    'conversations', jsonb_build_array(jsonb_build_object('localId', 'c_1', 'startedAt', '2026-07-01T10:00:00Z',
        'endedAt', '2026-07-01T10:00:00Z', 'messageCount', 1, 'participantLocalIds', jsonb_build_array('p_1'), 'preview', 'x')),
    'messages', jsonb_build_array(jsonb_build_object('seq', 0, 'conversationLocalId', 'c_1', 'participantLocalId', 'p_1',
        'sentAt', '2026-07-01T10:00:00Z', 'kind', 'text', 'body', p_body, 'location', null)),
    'masking', jsonb_build_object('counts', '{}'::jsonb), 'stats', '{}'::jsonb,
    'identityMatches', '[]'::jsonb, 'firstMessageAt', '2026-07-01T10:00:00Z', 'lastMessageAt', '2026-07-01T10:00:00Z',
    'warnings', '[]'::jsonb)
$$;

-- ── Round 3 (QA): rolled-back permission probes (it15+) ──────────────────────

-- Runs p_sql as the server acting for p_who, ALWAYS rolls it back, and returns 'OK' or 'ERR:<sqlstate>'.
create function it.gate_as(p_who text, p_sql text) returns text language plpgsql as $$
declare
  s text;
begin
  perform tests.as_user(p_who);
  begin
    execute p_sql;
    raise exception 'it.gate_as rollback' using errcode = 'QAOK0';
  exception when others then
    get stacked diagnostics s = returned_sqlstate;
  end;
  perform tests.as_owner();
  return case when s = 'QAOK0' then 'OK' else 'ERR:' || s end;
end $$;

-- The same through the browser role (authenticated, RLS applies), for Storage policies.
create function it.gate_reader(p_who text, p_sql text) returns text language plpgsql as $$
declare
  s text;
begin
  perform tests.as_reader(p_who);
  begin
    execute p_sql;
    raise exception 'it.gate_reader rollback' using errcode = 'QAOK0';
  exception when others then
    get stacked diagnostics s = returned_sqlstate;
  end;
  perform tests.as_owner();
  return case when s = 'QAOK0' then 'OK' else 'ERR:' || s end;
end $$;

-- NULL when the outcome matches the expectation, otherwise a one-line failure description.
-- p_mode: 'ok' = allowed personas must succeed; 'gate' = allowed personas must not be refused for
-- permission (state errors such as BTIT0/BTPF0/BTCF0 are acceptable there).
create function it.judge(p_label text, p_who text, p_result text, p_allowed text[], p_mode text) returns text
language plpgsql as $$
begin
  if p_who = any (p_allowed) then
    if p_mode = 'ok' and p_result <> 'OK' then
      return format('%s: %s should succeed, got %s', p_label, p_who, p_result);
    end if;
    if p_result in ('ERR:BTNF0', 'ERR:BTFB0', 'ERR:BTUA0', 'ERR:42501') then
      return format('%s: %s should pass the permission gate, got %s', p_label, p_who, p_result);
    end if;
    return null;
  end if;
  if p_who = 'eve' then
    return case when p_result = 'ERR:BTNF0' then null
                else format('%s: non-member must get not_found (BTNF0, §8.5), got %s', p_label, p_result) end;
  end if;
  return case when p_result in ('ERR:BTNF0', 'ERR:BTFB0') then null
              else format('%s: %s must be refused (BTFB0/BTNF0), got %s', p_label, p_who, p_result) end;
end $$;

grant execute on all functions in schema it to anon, authenticated, service_role;
