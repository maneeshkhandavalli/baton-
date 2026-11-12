-- Round 3 (Agent 3, D2/D3): upload-retry support and READ-ONLY orphan detection. Additive only:
-- no table, trigger or existing function changes, and nothing here deletes or updates anything.
-- Both functions are server-only (service_role); browser roles get nothing.

-- ── D2: retry after an interrupted upload ─────────────────────────────────────
-- create_source refuses a second live row with the same (handover_id, sha256) (unique index
-- sources_handover_sha256_key). When the first attempt never finished (tab closed, network drop,
-- signing failure), that row is still 'pending_upload' and blocks the retry with 'already uploaded'.
-- This returns the id of such a row ONLY when it is the actor's own unfinished upload of the same
-- file in a live handover the actor manages; the caller removes it with remove_source and creates a
-- fresh row. Anything else (uploaded, parsed, failed, someone else's) returns NULL, so a real
-- duplicate still fails with conflict.
create function public.stale_pending_source(p_actor_profile_id uuid, p_handover_id uuid, p_sha256_hex text)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid := public._require_actor(p_actor_profile_id);
  v_id uuid;
begin
  perform public._require_source_manager(v_actor, p_handover_id);
  if p_sha256_hex is null or p_sha256_hex !~ '^[a-f0-9]{64}$' then
    raise exception 'invalid checksum' using errcode = 'BTVF0';
  end if;
  select s.id into v_id
    from public.sources s
    join public.handovers h on h.id = s.handover_id
   where s.handover_id = p_handover_id
     and s.sha256 = decode(p_sha256_hex, 'hex')
     and s.deleted_at is null
     and s.state = 'pending_upload'
     and s.uploaded_by = v_actor
     and h.deleted_at is null;
  return v_id;
end $$;

-- ── D3: orphan-upload and raw-retention candidates (detection only) ──────────
-- One row per source whose raw upload (or upload slot) has outlived its purpose, with the reason.
-- A future retention sweep (docs/proposals/retention.md) would act on these; this function only
-- reports. Reasons, in priority order (a source is reported once):
--   handover_deleted     the handover is soft-deleted (discarded draft) and the source still has a
--                        raw path. remove_source can no longer run there (the handover is "not found").
--   removed_raw_pending  the source was removed but its storage delete failed (raw path still set).
--   parsed_raw_pending   parsed (data persisted) but the post-commit raw delete failed, older than p_grace.
--   pending_upload_expired  'pending_upload' older than p_grace: the signed URL (2 h) has expired, so the
--                        upload can never complete; the row only blocks a retry and uses a source slot.
--   raw_ceiling          'uploaded'/'failed' raw upload older than p_raw_ceiling (§12.6: 7 days).
-- raw_object_present says whether Storage actually holds an object at the path (a 'pending_upload'
-- row has a path from creation even when nothing ever arrived).
create function public.list_orphan_upload_candidates(
  p_grace interval default interval '24 hours',
  p_raw_ceiling interval default interval '7 days',
  p_limit int default 100
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  -- The signed upload URL lives 2 hours (lib/db/storage.ts); a shorter grace could report an upload in flight.
  if p_grace is null or p_grace < interval '2 hours' then
    raise exception 'grace must be at least 2 hours' using errcode = 'BTVF0';
  end if;
  if p_raw_ceiling is null or p_raw_ceiling < interval '1 day' then
    raise exception 'raw ceiling must be at least 1 day' using errcode = 'BTVF0';
  end if;
  if p_limit is null or p_limit < 1 or p_limit > 1000 then
    raise exception 'invalid limit' using errcode = 'BTVF0';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'sourceId', c.id,
             'handoverId', c.handover_id,
             'state', c.state,
             'reason', c.reason,
             'rawStoragePath', c.raw_storage_path,
             'rawObjectPresent', c.present,
             'createdAt', c.created_at,
             'updatedAt', c.updated_at,
             'sourceDeletedAt', c.deleted_at,
             'handoverDeletedAt', c.handover_deleted_at)
           order by c.created_at, c.id)
      from (
       select x.* from (
        select s.id, s.handover_id, s.state, s.raw_storage_path, s.created_at, s.updated_at, s.deleted_at,
               h.deleted_at as handover_deleted_at,
               exists (select 1 from storage.objects o
                        where o.bucket_id = 'source-uploads' and o.name = s.raw_storage_path) as present,
               case
                 when h.deleted_at is not null then 'handover_deleted'
                 when s.deleted_at is not null then 'removed_raw_pending'
                 when s.state = 'parsed' and s.updated_at < now() - p_grace then 'parsed_raw_pending'
                 when s.state = 'pending_upload' and s.created_at < now() - p_grace then 'pending_upload_expired'
                 when s.state in ('uploaded', 'failed') and s.created_at < now() - p_raw_ceiling then 'raw_ceiling'
               end as reason
          from public.sources s
          join public.handovers h on h.id = s.handover_id
         where s.raw_storage_path is not null
       ) x
       where x.reason is not null
       order by x.created_at, x.id
       limit p_limit
      ) c), '[]'::jsonb);
end $$;

revoke execute on function public.stale_pending_source(uuid, uuid, text) from public, anon, authenticated, service_role;
revoke execute on function public.list_orphan_upload_candidates(interval, interval, int) from public, anon, authenticated, service_role;
grant execute on function public.stale_pending_source(uuid, uuid, text) to service_role;
grant execute on function public.list_orphan_upload_candidates(interval, interval, int) to service_role;
