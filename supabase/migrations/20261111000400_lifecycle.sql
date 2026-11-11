-- Status derivation (§4), handover lifecycle (§9), publication and acknowledgement (§6.18, §6.19).
--
-- Locking (§5.5 concurrency item 2, §9.1): every function that may update the handovers row takes
-- `SELECT … FROM handovers … FOR UPDATE` as its FIRST lock. Child-row-only writers take FOR SHARE first
-- and never upgrade.

-- ── Profiles for new auth users ──────────────────────────────────────────────

-- N6: a display name is NEVER taken from raw_user_meta_data (anyone can set it through GoTrue's sign-up
-- API). It is derived from the address the user signed in with, restricted to plain characters, and the
-- labels Baton itself uses ("Former member", "Removed participant", "Participant N", …) are reserved.
-- Duplicate names inside one handover are disambiguated at display time (_handover_label).
create function public._derive_display_name(p_email text, p_profile_id uuid)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when v.name = '' then 'Member ' || left(replace(p_profile_id::text, '-', ''), 4)
    when lower(v.name) in ('former member', 'removed participant', 'member', 'baton', 'system', 'admin')
      or lower(v.name) ~ '^(participant|member)( [0-9a-z]+)?$'
      then 'Member ' || left(replace(p_profile_id::text, '-', ''), 4)
    else v.name
  end
  from (select left(btrim(regexp_replace(split_part(coalesce(p_email, ''), '@', 1), '[^A-Za-z0-9._ -]', '', 'g')), 60) as name) v
$$;

create function public._handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, public._derive_display_name(new.email, new.id))
  on conflict (id) do nothing;
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public._handle_new_auth_user();

-- ── Small internal helpers ───────────────────────────────────────────────────

-- H1 (audit): every application mutation is called by the SERVER with the service role and an actor id
-- taken from a verified Supabase session. This validates that actor id independently: it must be an
-- existing, non-deleted profile whose auth user is not deleted. Defence in depth: client API roles
-- (anon/authenticated) are refused even if a grant is ever added by mistake, and a user JWT whose subject
-- differs from the supplied actor is refused, so a browser can never act as someone else.
create function public._require_actor(p_actor_profile_id uuid)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if coalesce(current_setting('role', true), '') in ('anon', 'authenticated') then
    raise exception 'mutations are server-only' using errcode = 'BTFB0';
  end if;
  if p_actor_profile_id is null then
    raise exception 'sign in required' using errcode = 'BTUA0';
  end if;
  if auth.uid() is not null and auth.uid() <> p_actor_profile_id then
    raise exception 'actor does not match the session' using errcode = 'BTFB0';
  end if;
  if not exists (
    select 1 from public.profiles p join auth.users u on u.id = p.id
     where p.id = p_actor_profile_id and p.deleted_at is null and u.deleted_at is null
  ) then
    raise exception 'sign in required' using errcode = 'BTUA0';
  end if;
  return p_actor_profile_id;
end $$;

create function public._audit(
  p_handover_id uuid, p_actor_profile_id uuid, p_actor_token_id uuid, p_action text,
  p_entity_type text, p_entity_id uuid, p_before jsonb, p_after jsonb, p_access_level text default 'reviewer_only'
)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.audit_logs (handover_id, actor_profile_id, actor_token_id, action, entity_type, entity_id, before, after, access_level)
  values (p_handover_id, p_actor_profile_id, p_actor_token_id, p_action, p_entity_type, p_entity_id, p_before, p_after, p_access_level)
$$;

-- Lock the handover row FOR UPDATE (parent-row writers) and return it. Raises not_found when it does not
-- exist or is soft-deleted (unless p_allow_deleted).
create function public._lock_handover_for_update(p_handover_id uuid, p_allow_deleted boolean default false)
returns public.handovers
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.handovers;
begin
  select * into v from public.handovers where id = p_handover_id for update;
  if not found or (v.deleted_at is not null and not p_allow_deleted) then
    raise exception 'handover not found' using errcode = 'BTNF0';
  end if;
  return v;
end $$;

-- Lock the handover row FOR SHARE (child-row-only writers).
create function public._lock_handover_for_share(p_handover_id uuid)
returns public.handovers
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.handovers;
begin
  select * into v from public.handovers where id = p_handover_id for share;
  if not found or v.deleted_at is not null then
    raise exception 'handover not found' using errcode = 'BTNF0';
  end if;
  return v;
end $$;

-- ── §4.2 recompute_point_status ──────────────────────────────────────────────

create function public.recompute_point_status(p_point_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_p public.handover_points;
  v_as_of timestamptz;
  v_c boolean;
  v_s boolean;
  v_i boolean;
  v_last timestamptz;
  v_max_rank int;
  v_status text;
  v_floor text;
  v_outdated boolean;
  v_reopen boolean;
begin
  select * into v_p from public.handover_points where id = p_point_id;
  if not found or v_p.erased_at is not null then
    return null;
  end if;
  select h.evidence_as_of into v_as_of from public.handovers h where h.id = v_p.handover_id;

  with links as (
    select pe.excluded_at is null as active,
           (q.quote_check in ('exact', 'normalized') and pe.verified_revision_id = v_p.current_revision_id) as verified,
           pe.support_verdict as verdict,
           q.quote_check as qc,
           pe.verified_revision_id is distinct from v_p.current_revision_id as stale,
           q.access_level as lvl,
           coalesce(q.message_sent_at,
                    a.created_at,
                    s.document_date::timestamptz,
                    case when q.kind = 'testimony' then q.created_at end) as supported_at
      from public.point_evidence pe
      join public.evidence_quotes q on q.id = pe.evidence_id
      left join public.gap_answers a on a.id = q.gap_answer_id
      left join public.sources s on s.id = q.source_id
     where pe.point_id = p_point_id
  )
  select coalesce(bool_or(active and verified and verdict = 'contradicts'), false),
         coalesce(bool_or(active and verified and verdict = 'supports'), false),
         coalesce(bool_or(active and qc <> 'not_found' and verdict <> 'irrelevant'
                          and (verdict in ('partial', 'unchecked') or stale)), false),
         max(supported_at) filter (where active and verified and verdict = 'supports'),
         max(public.access_rank(lvl)) -- every link, excluded or not (§8.4)
    into v_c, v_s, v_i, v_last, v_max_rank
    from links;

  v_status := case
    when v_c then 'conflicting'
    when v_s then 'sourced'
    when v_i or coalesce(btrim(v_p.inference_rationale), '') <> '' then 'inferred'
    else 'missing'
  end;
  v_floor := public.max_access(
    (array['everyone', 'leads_only', 'reviewer_only'])[coalesce(v_max_rank, 0) + 1],
    v_p.extraction_access_level);
  v_outdated := v_status = 'sourced' and v_last is not null and v_as_of is not null
                and v_last < v_as_of - interval '30 days';
  v_reopen := v_p.review_state = 'approved' and v_p.evidence_status <> v_status;

  if (v_status, v_floor, v_outdated) is distinct from (v_p.evidence_status, v_p.access_floor, v_p.is_potentially_outdated)
     or v_last is distinct from v_p.last_supported_at then
    update public.handover_points
       set evidence_status = v_status,
           access_floor = v_floor,
           last_supported_at = v_last,
           is_potentially_outdated = v_outdated,
           status_computed_at = now(),
           review_state = case when v_reopen then 'pending' else review_state end,
           approved_as_known_gap = case when v_reopen then false else approved_as_known_gap end
     where id = p_point_id;

    if v_reopen then
      insert into public.review_actions (handover_id, point_id, revision_id, actor_profile_id, action,
                                         from_review_state, to_review_state, metadata)
      values (v_p.handover_id, p_point_id, v_p.current_revision_id, null, 'auto_reopen', 'approved', 'pending',
              jsonb_build_object('fromStatus', v_p.evidence_status, 'toStatus', v_status));
    end if;
  end if;
  return v_status;
end $$;

-- ── §9.1 transition_handover ─────────────────────────────────────────────────
-- p_actor NULL means "system" and is only reachable from server-side functions. Callers already hold
-- the handover FOR UPDATE; re-locking in the same transaction is a no-op.

create function public.transition_handover(p_handover_id uuid, p_to_state text, p_actor uuid default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_h public.handovers;
  v_from text;
  v_prior_success boolean;
  v_ok boolean := false;
begin
  v_h := public._lock_handover_for_update(p_handover_id);
  v_from := v_h.state;
  select exists (select 1 from public.processing_runs r where r.handover_id = p_handover_id and r.status = 'succeeded')
    into v_prior_success;

  if v_from = 'draft' and p_to_state = 'processing' then
    v_ok := p_actor is not null and (public._is_creator_of(p_handover_id, p_actor)
                                     or public._role_of(p_handover_id, p_actor) = 'outgoing');
  elsif v_from = 'processing' and p_to_state = 'in_review' then
    v_ok := v_prior_success and (p_actor is null or public._is_creator_of(p_handover_id, p_actor));
  elsif v_from = 'processing' and p_to_state = 'draft' then
    v_ok := not v_prior_success and (p_actor is null or public._is_creator_of(p_handover_id, p_actor));
  elsif v_from = 'in_review' and p_to_state = 'processing' then
    v_ok := p_actor is not null and (public._is_creator_of(p_handover_id, p_actor)
                                     or public._role_of(p_handover_id, p_actor) = 'outgoing');
  elsif v_from = 'in_review' and p_to_state = 'approved' then
    v_ok := p_actor is not null and public._is_creator_of(p_handover_id, p_actor) and public._flag('baton.publishing');
  elsif v_from in ('approved', 'acknowledged') and p_to_state = 'in_review' then
    v_ok := p_actor is not null and public._is_creator_of(p_handover_id, p_actor);
  elsif v_from = 'approved' and p_to_state = 'acknowledged' then
    v_ok := p_actor is null;
  elsif v_from = 'acknowledged' and p_to_state = 'approved' then
    v_ok := p_actor is null;
  end if;

  if not v_ok then
    raise exception 'transition % -> % is not allowed', v_from, p_to_state using errcode = 'BTIT0';
  end if;

  perform set_config('baton.transition', 'on', true);
  update public.handovers set state = p_to_state where id = p_handover_id;
  perform set_config('baton.transition', 'off', true);

  perform public._audit(p_handover_id, p_actor, null, 'handover.transition', 'handover', p_handover_id,
                        jsonb_build_object('state', v_from), jsonb_build_object('state', p_to_state));
end $$;

-- ── Readiness (§11.6) ────────────────────────────────────────────────────────

create function public._has_pending_incoming_invite(p_handover_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.access_tokens t
    where t.handover_id = p_handover_id and t.purpose = 'member_invite' and t.grant_role = 'incoming'
      and t.revoked_at is null and t.expires_at > now() and t.use_count < t.max_uses
  )
$$;

-- Boolean only, for review roles (no counts or identities leak).
create function public.has_incoming_recipient(p_handover_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case when public.is_review_role(p_handover_id) then
    exists (select 1 from public.handover_members m
            where m.handover_id = p_handover_id and m.role = 'incoming' and m.removed_at is null)
    or public._has_pending_incoming_invite(p_handover_id)
  end
$$;

-- Internal (no grant): the same boolean without the caller check, for server-side callers that already
-- validated the actor (publish_handover).
create function public._has_incoming_recipient(p_handover_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.handover_members m
                 where m.handover_id = p_handover_id and m.role = 'incoming' and m.removed_at is null)
      or public._has_pending_incoming_invite(p_handover_id)
$$;

-- SECURITY INVOKER: under a client session (p_actor NULL) the viewer is auth.uid() and every aggregate is
-- computed under the viewer's RLS (§8.5). publish_handover calls it as the owner with its validated actor,
-- i.e. over every row, under its FOR UPDATE lock; an API role may never pass p_actor. Review roles always
-- hold reviewer_only clearance, so both views are the same set of rows.
create function public.readiness_report(p_handover_id uuid, p_actor uuid default null)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_state text;
  v_blockers jsonb := '[]'::jsonb;
  v_ids uuid[];
  v_n int;
  v_by_status jsonb;
  v_by_review jsonb;
  v_outdated int;
  v_approved int;
  v_active int;
  v_recipient boolean;
begin
  if p_actor is null then
    if not public.is_review_role(p_handover_id) then
      return null;
    end if;
    v_recipient := coalesce(public.has_incoming_recipient(p_handover_id), false);
  else
    if public._is_api_role() or not public._is_review_role_as(p_actor, p_handover_id) then
      return null;
    end if;
    v_recipient := public._has_incoming_recipient(p_handover_id);
  end if;
  select h.state into v_state from public.handovers h where h.id = p_handover_id;
  if v_state is null then
    return null;
  end if;

  if v_state in ('draft', 'processing') then
    v_blockers := v_blockers || jsonb_build_object('kind', 'processing_incomplete', 'count', 1, 'pointIds', '[]'::jsonb);
  end if;

  select array_agg(p.id order by p.sort_key, p.id) into v_ids from public.handover_points p
   where p.handover_id = p_handover_id and p.erased_at is null and p.review_state = 'pending';
  if v_ids is not null then
    v_blockers := v_blockers || jsonb_build_object('kind', 'pending_points', 'count', cardinality(v_ids), 'pointIds', to_jsonb(v_ids));
  end if;

  select array_agg(p.id order by p.sort_key, p.id) into v_ids from public.handover_points p
   where p.handover_id = p_handover_id and p.erased_at is null and p.review_state = 'pending'
     and p.evidence_status = 'inferred' and p.inferred_confirmed_at is null;
  if v_ids is not null then
    v_blockers := v_blockers || jsonb_build_object('kind', 'unconfirmed_inferred', 'count', cardinality(v_ids), 'pointIds', to_jsonb(v_ids));
  end if;

  select array_agg(p.id order by p.sort_key, p.id) into v_ids from public.handover_points p
   where p.handover_id = p_handover_id and p.erased_at is null and p.review_state = 'pending'
     and p.evidence_status = 'conflicting' and p.conflict_resolution_note is null;
  if v_ids is not null then
    v_blockers := v_blockers || jsonb_build_object('kind', 'unresolved_conflicts', 'count', cardinality(v_ids), 'pointIds', to_jsonb(v_ids));
  end if;

  select count(*), array_remove(array_agg(distinct q.point_id), null) into v_n, v_ids from public.gap_questions q
   where q.handover_id = p_handover_id and q.status = 'open' and q.priority = 'required';
  if v_n > 0 then
    v_blockers := v_blockers || jsonb_build_object('kind', 'open_required_gaps', 'count', v_n, 'pointIds', to_jsonb(coalesce(v_ids, '{}')));
  end if;

  if not v_recipient then
    v_blockers := v_blockers || jsonb_build_object('kind', 'no_incoming_recipient', 'count', 1, 'pointIds', '[]'::jsonb);
  end if;

  select count(*) filter (where p.review_state = 'approved'), count(*) filter (where p.review_state <> 'rejected'),
         count(*) filter (where p.is_potentially_outdated)
    into v_approved, v_active, v_outdated
    from public.handover_points p where p.handover_id = p_handover_id and p.erased_at is null;
  if v_approved = 0 then
    v_blockers := v_blockers || jsonb_build_object('kind', 'no_approved_points', 'count', 1, 'pointIds', '[]'::jsonb);
  end if;

  select array_agg(p.id order by p.sort_key, p.id) into v_ids from public.handover_points p
   where p.handover_id = p_handover_id and p.erased_at is null and p.privacy_review = 'required';
  if v_ids is not null then
    v_blockers := v_blockers || jsonb_build_object('kind', 'privacy_review_required', 'count', cardinality(v_ids), 'pointIds', to_jsonb(v_ids));
  end if;

  select jsonb_build_object(
           'sourced', count(*) filter (where p.evidence_status = 'sourced'),
           'inferred', count(*) filter (where p.evidence_status = 'inferred'),
           'conflicting', count(*) filter (where p.evidence_status = 'conflicting'),
           'missing', count(*) filter (where p.evidence_status = 'missing')),
         jsonb_build_object(
           'pending', count(*) filter (where p.review_state = 'pending'),
           'approved', count(*) filter (where p.review_state = 'approved'),
           'rejected', count(*) filter (where p.review_state = 'rejected'))
    into v_by_status, v_by_review
    from public.handover_points p where p.handover_id = p_handover_id and p.erased_at is null;

  return jsonb_build_object(
    'canPublish', jsonb_array_length(v_blockers) = 0 and v_state = 'in_review',
    'blockers', v_blockers,
    'counts', jsonb_build_object('byStatus', v_by_status, 'byReviewState', v_by_review, 'outdated', v_outdated),
    'score', case when v_active = 0 then 0 else round(100.0 * v_approved / v_active)::int end
  );
end $$;

-- ── Handover creation (§6.3, D23) ────────────────────────────────────────────

create function public.create_handover(p_actor_profile_id uuid, 
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
begin
  if p_creator_role is null or p_creator_role not in ('outgoing', 'reviewer') then
    raise exception 'creator role must be outgoing or reviewer' using errcode = 'BTVF0';
  end if;
  if not exists (select 1 from public.profiles where id = v_actor and deleted_at is null) then
    raise exception 'profile not found' using errcode = 'BTUA0';
  end if;

  insert into public.handovers (title, team_name, role_title, description, created_by)
  values (btrim(p_title), btrim(p_team_name), nullif(btrim(p_role_title), ''), nullif(btrim(p_description), ''), v_actor)
  returning id into v_id;

  insert into public.handover_members (handover_id, profile_id, role, clearance, ack_required)
  values (v_id, v_actor, p_creator_role, 'reviewer_only', false);

  perform public._audit(v_id, v_actor, null, 'handover.created', 'handover', v_id, null,
                        jsonb_build_object('state', 'draft', 'creatorRole', p_creator_role));
  return v_id;
end $$;

-- ── Processing (§9.1, §9.3) ──────────────────────────────────────────────────

-- p_jobs: [{ "stage": PipelineStage, "sourceId": uuid|null, "inputHash": hex }]. Main decides the jobs;
-- the database validates their scope.
create function public.start_processing(p_actor_profile_id uuid, 
  p_handover_id uuid, p_pipeline_version text, p_ai_config jsonb, p_jobs jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := public._require_actor(p_actor_profile_id);
  v_h public.handovers;
  v_provider text := p_ai_config ->> 'provider';
  v_included uuid[];
  v_run uuid;
  v_job jsonb;
  v_source uuid;
begin
  v_h := public._lock_handover_for_update(p_handover_id);
  if not public._is_member_as(v_actor, p_handover_id) then
    raise exception 'handover not found' using errcode = 'BTNF0';
  end if;
  if not (public._is_creator_as(v_actor, p_handover_id) or public._member_role_as(v_actor, p_handover_id) = 'outgoing') then
    raise exception 'only the creator or an outgoing member can start processing' using errcode = 'BTFB0';
  end if;
  if v_h.state not in ('draft', 'in_review') then
    raise exception 'processing cannot start from %', v_h.state using errcode = 'BTIT0';
  end if;
  if exists (select 1 from public.processing_runs where handover_id = p_handover_id and status in ('queued', 'running')) then
    raise exception 'a run is already active' using errcode = 'BTCF0';
  end if;
  if v_provider is null or coalesce(btrim(p_pipeline_version), '') = '' then
    raise exception 'pipeline version and AI provider are required' using errcode = 'BTVF0';
  end if;

  select array_agg(s.id order by s.created_at, s.id) into v_included
    from public.sources s
   where s.handover_id = p_handover_id and s.deleted_at is null
     and (s.state = 'parsed' or (s.state in ('uploaded', 'failed') and s.raw_storage_path is not null));
  if v_included is null then
    raise exception 'no source is ready for processing' using errcode = 'BTPF0';
  end if;
  if exists (select 1 from public.sources s where s.id = any (v_included)
             and (s.consent_recorded_at is null or s.consent_ai_provider is distinct from v_provider)) then
    raise exception 'every source needs consent for the configured AI provider' using errcode = 'BTPF0';
  end if;

  insert into public.processing_runs (handover_id, triggered_by, status, source_ids, pipeline_version, ai_provider, ai_config)
  values (p_handover_id, v_actor, 'queued', v_included, p_pipeline_version, v_provider, p_ai_config)
  returning id into v_run;

  for v_job in select * from jsonb_array_elements(coalesce(p_jobs, '[]'::jsonb)) loop
    v_source := nullif(v_job ->> 'sourceId', '')::uuid;
    if v_source is not null and not (v_source = any (v_included)) then
      raise exception 'job source is not part of this run' using errcode = 'BTVF0';
    end if;
    if v_job ->> 'stage' = 'parse' and (v_source is null
        or exists (select 1 from public.sources where id = v_source and state = 'parsed')) then
      raise exception 'parse jobs are only for sources that are not parsed yet' using errcode = 'BTVF0';
    end if;
    insert into public.processing_jobs (handover_id, run_id, source_id, stage, input_hash, next_attempt_at)
    values (p_handover_id, v_run, v_source, v_job ->> 'stage', decode(v_job ->> 'inputHash', 'hex'), now());
  end loop;

  perform public.transition_handover(p_handover_id, 'processing', v_actor);
  perform public._audit(p_handover_id, v_actor, null, 'processing.started', 'processing_run', v_run, null,
                        jsonb_build_object('sourceCount', cardinality(v_included)));
  return v_run;
end $$;

create function public._close_run(p_handover_id uuid, p_run_id uuid, p_status text, p_error_code text, p_error_message text, p_actor uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_prior_success boolean;
  v_point uuid;
begin
  -- M4: fixed order jobs → run, the same order claim_processing_jobs uses (it locks jobs, then the run).
  update public.processing_jobs
     set status = 'cancelled', finished_at = now(), lease_expires_at = null
   where run_id = p_run_id and status in ('queued', 'running');
  update public.processing_runs
     set status = p_status, finished_at = now(), error_code = p_error_code, error_message = p_error_message
   where id = p_run_id;

  if p_status = 'succeeded' then
    update public.handovers h
       set evidence_as_of = (select max(m.sent_at) from public.source_messages m
                               join public.sources s on s.id = m.source_id
                              where m.handover_id = p_handover_id and s.deleted_at is null),
           last_error_code = null, last_error_message = null
     where h.id = p_handover_id;
    for v_point in select id from public.handover_points where handover_id = p_handover_id and erased_at is null order by id loop
      perform public.recompute_point_status(v_point);
    end loop;
    perform public.transition_handover(p_handover_id, 'in_review', null);
  else
    select exists (select 1 from public.processing_runs where handover_id = p_handover_id and status = 'succeeded')
      into v_prior_success;
    if p_status = 'failed' then
      update public.handovers set last_error_code = p_error_code, last_error_message = p_error_message where id = p_handover_id;
    end if;
    perform public.transition_handover(p_handover_id, case when v_prior_success then 'in_review' else 'draft' end, p_actor);
  end if;
end $$;

create function public.cancel_processing(p_actor_profile_id uuid, p_handover_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := public._require_actor(p_actor_profile_id);
  v_h public.handovers;
  v_run uuid;
begin
  v_h := public._lock_handover_for_update(p_handover_id);
  if not public._is_member_as(v_actor, p_handover_id) then
    raise exception 'handover not found' using errcode = 'BTNF0';
  end if;
  if not public._is_creator_as(v_actor, p_handover_id) then
    raise exception 'only the creator can cancel processing' using errcode = 'BTFB0';
  end if;
  select id into v_run from public.processing_runs where handover_id = p_handover_id and status in ('queued', 'running');
  if v_h.state <> 'processing' or v_run is null then
    raise exception 'nothing is processing' using errcode = 'BTIT0';
  end if;
  perform public._close_run(p_handover_id, v_run, 'cancelled', null, null, v_actor);
end $$;

-- Worker (service_role): close a run. p_error_message must be structural, never content (§12.7).
create function public.finish_processing_run(p_run_id uuid, p_status text, p_error_code text default null, p_error_message text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_handover uuid;
  v_status text;
begin
  select handover_id into v_handover from public.processing_runs where id = p_run_id;
  if v_handover is null then
    raise exception 'run not found' using errcode = 'BTNF0';
  end if;
  perform public._lock_handover_for_update(v_handover, true); -- first lock
  -- M4: jobs before the run row (same order as claim_processing_jobs), never the reverse.
  perform 1 from public.processing_jobs where run_id = p_run_id order by id for update;
  select status into v_status from public.processing_runs where id = p_run_id for update;
  if v_status not in ('queued', 'running') then
    raise exception 'run is not active' using errcode = 'BTIT0';
  end if;
  if p_status not in ('succeeded', 'failed', 'cancelled') then
    raise exception 'invalid final status' using errcode = 'BTVF0';
  end if;
  perform public._close_run(v_handover, p_run_id, p_status, p_error_code, p_error_message, null);
end $$;

-- ── Publication (§9.1 in_review → approved, §6.18) ───────────────────────────

create function public._build_publication_content(p_point_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'title', r.title,
    'statement', r.statement,
    'attributes', r.attributes,
    'evidenceStatus', p.evidence_status,
    'isPotentiallyOutdated', p.is_potentially_outdated,
    'isKnownGap', p.approved_as_known_gap,
    'inferredConfirmation',
      case when p.evidence_status = 'inferred' and p.inferred_confirmed_by is not null then
        jsonb_build_object('byLabel', public._handover_label(p.handover_id, p.inferred_confirmed_by),
                           'byProfileId', p.inferred_confirmed_by, 'at', p.inferred_confirmed_at)
      end,
    'conflictResolution',
      case when p.conflict_resolution_note is not null and p.conflict_resolved_by is not null then
        jsonb_build_object('note', p.conflict_resolution_note, 'byLabel', public._handover_label(p.handover_id, p.conflict_resolved_by),
                           'byProfileId', p.conflict_resolved_by, 'at', p.conflict_resolved_at)
      end,
    'evidence', coalesce((
      select jsonb_agg(item order by sent_at desc nulls last, eid)
        from (
          select q.id as eid,
                 coalesce(q.message_sent_at, case when q.kind = 'testimony' then coalesce(a.created_at, q.created_at) end) as sent_at,
                 jsonb_build_object(
                   'evidenceId', q.id, 'redacted', false, 'kind', q.kind, 'quote', q.quote_text,
                   'authorLabel', q.author_label,
                   'sentAt', coalesce(q.message_sent_at, case when q.kind = 'testimony' then coalesce(a.created_at, q.created_at) end),
                   'sourceTitle', q.source_title, 'stance', pe.support_verdict,
                   'authorProfileId', case when q.kind = 'testimony' then coalesce(q.stated_by_profile_id, a.answered_by_profile_id) end
                 ) as item
            from public.point_evidence pe
            join public.evidence_quotes q on q.id = pe.evidence_id
            left join public.gap_answers a on a.id = q.gap_answer_id
           where pe.point_id = p.id and pe.excluded_at is null
             and q.quote_check in ('exact', 'normalized')
             and pe.verified_revision_id = p.current_revision_id
             and pe.support_verdict in ('supports', 'contradicts')
        ) e
    ), '[]'::jsonb),
    'evidenceRedacted', false
  )
  from public.handover_points p
  join public.point_revisions r on r.id = p.current_revision_id
  where p.id = p_point_id
$$;

create function public.publish_handover(p_actor_profile_id uuid, p_handover_id uuid, p_summary text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := public._require_actor(p_actor_profile_id);
  v_h public.handovers;
  v_ready jsonb;
  v_version int;
  v_pub uuid;
  v_points int;
  v_pruned int;
begin
  v_h := public._lock_handover_for_update(p_handover_id); -- first lock (§5.5 item 2)
  if not public._is_member_as(v_actor, p_handover_id) then
    raise exception 'handover not found' using errcode = 'BTNF0';
  end if;
  if not public._is_creator_as(v_actor, p_handover_id) then
    raise exception 'only the creator can publish' using errcode = 'BTFB0';
  end if;
  if v_h.state <> 'in_review' then
    raise exception 'publish requires in_review' using errcode = 'BTIT0';
  end if;

  -- Readiness recomputed under the lock, so a point that became required just before is never snapshotted.
  v_ready := public.readiness_report(p_handover_id, v_actor);
  if v_ready is null or not (v_ready ->> 'canPublish')::boolean then
    raise exception 'handover is not ready to publish' using errcode = 'BTPF0';
  end if;

  select coalesce(max(version), 0) + 1 into v_version from public.handover_publications where handover_id = p_handover_id;
  insert into public.handover_publications (handover_id, version, published_by, summary, supersedes_id)
  values (p_handover_id, v_version, v_actor, nullif(btrim(p_summary), ''), v_h.current_publication_id)
  returning id into v_pub;

  insert into public.publication_points (handover_id, publication_id, point_id, revision_id, category, evidence_status,
                                         access_level, is_potentially_outdated, is_known_gap, sort_key, content)
  select p.handover_id, v_pub, p.id, p.current_revision_id, p.category, p.evidence_status, p.access_level,
         p.is_potentially_outdated, p.approved_as_known_gap, p.sort_key, public._build_publication_content(p.id)
    from public.handover_points p
   where p.handover_id = p_handover_id and p.erased_at is null
     and p.review_state = 'approved' and p.privacy_review <> 'required'; -- independent of readiness (§5.5)
  get diagnostics v_points = row_count;

  update public.handovers set current_publication_id = v_pub where id = p_handover_id;
  perform set_config('baton.publishing', 'on', true);
  perform public.transition_handover(p_handover_id, 'approved', v_actor);
  perform set_config('baton.publishing', 'off', true);

  -- §12.6: messages no quote references are hard-deleted at publish.
  delete from public.source_messages m
   where m.handover_id = p_handover_id
     and not exists (select 1 from public.evidence_quotes q where q.source_message_id = m.id);
  get diagnostics v_pruned = row_count;

  perform public._audit(p_handover_id, v_actor, null, 'handover.published', 'handover_publication', v_pub, null,
                        jsonb_build_object('version', v_version, 'points', v_points, 'messagesPruned', v_pruned));
  return v_pub;
end $$;

create function public.start_revision(p_actor_profile_id uuid, p_handover_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := public._require_actor(p_actor_profile_id);
begin
  perform public._lock_handover_for_update(p_handover_id);
  if not public._is_member_as(v_actor, p_handover_id) then
    raise exception 'handover not found' using errcode = 'BTNF0';
  end if;
  if not public._is_creator_as(v_actor, p_handover_id) then
    raise exception 'only the creator can start a revision' using errcode = 'BTFB0';
  end if;
  perform public.transition_handover(p_handover_id, 'in_review', v_actor);
end $$;

create function public.delete_handover(p_actor_profile_id uuid, p_handover_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := public._require_actor(p_actor_profile_id);
  v_run uuid;
begin
  perform public._lock_handover_for_update(p_handover_id);
  if not public._is_member_as(v_actor, p_handover_id) then
    raise exception 'handover not found' using errcode = 'BTNF0';
  end if;
  if not public._is_creator_as(v_actor, p_handover_id) then
    raise exception 'only the creator can delete a handover' using errcode = 'BTFB0';
  end if;
  select id into v_run from public.processing_runs where handover_id = p_handover_id and status in ('queued', 'running');
  if v_run is not null then
    update public.processing_jobs set status = 'cancelled', finished_at = now(), lease_expires_at = null
     where run_id = v_run and status in ('queued', 'running');
    update public.processing_runs set status = 'cancelled', finished_at = now() where id = v_run;
  end if;
  update public.access_tokens set revoked_at = now() where handover_id = p_handover_id and revoked_at is null;
  update public.handovers
     set deleted_at = now(), pending_creator_member_id = null, creator_transfer_offered_at = null
   where id = p_handover_id;
  perform public._audit(p_handover_id, v_actor, null, 'handover.deleted', 'handover', p_handover_id, null,
                        jsonb_build_object('deleted', true));
end $$;

-- ── Acknowledgement (§6.19, D9) ──────────────────────────────────────────────

create function public._ack_complete(p_handover_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select h.current_publication_id is not null
     and not exists (
       select 1 from public.handover_members m
       where m.handover_id = h.id and m.ack_required and m.removed_at is null
         and not exists (select 1 from public.acknowledgements a
                         where a.publication_id = h.current_publication_id and a.profile_id = m.profile_id
                           and a.invalidated_at is null)
     )
     and not public._has_pending_incoming_invite(h.id)
    from public.handovers h where h.id = p_handover_id
$$;

create function public.acknowledge_publication(p_actor_profile_id uuid, p_publication_id uuid, p_statement_version text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := public._require_actor(p_actor_profile_id);
  v_handover uuid;
  v_h public.handovers;
  v_ack uuid;
begin
  select handover_id into v_handover from public.handover_publications where id = p_publication_id;
  if v_handover is null then
    raise exception 'publication not found' using errcode = 'BTNF0';
  end if;
  v_h := public._lock_handover_for_update(v_handover); -- first lock, every call (§5.5 item 2)
  if not public._is_member_as(v_actor, v_handover) then
    raise exception 'publication not found' using errcode = 'BTNF0';
  end if;
  if public._member_role_as(v_actor, v_handover) <> 'incoming' then
    raise exception 'only incoming members acknowledge' using errcode = 'BTFB0';
  end if;
  if v_h.current_publication_id is distinct from p_publication_id or v_h.state not in ('approved', 'acknowledged') then
    raise exception 'only the current publication can be acknowledged' using errcode = 'BTIT0';
  end if;
  if coalesce(btrim(p_statement_version), '') = '' then
    raise exception 'statement version required' using errcode = 'BTVF0';
  end if;

  begin
    insert into public.acknowledgements (handover_id, publication_id, profile_id, statement_version)
    values (v_handover, p_publication_id, v_actor, p_statement_version)
    returning id into v_ack;
  exception when unique_violation then
    raise exception 'already acknowledged' using errcode = 'BTCF0';
  end;

  perform public._audit(v_handover, v_actor, null, 'publication.acknowledged', 'acknowledgement', v_ack, null,
                        jsonb_build_object('publicationId', p_publication_id));

  if v_h.state = 'approved' and public._ack_complete(v_handover) then
    perform public.transition_handover(v_handover, 'acknowledged', null);
  end if;
end $$;
