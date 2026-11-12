-- R3 C2 (duplicate-draft prevention): create_handover becomes idempotent for an immediate resubmission.
--
-- A double-click, a retried request after a dropped response, or a re-rendered wizard can call
-- create_handover twice with the same details. The second call now returns the FIRST draft's id instead of
-- creating a second, empty draft. It applies only when ALL of these hold for an existing handover:
--   * created by the same actor in the last 2 minutes, not deleted, still `draft` and never updated;
--   * the same (trimmed) title, team name, role title and description, and the same creator role;
--   * nothing was added yet: no source row (of any state), no member other than the creator, no token.
-- Anything else (different details, an older draft, a draft the user already worked on) still creates a
-- new handover, so a deliberate second draft is always possible.
--
-- Concurrency: a transaction-scoped advisory lock per actor serialises that actor's create_handover calls,
-- so two simultaneous submissions cannot both miss each other (READ COMMITTED: the statement after the
-- lock sees the other call's committed row).
--
-- CREATE OR REPLACE with an unchanged signature: the existing grants (service_role only) are kept.

create or replace function public.create_handover(p_actor_profile_id uuid,
  p_title text, p_team_name text, p_role_title text, p_description text, p_creator_role text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := public._require_actor(p_actor_profile_id);
  v_id uuid;
  v_title text := btrim(p_title);
  v_team text := btrim(p_team_name);
  v_role text := nullif(btrim(p_role_title), '');
  v_desc text := nullif(btrim(p_description), '');
begin
  if p_creator_role is null or p_creator_role not in ('outgoing', 'reviewer') then
    raise exception 'creator role must be outgoing or reviewer' using errcode = 'BTVF0';
  end if;
  if not exists (select 1 from public.profiles where id = v_actor and deleted_at is null) then
    raise exception 'profile not found' using errcode = 'BTUA0';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('baton.create_handover:' || v_actor::text, 0));

  select h.id into v_id
    from public.handovers h
    join public.handover_members m on m.handover_id = h.id and m.profile_id = v_actor and m.removed_at is null
   where h.created_by = v_actor
     and h.deleted_at is null
     and h.state = 'draft'
     and h.created_at > now() - interval '2 minutes'
     and h.updated_at = h.created_at
     and h.title = v_title and h.team_name = v_team
     and h.role_title is not distinct from v_role and h.description is not distinct from v_desc
     and m.role = p_creator_role
     and not exists (select 1 from public.sources s where s.handover_id = h.id)
     and not exists (select 1 from public.handover_members o where o.handover_id = h.id and o.profile_id <> v_actor)
     and not exists (select 1 from public.access_tokens t where t.handover_id = h.id)
   order by h.created_at desc
   limit 1;
  if v_id is not null then
    return v_id; -- the same submission again: no second draft, nothing written
  end if;

  insert into public.handovers (title, team_name, role_title, description, created_by)
  values (v_title, v_team, v_role, v_desc, v_actor)
  returning id into v_id;

  insert into public.handover_members (handover_id, profile_id, role, clearance, ack_required)
  values (v_id, v_actor, p_creator_role, 'reviewer_only', false);

  perform public._audit(v_id, v_actor, null, 'handover.created', 'handover', v_id, null,
                        jsonb_build_object('state', 'draft', 'creatorRole', p_creator_role));
  return v_id;
end $$;
