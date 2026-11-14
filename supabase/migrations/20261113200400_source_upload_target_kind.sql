-- Round 3 (Agent 3, approved request #4): source_upload_target also returns the source's declared `kind`,
-- so confirmSourceUploaded (lib/db/storage.ts) can refuse a renamed or wrong-type file (e.g. a PDF chosen
-- as a chat export) while the user is still on the upload step, instead of at preview or parse time.
-- Same signature and same checks as 20261111000600, replaced in place (grants kept); the only change is one
-- added JSON field, so existing readers of raw_storage_path / size_bytes / sha256 are unaffected.

create or replace function public.source_upload_target(p_actor_profile_id uuid, p_source_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid := public._require_actor(p_actor_profile_id);
  v_s public.sources;
begin
  select * into v_s from public.sources where id = p_source_id;
  if not found or v_s.deleted_at is not null then
    raise exception 'source not found' using errcode = 'BTNF0';
  end if;
  perform public._require_source_manager(v_actor, v_s.handover_id);
  if v_s.state <> 'pending_upload' then
    raise exception 'source is not awaiting upload' using errcode = 'BTIT0';
  end if;
  return jsonb_build_object('raw_storage_path', v_s.raw_storage_path, 'size_bytes', v_s.size_bytes,
                            'sha256', encode(v_s.sha256, 'hex'), 'kind', v_s.kind);
end $$;
