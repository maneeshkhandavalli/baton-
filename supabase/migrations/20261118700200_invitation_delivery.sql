-- Round 3 Task 06: invitation email delivery records and reissue (docs/round3/task06-contract.md §3.2 items 3-5).
-- ADDITIVE: one append-only, server-only table; three new service-role functions; CREATE OR REPLACE of
-- list_access_tokens that ADDS one key (delivery_status) and changes nothing else. No existing row is changed.
--
-- The raw invitation token is never stored, so an invitation email cannot be "resent": reissue_member_invite revokes the
-- old invitation and creates a new one (same handover, address, role and clearance) in ONE transaction, and the server
-- emails the new link (it returns the new token id and the address, to the server only). A used invitation cannot be
-- reissued.
--
-- invitation_deliveries records what happened to each attempt to email an invitation (sent / not_sent / failed). It
-- never holds the address, the token or the email body; provider_ref is the provider's message id, for operators.

-- ── 1. delivery records ─────────────────────────────────────────────────────

create table public.invitation_deliveries (
  id uuid primary key default gen_random_uuid(),
  handover_id uuid not null references public.handovers (id) on delete cascade,
  token_id uuid not null,
  status text not null check (status in ('sent', 'not_sent', 'failed')),
  reason text check (reason is null or reason in ('email_not_configured', 'provider_failed', 'rate_limited')),
  provider_ref text check (provider_ref is null or provider_ref ~ '^[A-Za-z0-9._:-]{1,200}$'),
  recorded_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default clock_timestamp(), -- ordered even within one transaction
  constraint invitation_deliveries_token_fkey
    foreign key (handover_id, token_id) references public.access_tokens (handover_id, id) on delete cascade,
  constraint invitation_deliveries_reason check ((status = 'sent') = (reason is null))
);
create index invitation_deliveries_token_idx on public.invitation_deliveries (token_id, created_at desc);
alter table public.invitation_deliveries enable row level security; -- no policies: server only

-- Creator only (as every invitation write). Called by the server after it tried to email the link.
create function public.record_invitation_delivery(p_actor_profile_id uuid,
  p_token_id uuid, p_status text, p_reason text default null, p_provider_ref text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := public._require_actor(p_actor_profile_id);
  v_t public.access_tokens;
  v_id uuid;
begin
  select * into v_t from public.access_tokens where id = p_token_id and purpose = 'member_invite';
  if not found or not public._is_creator_as(v_actor, v_t.handover_id)
     or exists (select 1 from public.handovers h where h.id = v_t.handover_id and h.deleted_at is not null) then
    raise exception 'invitation not found' using errcode = 'BTNF0';
  end if;
  insert into public.invitation_deliveries (handover_id, token_id, status, reason, provider_ref, recorded_by)
  values (v_t.handover_id, v_t.id, p_status, p_reason, p_provider_ref, v_actor)
  returning id into v_id;
  perform public._audit(v_t.handover_id, v_actor, null, 'member.invite_delivery', 'access_token', v_t.id, null,
                        jsonb_build_object('status', p_status, 'reason', p_reason));
  return v_id;
end $$;

-- ── 2. reissue ──────────────────────────────────────────────────────────────

create function public.reissue_member_invite(p_actor_profile_id uuid,
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
begin
  select * into v_t from public.access_tokens where id = p_token_id and purpose = 'member_invite';
  if not found then
    raise exception 'invitation not found' using errcode = 'BTNF0';
  end if;
  -- Same lock order as invite_member and redeem_member_invite: handover (share), then the token row.
  perform public._lock_handover_for_share(v_t.handover_id);
  if not public._is_member_as(v_actor, v_t.handover_id) then
    raise exception 'invitation not found' using errcode = 'BTNF0';
  end if;
  if not public._is_creator_as(v_actor, v_t.handover_id) then
    raise exception 'only the creator can invite members' using errcode = 'BTFB0';
  end if;
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
    raise exception 'this person is already a member' using errcode = 'BTCF0';
  end if;

  update public.access_tokens set revoked_at = coalesce(revoked_at, now()) where id = v_t.id;
  insert into public.access_tokens (handover_id, created_by, purpose, token_hash, recipient_email, grant_role,
                                    grant_clearance, expires_at, max_uses)
  values (v_t.handover_id, v_actor, 'member_invite', p_token_hash, v_t.recipient_email, v_t.grant_role,
          v_t.grant_clearance, p_expires_at, 1)
  returning id into v_id;
  perform public._audit(v_t.handover_id, v_actor, null, 'token.revoked', 'access_token', v_t.id, null,
                        jsonb_build_object('purpose', 'member_invite', 'reissuedAs', v_id));
  perform public._audit(v_t.handover_id, v_actor, null, 'member.invite_reissued', 'access_token', v_id, null,
                        jsonb_build_object('role', v_t.grant_role, 'previous', v_t.id));
  -- The server needs the address to email the new link (service role only; never returned to the browser).
  return jsonb_build_object('token_id', v_id, 'recipient_email', v_t.recipient_email::text);
end $$;

-- The invited address of an invitation the actor created (service role; creator only, else not found). The server needs
-- it BEFORE a reissue, to consume the per-recipient send limit before any new token exists (20261118700300).
create function public.member_invite_recipient(p_actor_profile_id uuid, p_token_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid := public._require_actor(p_actor_profile_id);
  v_t public.access_tokens;
begin
  select t.* into v_t from public.access_tokens t join public.handovers h on h.id = t.handover_id
   where t.id = p_token_id and t.purpose = 'member_invite' and h.deleted_at is null;
  if v_t.id is null or not public._is_creator_as(v_actor, v_t.handover_id) then
    raise exception 'invitation not found' using errcode = 'BTNF0';
  end if;
  return v_t.recipient_email::text;
end $$;

-- ── 3. listing: adds delivery_status for invitations (creator only, as recipient_email) ──

create or replace function public.list_access_tokens(p_handover_id uuid, p_purpose text default null, p_active_only boolean default false)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select case when public._is_review_role_as(auth.uid(), p_handover_id)
                   and exists (select 1 from public.handovers h where h.id = p_handover_id and h.deleted_at is null)
              then coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', t.id, 'purpose', t.purpose, 'status', t.status, 'grant_role', t.grant_role,
             'recipient_email', case when t.purpose = 'member_invite' then t.recipient_email::text end,
             'max_access_level', t.max_access_level, 'expires_at', t.expires_at, 'max_uses', t.max_uses,
             'use_count', t.use_count, 'revoked_at', t.revoked_at, 'created_at', t.created_at,
             'delivery_status', case when t.purpose = 'member_invite' then (
                 select d.status from public.invitation_deliveries d
                  where d.token_id = t.id order by d.created_at desc, d.id desc limit 1) end)
           order by t.created_at desc, t.id)
      from (
        select t.*,
               case when t.revoked_at is not null then 'revoked'
                    when t.expires_at <= now() then 'expired'
                    when t.use_count >= t.max_uses then 'exhausted'
                    else 'active' end as status
          from public.access_tokens t
         where t.handover_id = p_handover_id
           and (t.purpose = 'gap_interview' or public._is_creator_as(auth.uid(), p_handover_id))
           and (p_purpose is null or t.purpose = p_purpose)
      ) t
     where not coalesce(p_active_only, false) or t.status = 'active'
  ), '[]'::jsonb) end
$$;

-- ── 4. grants ────────────────────────────────────────────────────────────────

revoke all on public.invitation_deliveries from public, anon, authenticated, service_role;

revoke execute on function
  public.record_invitation_delivery(uuid, uuid, text, text, text),
  public.reissue_member_invite(uuid, uuid, bytea, timestamptz),
  public.member_invite_recipient(uuid, uuid)
  from public, anon, authenticated, service_role;
grant execute on function
  public.record_invitation_delivery(uuid, uuid, text, text, text),
  public.reissue_member_invite(uuid, uuid, bytea, timestamptz),
  public.member_invite_recipient(uuid, uuid)
  to service_role;
