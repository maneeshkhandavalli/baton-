-- R3 backend (Agent 2), C1: draft metadata editing (migration 20261113100100, update_handover_details).
-- Synthetic data only.
\set ON_ERROR_STOP 1

select tests.user(u) from unnest(array['ann', 'rev', 'inc', 'led', 'out2', 'eve']) u;
select tests.handover('h', 'ann', 'outgoing');      -- ann: creator (outgoing)
select tests.member('h', 'rev', 'reviewer');
select tests.member('h', 'inc', 'incoming');
select tests.member('h', 'led', 'lead');
select tests.handover('r', 'rev', 'reviewer');      -- rev: creator (reviewer); out2 is an outgoing non-creator
select tests.member('r', 'out2', 'outgoing');

-- The current concurrency token of a handover, as the browser sees it (ms precision, like the DTO).
create function tests.token(p_handover text) returns timestamptz language sql volatile as $$
  select date_trunc('milliseconds', updated_at) from public.handovers where id = tests.id(p_handover)
$$;
grant execute on function tests.token(text) to anon, authenticated, service_role;

-- update_handover_details as the server acting for p_user, with p_token as the last seen updated_at.
create function tests.edit_sql(p_user text, p_handover text, p_token timestamptz, p_title text, p_team text,
                               p_role text default null, p_desc text default null) returns text language sql volatile as $$
  select format('select public.update_handover_details(%L, %L, %L, %L, %L, %L, %L)::text',
                tests.id(p_user), tests.id(p_handover), p_token, p_title, p_team, p_role, p_desc)
$$;
grant execute on function tests.edit_sql(text, text, timestamptz, text, text, text, text) to anon, authenticated, service_role;

-- ── grants: server-only, like every application mutation (H1) ───────────────
do $$
declare
  f constant text := 'public.update_handover_details(uuid,uuid,timestamp with time zone,text,text,text,text)';
begin
  perform tests.ok(has_function_privilege('service_role', f, 'EXECUTE'), 'the server can execute update_handover_details');
  perform tests.ok(not has_function_privilege('authenticated', f, 'EXECUTE'), 'the browser cannot execute update_handover_details');
  perform tests.ok(not has_function_privilege('anon', f, 'EXECUTE'), 'anon cannot execute update_handover_details');
end $$;

select tests.as_reader('ann');
select tests.throws(tests.edit_sql('ann', 'h', now(), 'Browser title', 'Team'), '42501', 'a direct browser call is denied');
select tests.as_owner();

-- ── C1: the creator edits a draft ───────────────────────────────────────────
select tests.kv_put('t0', to_jsonb(tests.token('h')));
select pg_sleep(0.01); -- the edit must get a later updated_at than the token
select tests.as_user('ann');
select public.update_handover_details(tests.actor(), tests.id('h'), (tests.kv('t0') #>> '{}')::timestamptz,
                                      '  Treasurer handover 2026 ', ' Robotics Club ', ' Treasurer ', ' Bank and dues ');
select tests.as_owner();
select tests.eq((select title || '|' || team_name || '|' || role_title || '|' || description from public.handovers where id = tests.id('h')),
                'Treasurer handover 2026|Robotics Club|Treasurer|Bank and dues', 'values are trimmed and stored');
select tests.ok(tests.token('h') > (tests.kv('t0') #>> '{}')::timestamptz, 'updated_at moves forward');
select tests.eq((select after -> 'fields' from public.audit_logs where handover_id = tests.id('h') and action = 'handover.details_updated'),
                '["title", "teamName", "description"]'::jsonb, 'the audit names the changed fields only (role title was already Treasurer)');
select tests.ok(not exists (select 1 from public.audit_logs where handover_id = tests.id('h') and action = 'handover.details_updated'
                            and (after::text like '%Robotics%' or after::text like '%Bank%')), 'no free text is copied into the audit log');

-- the RLS re-read (what the action returns) shows the new values and the new token
select tests.as_reader('ann');
select tests.eq(public.api_get_handover(tests.id('h')) ->> 'title', 'Treasurer handover 2026', 'RLS read shows the edit');
select tests.as_owner();

-- ── C1: optimistic concurrency ──────────────────────────────────────────────
select tests.as_user('ann');
select tests.throws(tests.edit_sql('ann', 'h', (tests.kv('t0') #>> '{}')::timestamptz, 'A stale overwrite', 'Robotics Club'), 'BTCF0',
                    'a stale token is a conflict');
select tests.as_owner();
select tests.eq((select title from public.handovers where id = tests.id('h')), 'Treasurer handover 2026', 'the stale write changed nothing');

-- an idempotent retry (same values, stale token) succeeds without a write
select tests.kv_put('t1', to_jsonb(tests.token('h')));
select tests.as_user('ann');
select tests.eq(public.update_handover_details(tests.actor(), tests.id('h'), (tests.kv('t0') #>> '{}')::timestamptz,
                  'Treasurer handover 2026', 'Robotics Club', null, null) is not null, true, 'a no-op retry with a stale token succeeds');
select tests.as_owner();
select tests.eq(tests.token('h'), (tests.kv('t1') #>> '{}')::timestamptz, 'a no-op writes nothing (updated_at unchanged)');
select tests.eq((select count(*)::int from public.audit_logs where handover_id = tests.id('h') and action = 'handover.details_updated'), 1,
                'a no-op is not audited');

-- the token is compared at millisecond precision (the DTO drops microseconds)
select tests.as_user('ann');
select public.update_handover_details(tests.actor(), tests.id('h'),
                                      (to_char(tests.token('h') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS') || 'Z')::timestamptz,
                                      'Treasurer handover 2026', 'Robotics Club', '', null);
select tests.as_owner();
select tests.ok((select role_title is null and description = 'Bank and dues' from public.handovers where id = tests.id('h')),
                'an ISO millisecond token is accepted; empty string clears, null keeps');

-- ── C1: who may edit ────────────────────────────────────────────────────────
select tests.as_user('rev');
select tests.throws(tests.edit_sql('rev', 'h', tests.token('h'), 'Reviewer edit', 'Team'), 'BTFB0', 'a reviewer who is not the creator is forbidden');
select tests.as_user('inc');
select tests.throws(tests.edit_sql('inc', 'h', tests.token('h'), 'Incoming edit', 'Team'), 'BTFB0', 'an incoming member is forbidden');
select tests.as_user('led');
select tests.throws(tests.edit_sql('led', 'h', tests.token('h'), 'Lead edit', 'Team'), 'BTFB0', 'a lead is forbidden');
select tests.as_user('eve');
select tests.throws(tests.edit_sql('eve', 'h', tests.token('h'), 'Outsider edit', 'Team'), 'BTNF0', 'a non-member gets not_found');
select tests.throws(format('select public.update_handover_details(%L, gen_random_uuid(), now(), %L, %L)', tests.actor(), 'Unknown', 'Team'),
                    'BTNF0', 'an unknown handover is not_found, like a hidden one');
select tests.as_user('out2');
select public.update_handover_details(tests.actor(), tests.id('r'), tests.token('r'), 'Edited by the outgoing member', 'Team r');
select tests.as_owner();
select tests.eq((select title from public.handovers where id = tests.id('r')), 'Edited by the outgoing member',
                'an outgoing member who is not the creator may edit');
select tests.as_user('rev');
select public.update_handover_details(tests.actor(), tests.id('r'), tests.token('r'), 'Edited by the reviewer creator', 'Team r');
select tests.as_owner();
select tests.eq((select title from public.handovers where id = tests.id('r')), 'Edited by the reviewer creator', 'a reviewer creator may edit');

-- removed members lose the right
update public.handover_members set removed_at = now() where id = tests.id('r/out2');
select tests.as_user('out2');
select tests.throws(tests.edit_sql('out2', 'r', tests.token('r'), 'After removal', 'Team r'), 'BTNF0', 'a removed member gets not_found');
select tests.as_owner();

-- actor checks (H1)
select tests.as_user('rev');
select tests.throws(tests.edit_sql('ann', 'h', tests.token('h'), 'Impersonated', 'Team'), 'BTFB0', 'the actor must match the session');
select tests.as_service();
select tests.throws(format('select public.update_handover_details(gen_random_uuid(), %L, now(), %L, %L)', tests.id('h'), 'Ghost', 'Team'),
                    'BTUA0', 'an unknown actor is unauthenticated');
select tests.throws(format('select public.update_handover_details(null, %L, now(), %L, %L)', tests.id('h'), 'Ghost', 'Team'),
                    'BTUA0', 'a missing actor is unauthenticated');
select tests.as_owner();

-- ── C1: validation ──────────────────────────────────────────────────────────
select tests.as_user('ann');
select tests.throws(tests.edit_sql('ann', 'h', tests.token('h'), ' ab ', 'Team'), 'BTVF0', 'title shorter than 3 after trim');
select tests.throws(tests.edit_sql('ann', 'h', tests.token('h'), 'Title', 'T'), 'BTVF0', 'team shorter than 2');
select tests.throws(tests.edit_sql('ann', 'h', tests.token('h'), repeat('x', 121), 'Team'), 'BTVF0', 'title longer than 120');
select tests.throws(tests.edit_sql('ann', 'h', tests.token('h'), 'Title', 'Team', repeat('x', 121)), 'BTVF0', 'role title longer than 120');
select tests.throws(tests.edit_sql('ann', 'h', tests.token('h'), 'Title', 'Team', null, repeat('x', 2001)), 'BTVF0', 'description longer than 2000');
select tests.throws(tests.edit_sql('ann', 'h', null, 'Title', 'Team'), 'BTVF0', 'the concurrency token is required');
select tests.throws(format('select public.update_handover_details(%L, %L, now(), null, %L)', tests.actor(), tests.id('h'), 'Team'),
                    'BTVF0', 'title is required');
select tests.as_owner();

-- ── C1: drafts only ─────────────────────────────────────────────────────────
select tests.handover('p', 'ann', 'outgoing');
select tests.set_state('p', 'in_review');
select tests.as_user('ann');
select tests.throws(tests.edit_sql('ann', 'p', tests.token('p'), 'Too late', 'Team'), 'BTIT0', 'in_review is not editable');
select tests.as_owner();
select tests.set_state('p', 'processing');
select tests.as_user('ann');
select tests.throws(tests.edit_sql('ann', 'p', tests.token('p'), 'Too late', 'Team'), 'BTIT0', 'processing is not editable');
select tests.as_owner();
select tests.handover('d', 'ann', 'outgoing');
select tests.as_user('ann');
select public.delete_handover(tests.actor(), tests.id('d'));
select tests.throws(tests.edit_sql('ann', 'd', tests.token('d'), 'Deleted', 'Team'), 'BTNF0', 'a soft-deleted draft is not_found');
select tests.as_owner();

-- ── C1: RLS — the edit is visible to members only ───────────────────────────
select tests.as_reader('eve');
select tests.ok(public.api_get_handover(tests.id('h')) is null, 'a non-member still sees nothing');
select tests.eq((select count(*)::int from public.handovers where id = tests.id('h')), 0, 'a non-member reads no row directly');
select tests.throws(format($q$update public.handovers set title = 'Direct write' where id = %L$q$, tests.id('h')), '42501',
                    'the browser cannot update handovers directly');
select tests.as_reader('inc');
select tests.eq(public.api_get_handover(tests.id('h')) ->> 'title', 'Treasurer handover 2026', 'other members read the edited title');
select tests.as_owner();

-- ── C1: two concurrent autosaves with the same token: exactly one wins ──────
do $$
declare
  v_token timestamptz := tests.token('h');
  r1 text;
  r2 text;
begin
  perform tests.c_open('c1', 'ann'); perform tests.c_open('c2', 'ann');
  perform tests.c_exec('c1', 'begin');
  r1 := tests.c_try('c1', tests.edit_sql('ann', 'h', v_token, 'Autosave one', 'Robotics Club'));
  perform tests.c_send('c2', tests.edit_sql('ann', 'h', v_token, 'Autosave two', 'Robotics Club'));
  perform tests.ok(tests.c_blocked('c2'), 'the second autosave waits for the handover lock');
  perform tests.c_exec('c1', 'commit');
  r2 := tests.c_result('c2');
  perform tests.c_close('c1'); perform tests.c_close('c2');
  perform tests.ok(r1 like 'OK:%', 'the first autosave commits: ' || r1);
  perform tests.eq(r2, 'ERR:BTCF0', 'the second autosave with the same token is a conflict');
  perform tests.eq((select title from public.handovers where id = tests.id('h')), 'Autosave one', 'the first autosave is kept');
end $$;

