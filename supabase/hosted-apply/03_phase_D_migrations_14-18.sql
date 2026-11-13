-- Baton Round 3 hosted apply, PHASE D: migrations #14-#18, verbatim, in file order, in ONE transaction.
-- Run ONLY after phase A succeeded AND the Round 3 app/worker (>= 0bb1b96) is the one running.
-- The guard below aborts (nothing applied) if any processing job is running or queued.
do $$ begin
  if exists (select 1 from public.processing_jobs where status in ('queued','running')) then
    raise exception 'phase D aborted: processing jobs are queued or running';
  end if;
end $$;
begin;

-- ===== 20261113300500_revoke_unfenced_pipeline_writers.sql (verbatim) =====
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
insert into supabase_migrations.schema_migrations (version, name) values ('20261113300500', 'revoke_unfenced_pipeline_writers');

-- ===== 20261113300600_revoke_mark_source_parse_failed.sql (verbatim) =====
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
insert into supabase_migrations.schema_migrations (version, name) values ('20261113300600', 'revoke_mark_source_parse_failed');

-- ===== 20261113300700_processing_status_partial.sql (verbatim) =====
-- Round 3, Agent 4 (E4: accurate run states; lead-approved contract change to ProcessingStatus stage
-- status). CREATE OR REPLACE of api_get_processing_status with the SAME signature, grants, security
-- (invoker, RLS applies) and output shape as 20261111000900_read_api.sql; only the per-stage status changes:
--   running   any job running
--   queued    any job still queued (incl. a retry waiting for its backoff), none running
--   succeeded every job succeeded
--   partial   all jobs terminal, some succeeded and the rest failed or were skipped; or the run succeeded
--             although this stage's jobs all failed or were skipped (a failed source in a successful run)
--   failed    all jobs terminal, none succeeded, at least one failed, and the run did not succeed
--   cancelled all jobs terminal and cancelled, and the run did not succeed
-- Before: a stage showed `failed` while other jobs were still queued, and `cancelled` when one source was
-- skipped although the others succeeded. REQUIRES APPROVAL BEFORE ANY HOSTED APPLY.

create or replace function public.api_get_processing_status(p_handover_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'handover_state', h.state,
    'run', (
      select jsonb_build_object(
        'id', r.id, 'status', r.status, 'started_at', r.started_at, 'finished_at', r.finished_at,
        'error', case when r.error_code is not null
                      then jsonb_build_object('code', r.error_code, 'message', coalesce(r.error_message, '')) end,
        'stages', coalesce((
          select jsonb_agg(jsonb_build_object('stage', st.stage, 'status', st.status, 'done', st.done, 'total', st.total)
                           order by array_position(array['parse','extract','verify_quotes','verify_support','analyze','prepare_review'], st.stage))
            from (
              select j.stage,
                     -- E4 (lead-approved contract change): `partial` = some of the stage's jobs succeeded and
                     -- the others failed or were skipped (cancelled), or the run succeeded although this
                     -- stage's own jobs failed or were skipped. Open jobs win: a stage still working is
                     -- running/queued, never failed, until every job is terminal.
                     case when bool_or(j.status = 'running') then 'running'
                          when bool_or(j.status = 'queued') then 'queued'
                          when bool_and(j.status = 'succeeded') then 'succeeded'
                          when bool_or(j.status = 'succeeded') then 'partial'
                          when r.status = 'succeeded' then 'partial'
                          when bool_or(j.status = 'failed') then 'failed'
                          else 'cancelled' end as status,
                     count(*) filter (where j.status = 'succeeded') as done,
                     count(*) as total
                from public.processing_jobs j where j.run_id = r.id group by j.stage
            ) st), '[]'::jsonb))
        from public.processing_runs r where r.handover_id = h.id
       order by r.created_at desc, r.id limit 1),
    'sources', public.api_list_sources(h.id))
  from public.handovers h where h.id = p_handover_id
$$;
insert into supabase_migrations.schema_migrations (version, name) values ('20261113300700', 'processing_status_partial');

-- ===== 20261113300800_claim_generation.sql (verbatim) =====
-- Round 3, Agent 4 (DB-12 follow-up: claim generation + heartbeat on an expired lease). ADDITIVE: one column
-- (backfilled), CREATE OR REPLACE of three functions with unchanged signatures and grants, and new overloads.
-- REQUIRES APPROVAL BEFORE ANY HOSTED APPLY.
--
-- 1. Claim generation. `(job, attempt)` was not unique per claim: a checkpointing `yield` gives its attempt
--    back (attempt - 1), so the next claim reuses the same attempt number. `processing_jobs.claim_generation`
--    is incremented by every claim (the same trigger that remembers the claim's starting progress) and is
--    never decremented, so it identifies one claim. Existing rows are backfilled with `attempt`, so a job that
--    never yielded keeps claim_generation = attempt.
--      * New overloads pipeline_*(p_job_id, p_attempt, p_claim_generation, ...) check the exact generation.
--        The worker (lib/db/pipeline.ts) uses them whenever the claim carries a generation.
--      * The original pipeline_*(p_job_id, p_attempt, ...) stay granted (backwards compatible), but are now
--        accepted only while (job, attempt) is unambiguous, i.e. claim_generation = attempt (no yield since
--        the job was first claimed at that attempt); otherwise they refuse with BTLL0.
--    The overloads pass the generation to _pipeline_claim through a transaction-local setting
--    (baton.claim_generation) and call the original function, so every other check is unchanged.
-- 2. heartbeat_processing_job no longer renews a lease that has already expired: it returns 'lost', and the
--    worker stops (LeaseLostError → the job is dropped, recorded nothing) instead of reviving a claim that
--    another worker may already be entitled to take.

alter table public.processing_jobs add column claim_generation bigint not null default 0;
update public.processing_jobs set claim_generation = attempt;

create or replace function public._remember_claim_progress()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status = 'running' and new.attempt > old.attempt then
    new.claim_progress_done := old.progress_done;
    new.claim_generation := old.claim_generation + 1; -- one claim, one generation; a yield never lowers it
  end if;
  return new;
end $$;

create or replace function public._pipeline_claim(p_job_id uuid, p_attempt int, p_stages text[])
returns public.processing_jobs
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_handover uuid;
  v_job public.processing_jobs;
  v_run_status text;
  v_generation text := nullif(current_setting('baton.claim_generation', true), '');
begin
  if p_job_id is null or p_attempt is null then
    raise exception 'a claim (job id and attempt) is required' using errcode = 'BTVF0';
  end if;
  select handover_id into v_handover from public.processing_jobs where id = p_job_id;
  if v_handover is null then
    raise exception 'job not found' using errcode = 'BTNF0';
  end if;
  perform public._lock_handover_for_share(v_handover); -- first lock (same order as finish_processing_run)
  select * into v_job from public.processing_jobs where id = p_job_id for no key update;
  if v_job.status <> 'running' or v_job.attempt <> p_attempt
     or v_job.lease_expires_at is null or v_job.lease_expires_at <= now() then
    raise exception 'claim lost' using errcode = 'BTLL0';
  end if;
  -- Claim generation: exact match when the caller gave one; otherwise (job, attempt) must be unambiguous.
  if (v_generation is not null and v_job.claim_generation <> v_generation::bigint)
     or (v_generation is null and v_job.claim_generation <> v_job.attempt) then
    raise exception 'claim lost' using errcode = 'BTLL0';
  end if;
  select status into v_run_status from public.processing_runs where id = v_job.run_id;
  if v_run_status is null or v_run_status not in ('queued', 'running') then
    raise exception 'claim lost' using errcode = 'BTLL0';
  end if;
  if not (v_job.stage = any (p_stages)) then
    raise exception 'this stage may not perform that write' using errcode = 'BTFB0';
  end if;
  perform public._require_active_run(v_job.handover_id, v_job.run_id); -- N3: handover still processing
  return v_job;
end $$;

-- Sets the generation for the fenced call that follows in this transaction; NULL is refused.
create function public._pipeline_use_generation(p_claim_generation bigint)
returns void
language plpgsql
set search_path = ''
as $$
begin
  if p_claim_generation is null or p_claim_generation < 1 then
    raise exception 'a claim generation is required' using errcode = 'BTVF0';
  end if;
  perform set_config('baton.claim_generation', p_claim_generation::text, true);
end $$;

create or replace function public.heartbeat_processing_job(
  p_job_id uuid, p_attempt int, p_lease_seconds int, p_progress_done int default null, p_progress_total int default null
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.processing_jobs;
  v_run_status text;
begin
  if p_lease_seconds is null or p_lease_seconds < 30 or p_lease_seconds > 900 then
    raise exception 'invalid lease' using errcode = 'BTVF0';
  end if;
  select * into v_job from public.processing_jobs where id = p_job_id for update;
  if not found or v_job.status <> 'running' or v_job.attempt <> p_attempt then
    return 'lost';
  end if;
  -- An expired lease is not renewed: the job is claimable by another worker from that moment (DB-12).
  if v_job.lease_expires_at is null or v_job.lease_expires_at <= now() then
    return 'lost';
  end if;
  select status into v_run_status from public.processing_runs where id = v_job.run_id;
  if v_run_status not in ('queued', 'running') then
    return 'lost';
  end if;
  update public.processing_jobs
     set lease_expires_at = now() + make_interval(secs => p_lease_seconds),
         progress_done = coalesce(p_progress_done, progress_done),
         progress_total = coalesce(p_progress_total, progress_total)
   where id = p_job_id;
  return v_run_status;
end $$;

-- ── generation-checked overloads of the fenced writers ─────────────────────────

create function public.pipeline_set_job_provenance(p_job_id uuid, p_attempt int, p_claim_generation bigint, p_provenance jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public._pipeline_use_generation(p_claim_generation);
  perform public.pipeline_set_job_provenance(p_job_id, p_attempt, p_provenance);
  perform set_config('baton.claim_generation', '', true);
end $$;

create function public.pipeline_persist_parsed_source(p_job_id uuid, p_attempt int, p_claim_generation bigint, p_parsed jsonb, p_pepper_version text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public._pipeline_use_generation(p_claim_generation);
  perform public.pipeline_persist_parsed_source(p_job_id, p_attempt, p_parsed, p_pepper_version);
  perform set_config('baton.claim_generation', '', true);
end $$;

create function public.pipeline_mark_source_parse_failed(p_job_id uuid, p_attempt int, p_claim_generation bigint, p_error_code text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public._pipeline_use_generation(p_claim_generation);
  perform public.pipeline_mark_source_parse_failed(p_job_id, p_attempt, p_error_code);
  perform set_config('baton.claim_generation', '', true);
end $$;

create function public.pipeline_record_quote_check(p_job_id uuid, p_attempt int, p_claim_generation bigint, p_evidence_id uuid, p_quote_check text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public._pipeline_use_generation(p_claim_generation);
  perform public.pipeline_record_quote_check(p_job_id, p_attempt, p_evidence_id, p_quote_check);
  perform set_config('baton.claim_generation', '', true);
end $$;

create function public.pipeline_record_support_verdict(p_job_id uuid, p_attempt int, p_claim_generation bigint, p_point_evidence_id uuid, p_revision_id uuid, p_verdict text, p_rationale text, p_provenance jsonb, p_quote_sha256 bytea)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public._pipeline_use_generation(p_claim_generation);
  perform public.pipeline_record_support_verdict(p_job_id, p_attempt, p_point_evidence_id, p_revision_id, p_verdict, p_rationale, p_provenance, p_quote_sha256);
  perform set_config('baton.claim_generation', '', true);
end $$;

create function public.pipeline_create_system_gap_question(p_job_id uuid, p_attempt int, p_claim_generation bigint, p_point_id uuid, p_category text, p_question text, p_context text, p_priority text, p_access_level text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result uuid;
begin
  perform public._pipeline_use_generation(p_claim_generation);
  v_result := public.pipeline_create_system_gap_question(p_job_id, p_attempt, p_point_id, p_category, p_question, p_context, p_priority, p_access_level);
  perform set_config('baton.claim_generation', '', true);
  return v_result;
end $$;

create function public.pipeline_set_point_sort_keys(p_job_id uuid, p_attempt int, p_claim_generation bigint, p_keys jsonb)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result int;
begin
  perform public._pipeline_use_generation(p_claim_generation);
  v_result := public.pipeline_set_point_sort_keys(p_job_id, p_attempt, p_keys);
  perform set_config('baton.claim_generation', '', true);
  return v_result;
end $$;

create function public.pipeline_store_extract_chunk(p_job_id uuid, p_attempt int, p_claim_generation bigint, p_chunk_index int, p_chunk_total int, p_access_level text, p_ai_provenance jsonb, p_entries jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  perform public._pipeline_use_generation(p_claim_generation);
  v_result := public.pipeline_store_extract_chunk(p_job_id, p_attempt, p_chunk_index, p_chunk_total, p_access_level, p_ai_provenance, p_entries);
  perform set_config('baton.claim_generation', '', true);
  return v_result;
end $$;

-- ── grants ───────────────────────────────────────────────────────────────────

revoke execute on function public._pipeline_use_generation(bigint) from public, anon, authenticated, service_role;

revoke execute on function
  public.pipeline_set_job_provenance(uuid, int, bigint, jsonb),
  public.pipeline_persist_parsed_source(uuid, int, bigint, jsonb, text),
  public.pipeline_mark_source_parse_failed(uuid, int, bigint, text),
  public.pipeline_record_quote_check(uuid, int, bigint, uuid, text),
  public.pipeline_record_support_verdict(uuid, int, bigint, uuid, uuid, text, text, jsonb, bytea),
  public.pipeline_create_system_gap_question(uuid, int, bigint, uuid, text, text, text, text, text),
  public.pipeline_set_point_sort_keys(uuid, int, bigint, jsonb),
  public.pipeline_store_extract_chunk(uuid, int, bigint, int, int, text, jsonb, jsonb)
from public, anon, authenticated, service_role;

grant execute on function
  public.pipeline_set_job_provenance(uuid, int, bigint, jsonb),
  public.pipeline_persist_parsed_source(uuid, int, bigint, jsonb, text),
  public.pipeline_mark_source_parse_failed(uuid, int, bigint, text),
  public.pipeline_record_quote_check(uuid, int, bigint, uuid, text),
  public.pipeline_record_support_verdict(uuid, int, bigint, uuid, uuid, text, text, jsonb, bytea),
  public.pipeline_create_system_gap_question(uuid, int, bigint, uuid, text, text, text, text, text),
  public.pipeline_set_point_sort_keys(uuid, int, bigint, jsonb),
  public.pipeline_store_extract_chunk(uuid, int, bigint, int, int, text, jsonb, jsonb)
to service_role;
insert into supabase_migrations.schema_migrations (version, name) values ('20261113300800', 'claim_generation');

-- ===== 20261113300900_point_evidence_guard_fields.sql (verbatim) =====
-- Round 3, Agent 4: PI-11 guard fields on the review read (lead-approved additive contract change).
--
-- api_get_point (same signature, security invoker, grants unchanged) adds two keys to every evidence
-- object, so the UI no longer has to recognise the guard's fixed rationale sentence:
--   guarded       boolean  true when the deterministic injection guard (lib/ai/injection-guard.ts)
--                          replaced the verifier's promoting verdict with 'irrelevant';
--   model_verdict text     the verdict the model returned before the guard ('supports' | 'partial'),
--                          null unless guarded.
-- Both are derived from point_evidence.verifier_provenance -> 'injectionGuard', which the verify_support
-- stage writes (pattern ids and verdicts only, never text). They hold only while the stored verdict is
-- still 'irrelevant': a later reset (privacy redaction sets 'unchecked') or a new verdict clears them.
-- No table, column, grant or RLS change. Everything else is byte-for-byte the 20261111000900 body.

create or replace function public.api_get_point(p_point_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'id', p.id, 'category', p.category, 'title', r.title, 'statement', r.statement,
    'evidence_status', p.evidence_status, 'review_state', p.review_state, 'access_level', p.access_level,
    'is_potentially_outdated', p.is_potentially_outdated, 'origin', p.origin,
    'evidence_count', (select count(*) from public.point_evidence pe join public.evidence_quotes q on q.id = pe.evidence_id
                        where pe.point_id = p.id),
    'privacy_review', p.privacy_review, 'last_supported_at', p.last_supported_at, 'updated_at', p.updated_at,
    'current_revision_id', p.current_revision_id, 'revision_number', r.revision_number, 'attributes', r.attributes,
    'inference_rationale', p.inference_rationale,
    'privacy_review_flagged_at', case when p.privacy_review = 'required' then p.privacy_review_flagged_at end,
    'privacy_review_reason', case when p.privacy_review = 'required' then (
        select ra.metadata ->> 'reason' from public.review_actions ra
         where ra.point_id = p.id and ra.action = 'privacy_hold' order by ra.created_at desc, ra.id desc limit 1) end,
    'privacy_review_set', public.get_privacy_review(p.id),
    'inferred_confirmation', case when p.inferred_confirmed_at is not null then jsonb_build_object(
        'by', coalesce(public.member_label(p.handover_id, p.inferred_confirmed_by), 'Former member'),
        'at', p.inferred_confirmed_at) end,
    'conflict_resolution', case when p.conflict_resolution_note is not null then jsonb_build_object(
        'note', p.conflict_resolution_note,
        'by', coalesce(public.member_label(p.handover_id, p.conflict_resolved_by), 'Former member'),
        'at', p.conflict_resolved_at) end,
    'evidence', coalesce((
      select jsonb_agg(jsonb_build_object(
               'point_evidence_id', pe.id, 'evidence_id', q.id, 'kind', q.kind, 'quote', q.quote_text,
               'author_label', q.author_label,
               'sent_at', coalesce(q.message_sent_at, case when q.kind = 'testimony' then q.created_at end),
               'source_title', q.source_title, 'location', q.location, 'quote_check', q.quote_check,
               'support_verdict', pe.support_verdict, 'verdict_rationale', pe.verdict_rationale,
               'guarded', (pe.support_verdict = 'irrelevant'
                           and coalesce(pe.verifier_provenance -> 'injectionGuard' ->> 'guarded', '') = 'true'),
               'model_verdict', case when pe.support_verdict = 'irrelevant'
                                      and coalesce(pe.verifier_provenance -> 'injectionGuard' ->> 'guarded', '') = 'true'
                                      and pe.verifier_provenance -> 'injectionGuard' ->> 'modelVerdict' in ('supports', 'partial')
                                     then pe.verifier_provenance -> 'injectionGuard' ->> 'modelVerdict' end,
               'is_current_revision_verdict', pe.verified_revision_id is not distinct from p.current_revision_id
                                               and pe.support_verdict <> 'unchecked',
               'excluded', pe.excluded_at is not null, 'exclusion_reason', pe.exclusion_reason,
               'access_level', q.access_level)
             order by coalesce(q.message_sent_at, case when q.kind = 'testimony' then q.created_at end) desc nulls last, pe.id)
        from public.point_evidence pe join public.evidence_quotes q on q.id = pe.evidence_id
       where pe.point_id = p.id), '[]'::jsonb),
    'revisions', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', rv.id, 'number', rv.revision_number, 'title', rv.title, 'statement', rv.statement,
               'attributes', rv.attributes, 'edit_reason', rv.edit_reason,
               'author_label', case when rv.author_profile_id is not null
                                    then coalesce(public.member_label(p.handover_id, rv.author_profile_id), 'Former member') end,
               'created_at', rv.created_at, 'redaction', rv.redaction_kind)
             order by rv.revision_number)
        from public.point_revisions rv where rv.point_id = p.id), '[]'::jsonb),
    'review_history', coalesce((
      select jsonb_agg(jsonb_build_object(
               'action', ra.action,
               'actor_label', case when ra.actor_profile_id is not null
                                   then coalesce(public.member_label(p.handover_id, ra.actor_profile_id), 'Former member') end,
               'note', ra.note, 'created_at', ra.created_at)
             order by ra.created_at, ra.id)
        from public.review_actions ra where ra.point_id = p.id), '[]'::jsonb))
  from public.handover_points p
  join public.point_revisions r on r.id = p.current_revision_id
  where p.id = p_point_id
$$;
insert into supabase_migrations.schema_migrations (version, name) values ('20261113300900', 'point_evidence_guard_fields');

commit;

-- PostgREST must see #17's new overloads.
notify pgrst, 'reload schema';
