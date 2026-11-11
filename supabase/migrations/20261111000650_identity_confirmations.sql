-- R8 (D29, §6.8, §6.8.1, §12.2): how exclusion rules reach the parser, and the creator's explicit
-- per-source decision on handover-wide NAME exclusions.
--
-- Saved names are weak identities: two people can share one, so a handover-wide `name` exclusion is
-- never applied to another source silently. For every source other than the one it was chosen in it is
-- passed to the parser in `detect` mode, and the final parse fails before anything is persisted until
-- the creator answers confirm_identity_match for that source (§10.3 step 3). Phone exclusions are strong
-- identities and apply everywhere.

-- ── source_identity_confirmations integrity and RLS (§6.8.1) ─────────────────

create function public._guard_identity_confirmation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and (new.handover_id, new.source_id, new.exclusion_id)
                          is distinct from (old.handover_id, old.source_id, old.exclusion_id) then
    raise exception 'an identity confirmation cannot be moved to another source or exclusion' using errcode = 'BTVF0';
  end if;
  if not exists (
    select 1 from public.source_exclusions e
     where e.id = new.exclusion_id and e.handover_id = new.handover_id
       and e.kind = 'participant' and e.participant_identity_kind = 'name' and e.source_id is null
  ) then
    raise exception 'identity confirmations apply only to handover-wide name exclusions' using errcode = 'BTVF0';
  end if;
  return new;
end $$;

create trigger source_identity_confirmations_guard
  before insert or update on public.source_identity_confirmations
  for each row execute function public._guard_identity_confirmation();

-- ── Identity immutability (§6.6, §6.8, §12.11) ──────────────────────────────
-- A participant's identity (kind, hash, pepper version) and keys never change after the parse persisted
-- them. The only permitted update is participant erasure (§12.8 step 1: label, excluded, message count),
-- under its transaction-local flag. Exclusions are append-only (§6.8): no update at all; rows disappear only
-- through the source or handover purge cascade.

create function public._guard_source_participant_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (new.id, new.handover_id, new.source_id, new.local_id, new.identity_kind, new.identity_hash, new.identity_pepper_version)
     is distinct from (old.id, old.handover_id, old.source_id, old.local_id, old.identity_kind, old.identity_hash,
                       old.identity_pepper_version) then
    raise exception 'a participant''s identity is immutable' using errcode = 'BTIT0';
  end if;
  if not public._privileged('baton.erasure') then
    raise exception 'participants change only through participant erasure' using errcode = 'BTIT0';
  end if;
  return new;
end $$;

create trigger source_participants_guard_update
  before update on public.source_participants
  for each row execute function public._guard_source_participant_update();

create function public._guard_source_exclusion_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception 'exclusions are append-only' using errcode = 'BTIT0';
end $$;

create trigger source_exclusions_guard_update
  before update on public.source_exclusions
  for each row execute function public._guard_source_exclusion_update();

-- Review roles read (§6.8.1). No client writes: confirm_identity_match is the only writer.
create policy source_identity_confirmations_select on public.source_identity_confirmations
  for select to authenticated using (public.is_review_role(handover_id));

-- ── Effective rule mode (§6.8 "Scope", §11.4 ExclusionRule.mode) ─────────────
-- For exclusion E and source S: 'apply', 'detect', or 'none' when E does not apply to S at all.
--   * an exclusion scoped to S: apply (any kind);
--   * an exclusion scoped to another source: none;
--   * handover-wide phone participant, conversation-free date range: apply;
--   * handover-wide NAME participant: apply only after a same_person decision for S, none after a
--     different_person decision, otherwise detect (never drops content by itself).
-- Conversation exclusions are always source-scoped (CHECK on source_exclusions).

create function public._exclusion_rule_mode(p_exclusion public.source_exclusions, p_source_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when p_exclusion.source_id is not null then
      case when p_exclusion.source_id = p_source_id then 'apply' else 'none' end
    when p_exclusion.kind <> 'participant' or p_exclusion.participant_identity_kind = 'phone' then 'apply'
    else coalesce((
      select case c.decision when 'same_person' then 'apply' else 'none' end
        from public.source_identity_confirmations c
       where c.source_id = p_source_id and c.exclusion_id = p_exclusion.id), 'detect')
  end
$$;

-- The rule as the parser receives it, or NULL when it does not apply to the source.
create function public._exclusion_rule_json(p_exclusion public.source_exclusions, p_source_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when m.mode = 'none' then null
    when p_exclusion.kind = 'participant' then jsonb_build_object(
      'kind', 'participant', 'ruleId', p_exclusion.id,
      'identityKind', p_exclusion.participant_identity_kind,
      'participantIdentityHash', encode(p_exclusion.participant_identity_hash, 'hex'),
      'identityPepperVersion', p_exclusion.participant_identity_pepper_version,
      'mode', m.mode)
    when p_exclusion.kind = 'conversation' then jsonb_build_object(
      'kind', 'conversation', 'ruleId', p_exclusion.id,
      'conversationLocalId', p_exclusion.conversation_local_id,
      'context', jsonb_build_object('timezone', p_exclusion.parse_timezone,
                                    'dateOrder', p_exclusion.parse_date_order, -- JSON null for documents
                                    'parserVersion', p_exclusion.parser_version))
    else jsonb_build_object(
      'kind', 'date_range', 'ruleId', p_exclusion.id,
      'rangeStart', p_exclusion.range_start, 'rangeEnd', p_exclusion.range_end)
  end
  from (select public._exclusion_rule_mode(p_exclusion, p_source_id) as mode) m
$$;

-- Exclusion rules for a source's preview and final parse (§10.3, §11.4 ExclusionRule[]), read by
-- server code with the service role. Preview and parse receive the same list (D33).
create function public.parse_exclusion_rules(p_source_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(r.rule order by r.created_at, r.id), '[]'::jsonb)
    from (
      select public._exclusion_rule_json(e, s.id) as rule, e.created_at, e.id
        from public.sources s
        join public.source_exclusions e on e.handover_id = s.handover_id
       where s.id = p_source_id
    ) r
   where r.rule is not null
$$;

-- ── confirmIdentityMatch (§6.8.1, §11.3) ─────────────────────────────────────
-- Creator only, server-only mutation (§8.3). Only before the source is parsed, and not while a run is
-- processing the handover, so a decision can never change under an in-flight parse.

create function public.confirm_identity_match(
  p_actor_profile_id uuid, p_source_id uuid, p_exclusion_id uuid, p_decision text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := public._require_actor(p_actor_profile_id);
  v_s public.sources;
  v_h public.handovers;
  v_e public.source_exclusions;
  v_before text;
begin
  if p_decision is null or p_decision not in ('same_person', 'different_person') then
    raise exception 'unknown identity match decision' using errcode = 'BTVF0';
  end if;
  select * into v_s from public.sources where id = p_source_id;
  if not found or v_s.deleted_at is not null then
    raise exception 'source not found' using errcode = 'BTNF0';
  end if;
  v_h := public._lock_handover_for_share(v_s.handover_id);
  if not public._is_member_as(v_actor, v_s.handover_id) then
    raise exception 'source not found' using errcode = 'BTNF0';
  end if;
  if not public._is_creator_as(v_actor, v_s.handover_id) then
    raise exception 'only the creator decides identity matches' using errcode = 'BTFB0';
  end if;
  select * into v_s from public.sources where id = p_source_id for update;
  if v_s.state in ('parsed', 'removed') or v_s.deleted_at is not null then
    raise exception 'this source was already parsed' using errcode = 'BTIT0';
  end if;
  if v_h.state = 'processing' then
    raise exception 'identity matches cannot change while the handover is processing' using errcode = 'BTIT0';
  end if;
  select * into v_e from public.source_exclusions where id = p_exclusion_id and handover_id = v_s.handover_id;
  if not found then
    raise exception 'exclusion not found' using errcode = 'BTNF0';
  end if;
  if v_e.kind <> 'participant' or v_e.participant_identity_kind is distinct from 'name' or v_e.source_id is not null then
    raise exception 'only handover-wide name exclusions need a per-source decision' using errcode = 'BTVF0';
  end if;

  select decision into v_before from public.source_identity_confirmations
   where source_id = p_source_id and exclusion_id = p_exclusion_id for update;
  insert into public.source_identity_confirmations (handover_id, source_id, exclusion_id, decision, decided_by, decided_at)
  values (v_s.handover_id, p_source_id, p_exclusion_id, p_decision, v_actor, now())
  on conflict (source_id, exclusion_id)
  do update set decision = excluded.decision, decided_by = excluded.decided_by, decided_at = excluded.decided_at;

  -- Every decision is audited; never the identity hash or a name.
  perform public._audit(v_s.handover_id, v_actor, null, 'source.identity_match_decided', 'source', p_source_id,
                        case when v_before is not null then jsonb_build_object('decision', v_before) end,
                        jsonb_build_object('decision', p_decision, 'exclusionId', p_exclusion_id));
end $$;
