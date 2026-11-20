-- IT-30 (bug C, browser verification): never two usable invitation links for one address in one handover
-- (migration 20261121400200_single_open_invitation.sql).
--   * two concurrent invitations to the same address: the second waits for the address lock, then is refused;
--   * an invitation racing a reissue for the same address: whichever commits first wins, the other is refused or
--     replaces it; exactly one link stays usable either way;
--   * different addresses never wait for each other.
\set ON_ERROR_STOP 1

select tests.user(u) from unnest(array['ann']) u;
select tests.handover('h', 'ann', 'outgoing');

create function it.inv_sql(p_email text, p_name text) returns text language sql as $$
  select format('select public.invite_member(%L, %L, %L, %L, null, %L, now() + interval ''7 days'')::text',
                tests.id('ann'), tests.id('h'), p_email, 'incoming', sha256(convert_to(p_name, 'UTF8')))
$$;
create function it.open_for(p_email text) returns int language sql as $$
  select count(*)::int from public.access_tokens t
   where t.handover_id = tests.id('h') and t.purpose = 'member_invite' and t.recipient_email = p_email
     and t.revoked_at is null and t.use_count < t.max_uses and t.expires_at > now()
$$;
grant execute on all functions in schema it to anon, authenticated, service_role;

-- ── 1. two invitations at once ───────────────────────────────────────────────
do $$
declare
  r1 text;
  r2 text;
begin
  perform tests.c_open('c1', 'ann'); perform tests.c_open('c2', 'ann');
  perform tests.c_exec('c1', 'begin');
  r1 := tests.c_try('c1', it.inv_sql('same@example.test', 'it30-a'));
  perform tests.ok(r1 like 'OK:%', 'the first invitation runs');
  perform tests.c_send('c2', it.inv_sql('same@example.test', 'it30-b'));
  perform tests.ok(tests.c_blocked('c2'), 'the second waits');
  perform tests.c_exec('c1', 'commit');
  r2 := tests.c_result('c2');
  perform tests.eq(r2, 'ERR:BTCF0', 'and is refused');
  perform tests.c_close('c1'); perform tests.c_close('c2');
  perform tests.eq(it.open_for('same@example.test'), 1, 'one usable link');
end $$;

-- ── 2. a reissue racing a new invitation to the same address ─────────────────
-- setup in its own transaction (the address lock is transaction-scoped): an expired invitation that the creator
-- reissues while also inviting the address again
do $$
begin
  perform tests.as_user('ann');
  perform tests.put('it30-old', public.invite_member(tests.actor(), tests.id('h'), 'race@example.test', 'incoming', null,
                                                     sha256(convert_to('it30-old', 'UTF8')), now() + interval '7 days'));
  perform tests.as_owner();
  update public.access_tokens set expires_at = now() - interval '1 minute' where id = tests.id('it30-old');
end $$;
do $$
declare
  v_old uuid := tests.id('it30-old');
  r1 text;
  r2 text;
begin
  perform tests.c_open('c1', 'ann'); perform tests.c_open('c2', 'ann');
  perform tests.c_exec('c1', 'begin');
  r1 := tests.c_try('c1', it.inv_sql('race@example.test', 'it30-new'));
  perform tests.ok(r1 like 'OK:%', 'the new invitation runs first: ' || r1);
  perform tests.c_send('c2', format('select public.reissue_member_invite(%L, %L, %L, now() + interval ''7 days'')::text',
                                    tests.id('ann'), v_old, sha256(convert_to('it30-re', 'UTF8'))));
  perform tests.ok(tests.c_blocked('c2'), 'the reissue waits for the address lock');
  perform tests.c_exec('c1', 'commit');
  r2 := tests.c_result('c2');
  perform tests.ok(r2 like 'OK:%', 'then replaces the invitation: ' || r2);
  perform tests.c_close('c1'); perform tests.c_close('c2');
  perform tests.eq(it.open_for('race@example.test'), 1, 'exactly one usable link after the race');
  perform tests.ok((select revoked_at is null from public.access_tokens where id = ((substr(r2, 4))::jsonb ->> 'token_id')::uuid),
                   'the usable link is the reissued one');
end $$;

-- ── 3. different addresses do not wait for each other ───────────────────────
do $$
declare
  r1 text;
  r2 text;
begin
  perform tests.c_open('c1', 'ann'); perform tests.c_open('c2', 'ann');
  perform tests.c_exec('c1', 'begin');
  r1 := tests.c_try('c1', it.inv_sql('one@example.test', 'it30-one'));
  perform tests.c_exec('c2', 'begin');
  r2 := tests.c_try('c2', it.inv_sql('two@example.test', 'it30-two'));
  perform tests.ok(r1 like 'OK:%' and r2 like 'OK:%', 'both run without waiting');
  perform tests.c_exec('c1', 'commit'); perform tests.c_exec('c2', 'commit');
  perform tests.c_close('c1'); perform tests.c_close('c2');
end $$;
