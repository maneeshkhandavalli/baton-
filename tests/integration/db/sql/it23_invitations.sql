-- IT-23 (Round 3 Task 06): invitation acceptance under concurrency, scope and privileges
-- (migrations 20261118700100–20261118700300).
--   * two concurrent redemptions of ONE invitation by the invited user: exactly one membership; the second waits for
--     the first and then replays (idempotent), nothing is written twice;
--   * concurrent redemptions by the invited user and someone else: only the invited user joins;
--   * a reissue racing a redemption: either the redemption wins (reissue refused as used) or the reissue wins (the old
--     link is refused), never both;
--   * the accepted member reaches exactly the invited handover with the invited role, and none of the new functions
--     is reachable from a browser role.
\set ON_ERROR_STOP 1

select tests.user(u) from unnest(array['ann', 'inc', 'bob', 'kim']) u;
select tests.handover('h', 'ann', 'outgoing');
select tests.handover('other', 'ann', 'outgoing');

create function it.h(p text) returns bytea language sql immutable as $$ select sha256(convert_to(p, 'UTF8')) $$;
create function it.invite(p_name text, p_email text, p_role text) returns uuid language plpgsql as $$
declare v uuid;
begin
  perform tests.as_user('ann');
  v := public.invite_member(tests.actor(), tests.id('h'), p_email, p_role, null, it.h(p_name), now() + interval '7 days');
  perform tests.as_owner();
  return tests.put(p_name, v);
end $$;

select it.invite('race-same', 'inc@example.test', 'incoming');
select it.invite('race-other', 'kim@example.test', 'lead');
select it.invite('race-reissue', 'bob@example.test', 'incoming');

-- ── 1. the same user submits twice at once ──────────────────────────────────
do $$
declare
  r1 text;
  r2 text;
begin
  perform tests.c_open('c1', 'service'); perform tests.c_open('c2', 'service');
  perform tests.c_exec('c1', 'begin');
  r1 := tests.c_try('c1', format('select public.redeem_member_invite(%L, %L)::text', it.h('race-same'), tests.id('inc')));
  perform tests.ok(r1 like 'OK:%', 'the first redemption runs');
  perform tests.c_send('c2', format('select public.redeem_member_invite(%L, %L)::text', it.h('race-same'), tests.id('inc')));
  perform tests.ok(tests.c_blocked('c2'), 'the second waits for the first (token row lock)');
  perform tests.c_exec('c1', 'commit');
  r2 := tests.c_result('c2');
  perform tests.ok(r2 like 'OK:%', 'then succeeds: ' || r2);
  perform tests.eq(((substr(r2, 4))::jsonb ->> 'replayed')::boolean, true, 'as a replay');
  perform tests.eq(((substr(r2, 4))::jsonb ->> 'member_id'), ((substr(r1, 4))::jsonb ->> 'member_id'), 'of the same membership');
  perform tests.c_close('c1'); perform tests.c_close('c2');
  perform tests.eq((select count(*)::int from public.handover_members where handover_id = tests.id('h') and profile_id = tests.id('inc')), 1, 'one membership');
  perform tests.eq((select use_count from public.access_tokens where id = tests.id('race-same')), 1, 'used once');
  perform tests.eq((select count(*)::int from public.audit_logs where action = 'member.joined' and actor_token_id = tests.id('race-same')), 1, 'joined once');
end $$;

-- ── 2. the invited user and someone else at once ────────────────────────────
do $$
declare
  r text;
begin
  perform tests.c_open('c1', 'service'); perform tests.c_open('c2', 'service');
  perform tests.c_exec('c1', 'begin');
  perform tests.ok(tests.c_try('c1', format('select public.redeem_member_invite(%L, %L)::text', it.h('race-other'), tests.id('kim'))) like 'OK:%',
                   'the invited user redeems');
  perform tests.c_send('c2', format('select public.redeem_member_invite(%L, %L)::text', it.h('race-other'), tests.id('bob')));
  perform tests.ok(tests.c_blocked('c2'), 'the other waits');
  perform tests.c_exec('c1', 'commit');
  r := tests.c_result('c2');
  perform tests.eq(r, 'ERR:BTTI0', 'and is refused');
  perform tests.c_close('c1'); perform tests.c_close('c2');
  perform tests.ok(not exists (select 1 from public.handover_members where handover_id = tests.id('h') and profile_id = tests.id('bob')), 'bob is not a member');
end $$;

-- ── 3. a reissue racing a redemption ────────────────────────────────────────
do $$
declare
  r text;
begin
  perform tests.c_open('c1', 'service'); perform tests.c_open('c2', 'service');
  perform tests.c_exec('c1', 'begin');
  perform tests.ok(tests.c_try('c1', format('select public.redeem_member_invite(%L, %L)::text', it.h('race-reissue'), tests.id('bob'))) like 'OK:%',
                   'the redemption runs first');
  perform tests.c_send('c2', format('select public.reissue_member_invite(%L, %L, %L, %L)::text', tests.id('ann'), tests.id('race-reissue'),
                                    it.h('race-reissue-2'), now() + interval '7 days'));
  perform tests.ok(tests.c_blocked('c2'), 'the reissue waits for it');
  perform tests.c_exec('c1', 'commit');
  r := tests.c_result('c2');
  perform tests.eq(r, 'ERR:BTIT0', 'then is refused: the invitation was accepted');
  perform tests.c_close('c1'); perform tests.c_close('c2');
  perform tests.ok(not exists (select 1 from public.access_tokens where token_hash = it.h('race-reissue-2')), 'no second link exists');
end $$;

-- ── 4. scope and role after acceptance ──────────────────────────────────────
do $$
begin
  perform tests.eq((select role || '/' || clearance from public.handover_members where handover_id = tests.id('h') and profile_id = tests.id('kim')),
                   'lead/leads_only', 'the lead has the lead clearance');
  perform tests.as_reader('kim');
  perform tests.ok(public.api_get_handover(tests.id('h')) is not null, 'the lead reads the invited handover');
  perform tests.ok(public.api_get_handover(tests.id('other')) is null, 'and no other handover of the same creator');
  perform tests.eq(public.list_access_tokens(tests.id('h'), null, false), null::jsonb, 'a lead sees no links (not a review role)');
  perform tests.as_user('kim');
  perform tests.throws(format('select public.reissue_member_invite(%L, %L, %L, %L)', tests.actor(), tests.id('race-same'), it.h('x-1'), now() + interval '1 day'),
                       'BTFB0', 'a lead cannot reissue invitations');
  perform tests.throws(format($q$select public.record_invitation_delivery(%L, %L, 'sent', null, null)$q$, tests.actor(), tests.id('race-same')), 'BTNF0',
                       'nor record deliveries');
  perform tests.as_owner();
end $$;

-- ── 5. browser roles reach none of it ───────────────────────────────────────
do $$
begin
  perform tests.as_reader('inc');
  perform tests.throws(format('select public.get_member_invite_details(%L, null)', it.h('race-same')), '42501', 'authenticated cannot read invitation details');
  perform tests.throws(format('select public.redeem_member_invite(%L, %L)', it.h('race-same'), tests.id('inc')), '42501', 'nor redeem');
  perform tests.throws('select count(*) from public.invitation_deliveries', '42501', 'nor read delivery records');
  perform tests.as_anon();
  perform tests.throws(format('select public.get_member_invite_details(%L, null)', it.h('race-same')), '42501', 'anon cannot either');
  perform tests.as_owner();
end $$;

select 'ok' as result;
