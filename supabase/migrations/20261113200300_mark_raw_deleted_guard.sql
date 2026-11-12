-- Round 3 (Agent 3): QA-L1, database half. mark_source_raw_deleted (20261111000500) recorded a raw delete for
-- ANY source, including an uploaded or failed one on a live draft that still needs its raw upload for a
-- (re)parse (D14, §10.3 step 5). Same signature, replaced in place (grants are kept); the only change is a
-- guard. A raw delete may be recorded only when the raw upload is no longer needed:
--   * the source is 'parsed' (the parse transaction committed, §10.3 step 4), or
--   * the source was removed ('removed' / deleted_at set: removeSource, and storage.ts's signing rollback), or
--   * its handover is soft-deleted (R3-D5 discard cleanup: pending/uploaded/failed sources of a deleted draft).
-- Anything else is invalid_transition (BTIT0). An already-recorded delete (raw path NULL) stays a no-op for
-- every state, so retries are idempotent. The future 7-day ceiling for uploaded/failed sources (§12.6) is a
-- separate, fenced retention function (docs/proposals/retention.md §7), not this one.

create or replace function public.mark_source_raw_deleted(p_source_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_s public.sources;
  v_handover_deleted boolean;
begin
  select * into v_s from public.sources where id = p_source_id for update;
  if not found then
    raise exception 'source not found' using errcode = 'BTNF0';
  end if;
  if v_s.raw_storage_path is null then
    return;
  end if;
  select h.deleted_at is not null into v_handover_deleted from public.handovers h where h.id = v_s.handover_id;
  if not (v_s.state in ('parsed', 'removed') or v_s.deleted_at is not null or coalesce(v_handover_deleted, false)) then
    raise exception 'the raw upload is still needed (source not parsed, removed or discarded)' using errcode = 'BTIT0';
  end if;
  update public.sources set raw_storage_path = null, raw_deleted_at = now() where id = p_source_id;
  perform public._audit(v_s.handover_id, null, null, 'source.raw_deleted', 'source', p_source_id, null,
                        jsonb_build_object('state', v_s.state));
end $$;
