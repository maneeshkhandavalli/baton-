-- LOCAL TEST HELPERS ONLY (schema "tests"). Never applied to a Supabase project.
-- Role switching mirrors what PostgREST does per request: SET ROLE + request.jwt.claims.

create schema if not exists tests;
grant usage on schema tests to anon, authenticated, service_role;

create table tests.ids (name text primary key, id uuid not null);
grant all on tests.ids to anon, authenticated, service_role;

create function tests.put(p_name text, p_id uuid) returns uuid language sql as $$
  insert into tests.ids values (p_name, p_id) on conflict (name) do update set id = excluded.id returning id
$$;
create function tests.id(p_name text) returns uuid language plpgsql volatile as $$
declare v uuid;
begin
  select id into v from tests.ids where name = p_name;
  if v is null then raise exception 'tests.id: unknown fixture %', p_name; end if;
  return v;
end $$;

-- "The server acting for user X" (H1): service role, with the user's id as the JWT subject so
-- auth.uid()-based reads behave as that user. Mutations take the actor explicitly: tests.actor().
create function tests.as_user(p_name text) returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub', tests.id(p_name), 'role', 'service_role')::text, false);
  execute 'set role service_role';
end $$;

-- The browser: a real authenticated PostgREST session for user X (RLS applies, no mutation grants).
create function tests.as_reader(p_name text) returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub', tests.id(p_name), 'role', 'authenticated')::text, false);
  execute 'set role authenticated';
end $$;

create function tests.actor() returns uuid language sql volatile as $$ select auth.uid() $$;

create function tests.as_service() returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', '{"role":"service_role"}', false);
  execute 'set role service_role';
end $$;

create function tests.as_anon() returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', '{"role":"anon"}', false);
  execute 'set role anon';
end $$;

create function tests.as_owner() returns void language plpgsql as $$
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', '', false);
end $$;

create function tests.ok(p_cond boolean, p_msg text) returns void language plpgsql as $$
begin
  if p_cond is distinct from true then
    raise exception 'ASSERTION FAILED: %', p_msg;
  end if;
end $$;

create function tests.eq(p_actual anyelement, p_expected anyelement, p_msg text) returns void language plpgsql as $$
begin
  if p_actual is distinct from p_expected then
    raise exception 'ASSERTION FAILED: % (expected %, got %)', p_msg, p_expected, p_actual;
  end if;
end $$;

-- Runs p_sql and asserts it fails with SQLSTATE p_state (prefix match, e.g. '42501' or 'BTNF0').
create function tests.throws(p_sql text, p_state text, p_msg text) returns void language plpgsql as $$
declare
  v_state text;
begin
  begin
    execute p_sql;
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate;
    if v_state like p_state || '%' then return; end if;
    raise exception 'ASSERTION FAILED: % (expected SQLSTATE %, got % %)', p_msg, p_state, v_state, sqlerrm;
  end;
  raise exception 'ASSERTION FAILED: % (expected SQLSTATE %, but it succeeded)', p_msg, p_state;
end $$;

grant execute on all functions in schema tests to anon, authenticated, service_role;

-- ── Fixtures (run as the owner; triggers and guards still apply) ─────────────

create function tests.user(p_name text) returns uuid language plpgsql as $$
declare v uuid;
begin
  insert into auth.users (email, raw_user_meta_data, email_confirmed_at)
  values (p_name || '@example.test', jsonb_build_object('display_name', initcap(p_name)), now())
  returning id into v;
  return tests.put(p_name, v);
end $$;

-- A handover created through create_handover by p_creator (role p_creator_role).
create function tests.handover(p_name text, p_creator text, p_creator_role text default 'outgoing') returns uuid
language plpgsql as $$
declare v uuid;
begin
  perform tests.as_user(p_creator);
  v := public.create_handover(tests.actor(), 'Handover ' || p_name, 'Team ' || p_name, 'Treasurer', null, p_creator_role);
  perform tests.as_owner();
  return tests.put(p_name, v);
end $$;

create function tests.member(p_handover text, p_user text, p_role text, p_clearance text default null) returns uuid
language plpgsql as $$
declare v uuid;
begin
  insert into public.handover_members (handover_id, profile_id, role, clearance, ack_required)
  values (tests.id(p_handover), tests.id(p_user), p_role,
          coalesce(p_clearance, case p_role when 'lead' then 'leads_only' when 'incoming' then 'everyone' else 'reviewer_only' end),
          p_role = 'incoming')
  returning id into v;
  return tests.put(p_handover || '/' || p_user, v);
end $$;

create function tests.set_state(p_handover text, p_state text) returns void language plpgsql as $$
begin
  perform set_config('baton.transition', 'on', true);
  update public.handovers set state = p_state where id = tests.id(p_handover);
  perform set_config('baton.transition', 'off', true);
end $$;

-- A parsed source with participants alice/bob/carol (identity hashes sha256('alice') …) and messages.
create function tests.source(p_handover text, p_name text, p_access text default 'everyone', p_identity_kind text default 'phone') returns uuid
language plpgsql as $$
declare
  v_h uuid := tests.id(p_handover);
  v uuid;
  v_creator uuid;
  p record;
  i int := 0;
begin
  select created_by into v_creator from public.handovers where id = v_h;
  insert into public.sources (handover_id, uploaded_by, kind, title, original_filename, mime_type, size_bytes, sha256, state,
                              access_level, timezone, consent_statement_version, consent_ai_provider, consent_recorded_at,
                              consent_recorded_by)
  values (v_h, v_creator, 'whatsapp_export', 'Chat ' || p_name, p_name || '.txt', 'text/plain', 1000,
          sha256(convert_to(p_handover || p_name, 'UTF8')), 'parsed', p_access, 'Asia/Kolkata', 'v1', 'fake', now(), v_creator)
  returning id into v;
  perform tests.put(p_name, v);
  for p in select unnest(array['alice', 'bob', 'carol']) as who loop
    -- synthetic identities: 'phone' by default (handover-wide); p_identity_kind 'name' for D29 tests
    insert into public.source_participants (handover_id, source_id, local_id, display_label, identity_kind, identity_hash, identity_pepper_version, message_count)
    values (v_h, v, 'p_' || p.who, initcap(p.who), p_identity_kind, sha256(convert_to(p.who, 'UTF8')), 'p1', 3);
  end loop;
  -- three messages per participant, dated 2026-06-0X
  insert into public.source_messages (handover_id, source_id, participant_id, seq, sent_at, kind, body, body_sha256)
  select v_h, v, sp.id, row_number() over (order by sp.local_id, g) - 1,
         timestamptz '2026-06-01' + make_interval(days => g) , 'text',
         initcap(substr(sp.local_id, 3)) || ' message ' || g || ' about the bank account handover',
         sha256(convert_to(sp.local_id || g, 'UTF8'))
    from public.source_participants sp cross join generate_series(1, 3) g
   where sp.source_id = v;
  return v;
end $$;

-- A message id by author and number within a source (author in alice|bob|carol, n in 1..3).
create function tests.msg(p_source text, p_author text, p_n int) returns uuid language sql volatile as $$
  select m.id from public.source_messages m join public.source_participants sp on sp.id = m.participant_id
   where m.source_id = tests.id(p_source) and sp.local_id = 'p_' || p_author and m.body like '% message ' || p_n || ' %'
$$;

-- An extracted point (revision 1, system author).
create function tests.point(p_handover text, p_name text, p_category text default 'decision') returns uuid
language plpgsql as $$
declare
  v_h uuid := tests.id(p_handover);
  v uuid;
  r uuid;
begin
  insert into public.handover_points (handover_id, category, origin, extraction_access_level, sort_key)
  values (v_h, p_category, 'extracted', 'everyone', (select count(*) from public.handover_points where handover_id = v_h))
  returning id into v;
  insert into public.point_revisions (handover_id, point_id, revision_number, title, statement, attributes, author_kind, ai_provenance)
  values (v_h, v, 1, 'Title of ' || p_name, 'Statement of ' || p_name,
          case p_category when 'owner' then '{"responsibility":"Bank"}' when 'contact' then '{"nameLabel":"Asha"}' else '{}' end::jsonb,
          'system', '{"provider":"fake"}')
  returning id into r;
  update public.handover_points set current_revision_id = r where id = v;
  return tests.put(p_name, v);
end $$;

-- Attach a source quote from message (source, author, n) to a point, verified with p_verdict for the
-- point's CURRENT revision (unless p_verdict = 'unchecked').
create function tests.cite(p_point text, p_source text, p_author text, p_n int, p_verdict text default 'supports',
                           p_check text default 'exact', p_name text default null) returns uuid
language plpgsql as $$
declare
  v_link uuid;
  v_rev uuid;
  v_quote uuid;
begin
  -- Built directly (as add_source_quote_evidence would), because that worker function now requires an
  -- active processing run (N3) and fixtures attach evidence in any state.
  select q.id into v_quote from public.evidence_quotes q
   where q.source_message_id = tests.msg(p_source, p_author, p_n) and q.quote_start = 0 and q.quote_end = 10;
  if v_quote is null then
    insert into public.evidence_quotes (handover_id, kind, source_id, source_message_id, quote_text, quote_start, quote_end,
                                        message_sent_at, author_label, author_identity_kind, author_identity_hash,
                                        author_identity_pepper_version, source_title, location, quote_check, access_level)
    select m.handover_id, 'source_quote', m.source_id, m.id, p_author || ' message ' || p_n, 0, 10, m.sent_at,
           sp.display_label, sp.identity_kind, sp.identity_hash, sp.identity_pepper_version, s.title, m.location, p_check,
           s.access_level
      from public.source_messages m join public.sources s on s.id = m.source_id
      left join public.source_participants sp on sp.id = m.participant_id
     where m.id = tests.msg(p_source, p_author, p_n)
    returning id into v_quote;
  end if;
  insert into public.point_evidence (handover_id, point_id, evidence_id)
  select handover_id, id, v_quote from public.handover_points where id = tests.id(p_point)
  returning id into v_link;
  select current_revision_id into v_rev from public.handover_points where id = tests.id(p_point);
  if p_verdict <> 'unchecked' then
    update public.point_evidence
       set support_verdict = p_verdict, verified_revision_id = v_rev, verifier_provenance = '{"provider":"fake"}', verified_at = now()
     where id = v_link;
  end if;
  return tests.put(coalesce(p_name, p_point || '/' || p_author || p_n), v_link);
end $$;

create function tests.approve_all(p_handover text) returns void language plpgsql as $$
begin
  update public.handover_points
     set review_state = 'approved',
         inferred_confirmed_by = case when evidence_status = 'inferred' then created_by_fix.c end,
         inferred_confirmed_at = case when evidence_status = 'inferred' then now() end,
         approved_as_known_gap = evidence_status = 'missing'
    from (select created_by as c from public.handovers where id = tests.id(p_handover)) created_by_fix
   where handover_id = tests.id(p_handover) and erased_at is null and review_state = 'pending'
     and privacy_review <> 'required';
end $$;

grant execute on all functions in schema tests to anon, authenticated, service_role;

-- ── Concurrency helpers: real extra sessions through dblink ──────────────────

create table tests.kv (name text primary key, val jsonb not null);
grant all on tests.kv to anon, authenticated, service_role;
create function tests.kv_put(p_name text, p_val jsonb) returns void language sql as $$
  insert into tests.kv values (p_name, p_val) on conflict (name) do update set val = excluded.val
$$;
create function tests.kv(p_name text) returns jsonb language sql volatile as $$ select val from tests.kv where name = p_name $$;

-- Runs p_sql; returns 'OK:<first column>' or 'ERR:<sqlstate>'.
create function tests.try(p_sql text) returns text language plpgsql as $$
declare
  v text;
  s text;
begin
  execute p_sql into v;
  return 'OK:' || coalesce(v, '');
exception when others then
  get stacked diagnostics s = returned_sqlstate;
  return 'ERR:' || s;
end $$;

-- p_who: 'service', a fixture user name, or null (owner).
create function tests.c_open(p_name text, p_who text default null) returns void language plpgsql as $$
begin
  perform dblink_connect(p_name, format('dbname=%s user=postgres application_name=%s', current_database(), p_name));
  if p_who = 'service' then
    perform 1 from dblink(p_name, 'select tests.as_service()::text') as t (r text);
  elsif p_who is not null then
    perform 1 from dblink(p_name, format('select tests.as_user(%L)::text', p_who)) as t (r text);
  end if;
end $$;

create function tests.c_exec(p_name text, p_sql text) returns void language sql as $$ select dblink_exec(p_name, p_sql) $$;

-- Synchronous call in the session's current transaction.
create function tests.c_try(p_name text, p_sql text) returns text language sql as $$
  select r from dblink(p_name, format('select tests.try(%L)', p_sql)) as t (r text)
$$;

create function tests.c_send(p_name text, p_sql text) returns void language sql as $$
  select dblink_send_query(p_name, format('select tests.try(%L)', p_sql))
$$;

-- True once the session is waiting on a lock (polls pg_stat_activity for up to ~5 s).
create function tests.c_blocked(p_name text) returns boolean language plpgsql as $$
begin
  for i in 1..100 loop
    perform pg_stat_clear_snapshot();
    if exists (select 1 from pg_stat_activity where application_name = p_name and wait_event_type = 'Lock') then
      return true;
    end if;
    perform pg_sleep(0.05);
  end loop;
  return false;
end $$;

create function tests.c_result(p_name text) returns text language plpgsql as $$
declare
  v text;
begin
  select r into v from dblink_get_result(p_name) as t (r text);
  perform 1 from dblink_get_result(p_name) as t (r text); -- drain
  return v;
end $$;

create function tests.c_close(p_name text) returns void language sql as $$ select dblink_disconnect(p_name) $$;

grant execute on all functions in schema tests to anon, authenticated, service_role;

-- Run a read through the browser path (authenticated, RLS) as the user the session currently acts for,
-- then restore the caller's role. Reads are never executed by the service role in production.
create function tests.read(p_sql text) returns jsonb language plpgsql as $$
declare
  v jsonb;
  v_claims text := current_setting('request.jwt.claims', true);
  v_role text := current_user;
  v_sub uuid := auth.uid();
begin
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub', v_sub, 'role', 'authenticated')::text, false);
  execute 'set role authenticated';
  execute p_sql into v;
  execute 'reset role';
  perform set_config('request.jwt.claims', coalesce(v_claims, ''), false);
  if v_role <> session_user then
    execute format('set role %I', v_role);
  end if;
  return v;
end $$;
grant execute on function tests.read(text) to anon, authenticated, service_role;
