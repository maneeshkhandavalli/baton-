-- R3 C5 (interrupted-upload retry): create_source no longer refuses the same file when the earlier copy
-- is the SAME actor's unfinished upload (`pending_upload`) in the same handover.
--
-- Before: an upload that was interrupted (tab closed, network lost, signed URL expired, confirm never
-- reached the server) left a `pending_upload` row whose (handover_id, sha256) blocked every retry with
-- `conflict` ("this file was already uploaded") until the user found and removed it.
--
-- Now, for a live `pending_upload` row with the same checksum that the actor created:
--   * REUSE when Storage holds no object at its path (the upload never arrived, or confirm removed a
--     mismatching object): the row's declared metadata is refreshed and its id is returned, so the server
--     signs a fresh upload ticket for the same path raw/{handover}/{source}. No second row, no extra slot.
--   * REPLACE when an object already exists at its path (the upload arrived but was never confirmed): a
--     signed upload cannot overwrite it, so the old row is soft-deleted (`removed`; raw_storage_path is
--     kept so the retention sweep removes that object: reason `removed_raw_pending`) and a new row with a
--     new id and path is created.
-- Every other duplicate is unchanged: a live `uploaded`/`parsing`/`parsed`/`failed` source, or a
-- `pending_upload` row created by another member, is still `conflict` (BTCF0, mapped to
-- details.reason = "duplicate_source" by the action).
--
-- Concurrency: a transaction-scoped advisory lock per (handover, checksum) serialises retries of the same
-- file, so a double submit reuses one row instead of racing into the unique index.
--
-- CREATE OR REPLACE with an unchanged signature and return value (the new or reused source id): the
-- existing grants (service_role only) and lib/db/storage.ts's ticket contract are unchanged.

create or replace function public.create_source(p_actor_profile_id uuid,
  p_handover_id uuid, p_kind text, p_file_name text, p_mime_type text, p_size_bytes bigint, p_sha256_hex text,
  p_timezone text default 'Asia/Kolkata'
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := public._require_actor(p_actor_profile_id);
  v_h public.handovers;
  v_id uuid := gen_random_uuid();
  v_prev public.sources;
  v_replaces uuid;
begin
  v_h := public._lock_handover_for_share(p_handover_id);
  perform public._require_source_manager(p_actor_profile_id, p_handover_id);
  if v_h.state not in ('draft', 'in_review') then
    raise exception 'sources can be added in draft or review only' using errcode = 'BTIT0';
  end if;
  if p_sha256_hex is null or p_sha256_hex !~ '^[a-f0-9]{64}$' then
    raise exception 'invalid checksum' using errcode = 'BTVF0';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('baton.create_source:' || p_handover_id::text || ':' || p_sha256_hex, 0));

  select * into v_prev
    from public.sources s
   where s.handover_id = p_handover_id and s.sha256 = decode(p_sha256_hex, 'hex') and s.deleted_at is null
     and s.state = 'pending_upload' and s.uploaded_by = v_actor
   for update;

  if found then
    if not exists (select 1 from storage.objects o
                    where o.bucket_id = 'source-uploads' and o.name = v_prev.raw_storage_path) then
      -- REUSE: nothing arrived at the old path, so a fresh ticket for the same path is safe.
      update public.sources
         set kind = p_kind, title = left(p_file_name, 255), original_filename = p_file_name, mime_type = p_mime_type,
             size_bytes = p_size_bytes, timezone = p_timezone,
             raw_storage_path = 'raw/' || p_handover_id::text || '/' || v_prev.id::text
       where id = v_prev.id;
      perform public._audit(p_handover_id, v_actor, null, 'source.upload_restarted', 'source', v_prev.id, null,
                            jsonb_build_object('kind', p_kind, 'sizeBytes', p_size_bytes));
      return v_prev.id;
    end if;
    -- REPLACE: an unconfirmed object occupies the old path. Retire that row; the sweep deletes its object.
    update public.sources set deleted_at = now(), state = 'removed' where id = v_prev.id;
    perform public._audit(p_handover_id, v_actor, null, 'source.removed', 'source', v_prev.id,
                          jsonb_build_object('state', 'pending_upload'),
                          jsonb_build_object('state', 'removed', 'reason', 'upload_retried'));
    v_replaces := v_prev.id;
  end if;

  if (select count(*) from public.sources where handover_id = p_handover_id and deleted_at is null) >= 10 then
    raise exception 'a handover has at most 10 sources' using errcode = 'BTPF0'; -- D15
  end if;
  begin
    insert into public.sources (id, handover_id, uploaded_by, kind, title, original_filename, mime_type, size_bytes, sha256,
                                state, timezone, raw_storage_path)
    values (v_id, p_handover_id, v_actor, p_kind, left(p_file_name, 255), p_file_name, p_mime_type, p_size_bytes,
            decode(p_sha256_hex, 'hex'), 'pending_upload', p_timezone,
            'raw/' || p_handover_id::text || '/' || v_id::text);
  exception when unique_violation then
    raise exception 'this file was already uploaded' using errcode = 'BTCF0';
  end;
  perform public._audit(p_handover_id, v_actor, null, 'source.created', 'source', v_id, null,
                        jsonb_strip_nulls(jsonb_build_object('kind', p_kind, 'sizeBytes', p_size_bytes, 'replaces', v_replaces)));
  return v_id;
end $$;
