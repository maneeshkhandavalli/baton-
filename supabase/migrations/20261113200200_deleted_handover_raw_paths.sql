-- Round 3 (Agent 3, R3-D5): raw cleanup on discard. Additive: one read-only, service_role-only function.
-- delete_handover only soft-deletes the handover; its sources keep their raw paths and, while D27 keeps
-- purge_handover closed, their raw (unmasked) uploads would stay in Storage indefinitely
-- (docs/proposals/retention.md §4). After delete_handover commits, the server lists the raw paths with
-- this function, deletes each object (lib/db/storage.ts deleteHandoverRawObjects) and records it with the
-- existing mark_source_raw_deleted (service role; idempotent; it applies to sources of deleted handovers
-- too). No database content is deleted here, so the purge gate (D27) is untouched.

-- (source_id, raw_storage_path) of every source of a SOFT-DELETED handover whose raw path is still set,
-- for the handover's creator or the actor who deleted it (the 'handover.deleted' audit row) only.
-- Errors: actor problems as _require_actor; unknown handover or any other actor → not_found (BTNF0);
-- a handover that is not deleted → precondition_failed (BTPF0), so it can never be used to list a
-- live draft's uploads.
create function public.list_deleted_handover_raw_paths(p_actor_profile_id uuid, p_handover_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid := public._require_actor(p_actor_profile_id);
  v_h public.handovers;
begin
  select * into v_h from public.handovers where id = p_handover_id;
  if not found then
    raise exception 'handover not found' using errcode = 'BTNF0';
  end if;
  if v_h.created_by is distinct from v_actor and not exists (
    select 1 from public.audit_logs a
     where a.handover_id = p_handover_id and a.action = 'handover.deleted' and a.actor_profile_id = v_actor
  ) then
    raise exception 'handover not found' using errcode = 'BTNF0';
  end if;
  if v_h.deleted_at is null then
    raise exception 'handover is not deleted' using errcode = 'BTPF0';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('sourceId', s.id, 'rawStoragePath', s.raw_storage_path) order by s.created_at, s.id)
      from public.sources s
     where s.handover_id = p_handover_id and s.raw_storage_path is not null), '[]'::jsonb);
end $$;

revoke execute on function public.list_deleted_handover_raw_paths(uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function public.list_deleted_handover_raw_paths(uuid, uuid) to service_role;
