-- IT-19: account deletion (§12.9, D25; migration 20261114100100_account_deletion.sql).
--
-- Part A (structural): delete_own_account and account_has_password are executable by service_role only;
--   purge_handover and erase_participant are still executable by no API role.
-- Part B (refusals, nothing changes): wrong word, an incomplete purge list, someone else's handover, an actor
--   that differs from the session subject, a browser (authenticated) session.
-- Part C (success): the actor's own handovers (live and soft-deleted) are purged with everything that hangs off
--   them (sources, messages, runs, jobs, points); a handover someone else created survives with the actor's
--   membership removed; the profile is anonymised; audit rows record ids and counts; nobody else is touched.
-- Part D (atomicity): a failure in the anonymising step rolls the purges back.
-- Part E: account_has_password reads only the actor's own auth user.
\set ON_ERROR_STOP 1

-- ── Part A ───────────────────────────────────────────────────────────────────
select tests.eq((select array_agg(r order by r) from unnest(array['anon', 'authenticated', 'service_role', 'public']) r
                  where has_function_privilege(r, 'public.delete_own_account(uuid,text,uuid[])', 'EXECUTE')),
                array['service_role'], 'delete_own_account: service_role only');
select tests.eq((select array_agg(r order by r) from unnest(array['anon', 'authenticated', 'service_role', 'public']) r
                  where has_function_privilege(r, 'public.account_has_password(uuid)', 'EXECUTE')),
                array['service_role'], 'account_has_password: service_role only');
select tests.eq((select array_agg(f || ':' || r order by f, r)
                   from unnest(array['public.purge_handover(uuid,uuid,uuid)', 'public.erase_participant(uuid,uuid,text,bytea,text,uuid,uuid)']) f,
                        unnest(array['anon', 'authenticated', 'service_role', 'public']) r
                  where has_function_privilege(r, f::regprocedure, 'EXECUTE')),
                null::text[], 'purge_handover and erase_participant stay closed to every API role');
select tests.eq((select array_agg(p.oid::regprocedure::text order by 1)
                   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                  where n.nspname = 'public' and p.proname <> 'purge_handover'
                    and p.prosrc ~* 'public\.(purge_handover|erase_participant)\s*\('),
                array['delete_own_account(uuid,text,uuid[])'],
                'the only caller of purge_handover/erase_participant is delete_own_account (a new one needs review)');

-- ── fixtures ─────────────────────────────────────────────────────────────────
select tests.user(u) from unnest(array['ann', 'bob', 'cat', 'eve']) u;
select tests.handover('h1', 'ann', 'outgoing');   -- ann's live handover, with content and a processing run
select tests.member('h1', 'bob', 'reviewer');
select tests.source('h1', 's1');
select tests.point('h1', 'p1');
select tests.as_user('ann');
select tests.put('run1', public.start_processing(tests.actor(), tests.id('h1'), 'it19-1', '{"provider":"fake"}',
  jsonb_build_array(jsonb_build_object('stage', 'extract', 'sourceId', tests.id('s1'), 'inputHash', md5('it19-1')))));
select tests.as_owner();
select tests.handover('h2', 'ann', 'outgoing');   -- ann's soft-deleted handover (still blocks until purged)
update public.handovers set deleted_at = now() where id = tests.id('h2');
select tests.handover('hb', 'bob', 'outgoing');   -- bob's handover; ann is only a member
select tests.member('hb', 'ann', 'reviewer');
select tests.source('hb', 'sb');
select tests.handover('hc', 'cat', 'outgoing');   -- for the atomicity check

-- ── Part B: refusals; nothing changes ────────────────────────────────────────
do $$
declare
  v text;
  f text := 'select public.delete_own_account(%L, %L, %L)::text';
begin
  perform tests.as_user('ann');
  v := tests.try(format(f, tests.id('ann'), 'delete', array[tests.id('h1'), tests.id('h2')]));
  perform tests.eq(v, 'ERR:BTVF0', 'the typed word must be exactly DELETE');
  v := tests.try(format(f, tests.id('ann'), 'DELETE', array[tests.id('h1')]));
  perform tests.eq(v, 'ERR:BTPF0', 'every created handover (including soft-deleted ones) must be listed');
  v := tests.try(format(f, tests.id('ann'), 'DELETE', array[tests.id('h1'), tests.id('h2'), tests.id('hb')]));
  perform tests.eq(v, 'ERR:BTNF0', 'a handover someone else created can never be listed');
  v := tests.try(format(f, tests.id('ann'), 'DELETE', array[tests.id('h1'), tests.id('h1')]));
  perform tests.eq(v, 'ERR:BTVF0', 'each handover once');
  perform tests.as_user('bob');
  v := tests.try(format(f, tests.id('ann'), 'DELETE', array[tests.id('h1'), tests.id('h2')]));
  perform tests.eq(v, 'ERR:BTFB0', 'bob''s session cannot delete ann''s account');
  perform tests.as_owner();
  grant execute on function public.delete_own_account(uuid, text, uuid[]) to authenticated; -- a mistaken grant
  perform tests.as_reader('ann');
  v := tests.try(format(f, tests.id('ann'), 'DELETE', array[tests.id('h1'), tests.id('h2')]));
  perform tests.as_owner();
  revoke execute on function public.delete_own_account(uuid, text, uuid[]) from authenticated;
  perform tests.eq(v, 'ERR:BTFB0', 'a browser session is refused even with a mistaken grant');
  perform tests.as_owner();
  perform tests.eq((select count(*)::int from public.handovers where id in (tests.id('h1'), tests.id('h2'), tests.id('hb'))), 3,
                   'after every refusal all three handovers still exist');
  perform tests.ok((select deleted_at is null and display_name <> 'Former member' from public.profiles where id = tests.id('ann')),
                   'after every refusal ann''s profile is untouched');
end $$;

-- ── Part C: success ──────────────────────────────────────────────────────────
select tests.as_user('ann');
select tests.kv_put('result', public.delete_own_account(tests.id('ann'), 'DELETE', array[tests.id('h2'), tests.id('h1')]));
select tests.as_owner();

select tests.eq((tests.kv('result') ->> 'purgedHandovers')::int, 2, 'two handovers purged');
select tests.eq((tests.kv('result') ->> 'memberships')::int, 1, 'one membership ended (hb); memberships of the purged handovers went with them');
select tests.eq((select count(*)::int from public.handovers where id in (tests.id('h1'), tests.id('h2'))), 0, 'ann''s handovers are gone');
select tests.eq((select count(*)::int from public.sources where handover_id in (tests.id('h1'), tests.id('h2'))), 0, 'their sources are gone');
select tests.eq((select count(*)::int from public.source_messages where handover_id = tests.id('h1')), 0, 'their messages are gone');
select tests.eq((select count(*)::int from public.processing_runs where handover_id = tests.id('h1')), 0, 'their processing runs are gone');
select tests.eq((select count(*)::int from public.processing_jobs where handover_id = tests.id('h1')), 0, 'their processing jobs are gone');
select tests.eq((select count(*)::int from public.handover_points where handover_id = tests.id('h1')), 0, 'their points are gone');
select tests.eq((select count(*)::int from public.handover_members where handover_id = tests.id('h1')), 0, 'bob''s membership of ann''s purged handover went with it');

select tests.ok(exists (select 1 from public.handovers where id = tests.id('hb') and deleted_at is null), 'bob''s handover survives');
select tests.ok(exists (select 1 from public.sources where id = tests.id('sb')), 'bob''s source survives');
select tests.ok((select removed_at is not null from public.handover_members where handover_id = tests.id('hb') and profile_id = tests.id('ann')),
                'ann''s membership of bob''s handover is ended, not deleted (traceability)');
select tests.ok((select removed_at is null from public.handover_members where handover_id = tests.id('hb') and profile_id = tests.id('bob')),
                'bob''s own membership is untouched');
select tests.ok((select display_name = 'Former member' and avatar_url is null and deleted_at is not null from public.profiles where id = tests.id('ann')),
                'ann''s profile is anonymised and marked deleted');
select tests.ok((select display_name <> 'Former member' and deleted_at is null from public.profiles where id = tests.id('bob')), 'bob''s profile is untouched');
select tests.eq((select count(*)::int from public.audit_logs where action = 'handover.purged' and entity_id in (tests.id('h1'), tests.id('h2'))), 2,
                'one handover.purged audit row per purge');
select tests.eq((select count(*)::int from public.audit_logs where action = 'account.deleted' and entity_id = tests.id('ann')), 1, 'one account.deleted audit row');
select tests.ok(not exists (select 1 from public.audit_logs where action = 'account.deleted' and entity_id = tests.id('ann')
                              and (coalesce(after::text, '') ilike '%ann@example.test%' or coalesce(after::text, '') ilike '%"Ann"%')),
                'the audit row holds neither the email address nor the name');

select tests.as_user('ann');
select tests.eq(tests.try(format('select public.delete_own_account(%L, ''DELETE'', ''{}''::uuid[])::text', tests.id('ann'))), 'ERR:BTUA0',
                'a deleted account cannot run deletion again');
select tests.as_owner();

-- ── Part D: atomicity ────────────────────────────────────────────────────────
create function pg_temp.fail_for_cat() returns trigger language plpgsql as $$
begin
  if new.id = tests.id('cat') then raise exception 'simulated failure' using errcode = 'XX001'; end if;
  return new;
end $$;
create trigger it19_fail before update on public.profiles for each row execute function pg_temp.fail_for_cat();
select tests.as_user('cat');
select tests.eq(tests.try(format('select public.delete_own_account(%L, ''DELETE'', %L)::text', tests.id('cat'), array[tests.id('hc')])), 'ERR:XX001',
                'the anonymising step fails');
select tests.as_owner();
drop trigger it19_fail on public.profiles;
select tests.ok(exists (select 1 from public.handovers where id = tests.id('hc')), 'the purge of cat''s handover was rolled back');
select tests.ok((select deleted_at is null from public.profiles where id = tests.id('cat')), 'cat''s profile is unchanged');
select tests.eq((select count(*)::int from public.audit_logs where entity_id = tests.id('hc') and action = 'handover.purged'), 0, 'no purge audit row survives');

-- ── Part E: account_has_password ─────────────────────────────────────────────
select tests.as_user('bob');
select tests.eq(public.account_has_password(tests.id('bob')), false, 'no password yet');
select tests.as_owner();
update auth.users set encrypted_password = '$2a$10$synthetic' where id = tests.id('bob');
select tests.as_user('bob');
select tests.eq(public.account_has_password(tests.id('bob')), true, 'password set');
select tests.eq(tests.try(format('select public.account_has_password(%L)::text', tests.id('eve'))), 'ERR:BTFB0', 'bob cannot ask about eve');
select tests.as_owner();
