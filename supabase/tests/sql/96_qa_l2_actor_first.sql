-- R3-C7 = QA-L2 (Agent 2): erase_participant / purge_handover validate the actor first
-- (migration 20261113100500). D27 stays fail-closed: the grants used here are SIMULATED inside this
-- throw-away database and revoked again at the end. Synthetic data only.
\set ON_ERROR_STOP 1

-- D27 before anything: no API role may execute either function.
do $$
declare r text;
begin
  foreach r in array array['anon', 'authenticated', 'service_role', 'public'] loop
    perform tests.ok(not has_function_privilege(r, 'public.erase_participant(uuid,uuid,text,bytea,text,uuid,uuid)', 'EXECUTE'), r || ' cannot erase');
    perform tests.ok(not has_function_privilege(r, 'public.purge_handover(uuid,uuid,uuid)', 'EXECUTE'), r || ' cannot purge');
  end loop;
end $$;

select tests.user(u) from unnest(array['ann', 'rev', 'eve', 'gone']) u;
select tests.handover('h', 'ann', 'outgoing');
select tests.member('h', 'rev', 'reviewer');
select tests.source('h', 's1');
select tests.handover('hg', 'gone', 'outgoing');
select tests.source('hg', 'sg');
select tests.handover('p_live', 'ann', 'outgoing');
select tests.handover('p_mine', 'ann', 'outgoing');
select tests.handover('p_due', 'rev', 'outgoing');
select tests.handover('p_due2', 'rev', 'outgoing');
select tests.handover('p_gone', 'gone', 'outgoing');
update public.handovers set deleted_at = now() - interval '31 days' where id in (tests.id('p_due'), tests.id('p_due2'));
update auth.users set deleted_at = now() where id = tests.id('gone');

grant execute on function public.erase_participant(uuid, uuid, text, bytea, text, uuid, uuid) to service_role;
grant execute on function public.purge_handover(uuid, uuid, uuid) to service_role;

create function tests.erase_sql(p_event uuid, p_handover text, p_who text, p_actor uuid) returns text language sql volatile as $$
  select format('select public.erase_participant(%L, %L, ''phone'', %L, ''p1'', null, %L)::text',
                p_event, tests.id(p_handover), sha256(convert_to(p_who, 'UTF8')), p_actor)
$$;
grant execute on function tests.erase_sql(uuid, text, text, uuid) to anon, authenticated, service_role;

-- ── erase_participant ───────────────────────────────────────────────────────
do $$
declare
  v text;
  v_eid uuid := '00000000-0000-4000-8000-0000000000a1';
begin
  -- the creator under her own session: applied, then an idempotent replay
  perform tests.as_user('ann');
  v := tests.try(tests.erase_sql(v_eid, 'h', 'alice', tests.id('ann')));
  perform tests.ok(v like 'OK:%' and (substr(v, 4)::jsonb ->> 'alreadyApplied') = 'false', 'the creator erases: ' || v);
  v := tests.try(tests.erase_sql(v_eid, 'h', 'alice', tests.id('ann')));
  perform tests.ok((substr(v, 4)::jsonb ->> 'alreadyApplied') = 'true', 'the creator''s replay is alreadyApplied: ' || v);

  -- the replayed id answers nobody else (creator check before idempotency)
  perform tests.as_user('rev');
  perform tests.eq(tests.try(tests.erase_sql(v_eid, 'h', 'alice', tests.id('rev'))), 'ERR:BTFB0', 'a reviewer replaying the id is forbidden');
  perform tests.as_user('eve');
  perform tests.eq(tests.try(tests.erase_sql(v_eid, 'h', 'alice', tests.id('eve'))), 'ERR:BTFB0', 'a non-member replaying the id is forbidden');

  -- actor validation first
  perform tests.as_user('rev');
  perform tests.eq(tests.try(tests.erase_sql(gen_random_uuid(), 'h', 'bob', tests.id('ann'))), 'ERR:BTFB0',
                   'a session naming another actor is refused');
  perform tests.as_user('gone');
  perform tests.eq(tests.try(tests.erase_sql(gen_random_uuid(), 'hg', 'bob', tests.id('gone'))), 'ERR:BTUA0', 'a deleted actor is unauthenticated');
  perform tests.as_service();
  perform tests.eq(tests.try(tests.erase_sql(gen_random_uuid(), 'h', 'bob', null)), 'ERR:BTUA0', 'a missing actor is unauthenticated');
  perform tests.eq(tests.try(tests.erase_sql(gen_random_uuid(), 'h', 'bob', gen_random_uuid())), 'ERR:BTUA0', 'an unknown actor is unauthenticated');
  perform tests.eq(tests.try(tests.erase_sql(gen_random_uuid(), 'h', 'bob', tests.id('ann'))) like 'OK:%', true,
                   'the server without a session subject, acting for the creator, still works');
  perform tests.as_owner();

  -- a mistaken grant to the browser role is refused inside the function
  grant execute on function public.erase_participant(uuid, uuid, text, bytea, text, uuid, uuid) to authenticated;
  perform tests.as_reader('ann');
  v := tests.try(tests.erase_sql(gen_random_uuid(), 'h', 'carol', tests.id('ann')));
  perform tests.as_owner();
  revoke execute on function public.erase_participant(uuid, uuid, text, bytea, text, uuid, uuid) from authenticated;
  perform tests.eq(v, 'ERR:BTFB0', 'the browser role is refused even with a grant');
  perform tests.eq((select count(*)::int from public.participant_erasures where handover_id = tests.id('h')), 2,
                   'only the two legitimate erasures were recorded');
end $$;

-- ── purge_handover ──────────────────────────────────────────────────────────
do $$
declare
  v text;
  purge text := 'select public.purge_handover(gen_random_uuid(), %L, %L)::text';
begin
  -- actor path
  perform tests.as_user('rev');
  perform tests.eq(tests.try(format(purge, tests.id('p_live'), tests.id('ann'))), 'ERR:BTFB0', 'a session naming another actor is refused');
  perform tests.eq(tests.try(format(purge, tests.id('p_live'), tests.id('rev'))), 'ERR:BTFB0', 'a non-creator is refused');
  perform tests.as_user('gone');
  perform tests.eq(tests.try(format(purge, tests.id('p_gone'), tests.id('gone'))), 'ERR:BTUA0', 'a deleted creator is unauthenticated');
  perform tests.as_user('ann');
  perform tests.eq(tests.try(format(purge, tests.id('p_mine'), tests.id('ann'))), 'OK:true', 'the creator under her own session purges');
  perform tests.eq(tests.try(format(purge, tests.id('p_mine'), tests.id('ann'))), 'OK:false', 'a replay of a purged handover is a no-op');

  -- actor-less retention path: the sweep caller only
  perform tests.as_user('eve');
  perform tests.eq(tests.try(format(purge, tests.id('p_due'), null)), 'ERR:BTFB0', 'a user session cannot use the actor-less path');
  perform tests.as_user('rev');
  perform tests.eq(tests.try(format(purge, tests.id('p_due'), null)), 'ERR:BTFB0', 'not even the creator''s own session');
  perform tests.as_owner();
  grant execute on function public.purge_handover(uuid, uuid, uuid) to authenticated;
  perform tests.as_reader('eve');
  v := tests.try(format(purge, tests.id('p_due'), null));
  perform tests.as_owner();
  revoke execute on function public.purge_handover(uuid, uuid, uuid) from authenticated;
  perform tests.eq(v, 'ERR:BTFB0', 'the browser role is refused even with a grant');
  perform tests.ok((select count(*) from public.handovers where id = tests.id('p_due')) = 1, 'nothing was purged by those calls');

  perform tests.as_service();
  perform tests.eq(tests.try(format(purge, tests.id('p_live'), null)), 'ERR:BTPF0', 'the sweep still refuses a handover that is not due');
  perform tests.eq(tests.try(format(purge, tests.id('p_due'), null)), 'OK:true', 'the sweep (no session subject) purges a due handover');
  perform tests.eq(tests.try(format(purge, gen_random_uuid(), null)), 'OK:false', 'the sweep on an unknown handover is a no-op');
  perform tests.as_owner();
  perform tests.eq(tests.try(format(purge, tests.id('p_due2'), null)), 'OK:true', 'a database-owner job (e.g. cron) is a sweep caller too');
end $$;

-- ── D27 restored ────────────────────────────────────────────────────────────
revoke execute on function public.erase_participant(uuid, uuid, text, bytea, text, uuid, uuid) from service_role;
revoke execute on function public.purge_handover(uuid, uuid, uuid) from service_role;
do $$
declare r text;
begin
  foreach r in array array['anon', 'authenticated', 'service_role', 'public'] loop
    perform tests.ok(not has_function_privilege(r, 'public.erase_participant(uuid,uuid,text,bytea,text,uuid,uuid)', 'EXECUTE'), 'restored: ' || r || ' cannot erase');
    perform tests.ok(not has_function_privilege(r, 'public.purge_handover(uuid,uuid,uuid)', 'EXECUTE'), 'restored: ' || r || ' cannot purge');
  end loop;
  perform tests.as_service();
  perform tests.throws(format('select public.purge_handover(gen_random_uuid(), %L, null)', tests.id('p_live')), '42501', 'service_role purge refused');
  perform tests.throws(tests.erase_sql(gen_random_uuid(), 'h', 'bob', tests.id('ann')), '42501', 'service_role erase refused');
  perform tests.as_owner();
end $$;
