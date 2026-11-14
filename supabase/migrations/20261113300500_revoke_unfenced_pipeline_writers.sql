-- Round 3, Agent 4 (DB-12-LEGACY). ADDITIVE grants change only: no function body changes.
-- REQUIRES APPROVAL BEFORE ANY HOSTED APPLY.
--
-- Since the wiring commit, lib/** reaches the pipeline writers only through their fenced twins
-- (pipeline_*, migration 20261113300100), which check the worker's claim (job + attempt + lease + active
-- run + stage + scope). The unfenced originals stay callable by service_role only as a bypass of that
-- fencing, so no API role may execute them any more (the same treatment QA-N1 gave the legacy claim and
-- attempt functions). The fenced functions are SECURITY DEFINER and call these as their owner, so they
-- keep working.
--
-- Left granted on purpose: mark_source_parse_failed(uuid, text). lib/db/storage.ts (Agent 3) still calls it
-- directly when the raw upload fails its integrity check (downloadVerifiedRawSourceWithMeta). A follow-up
-- (cross-owner request) moves that call to the parse stage's fenced pipeline_mark_source_parse_failed, after
-- which it can be revoked too.

revoke execute on function
  public.insert_extracted_point(uuid, uuid, text, text, text, jsonb, text, text, jsonb, double precision),
  public.add_source_quote_evidence(uuid, uuid, text, int, int, text),
  public.record_quote_check(uuid, text),
  public.record_support_verdict(uuid, uuid, text, text, jsonb, bytea),
  public.create_system_gap_question(uuid, uuid, text, text, text, text, text),
  public.set_point_sort_keys(uuid, uuid, jsonb),
  public.persist_parsed_source(uuid, jsonb, text),
  public.set_job_provenance(uuid, jsonb)
from public, anon, authenticated, service_role;
