-- R3 (lead-approved contract change): HandoverSummary.description. The two handover read functions behind
-- BatonQueries (api_list_my_handovers, api_get_handover) now also return `description`, so the wizard can
-- show and edit a draft's description (updateHandoverDetails). Nothing else changes: same signatures,
-- SECURITY INVOKER (RLS decides visibility), same grants (CREATE OR REPLACE keeps them). The description is
-- already masked at write time (§12.1) and is visible to exactly the members who could see the handover.

create or replace function public.api_list_my_handovers()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', h.id, 'title', h.title, 'team_name', h.team_name, 'role_title', h.role_title, 'description', h.description, 'state', h.state,
           'viewer_role', m.role, 'viewer_is_creator', h.created_by = auth.uid(), 'viewer_clearance', m.clearance,
           -- R8: an open creatorship offer, for the creator and the offered member only (§12.9). It lapses
           -- after 14 days or when the offered member is removed. Under RLS other members cannot see the
           -- offered member's row, so they get NULL.
           'pending_creator_transfer', (
             select jsonb_build_object('to_member_id', om.id, 'offered_at', h.creator_transfer_offered_at)
               from public.handover_members om
              where om.id = h.pending_creator_member_id and om.removed_at is null
                and h.creator_transfer_offered_at >= now() - interval '14 days'
                and (h.created_by = auth.uid() or om.profile_id = auth.uid())),
           'current_publication_id', h.current_publication_id, 'created_at', h.created_at, 'updated_at', h.updated_at)
         order by h.updated_at desc, h.id), '[]'::jsonb)
    from public.handovers h
    join public.handover_members m on m.handover_id = h.id and m.profile_id = auth.uid() and m.removed_at is null
   where h.deleted_at is null
$$;

create or replace function public.api_get_handover(p_handover_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
           'id', h.id, 'title', h.title, 'team_name', h.team_name, 'role_title', h.role_title, 'description', h.description, 'state', h.state,
           'viewer_role', m.role, 'viewer_is_creator', h.created_by = auth.uid(), 'viewer_clearance', m.clearance,
           -- R8: an open creatorship offer, for the creator and the offered member only (§12.9). It lapses
           -- after 14 days or when the offered member is removed. Under RLS other members cannot see the
           -- offered member's row, so they get NULL.
           'pending_creator_transfer', (
             select jsonb_build_object('to_member_id', om.id, 'offered_at', h.creator_transfer_offered_at)
               from public.handover_members om
              where om.id = h.pending_creator_member_id and om.removed_at is null
                and h.creator_transfer_offered_at >= now() - interval '14 days'
                and (h.created_by = auth.uid() or om.profile_id = auth.uid())),
           'current_publication_id', h.current_publication_id, 'created_at', h.created_at, 'updated_at', h.updated_at)
    from public.handovers h
    join public.handover_members m on m.handover_id = h.id and m.profile_id = auth.uid() and m.removed_at is null
   where h.id = p_handover_id and h.deleted_at is null
$$;
