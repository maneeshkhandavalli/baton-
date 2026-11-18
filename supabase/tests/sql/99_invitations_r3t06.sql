-- R3 Task 06: invitation details, idempotent acceptance, reissue, delivery records and the new rate-limit scopes
-- (migrations 20261118700100–20261118700300). Synthetic data only.
\set ON_ERROR_STOP 1

select tests.user(u) from unnest(array['ann', 'rev', 'inc', 'bob', 'unc', 'lea']) u;
update auth.users set email_confirmed_at = null where id = tests.id('unc');
select tests.handover('h', 'ann', 'outgoing');
select tests.handover('h2', 'ann', 'outgoing');
select tests.member('h', 'rev', 'reviewer');

-- invite(p_name, handover, email, role) as ann; the raw token is the name, its hash sha256(name)
create function tests.invite(p_name text, p_handover text, p_email text, p_role text, p_clearance text default null) returns uuid
language plpgsql as $$
declare v uuid;
begin
  perform tests.as_user('ann');
  v := public.invite_member(tests.actor(), tests.id(p_handover), p_email, p_role, p_clearance, sha256(convert_to(p_name, 'UTF8')),
                            now() + interval '7 days');
  perform tests.as_owner();
  return tests.put(p_name, v);
end $$;
create function tests.h(p_name text) returns bytea language sql immutable as $$ select sha256(convert_to(p_name, 'UTF8')) $$;
create function tests.details(p_name text, p_viewer text default null) returns jsonb language plpgsql as $$
declare v jsonb;
begin
  perform tests.as_service();
  v := public.get_member_invite_details(tests.h(p_name), case when p_viewer is null then null else tests.id(p_viewer) end);
  perform tests.as_owner();
  return v;
end $$;
create function tests.redeem(p_name text, p_user text) returns jsonb language plpgsql as $$
declare v jsonb;
begin
  perform tests.as_service();
  v := public.redeem_member_invite(tests.h(p_name), tests.id(p_user));
  perform tests.as_owner();
  return v;
end $$;

select tests.invite('inv-inc', 'h', 'INC@example.test', 'incoming');
select tests.invite('inv-unc', 'h', 'unc@example.test', 'incoming');
select tests.invite('inv-exp', 'h', 'bob@example.test', 'lead');
select tests.invite('inv-rev', 'h', 'lea@example.test', 'reviewer');
select tests.invite('inv-del', 'h2', 'bob@example.test', 'incoming');

-- ── 1. details ──────────────────────────────────────────────────────────────
do $$
declare v jsonb;
begin
  perform tests.as_service();
  perform tests.throws(format('select public.get_member_invite_details(%L, null)', tests.h('no-such-token')), 'BTTI0', 'unknown token → token_invalid');
  perform tests.throws(format('select public.get_member_invite_details(%L, null)', tests.h('Inv-inc')), 'BTTI0', 'the hash is exact');
  perform tests.as_owner();

  v := tests.details('inv-inc');
  perform tests.eq(v ->> 'state', 'pending', 'pending invitation');
  perform tests.eq(v ->> 'handover_title', 'Handover h', 'pending shows the handover title');
  perform tests.eq(v ->> 'inviter_name', (select display_name from public.profiles where id = tests.id('ann')), 'pending shows the inviter''s display name');
  perform tests.eq(v ->> 'role', 'incoming', 'pending shows the role');
  perform tests.eq(v ->> 'recipient_email_masked', 'i***@example.test', 'the address is masked');
  perform tests.ok(v -> 'viewer' = 'null'::jsonb, 'signed out: no viewer');
  perform tests.ok(not (v::text ilike '%inc@example.test%'), 'the full address is never returned');
  perform tests.ok(v -> 'member_handover_id' = 'null'::jsonb, 'no handover id for a non-member');
  perform tests.ok(v ->> 'expires_at' is not null, 'pending shows the expiry');

  v := tests.details('inv-inc', 'inc');
  perform tests.eq(v -> 'viewer', '{"email_matches": true, "email_confirmed": true, "already_member": false}'::jsonb,
                   'the invited, confirmed viewer (case-insensitive address)');
  v := tests.details('inv-inc', 'bob');
  perform tests.eq((v -> 'viewer' ->> 'email_matches')::boolean, false, 'a different signed-in address');
  v := tests.details('inv-unc', 'unc');
  perform tests.eq(v -> 'viewer', '{"email_matches": true, "email_confirmed": false, "already_member": false}'::jsonb,
                   'the invited address, unconfirmed');
  v := tests.details('inv-inc', 'rev');
  perform tests.eq((v -> 'viewer' ->> 'already_member')::boolean, true, 'a viewer who is already a member');
  perform tests.eq((v ->> 'member_handover_id')::uuid, tests.id('h'), 'an existing member learns where to go');
  perform tests.eq(v ->> 'member_role', 'reviewer', 'with their own role');
end $$;

do $$
declare v jsonb;
begin
  -- an unknown viewer id is treated as signed out
  perform tests.as_service();
  v := public.get_member_invite_details(tests.h('inv-inc'), gen_random_uuid());
  perform tests.as_owner();
  perform tests.ok(v -> 'viewer' = 'null'::jsonb, 'an unknown viewer is treated as signed out');

  -- expired
  update public.access_tokens set expires_at = now() - interval '1 minute', created_at = now() - interval '2 days' where id = tests.id('inv-exp');
  v := tests.details('inv-exp', 'bob');
  perform tests.eq(v, '{"state": "expired"}'::jsonb, 'expired: the state only');

  -- revoked
  perform tests.as_user('ann');
  perform public.revoke_access_token(tests.actor(), tests.id('inv-unc'));
  perform tests.as_owner();
  perform tests.eq(tests.details('inv-unc', 'unc'), '{"state": "revoked"}'::jsonb, 'revoked: the state only');

  -- unavailable (deleted handover)
  update public.handovers set deleted_at = now() where id = tests.id('h2');
  perform tests.eq(tests.details('inv-del', 'bob'), '{"state": "unavailable"}'::jsonb, 'deleted handover: unavailable, nothing else');
end $$;

-- ── 2. idempotent acceptance ────────────────────────────────────────────────
do $$
declare
  v jsonb;
  v2 jsonb;
begin
  v := tests.redeem('inv-inc', 'inc');
  perform tests.eq((v ->> 'replayed')::boolean, false, 'first redemption writes');
  perform tests.eq(v ->> 'role', 'incoming', 'the invited role');
  v2 := tests.redeem('inv-inc', 'inc');
  perform tests.eq((v2 ->> 'replayed')::boolean, true, 'second redemption by the same user is a replay');
  perform tests.eq(v2 ->> 'member_id', v ->> 'member_id', 'the replay returns the same membership');
  perform tests.eq((select use_count from public.access_tokens where id = tests.id('inv-inc')), 1, 'the replay does not consume the token');
  perform tests.eq((select count(*)::int from public.audit_logs where action = 'member.joined' and actor_token_id = tests.id('inv-inc')), 1,
                   'the replay writes no audit row');
  perform tests.eq((select count(*)::int from public.handover_members where handover_id = tests.id('h') and profile_id = tests.id('inc')), 1,
                   'exactly one membership');

  perform tests.as_service();
  perform tests.throws(format('select public.redeem_member_invite(%L, %L)', tests.h('inv-inc'), tests.id('bob')), 'BTTI0',
                       'a used invitation cannot be redeemed by anyone else');
  perform tests.as_owner();

  -- details after acceptance: the member sees "accepted", anyone else "used"
  v := tests.details('inv-inc', 'inc');
  perform tests.eq(v, jsonb_build_object('state', 'accepted', 'handover_id', tests.id('h'), 'role', 'incoming'), 'accepted, for the member');
  perform tests.eq(tests.details('inv-inc', 'bob'), '{"state": "used"}'::jsonb, 'used, for anyone else');
  perform tests.eq(tests.details('inv-inc'), '{"state": "used"}'::jsonb, 'used, signed out');

  -- a removed member cannot replay the old invitation back into the handover
  update public.handover_members set removed_at = now() where handover_id = tests.id('h') and profile_id = tests.id('inc');
  perform tests.as_service();
  perform tests.throws(format('select public.redeem_member_invite(%L, %L)', tests.h('inv-inc'), tests.id('inc')), 'BTTI0',
                       'a removed member cannot replay a used invitation');
  perform tests.as_owner();
  update public.handover_members set removed_at = null where handover_id = tests.id('h') and profile_id = tests.id('inc');

  -- expired and revoked stay refused, for the right person too
  perform tests.as_service();
  perform tests.throws(format('select public.redeem_member_invite(%L, %L)', tests.h('inv-exp'), tests.id('bob')), 'BTTI0', 'expired');
  perform tests.throws(format('select public.redeem_member_invite(%L, %L)', tests.h('inv-unc'), tests.id('unc')), 'BTTI0', 'revoked');
  perform tests.as_owner();
end $$;

-- ── 3. scope: only the intended handover and role ───────────────────────────
do $$
begin
  perform tests.eq((select role || '/' || clearance from public.handover_members where handover_id = tests.id('h') and profile_id = tests.id('inc')),
                   'incoming/everyone', 'incoming with the default clearance');
  perform tests.ok(not exists (select 1 from public.handover_members where handover_id = tests.id('h2') and profile_id = tests.id('inc')),
                   'nothing on another handover');
  perform tests.redeem('inv-rev', 'lea');
  perform tests.eq((select role || '/' || clearance from public.handover_members where handover_id = tests.id('h') and profile_id = tests.id('lea')),
                   'reviewer/reviewer_only', 'review roles are always reviewer_only');
  perform tests.as_reader('inc');
  perform tests.ok(public.api_get_handover(tests.id('h2')) is null, 'the new member cannot read the other handover');
  perform tests.ok(public.api_get_handover(tests.id('h')) is not null, 'the new member reads the invited handover');
  perform tests.as_owner();
end $$;

-- ── 4. reissue and recipient ────────────────────────────────────────────────
select tests.invite('inv-re', 'h', 'new.person@example.test', 'lead', 'leads_only');
do $$
declare v jsonb;
begin
  perform tests.as_user('rev');
  perform tests.throws(format('select public.reissue_member_invite(%L, %L, %L, %L)', tests.actor(), tests.id('inv-re'), tests.h('inv-re2'), now() + interval '7 days'),
                       'BTFB0', 'a non-creator member cannot reissue');
  perform tests.throws(format('select public.member_invite_recipient(%L, %L)', tests.actor(), tests.id('inv-re')), 'BTNF0',
                       'a non-creator never sees the address');
  perform tests.as_user('bob');
  perform tests.throws(format('select public.reissue_member_invite(%L, %L, %L, %L)', tests.actor(), tests.id('inv-re'), tests.h('inv-re2'), now() + interval '7 days'),
                       'BTNF0', 'a non-member cannot reissue');
  perform tests.as_user('ann');
  perform tests.eq(public.member_invite_recipient(tests.actor(), tests.id('inv-re')), 'new.person@example.test', 'the creator gets the address');
  perform tests.throws(format('select public.reissue_member_invite(%L, %L, %L, %L)', tests.actor(), tests.id('inv-re'), tests.h('inv-re2'), now() + interval '31 days'),
                       'BTVF0', 'expiry within 30 days');
  perform tests.throws(format('select public.reissue_member_invite(%L, %L, %L, %L)', tests.actor(), tests.id('inv-inc'), tests.h('inv-re2'), now() + interval '7 days'),
                       'BTIT0', 'a used invitation cannot be reissued');
  -- atomic: a failing insert (duplicate hash) leaves the old invitation active
  perform tests.throws(format('select public.reissue_member_invite(%L, %L, %L, %L)', tests.actor(), tests.id('inv-re'), tests.h('inv-rev'), now() + interval '7 days'),
                       '23505', 'a duplicate token hash fails');
  perform tests.as_owner();
  perform tests.ok((select revoked_at is null from public.access_tokens where id = tests.id('inv-re')), 'a failed reissue revokes nothing');

  perform tests.as_user('ann');
  v := public.reissue_member_invite(tests.actor(), tests.id('inv-re'), tests.h('inv-re2'), now() + interval '7 days');
  perform tests.as_owner();
  perform tests.eq(v ->> 'recipient_email', 'new.person@example.test', 'the server gets the address for the email');
  perform tests.ok((select revoked_at is not null from public.access_tokens where id = tests.id('inv-re')), 'the old invitation is revoked');
  perform tests.eq((select purpose || '/' || recipient_email::text || '/' || grant_role || '/' || grant_clearance || '/' || max_uses
                      from public.access_tokens where id = (v ->> 'token_id')::uuid),
                   'member_invite/new.person@example.test/lead/leads_only/1', 'same address, role and clearance; single use');
  perform tests.eq((select count(*)::int from public.audit_logs where action = 'member.invite_reissued' and entity_id = (v ->> 'token_id')::uuid), 1,
                   'the reissue is audited');
  perform tests.eq(tests.details('inv-re2') ->> 'state', 'pending', 'the new link works');
  perform tests.eq(tests.details('inv-re'), '{"state": "revoked"}'::jsonb, 'the old link says revoked');
  perform tests.put('inv-re2', (v ->> 'token_id')::uuid);
end $$;

-- ── 5. delivery records ─────────────────────────────────────────────────────
do $$
declare v jsonb;
begin
  perform tests.as_user('rev');
  perform tests.throws(format($q$select public.record_invitation_delivery(%L, %L, 'sent', null, null)$q$, tests.actor(), tests.id('inv-re2')), 'BTNF0',
                       'only the creator records a delivery');
  perform tests.as_user('ann');
  perform tests.throws(format($q$select public.record_invitation_delivery(%L, %L, 'delivered', null, null)$q$, tests.actor(), tests.id('inv-re2')), '23514',
                       'unknown status');
  perform tests.throws(format($q$select public.record_invitation_delivery(%L, %L, 'sent', 'provider_failed', null)$q$, tests.actor(), tests.id('inv-re2')), '23514',
                       'a sent email has no reason');
  perform tests.throws(format($q$select public.record_invitation_delivery(%L, %L, 'sent', null, 'bad ref with spaces')$q$, tests.actor(), tests.id('inv-re2')), '23514',
                       'the provider reference is a plain id');
  perform public.record_invitation_delivery(tests.actor(), tests.id('inv-re2'), 'failed', 'provider_failed', null);
  perform public.record_invitation_delivery(tests.actor(), tests.id('inv-re2'), 'sent', null, 'msg_0123-abc');
  perform public.record_invitation_delivery(tests.actor(), tests.id('inv-exp'), 'not_sent', 'email_not_configured', null);
  perform tests.as_owner();
  perform tests.eq((select count(*)::int from public.audit_logs where action = 'member.invite_delivery'), 3, 'each delivery is audited');

  perform tests.as_reader('ann');
  v := public.list_access_tokens(tests.id('h'), 'member_invite', false);
  perform tests.eq((select t ->> 'delivery_status' from jsonb_array_elements(v) t where (t ->> 'id')::uuid = tests.id('inv-re2')), 'sent',
                   'the creator sees the latest delivery outcome');
  perform tests.eq((select t ->> 'delivery_status' from jsonb_array_elements(v) t where (t ->> 'id')::uuid = tests.id('inv-exp')), 'not_sent',
                   'not sent');
  perform tests.ok((select t -> 'delivery_status' = 'null'::jsonb from jsonb_array_elements(v) t where (t ->> 'id')::uuid = tests.id('inv-rev')),
                   'never attempted: null');
  perform tests.as_reader('rev');
  perform tests.eq(jsonb_array_length(public.list_access_tokens(tests.id('h'), 'member_invite', false)), 0, 'other review roles see no invitations');
  perform tests.as_owner();
end $$;

-- ── 6. rate-limit scopes ────────────────────────────────────────────────────
do $$
declare
  i int;
  v boolean;
  s text := repeat('ab', 32);
begin
  perform tests.as_service();
  for i in 1..20 loop
    perform tests.ok(public.consume_rate_limit('invite_send_actor', s), 'within the per-creator limit');
  end loop;
  perform tests.ok(not public.consume_rate_limit('invite_send_actor', s), 'the 21st invitation in an hour is refused');
  for i in 1..5 loop
    v := public.consume_rate_limit('invite_send_recipient', s);
  end loop;
  perform tests.ok(v, '5 per recipient');
  perform tests.ok(not public.consume_rate_limit('invite_send_recipient', s), 'the 6th to one address is refused');
  perform tests.ok(public.consume_rate_limit('invite_view_client', s) and public.consume_rate_limit('invite_view_token', s), 'view scopes exist');
  perform tests.ok(public.consume_rate_limit('invite_redeem_token', s), 'existing scopes still work');
  perform tests.throws($q$select public.consume_rate_limit('invite_spam', repeat('ab', 32))$q$, 'BTVF0', 'unknown scope still refused');
  perform tests.as_owner();
end $$;

-- ── 7. privileges ───────────────────────────────────────────────────────────
do $$
declare
  r text;
  f text;
begin
  foreach r in array array['anon', 'authenticated'] loop
    foreach f in array array['public.get_member_invite_details(bytea,uuid)', 'public.record_invitation_delivery(uuid,uuid,text,text,text)',
                             'public.reissue_member_invite(uuid,uuid,bytea,timestamp with time zone)', 'public.member_invite_recipient(uuid,uuid)',
                             'public._mask_email(text)'] loop
      perform tests.ok(not has_function_privilege(r, f, 'EXECUTE'), format('%s cannot execute %s', r, f));
    end loop;
  end loop;
  foreach f in array array['public.get_member_invite_details(bytea,uuid)', 'public.record_invitation_delivery(uuid,uuid,text,text,text)',
                           'public.reissue_member_invite(uuid,uuid,bytea,timestamp with time zone)', 'public.member_invite_recipient(uuid,uuid)'] loop
    perform tests.ok(has_function_privilege('service_role', f, 'EXECUTE'), 'service_role executes ' || f);
  end loop;
  perform tests.ok(not has_function_privilege('service_role', 'public._mask_email(text)', 'EXECUTE'), 'the masking helper is internal');
  perform tests.ok(not has_function_privilege('authenticated', 'public.redeem_member_invite(bytea,uuid)', 'EXECUTE'), 'redemption stays server-only');
  foreach r in array array['anon', 'authenticated', 'service_role'] loop
    perform tests.ok(not has_table_privilege(r, 'public.invitation_deliveries', 'SELECT') and not has_table_privilege(r, 'public.invitation_deliveries', 'INSERT'),
                     r || ' cannot read or write delivery records directly');
  end loop;
  perform tests.ok((select relrowsecurity from pg_class where oid = 'public.invitation_deliveries'::regclass), 'RLS is on');
  perform tests.eq(public._mask_email('a@b.example'), 'a***@b.example', 'masking keeps the domain');
end $$;

select 'ok' as result;
