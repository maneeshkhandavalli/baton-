-- Round 3 Task 06: invitation details and idempotent acceptance (docs/round3/task06-contract.md §3.2 items 1-2).
-- ADDITIVE: one new server-only function and CREATE OR REPLACE of redeem_member_invite (same signature, same grants).
-- No table or existing row is changed.
--
-- get_member_invite_details(token_hash, viewer) lets the holder of an invitation link see what it is for before signing
-- in, and why it no longer works. The raw token is a 256-bit bearer secret, so telling its holder that it expired, was
-- revoked or was used reveals nothing to anyone who cannot already present it (contract D1-contract; Gap Interview links
-- stay generic). Only a PENDING invitation shows its handover title, inviter, role, expiry and a MASKED recipient address
-- (D3); every other state shows the state alone. An unknown hash raises token_invalid (BTTI0) exactly as before.
--
-- redeem_member_invite now replays: the same confirmed user who already redeemed a token gets the same membership back
-- ("replayed": true) and nothing is written or audited. Every H3 check (address read from auth.users, confirmed, equal to
-- the invited address) runs BEFORE the replay branch, so a replay needs exactly what the first redemption needed.
-- Concurrent double submits by the same user therefore both succeed (one writes, one replays). Anyone else still gets
-- BTTI0 for a used token.

-- ── 1. details (service role only) ──────────────────────────────────────────

create function public._mask_email(p_email text)
returns text
language sql
immutable
set search_path = ''
as $$
  -- first character of the local part, then ***, then the full domain: n***@example.com
  select left(split_part(p_email, '@', 1), 1) || '***@' || coalesce(substring(p_email from '@([^@]*)$'), '')
$$;

create function public.get_member_invite_details(p_token_hash bytea, p_viewer_profile_id uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_t public.access_tokens;
  v_h public.handovers;
  v_email text;
  v_confirmed timestamptz;
  v_member public.handover_members;
  v_viewer jsonb := null;
  v_state text;
begin
  select * into v_t from public.access_tokens where token_hash = p_token_hash and purpose = 'member_invite';
  if not found then
    raise exception 'invite invalid' using errcode = 'BTTI0';
  end if;
  select * into v_h from public.handovers where id = v_t.handover_id;
  if v_h.deleted_at is not null then
    return jsonb_build_object('state', 'unavailable');
  end if;

  -- The viewer comes from the verified session on the server. An unknown or deleted profile is treated as signed out.
  if p_viewer_profile_id is not null then
    select u.email, u.email_confirmed_at into v_email, v_confirmed
      from auth.users u join public.profiles p on p.id = u.id
     where u.id = p_viewer_profile_id and u.deleted_at is null and p.deleted_at is null;
    if v_email is not null then
      select * into v_member from public.handover_members
       where handover_id = v_t.handover_id and profile_id = p_viewer_profile_id and removed_at is null;
      if v_member.id is not null and v_member.invitation_token_id = v_t.id and v_t.use_count >= v_t.max_uses then
        return jsonb_build_object('state', 'accepted', 'handover_id', v_t.handover_id, 'role', v_member.role);
      end if;
      v_viewer := jsonb_build_object(
        'email_matches', lower(v_email) = lower(v_t.recipient_email::text),
        'email_confirmed', v_confirmed is not null,
        'already_member', v_member.id is not null);
    end if;
  end if;

  v_state := case when v_t.use_count >= v_t.max_uses then 'used'
                  when v_t.revoked_at is not null then 'revoked'
                  when v_t.expires_at <= now() then 'expired'
                  else 'pending' end;
  if v_state <> 'pending' then
    return jsonb_build_object('state', v_state);
  end if;

  return jsonb_build_object(
    'state', 'pending',
    'handover_title', v_h.title,
    'inviter_name', coalesce((select p.display_name from public.profiles p where p.id = v_t.created_by and p.deleted_at is null),
                             'A Baton user'),
    'role', v_t.grant_role,
    'expires_at', v_t.expires_at,
    'recipient_email_masked', public._mask_email(v_t.recipient_email::text),
    'viewer', v_viewer,
    -- only for a viewer who is ALREADY a member of this handover (so it reveals nothing new): where to go instead
    'member_handover_id', case when v_member.id is not null then v_t.handover_id end,
    'member_role', case when v_member.id is not null then v_member.role end);
end $$;

-- ── 2. idempotent redemption (same signature; grants are kept by CREATE OR REPLACE) ──

create or replace function public.redeem_member_invite(p_token_hash bytea, p_profile_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_t public.access_tokens;
  v_existing public.handover_members;
  v_member uuid;
  v_clearance text;
  v_email text;
  v_confirmed timestamptz;
begin
  select t.* into v_t
    from public.access_tokens t join public.handovers h on h.id = t.handover_id
   where t.token_hash = p_token_hash and t.purpose = 'member_invite' and h.deleted_at is null;
  if v_t.id is null then
    raise exception 'invite invalid' using errcode = 'BTTI0';
  end if;
  perform public._lock_handover_for_share(v_t.handover_id);
  select * into v_t from public.access_tokens where id = v_t.id for update;

  select u.email, u.email_confirmed_at into v_email, v_confirmed
    from auth.users u join public.profiles p on p.id = u.id
   where u.id = p_profile_id and u.deleted_at is null and p.deleted_at is null;
  if v_email is null then
    raise exception 'profile not found' using errcode = 'BTUA0';
  end if;
  -- Never reveal which check failed here (§3.2): unconfirmed and mismatched addresses look the same.
  if v_confirmed is null or lower(v_email) <> lower(v_t.recipient_email::text) then
    raise exception 'invite invalid' using errcode = 'BTTI0';
  end if;

  if v_t.use_count >= v_t.max_uses then
    -- Replay: this user already redeemed this very token and is still a member. Nothing is written.
    select * into v_existing from public.handover_members
     where handover_id = v_t.handover_id and profile_id = p_profile_id and removed_at is null and invitation_token_id = v_t.id;
    if found then
      return jsonb_build_object('handover_id', v_t.handover_id, 'role', v_existing.role, 'member_id', v_existing.id,
                                'replayed', true);
    end if;
    raise exception 'invite invalid' using errcode = 'BTTI0';
  end if;
  if v_t.revoked_at is not null or v_t.expires_at <= now() then
    raise exception 'invite invalid' using errcode = 'BTTI0';
  end if;

  v_clearance := case
    when v_t.grant_role in ('outgoing', 'reviewer') then 'reviewer_only'
    else coalesce(v_t.grant_clearance, case v_t.grant_role when 'lead' then 'leads_only' else 'everyone' end)
  end;

  select * into v_existing from public.handover_members where handover_id = v_t.handover_id and profile_id = p_profile_id for update;
  if found and v_existing.removed_at is null then
    raise exception 'already a member' using errcode = 'BTCF0';
  elsif found then
    update public.handover_members
       set role = v_t.grant_role, clearance = v_clearance, ack_required = v_t.grant_role = 'incoming',
           invited_by = v_t.created_by, invitation_token_id = v_t.id, joined_at = now(), removed_at = null
     where id = v_existing.id
    returning id into v_member;
  else
    insert into public.handover_members (handover_id, profile_id, role, clearance, ack_required, invited_by, invitation_token_id)
    values (v_t.handover_id, p_profile_id, v_t.grant_role, v_clearance, v_t.grant_role = 'incoming', v_t.created_by, v_t.id)
    returning id into v_member;
  end if;

  update public.access_tokens set use_count = use_count + 1, last_used_at = now() where id = v_t.id;
  perform public._audit(v_t.handover_id, p_profile_id, v_t.id, 'token.redeemed', 'access_token', v_t.id, null,
                        jsonb_build_object('purpose', 'member_invite'));
  perform public._audit(v_t.handover_id, p_profile_id, v_t.id, 'member.joined', 'handover_member', v_member, null,
                        jsonb_build_object('role', v_t.grant_role, 'clearance', v_clearance));
  return jsonb_build_object('handover_id', v_t.handover_id, 'role', v_t.grant_role, 'member_id', v_member, 'replayed', false);
end $$;

-- ── 3. grants ────────────────────────────────────────────────────────────────

revoke execute on function
  public._mask_email(text),
  public.get_member_invite_details(bytea, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.get_member_invite_details(bytea, uuid) to service_role;
