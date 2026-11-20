-- Bug C (browser verification): one open invitation per handover and address
-- (20261121400200_single_open_invitation.sql). Synthetic data only.
\set ON_ERROR_STOP 1

select tests.user(u) from unnest(array['ann', 'rev', 'xin']) u;
select tests.handover('h', 'ann', 'outgoing');
select tests.handover('h2', 'ann', 'outgoing');
select tests.member('h', 'rev', 'reviewer');

create function pg_temp.invite_sql(p_handover text, p_email text, p_role text, p_name text) returns text language sql as $$
  select format('select public.invite_member(%L, %L, %L, %L, null, %L, now() + interval ''7 days'')',
                tests.id('ann'), tests.id(p_handover), p_email, p_role, sha256(convert_to(p_name, 'UTF8')))
$$;
create function pg_temp.invite(p_handover text, p_email text, p_role text, p_name text) returns uuid language plpgsql as $$
declare v uuid;
begin
  perform tests.as_user('ann');
  execute pg_temp.invite_sql(p_handover, p_email, p_role, p_name) into v;
  perform tests.as_owner();
  return tests.put(p_name, v);
end $$;
create function pg_temp.open_for(p_handover text, p_email text) returns int language sql as $$
  select count(*)::int from public.access_tokens t
   where t.handover_id = tests.id(p_handover) and t.purpose = 'member_invite' and lower(t.recipient_email::text) = lower(p_email)
     and t.revoked_at is null and t.use_count < t.max_uses and t.expires_at > now()
$$;
-- the SQLSTATE and HINT of a refused call, as the server sees them
create function pg_temp.refusal(p_sql text) returns text language plpgsql as $$
declare
  s text;
  h text;
begin
  perform tests.as_user('ann');
  begin
    execute p_sql;
  exception when others then
    get stacked diagnostics s = returned_sqlstate, h = pg_exception_hint;
    perform tests.as_owner();
    return s || ':' || coalesce(h, '');
  end;
  perform tests.as_owner();
  return 'OK';
end $$;

-- ── the repro: invite x, then invite x again ─────────────────────────────────
select pg_temp.invite('h', 'x@local.test', 'incoming', 'inv1');
do $$
begin
  perform tests.eq(pg_temp.refusal(pg_temp.invite_sql('h', 'x@local.test', 'incoming', 'inv2')), 'BTCF0:invite_pending', 'same address again: refused');
  perform tests.eq(pg_temp.refusal(pg_temp.invite_sql('h', '  X@Local.TEST ', 'lead', 'inv3')), 'BTCF0:invite_pending',
                   'other case, spaces and another role: refused (the role is not part of the identity)');
  perform tests.eq(pg_temp.open_for('h', 'x@local.test'), 1, 'one open invitation');
  perform tests.eq((select count(*)::int from public.access_tokens where purpose = 'member_invite' and handover_id = tests.id('h')), 1,
                   'no second token row was written');
  perform tests.eq(pg_temp.refusal(pg_temp.invite_sql('h2', 'x@local.test', 'incoming', 'inv-h2')), 'OK', 'another handover is independent');
  -- already a member: the existing refusal, now with its reason
  perform tests.eq(pg_temp.refusal(pg_temp.invite_sql('h', 'rev@example.test', 'incoming', 'inv-rev')), 'BTCF0:already_member',
                   'already a member: conflict with reason');
end $$;

-- ── a closed invitation (revoked, expired, used) does not block a new one ────
do $$
begin
  update public.access_tokens set revoked_at = now() where id = tests.id('inv1');
  perform tests.eq(pg_temp.refusal(pg_temp.invite_sql('h', 'x@local.test', 'incoming', 'inv4')), 'OK', 'after a revocation: allowed');
  update public.access_tokens set expires_at = now() - interval '1 minute', created_at = now() - interval '8 days'
   where handover_id = tests.id('h') and token_hash = sha256(convert_to('inv4', 'UTF8'));
  perform tests.eq(pg_temp.refusal(pg_temp.invite_sql('h', 'x@local.test', 'incoming', 'inv5')), 'OK', 'after expiry: allowed');
  perform tests.eq(pg_temp.open_for('h', 'x@local.test'), 1, 'still one open invitation');
end $$;

-- ── reissue keeps exactly one usable link, even with an older duplicate ──────
do $$
declare
  v_dup uuid;
  v_new jsonb;
  v_open uuid;
begin
  select id into v_open from public.access_tokens where handover_id = tests.id('h') and token_hash = sha256(convert_to('inv5', 'UTF8'));
  -- a duplicate created before this migration (written directly, as the old function did)
  insert into public.access_tokens (handover_id, created_by, purpose, token_hash, recipient_email, grant_role, expires_at, max_uses, created_at)
  values (tests.id('h'), tests.id('ann'), 'member_invite', sha256(convert_to('legacy-dup', 'UTF8')), 'x@local.test', 'incoming',
          now() + interval '7 days', 1, now() - interval '1 hour')
  returning id into v_dup;
  perform tests.eq(pg_temp.open_for('h', 'x@local.test'), 2, 'setup: a legacy duplicate');
  perform tests.as_user('ann');
  v_new := public.reissue_member_invite(tests.actor(), v_dup, sha256(convert_to('inv6', 'UTF8')), now() + interval '7 days');
  perform tests.as_owner();
  perform tests.eq(pg_temp.open_for('h', 'x@local.test'), 1, 'after the reissue: exactly one open invitation');
  perform tests.ok((select revoked_at is not null from public.access_tokens where id = v_dup), 'the reissued one is revoked');
  perform tests.ok((select revoked_at is not null from public.access_tokens where id = v_open), 'the other open duplicate is revoked too');
  perform tests.ok((select revoked_at is null from public.access_tokens where id = (v_new ->> 'token_id')::uuid), 'the new link is open');
  perform tests.ok(exists (select 1 from public.audit_logs where entity_id = v_open and action = 'token.revoked'
                            and after ->> 'reason' = 'duplicate_invitation'), 'the extra revocation is audited');
  -- the reissue still refuses an accepted invitation and a member, as before (with the member reason)
  update public.access_tokens set use_count = 1 where id = (v_new ->> 'token_id')::uuid;
  perform tests.eq(pg_temp.refusal(format('select public.reissue_member_invite(%L, %L, %L, now() + interval ''7 days'')',
                   tests.id('ann'), v_new ->> 'token_id', sha256(convert_to('inv7', 'UTF8')))), 'BTIT0:', 'used: refused');
end $$;

-- ── the helper is internal ───────────────────────────────────────────────────
do $$
declare
  r text;
begin
  foreach r in array array['anon', 'authenticated', 'service_role'] loop
    perform tests.ok(not has_function_privilege(r, 'public._lock_member_invite_address(uuid,text)', 'EXECUTE'), r || ': lock helper not executable');
  end loop;
  perform tests.ok(has_function_privilege('service_role', 'public.invite_member(uuid,uuid,text,text,text,bytea,timestamp with time zone)', 'EXECUTE')
                   and not has_function_privilege('authenticated', 'public.invite_member(uuid,uuid,text,text,text,bytea,timestamp with time zone)', 'EXECUTE'),
                   'invite_member grants unchanged');
  perform tests.ok(has_function_privilege('service_role', 'public.reissue_member_invite(uuid,uuid,bytea,timestamp with time zone)', 'EXECUTE')
                   and not has_function_privilege('authenticated', 'public.reissue_member_invite(uuid,uuid,bytea,timestamp with time zone)', 'EXECUTE'),
                   'reissue_member_invite grants unchanged');
end $$;

-- ── a race: two invitations to the same address at once → exactly one ────────
do $$
declare
  r1 text;
  r2 text;
begin
  perform tests.c_open('c1', 'ann'); perform tests.c_open('c2', 'ann');
  perform tests.c_exec('c1', 'begin');
  r1 := tests.c_try('c1', pg_temp.invite_sql('h', 'race@local.test', 'incoming', 'race1') || '::text');
  perform tests.ok(r1 like 'OK:%', 'the first invitation is created: ' || r1);
  perform tests.c_send('c2', pg_temp.invite_sql('h', 'race@local.test', 'lead', 'race2') || '::text');
  perform tests.ok(tests.c_blocked('c2'), 'the second waits for the address lock');
  perform tests.c_exec('c1', 'commit');
  r2 := tests.c_result('c2');
  perform tests.eq(r2, 'ERR:BTCF0', 'then is refused');
  perform tests.c_close('c1'); perform tests.c_close('c2');
  perform tests.eq(pg_temp.open_for('h', 'race@local.test'), 1, 'race: one open invitation');
end $$;
