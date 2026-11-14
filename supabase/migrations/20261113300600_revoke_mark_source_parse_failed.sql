-- Round 3, Agent 4 (DB-12-LEGACY, part 2). ADDITIVE grants change only: no function body changes.
-- REQUIRES APPROVAL BEFORE ANY HOSTED APPLY.
--
-- 20261113300500 left mark_source_parse_failed granted because lib/db/storage.ts still called it on an
-- integrity mismatch. Since Agent 3's d4f4d46 and Agent 4's 0d222b3, the parse job passes its claim and the
-- mismatch is written through the fenced pipeline_mark_source_parse_failed; no production code calls the
-- unfenced function any more (storage.ts keeps a claim-less branch for callers without a claim; none
-- exists in lib/** or app/**, and after this revoke such a call fails closed with 42501 → forbidden).
-- pipeline_mark_source_parse_failed calls it as its SECURITY DEFINER owner, so it keeps working.

revoke execute on function public.mark_source_parse_failed(uuid, text)
from public, anon, authenticated, service_role;
