-- Round 3 (Agent 3, D3): READ-ONLY orphan-upload detection. Additive only: no table, trigger or existing
-- function changes, and nothing here deletes or updates anything. Server-only (service_role).
-- (Reusing a stale pending_upload row on retry is Agent 2's create_source change, not this migration.)

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

revoke execute on function public.list_orphan_upload_candidates(interval, interval, int) from public, anon, authenticated, service_role;
grant execute on function public.list_orphan_upload_candidates(interval, interval, int) to service_role;
