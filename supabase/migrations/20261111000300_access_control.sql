-- Access control (§8.3–§8.5). RLS is authoritative for reads. Client roles have no direct write grants
-- at all (see the grants migration): every write goes through a SECURITY DEFINER function that checks
-- role, clearance and lifecycle with these same helpers.

-- ── Helpers parameterised by profile (used by service-role functions with an explicit actor) ──

create function public._member_row(p_handover_id uuid, p_profile_id uuid)
returns public.handover_members
language sql
stable
security definer
set search_path = ''
as $$
  select m.*
    from public.handover_members m
    join public.handovers h on h.id = m.handover_id
   where m.handover_id = p_handover_id and m.profile_id = p_profile_id
     and m.removed_at is null and h.deleted_at is null
$$;

create function public._role_of(p_handover_id uuid, p_profile_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$ select (public._member_row(p_handover_id, p_profile_id)).role $$;

create function public._clearance_of(p_handover_id uuid, p_profile_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$ select (public._member_row(p_handover_id, p_profile_id)).clearance $$;

create function public._is_creator_of(p_handover_id uuid, p_profile_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_profile_id is not null and exists (
    select 1 from public.handovers h
    where h.id = p_handover_id and h.created_by = p_profile_id and h.deleted_at is null
  ) and public._role_of(p_handover_id, p_profile_id) is not null
$$;

create function public._is_review_role_of(p_handover_id uuid, p_profile_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(public._is_creator_of(p_handover_id, p_profile_id)
                  or public._role_of(p_handover_id, p_profile_id) in ('outgoing', 'reviewer'), false)
$$;

-- ── Actor-explicit helpers (H1) ──────────────────────────────────────────────
-- Used by every mutation function with the actor validated by _require_actor. Not granted to any client.

create function public._is_member_as(p_actor uuid, p_handover_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$ select public._role_of(p_handover_id, p_actor) is not null $$;

create function public._member_role_as(p_actor uuid, p_handover_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$ select public._role_of(p_handover_id, p_actor) $$;

create function public._is_creator_as(p_actor uuid, p_handover_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$ select public._is_creator_of(p_handover_id, p_actor) $$;

create function public._is_review_role_as(p_actor uuid, p_handover_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$ select public._is_review_role_of(p_handover_id, p_actor) $$;

create function public._within_clearance_as(p_actor uuid, p_handover_id uuid, p_level text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$ select coalesce(public.access_rank(p_level) <= public.access_rank(public._clearance_of(p_handover_id, p_actor)), false) $$;

create function public._point_visible_as(p_actor uuid, p_point_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.handover_points p
    where p.id = p_point_id and p.erased_at is null
      and public._is_review_role_as(p_actor, p.handover_id)
      and public._within_clearance_as(p_actor, p.handover_id, p.access_level)
  )
$$;

-- ── §8.3 RLS helpers (caller = auth.uid()) ───────────────────────────────────

create function public.is_member(p_handover_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$ select public._is_member_as(auth.uid(), p_handover_id) $$;

create function public.member_role(p_handover_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$ select public._member_role_as(auth.uid(), p_handover_id) $$;

create function public.clearance(p_handover_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$ select public._clearance_of(p_handover_id, auth.uid()) $$;

create function public.is_creator(p_handover_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$ select public._is_creator_as(auth.uid(), p_handover_id) $$;

-- "role ∈ {creator, outgoing, reviewer}" (§8.4)
create function public.is_review_role(p_handover_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$ select public._is_review_role_as(auth.uid(), p_handover_id) $$;

-- rank(level) ≤ rank(clearance). False for non-members.
create function public.within_clearance(p_handover_id uuid, p_level text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$ select public._within_clearance_as(auth.uid(), p_handover_id, p_level) $$;

create function public.point_visible(p_point_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$ select public._point_visible_as(auth.uid(), p_point_id) $$;

create function public.source_visible(p_source_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.sources s
    where s.id = p_source_id
      and public.is_review_role(s.handover_id) and public.within_clearance(s.handover_id, s.access_level)
  )
$$;

-- ── §5.5 privacy-hold helpers ────────────────────────────────────────────────

-- A question is held while its point has privacy_review = 'required'.
create function public.gap_question_privacy_held(p_question_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.gap_questions q join public.handover_points p on p.id = q.point_id
    where q.id = p_question_id and p.privacy_review = 'required'
  )
$$;

-- An answer is held while its question is held, or while its testimony backs a required point.
create function public.gap_answer_privacy_held(p_answer_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.gap_answers a
    where a.id = p_answer_id
      and (public.gap_question_privacy_held(a.gap_question_id)
           or exists (
             select 1 from public.evidence_quotes t
             join public.point_evidence pe on pe.evidence_id = t.id
             join public.handover_points p on p.id = pe.point_id
             where t.gap_answer_id = a.id and p.privacy_review = 'required'
           ))
  )
$$;

-- The caller's own membership id in a handover (for gap-question assignment).
create function public.my_member_id(p_handover_id uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$ select (public._member_row(p_handover_id, auth.uid())).id $$;

-- A question can be shown and answered at all: open, not privacy-held, and (M2) not attached to an
-- erased or withdrawn point. Used by RLS, the token query and the gap_answers insert guard.
create function public._gap_question_answerable(p_question_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.gap_questions q
      left join public.handover_points p on p.id = q.point_id
     where q.id = p_question_id and q.status = 'open'
       and (q.point_id is null or p.erased_at is null)
       and not public.gap_question_privacy_held(q.id)
  )
$$;

-- Non-review members: a question assigned to them, answerable and within clearance (§8.4).
create function public._gap_question_visible_as(p_actor uuid, p_question_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.gap_questions q
    where q.id = p_question_id
      and q.assigned_member_id = (public._member_row(q.handover_id, p_actor)).id
      and public._within_clearance_as(p_actor, q.handover_id, q.access_level)
      and public._gap_question_answerable(q.id)
  )
$$;

create function public.gap_question_visible_to_member(p_question_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$ select public._gap_question_visible_as(auth.uid(), p_question_id) $$;

-- ── Policies (SELECT only; there are no client write policies) ───────────────

create policy profiles_select_own on public.profiles
  for select to authenticated using (id = auth.uid());

create policy handovers_select_member on public.handovers
  for select to authenticated using (public.is_member(id));

-- Own row, or every row for the creator. Everyone else reads the directory view below.
create policy handover_members_select on public.handover_members
  for select to authenticated using (profile_id = auth.uid() or public.is_creator(handover_id));

create policy sources_select on public.sources
  for select to authenticated
  using (public.is_review_role(handover_id) and public.within_clearance(handover_id, access_level));

create policy source_participants_select on public.source_participants
  for select to authenticated using (public.source_visible(source_id));

create policy source_conversations_select on public.source_conversations
  for select to authenticated using (public.source_visible(source_id));

create policy source_messages_select on public.source_messages
  for select to authenticated using (public.source_visible(source_id));

create policy source_exclusions_select on public.source_exclusions
  for select to authenticated
  using (public.is_review_role(handover_id) and (source_id is null or public.source_visible(source_id)));

create policy evidence_quotes_select on public.evidence_quotes
  for select to authenticated
  using (public.is_review_role(handover_id) and public.within_clearance(handover_id, access_level));

create policy handover_points_select on public.handover_points
  for select to authenticated
  using (erased_at is null and public.is_review_role(handover_id) and public.within_clearance(handover_id, access_level));

create policy point_revisions_select on public.point_revisions
  for select to authenticated using (public.point_visible(point_id));

create policy point_evidence_select on public.point_evidence
  for select to authenticated using (public.point_visible(point_id));

create policy review_actions_select on public.review_actions
  for select to authenticated using (public.point_visible(point_id));

create policy gap_questions_select on public.gap_questions
  for select to authenticated
  using (
    (public.is_review_role(handover_id) and public.within_clearance(handover_id, access_level))
    or public.gap_question_visible_to_member(id)
  );

create policy gap_answers_select on public.gap_answers
  for select to authenticated
  using (
    exists (
      select 1 from public.gap_questions q
      where q.id = gap_question_id
        and public.is_review_role(q.handover_id) and public.within_clearance(q.handover_id, q.access_level)
    )
    or (answered_by_profile_id = auth.uid()
        and public.gap_question_visible_to_member(gap_question_id)
        and not public.gap_answer_privacy_held(id))
  );

create policy processing_runs_select on public.processing_runs
  for select to authenticated using (public.is_review_role(handover_id));

create policy processing_jobs_select on public.processing_jobs
  for select to authenticated using (public.is_review_role(handover_id));

create policy handover_publications_select on public.handover_publications
  for select to authenticated using (public.is_member(handover_id));

create policy publication_points_select on public.publication_points
  for select to authenticated
  using (public.is_member(handover_id) and public.within_clearance(handover_id, access_level)
         and redacted_at is null and not privacy_hold);

create policy acknowledgements_select on public.acknowledgements
  for select to authenticated using (profile_id = auth.uid() or public.is_review_role(handover_id));

create policy audit_logs_select on public.audit_logs
  for select to authenticated
  using (handover_id is not null and public.is_review_role(handover_id) and public.within_clearance(handover_id, access_level));

-- access_tokens, access_token_questions, participant_erasures: RLS enabled, no policy, no grant (§8.4).

-- ── Member directory (§6.1) ──────────────────────────────────────────────────
-- Display names of people who share a handover with the viewer. Runs with the view owner's rights
-- and filters on is_member(); clearance is exposed only to the creator (MemberSummary). Removed
-- members stay listed (flagged) so history labels still resolve.

-- N6: the label shown for a member inside one handover. If another member of the same handover (active
-- or removed) has the same name, a short stable suffix from the profile id is added, so nobody can pass
-- as someone else by choosing the same name. Deleted accounts stay exactly "Former member" (D26).
create function public._handover_label(p_handover_id uuid, p_profile_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when p.deleted_at is null and exists (
      select 1 from public.handover_members m2 join public.profiles p2 on p2.id = m2.profile_id
       where m2.handover_id = p_handover_id and m2.profile_id <> p.id
         and lower(p2.display_name) = lower(p.display_name))
    then p.display_name || ' #' || left(replace(p.id::text, '-', ''), 4)
    else p.display_name
  end
  from public.profiles p where p.id = p_profile_id
$$;

create view public.handover_member_directory
with (security_barrier = true)
as
  select m.id as member_id,
         m.handover_id,
         m.profile_id,
         -- same rule as _handover_label (N6), inlined: function calls in a view are permission-checked as
         -- the caller, and _handover_label is deliberately not granted to clients.
         case when p.deleted_at is null and exists (
                select 1 from public.handover_members m2 join public.profiles p2 on p2.id = m2.profile_id
                 where m2.handover_id = m.handover_id and m2.profile_id <> p.id
                   and lower(p2.display_name) = lower(p.display_name))
              then p.display_name || ' #' || left(replace(p.id::text, '-', ''), 4)
              else p.display_name end as display_name,
         m.role,
         case when public.is_creator(m.handover_id) then m.clearance end as clearance,
         m.ack_required,
         m.removed_at is not null as removed,
         m.profile_id = h.created_by as is_creator -- R8 MemberSummary.isCreator
    from public.handover_members m
    join public.profiles p on p.id = m.profile_id
    join public.handovers h on h.id = m.handover_id
   where public.is_member(m.handover_id);

-- Display name of a profile, if it is (or was) a member of a handover the viewer belongs to.
create function public.member_label(p_handover_id uuid, p_profile_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select public._handover_label(p_handover_id, m.profile_id)
    from public.handover_members m
   where m.handover_id = p_handover_id and m.profile_id = p_profile_id and public.is_member(p_handover_id)
$$;
