-- Round 4 E follow-up (browser verification, bug C): at most ONE open invitation per handover and address.
--
-- Inviting an address that already had an open invitation (not revoked, not used, not expired) created a second one:
-- two usable single-use links for the same person. Now:
--   * invite_member REFUSES it (BTCF0, hint 'invite_pending'): the creator uses "Send a new link" on the open
--     invitation (reissue_member_invite: revoke + new link in one transaction) or revokes it first. Refusing, rather
--     than silently revoking, never breaks a link the creator already shared. The role is NOT part of the identity:
--     one person can hold at most one membership, so any open invitation to the address counts.
--   * reissue_member_invite revokes the invitation it replaces AND any other open invitation to the same address
--     (an older duplicate), so a reissue always leaves exactly one usable link.
--   * Both take the same transaction-scoped advisory lock on (handover, lower(address)) before reading the open
--     invitations, so two concurrent calls are serialised and a race can never create two open invitations. The lock is
--     taken after the handover share lock and BEFORE any token row lock (redeem_member_invite takes no advisory lock),
--     so no lock cycle is possible.
--   * The "already a member" refusal of both functions gains hint 'already_member' (same SQLSTATE BTCF0), so the server
--     can tell the creator which conflict it is (lib/db/errors.ts passes a snake_case hint as details.reason).
--   * Existing duplicates: every open invitation that has a NEWER open invitation for the same handover and address is
--     revoked (the newest link keeps working), audited as token.revoked with reason duplicate_invitation.
-- Same signatures, grants and security mode for both functions. One new internal helper, not executable by any API role.

-- ── 1. the lock ──────────────────────────────────────────────────────────────

create or replace function public._lock_member_invite_address(p_handover_id uuid, p_email text)
returns void
language sql
set search_path = ''
as $$
  select pg_advisory_xact_lock(hashtextextended('baton.member_invite:' || p_handover_id::text || ':' || lower(btrim(coalesce(p_email, ''))), 0))
$$;

-- ── 2. invite_member ─────────────────────────────────────────────────────────

create or replace function public.invite_member(p_actor_profile_id uuid,
  p_handover_id uuid, p_email text, p_role text, p_clearance text, p_token_hash bytea, p_expires_at timestamptz
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := public._require_actor(p_actor_profile_id);
  v_email text := lower(btrim(p_email));
  v_id uuid;
begin
  -- FOR SHARE serialises with acknowledgePublication's FOR UPDATE, so a final acknowledgement can never
  -- miss a pending incoming invite created at the same moment (D9).
  perform public._lock_handover_for_share(p_handover_id);
  if not public._is_member_as(v_actor, p_handover_id) then
    raise exception 'handover not found' using errcode = 'BTNF0';
  end if;
  if not public._is_creator_as(v_actor, p_handover_id) then
    raise exception 'only the creator can invite members' using errcode = 'BTFB0';
  end if;
  if p_role in ('outgoing', 'reviewer') and p_clearance is not null and p_clearance <> 'reviewer_only' then
    raise exception 'review roles always have reviewer_only clearance' using errcode = 'BTVF0';
  end if;
  if p_expires_at <= now() or p_expires_at > now() + interval '30 days' then
    raise exception 'invites expire within 30 days' using errcode = 'BTVF0';
  end if;
  if exists (
    select 1 from public.handover_members m join auth.users u on u.id = m.profile_id
    where m.handover_id = p_handover_id and m.removed_at is null and lower(u.email) = v_email
  ) then
    raise exception 'this person is already a member' using errcode = 'BTCF0', hint = 'already_member';
  end if;
  -- bug C: one open invitation per address (serialised per handover and address)
  perform public._lock_member_invite_address(p_handover_id, v_email);
  if exists (
    select 1 from public.access_tokens t
     where t.handover_id = p_handover_id and t.purpose = 'member_invite' and t.recipient_email = v_email
       and t.revoked_at is null and t.use_count < t.max_uses and t.expires_at > now()
  ) then
    raise exception 'this person already has an open invitation' using errcode = 'BTCF0', hint = 'invite_pending';
  end if;
  insert into public.access_tokens (handover_id, created_by, purpose, token_hash, recipient_email, grant_role,
                                    grant_clearance, expires_at, max_uses)
  values (p_handover_id, v_actor, 'member_invite', p_token_hash, v_email, p_role,
          case when p_role in ('outgoing', 'reviewer') then 'reviewer_only' else p_clearance end, p_expires_at, 1)
  returning id into v_id;
  perform public._audit(p_handover_id, v_actor, null, 'member.invited', 'access_token', v_id, null,
                        jsonb_build_object('role', p_role));
  return v_id;
end $$;

-- ── 3. reissue_member_invite ─────────────────────────────────────────────────

create or replace function public.reissue_member_invite(p_actor_profile_id uuid,
  p_token_id uuid, p_token_hash bytea, p_expires_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := public._require_actor(p_actor_profile_id);
  v_t public.access_tokens;
  v_id uuid;
  v_other uuid;
begin
  select * into v_t from public.access_tokens where id = p_token_id and purpose = 'member_invite';
  if not found then
    raise exception 'invitation not found' using errcode = 'BTNF0';
  end if;
  -- Lock order: handover (share), the address (advisory), then token rows; as invite_member and redeem_member_invite.
  perform public._lock_handover_for_share(v_t.handover_id);
  if not public._is_member_as(v_actor, v_t.handover_id) then
    raise exception 'invitation not found' using errcode = 'BTNF0';
  end if;
  if not public._is_creator_as(v_actor, v_t.handover_id) then
    raise exception 'only the creator can invite members' using errcode = 'BTFB0';
  end if;
  perform public._lock_member_invite_address(v_t.handover_id, v_t.recipient_email::text); -- the address never changes
  select * into v_t from public.access_tokens where id = p_token_id for update;
  if v_t.use_count >= v_t.max_uses then
    raise exception 'this invitation was already accepted' using errcode = 'BTIT0';
  end if;
  if p_expires_at <= now() or p_expires_at > now() + interval '30 days' then
    raise exception 'invites expire within 30 days' using errcode = 'BTVF0';
  end if;
  if exists (
    select 1 from public.handover_members m join auth.users u on u.id = m.profile_id
    where m.handover_id = v_t.handover_id and m.removed_at is null and lower(u.email) = lower(v_t.recipient_email::text)
  ) then
    raise exception 'this person is already a member' using errcode = 'BTCF0', hint = 'already_member';
  end if;

  update public.access_tokens set revoked_at = coalesce(revoked_at, now()) where id = v_t.id;
  insert into public.access_tokens (handover_id, created_by, purpose, token_hash, recipient_email, grant_role,
                                    grant_clearance, expires_at, max_uses)
  values (v_t.handover_id, v_actor, 'member_invite', p_token_hash, v_t.recipient_email, v_t.grant_role,
          v_t.grant_clearance, p_expires_at, 1)
  returning id into v_id;
  perform public._audit(v_t.handover_id, v_actor, null, 'token.revoked', 'access_token', v_t.id, null,
                        jsonb_build_object('purpose', 'member_invite', 'reissuedAs', v_id));
  -- bug C: any other open invitation to the same address is replaced too, so exactly one link stays usable
  for v_other in
    update public.access_tokens t set revoked_at = now()
     where t.handover_id = v_t.handover_id and t.purpose = 'member_invite' and t.recipient_email = v_t.recipient_email
       and t.id not in (v_t.id, v_id) and t.revoked_at is null and t.use_count < t.max_uses
    returning t.id
  loop
    perform public._audit(v_t.handover_id, v_actor, null, 'token.revoked', 'access_token', v_other, null,
                          jsonb_build_object('purpose', 'member_invite', 'reissuedAs', v_id, 'reason', 'duplicate_invitation'));
  end loop;
  perform public._audit(v_t.handover_id, v_actor, null, 'member.invite_reissued', 'access_token', v_id, null,
                        jsonb_build_object('role', v_t.grant_role, 'previous', v_t.id));
  -- The server needs the address to email the new link (service role only; never returned to the browser).
  return jsonb_build_object('token_id', v_id, 'recipient_email', v_t.recipient_email::text);
end $$;

-- ── 4. existing duplicates: keep the newest open invitation per handover and address ─

do $$
declare
  r record;
begin
  for r in
    with open_invites as (
      select t.id, t.handover_id,
             row_number() over (partition by t.handover_id, lower(t.recipient_email::text) order by t.created_at desc, t.id desc) as rn
        from public.access_tokens t
       where t.purpose = 'member_invite' and t.revoked_at is null and t.use_count < t.max_uses and t.expires_at > now()
    )
    update public.access_tokens t set revoked_at = now()
      from open_invites o
     where o.id = t.id and o.rn > 1
    returning t.id, t.handover_id
  loop
    perform public._audit(r.handover_id, null, null, 'token.revoked', 'access_token', r.id, null,
                          jsonb_build_object('purpose', 'member_invite', 'reason', 'duplicate_invitation'));
  end loop;
end $$;

-- ── 5. grants ────────────────────────────────────────────────────────────────

revoke execute on function public._lock_member_invite_address(uuid, text) from public, anon, authenticated, service_role;
