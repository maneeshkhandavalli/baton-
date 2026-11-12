-- R3 C1 (draft metadata editing): update_handover_details.
--
-- Additive: one new SECURITY DEFINER mutation, server-only like every other application mutation (H1).
-- The server action passes the verified actor and ALREADY MASKED free text (§12.1).
--
-- Rules (checked in this order, so a hidden handover and a missing one fail identically, §8.5):
--   validation_failed   bad lengths / missing concurrency token (row-independent, checked first)
--   not_found           unknown, soft-deleted, or the actor is not an active member
--   forbidden           the actor is neither the creator nor an outgoing member
--   invalid_transition  the handover is not in `draft`
--   conflict            `p_expected_updated_at` is not the row's current updated_at (optimistic concurrency)
--
-- `p_expected_updated_at` is compared at MILLISECOND precision: the DTO's updatedAt is a JavaScript ISO
-- string (lib/db/mappers.ts truncates the microseconds), so both sides are truncated the same way.
--
-- Optional fields: NULL keeps the stored value (HandoverSummary does not carry `description`, so an editor
-- that never saw it must not erase it); an empty string clears it.
--
-- Idempotent retries: when the requested values already equal the stored ones, nothing is written and the
-- current updated_at is returned even if the token is stale (a retried autosave whose first attempt
-- committed is not a conflict, because nothing would be overwritten).
--
-- Returns the row's updated_at after the call.

create function public.update_handover_details(p_actor_profile_id uuid,
  p_handover_id uuid, p_expected_updated_at timestamptz,
  p_title text, p_team_name text, p_role_title text default null, p_description text default null
)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := public._require_actor(p_actor_profile_id);
  v_h public.handovers;
  v_title text := btrim(p_title);
  v_team text := btrim(p_team_name);
  v_role text;
  v_desc text;
  v_fields text[] := '{}';
  v_updated timestamptz;
begin
  if p_expected_updated_at is null then
    raise exception 'the last seen updated_at is required' using errcode = 'BTVF0';
  end if;
  if v_title is null or char_length(v_title) not between 3 and 120 then
    raise exception 'title must be 3 to 120 characters' using errcode = 'BTVF0';
  end if;
  if v_team is null or char_length(v_team) not between 2 and 120 then
    raise exception 'team name must be 2 to 120 characters' using errcode = 'BTVF0';
  end if;
  if p_role_title is not null and char_length(btrim(p_role_title)) > 120 then
    raise exception 'role title is at most 120 characters' using errcode = 'BTVF0';
  end if;
  if p_description is not null and char_length(btrim(p_description)) > 2000 then
    raise exception 'description is at most 2000 characters' using errcode = 'BTVF0';
  end if;

  v_h := public._lock_handover_for_update(p_handover_id);
  if not public._is_member_as(v_actor, p_handover_id) then
    raise exception 'handover not found' using errcode = 'BTNF0';
  end if;
  if not (public._is_creator_as(v_actor, p_handover_id) or public._member_role_as(v_actor, p_handover_id) = 'outgoing') then
    raise exception 'only the creator or an outgoing member can edit the details' using errcode = 'BTFB0';
  end if;
  if v_h.state <> 'draft' then
    raise exception 'details can be edited only while the handover is a draft' using errcode = 'BTIT0';
  end if;

  v_role := case when p_role_title is null then v_h.role_title else nullif(btrim(p_role_title), '') end;
  v_desc := case when p_description is null then v_h.description else nullif(btrim(p_description), '') end;

  if v_title is distinct from v_h.title then v_fields := v_fields || 'title'::text; end if;
  if v_team is distinct from v_h.team_name then v_fields := v_fields || 'teamName'::text; end if;
  if v_role is distinct from v_h.role_title then v_fields := v_fields || 'roleTitle'::text; end if;
  if v_desc is distinct from v_h.description then v_fields := v_fields || 'description'::text; end if;

  if cardinality(v_fields) = 0 then
    return v_h.updated_at; -- nothing would change: an idempotent retry, never a conflict
  end if;
  if date_trunc('milliseconds', v_h.updated_at) <> date_trunc('milliseconds', p_expected_updated_at) then
    raise exception 'the draft changed since it was loaded' using errcode = 'BTCF0';
  end if;

  update public.handovers
     set title = v_title, team_name = v_team, role_title = v_role, description = v_desc
   where id = p_handover_id
  returning updated_at into v_updated;

  -- Field names only: the (masked) values themselves are not copied into the audit log.
  perform public._audit(p_handover_id, v_actor, null, 'handover.details_updated', 'handover', p_handover_id, null,
                        jsonb_build_object('fields', to_jsonb(v_fields)));
  return v_updated;
end $$;

revoke execute on function public.update_handover_details(uuid, uuid, timestamptz, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.update_handover_details(uuid, uuid, timestamptz, text, text, text, text) to service_role;
