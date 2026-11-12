-- IT-16 (Round 3, F2): D27 stays fail-closed, and QA-L2 (erase_participant / purge_handover actor validation)
-- is characterised so the fix can be verified before D27 ever grants these functions.
--
-- Part A (hard): D27 fail-closed, structurally. Any function — including one added by a later migration —
--   that turns on the erasure or purge privilege flag, or hard-deletes handovers, must be executable by NO
--   API role. No restore role exists.
-- Part B (QA-L2, latent): simulate the FUTURE reviewed grant to service_role inside this throw-away test
--   database, then probe actor validation. Checks that already hold are hard assertions; the open ones are
--   reported with it.todo(...) as "TODO(open QA-L2)" and flip to "NOW HOLDS" when the fix lands.
--   Expected fix: both functions call public._require_actor(p_actor_profile_id) (session subject must equal
--   the actor, the actor must be a live profile, API client roles refused) BEFORE any read or early return,
--   with purge's actor-less retention path restricted to a dedicated caller.
-- Part C (hard): the simulated grant is revoked and Part A holds again.
\set ON_ERROR_STOP 1

-- ── Part A: D27 fail-closed, structurally ────────────────────────────────────
create temp view it16_destructive as
  select p.oid, p.oid::regprocedure::text as sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and (p.prosrc ~* $re$set_config\(\s*'baton\.(erasure|purge)'\s*,\s*'on'$re$
          or p.prosrc ~* 'delete\s+from\s+public\.handovers\M');

select tests.eq((select array_agg(sig order by sig) from it16_destructive),
                array['erase_participant(uuid,uuid,text,bytea,text,uuid,uuid)', 'purge_handover(uuid,uuid,uuid)']::text[],
                'D27: exactly two functions can erase or purge (a new one needs a QA review)');
select tests.eq((select array_agg(sig || ':' || r order by sig, r) from it16_destructive,
                        unnest(array['anon', 'authenticated', 'service_role', 'public']) r
                  where has_function_privilege(r, oid, 'EXECUTE')),
                null::text[], 'D27: no API role (and not PUBLIC) may execute an erasure or purge function');
select tests.ok(not exists (select 1 from pg_roles where rolname = 'baton_restore'), 'D27: no restore role is provisioned');

-- ── fixtures ─────────────────────────────────────────────────────────────────
select tests.user(u) from unnest(array['ann', 'rev', 'eve', 'gone']) u;
select tests.handover('h', 'ann', 'outgoing');
select tests.member('h', 'rev', 'reviewer');
select tests.source('h', 's1');
select tests.handover('hg', 'gone', 'outgoing');   -- a creator whose account will be deleted
select tests.source('hg', 'sg');
select tests.handover('hp1', 'ann', 'outgoing');   -- purge targets
select tests.handover('hp2', 'ann', 'outgoing');
select tests.handover('hp3', 'gone', 'outgoing');
update auth.users set deleted_at = now() where id = tests.id('gone');

-- ── Part B: simulate the future grant (this database only) ────────────────────
grant execute on function public.erase_participant(uuid, uuid, text, bytea, text, uuid, uuid) to service_role;
grant execute on function public.purge_handover(uuid, uuid, uuid) to service_role;

do $$
declare
  v text;
  v_eid uuid := gen_random_uuid();
  hash_alice bytea := sha256(convert_to('alice', 'UTF8'));
  hash_bob bytea := sha256(convert_to('bob', 'UTF8'));
  hash_carol bytea := sha256(convert_to('carol', 'UTF8'));
  erase text := 'select public.erase_participant(%L, %L, ''phone'', %L, ''p1'', null, %L)::text';
begin
  -- holds today: a non-creator actor is refused, under its own session
  perform tests.as_user('rev');
  v := tests.try(format(erase, gen_random_uuid(), tests.id('h'), hash_alice, tests.id('rev')));
  perform tests.as_owner();
  perform tests.eq(v, 'ERR:BTFB0', 'QA-L2 (holds): a reviewer cannot erase');
  perform tests.as_user('eve');
  v := tests.try(format(erase, gen_random_uuid(), tests.id('h'), hash_alice, tests.id('eve')));
  perform tests.as_owner();
  perform tests.ok(v in ('ERR:BTFB0', 'ERR:BTNF0'), 'QA-L2 (holds): a non-member cannot erase, got ' || v);

  -- open: a session for rev that NAMES the creator as actor (H1 actor/session binding)
  perform tests.as_user('rev');
  v := tests.try(format(erase, v_eid, tests.id('h'), hash_alice, tests.id('ann')));
  perform tests.as_owner();
  perform it.todo(v = 'ERR:BTFB0', 'QA-L2',
    'erase_participant must refuse an actor that differs from the session subject (_require_actor); got ' || v);

  -- open: replaying a known erasure id answers alreadyApplied BEFORE any actor check (an oracle for ids)
  perform tests.as_user('eve');
  v := tests.try(format(erase, v_eid, tests.id('h'), hash_alice, tests.id('eve')));
  perform tests.as_owner();
  perform it.todo(v in ('ERR:BTFB0', 'ERR:BTNF0'), 'QA-L2',
    'erase_participant idempotency must not answer a non-creator (alreadyApplied before the actor check); got ' || v);

  -- open: a deleted creator account can still erase
  perform tests.as_user('gone');
  v := tests.try(format(erase, gen_random_uuid(), tests.id('hg'), hash_alice, tests.id('gone')));
  perform tests.as_owner();
  perform it.todo(v = 'ERR:BTUA0', 'QA-L2', 'erase_participant must refuse a deleted actor (BTUA0); got ' || v);

  -- open: with a mistaken grant to the browser role, nothing inside the function refuses it
  grant execute on function public.erase_participant(uuid, uuid, text, bytea, text, uuid, uuid) to authenticated;
  perform tests.as_reader('ann');
  v := tests.try(format(erase, gen_random_uuid(), tests.id('h'), hash_bob, tests.id('ann')));
  perform tests.as_owner();
  revoke execute on function public.erase_participant(uuid, uuid, text, bytea, text, uuid, uuid) from authenticated;
  perform it.todo(v = 'ERR:BTFB0', 'QA-L2',
    'erase_participant must refuse client API roles even if granted by mistake (_require_actor defence in depth); got ' || v);

  -- control: the creator under her own session (the legitimate path) still works
  perform tests.as_user('ann');
  v := tests.try(format(erase, gen_random_uuid(), tests.id('h'), hash_carol, tests.id('ann')));
  perform tests.as_owner();
  perform tests.ok(v like 'OK:%', 'QA-L2 control: the creator can erase under her own session, got ' || v);
end $$;

do $$
declare
  v text;
  purge text := 'select public.purge_handover(%L, %L, %L)::text';
begin
  -- holds today
  perform tests.as_user('rev');
  v := tests.try(format(purge, gen_random_uuid(), tests.id('hp1'), tests.id('rev')));
  perform tests.as_owner();
  perform tests.eq(v, 'ERR:BTFB0', 'QA-L2 (holds): a non-creator cannot purge');
  perform tests.as_service();
  v := tests.try(format('select public.purge_handover(%L, %L, null)::text', gen_random_uuid(), tests.id('hp1')));
  perform tests.as_owner();
  perform tests.eq(v, 'ERR:BTPF0', 'QA-L2 (holds): the actor-less retention path refuses a handover that is not due (live)');

  -- open: actor/session mismatch
  perform tests.as_user('rev');
  v := tests.try(format(purge, gen_random_uuid(), tests.id('hp1'), tests.id('ann')));
  perform tests.as_owner();
  perform it.todo(v = 'ERR:BTFB0', 'QA-L2', 'purge_handover must refuse an actor that differs from the session subject; got ' || v);

  -- open: a deleted creator can purge
  perform tests.as_user('gone');
  v := tests.try(format(purge, gen_random_uuid(), tests.id('hp3'), tests.id('gone')));
  perform tests.as_owner();
  perform it.todo(v = 'ERR:BTUA0', 'QA-L2', 'purge_handover must refuse a deleted actor (BTUA0); got ' || v);

  -- open: the actor-less path is open to ANY holder of the grant, not only the retention sweep: a user
  -- session (JWT subject set) that omits the actor purges a due handover it has nothing to do with
  update public.handovers set deleted_at = now() - interval '31 days' where id = tests.id('hp2');
  perform tests.as_user('eve');
  v := tests.try(format('select public.purge_handover(%L, %L, null)::text', gen_random_uuid(), tests.id('hp2')));
  perform tests.as_owner();
  perform it.todo(v like 'ERR:%', 'QA-L2',
    'purge_handover''s actor-less retention path must not run for a user session (only the sweep caller); got ' || v);
end $$;

-- ── Part C: the simulated grant is gone; D27 fail-closed again ────────────────
revoke execute on function public.erase_participant(uuid, uuid, text, bytea, text, uuid, uuid) from service_role;
revoke execute on function public.purge_handover(uuid, uuid, uuid) from service_role;
do $$
declare
  r text;
begin
  foreach r in array array['anon', 'authenticated', 'service_role'] loop
    perform tests.ok(not has_function_privilege(r, 'public.erase_participant(uuid,uuid,text,bytea,text,uuid,uuid)', 'EXECUTE'), 'D27 restored: ' || r || ' cannot erase');
    perform tests.ok(not has_function_privilege(r, 'public.purge_handover(uuid,uuid,uuid)', 'EXECUTE'), 'D27 restored: ' || r || ' cannot purge');
  end loop;
  perform tests.as_service();
  perform tests.throws(format('select public.purge_handover(gen_random_uuid(), %L, null)', tests.id('h')), '42501', 'D27: service_role purge refused');
  perform tests.as_owner();
end $$;

select 'ok' as it16_qa_l2_d27;
