-- Integration support for the pipeline worker and server actions (overnight integration, 2026-11-12).
-- Lead-owned, ADDITIVE: new functions only, plus one bug fix (DB-11) by CREATE OR REPLACE with the same
-- signature. No table, column, policy or existing grant changes. Requests: docs/integration/interfaces.md.
--
-- Worker (service_role only, §9.3, §10, §11.8):
--   DB-1  claim_ready_processing_jobs   claim only jobs whose earlier stages are terminal; reap dead leases
--   DB-2  complete_processing_job       fenced completion (status + attempt must match the claim)
--   DB-3  heartbeat_processing_job      extend the lease, return the run status or 'lost'
--   DB-4  get_processing_job_context    job, run snapshot, handover, source, idempotency hint
--   DB-5  list_extraction_messages      masked text messages of one parsed source, by seq page
--   DB-6  list_points_for_pipeline      points + current revision for dedup, coverage and ordering
--   DB-7  list_quotes_for_check         pending source quotes with their message body
--   DB-8  list_links_needing_support    (current revision, verified quote, ≤3 same-source neighbours)
--   DB-9  list_gap_questions_for_pipeline
--   DB-10 set_point_sort_keys           §10.10 ordering, inside the active run
--   DB-11 add_source_quote_evidence     fix: offset-less (not_found) quotes no longer collapse into one row
--   QA-M1 add_source_quote_evidence + record_quote_check refuse implausible exact/normalized checks
-- Actions:
--   R1    api_get_source                (authenticated, SECURITY INVOKER) one source under RLS
--   R2    source_preview_target         (service_role) actor-checked raw read for previewSource (§10.3.1)
--
-- Deferred (documented gaps): run fencing on persist/evidence/gap writers (DB-12) and an atomic
-- per-chunk extraction insert (DB-13).

-- ── helpers ────────────────────────────────────────────────────────────────

create function public._pipeline_stage_rank(p_stage text)
returns int
language sql
immutable
set search_path = ''
as $$
  select array_position(array['parse', 'extract', 'verify_quotes', 'verify_support', 'analyze', 'prepare_review'], p_stage)
$$;

-- ── DB-1 ───────────────────────────────────────────────────────────────────
-- Like claim_processing_jobs, plus: (a) one claimer at a time, (b) jobs whose lease expired on their last
-- attempt are failed instead of staying 'running' forever, (c) a job is claimable only when every
-- earlier-stage job of the same source (and every earlier per-handover job) is terminal, so ordering
-- never costs an attempt, (d) at most one extract per run at a time (cross-source dedup is serial).

create function public.claim_ready_processing_jobs(p_limit int default 5, p_lease_seconds int default 300)
returns setof public.processing_jobs
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ids uuid[];
begin
  if p_limit is null or p_limit < 1 or p_limit > 50 or p_lease_seconds is null or p_lease_seconds < 30 or p_lease_seconds > 900 then
    raise exception 'invalid claim parameters' using errcode = 'BTVF0';
  end if;
  perform pg_advisory_xact_lock(hashtext('baton.claim_processing_jobs'));

  update public.processing_jobs j
     set status = 'failed', error_code = 'processing_failed', error_message = 'lease_expired',
         finished_at = now(), lease_expires_at = null
   where j.status = 'running' and j.lease_expires_at < now() and j.attempt >= j.max_attempts;

  select array_agg(x.id) into v_ids from (
    select c.id
      from (
        select c0.*,
               row_number() over (partition by c0.run_id, (c0.stage = 'extract')
                                  order by c0.next_attempt_at nulls first, c0.id) as rn
          from public.processing_jobs c0
          join public.processing_runs r on r.id = c0.run_id
         where r.status in ('queued', 'running')
           and ((c0.status = 'queued' and (c0.next_attempt_at is null or c0.next_attempt_at <= now()))
                or (c0.status = 'running' and c0.lease_expires_at < now()))
           and c0.attempt < c0.max_attempts
           and not exists (
             select 1 from public.processing_jobs d
              where d.run_id = c0.run_id and d.id <> c0.id
                and public._pipeline_stage_rank(d.stage) < public._pipeline_stage_rank(c0.stage)
                and (d.source_id is not distinct from c0.source_id or d.source_id is null or c0.source_id is null)
                and d.status not in ('succeeded', 'failed', 'cancelled'))
           and (c0.stage <> 'extract' or not exists (
             select 1 from public.processing_jobs e
              where e.run_id = c0.run_id and e.id <> c0.id and e.stage = 'extract'
                and e.status = 'running' and e.lease_expires_at >= now()))
      ) c
     where c.stage <> 'extract' or c.rn = 1
     order by public._pipeline_stage_rank(c.stage), c.next_attempt_at nulls first, c.id
     limit p_limit
  ) x;

  if v_ids is null then
    return;
  end if;

  return query
  update public.processing_jobs j
     set status = 'running', attempt = j.attempt + 1, started_at = coalesce(j.started_at, now()),
         lease_expires_at = now() + make_interval(secs => p_lease_seconds)
   where j.id in (select k.id from public.processing_jobs k where k.id = any (v_ids) order by k.id for update of k skip locked)
  returning j.*;
  -- M4 order: jobs first (above), then the run.
  update public.processing_runs r set status = 'running', started_at = coalesce(r.started_at, now())
   where r.status = 'queued' and exists (select 1 from public.processing_jobs j where j.run_id = r.id and j.status = 'running');
end $$;

-- ── DB-2 ───────────────────────────────────────────────────────────────────

create function public.complete_processing_job(
  p_job_id uuid, p_attempt int, p_outcome text, p_attempt_record jsonb default null,
  p_error_code text default null, p_error_message text default null, p_next_attempt_at timestamptz default null,
  p_progress_done int default null, p_progress_total int default null
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.processing_jobs;
  v_yield boolean;
  v_status text;
begin
  select * into v_job from public.processing_jobs where id = p_job_id for update;
  if not found then
    raise exception 'job not found' using errcode = 'BTNF0';
  end if;
  if v_job.status <> 'running' or v_job.attempt <> p_attempt then
    raise exception 'job lease lost' using errcode = 'BTCF0';
  end if;
  if p_outcome is null or p_outcome not in ('succeeded', 'retry', 'failed', 'skipped', 'yield') then
    raise exception 'unknown outcome' using errcode = 'BTVF0';
  end if;
  if p_error_code is not null and p_error_code <> all (array[
       'validation_failed', 'unauthenticated', 'forbidden', 'not_found', 'conflict', 'invalid_transition',
       'precondition_failed', 'rate_limited', 'payload_too_large', 'unsupported_file_type', 'token_invalid',
       'parse_failed', 'processing_failed', 'internal']) then
    raise exception 'unknown error code' using errcode = 'BTVF0';
  end if;
  -- §12.7: a structural reason token only, never content.
  if p_error_message is not null and p_error_message !~ '^[a-z0-9_:]{1,64}$' then
    raise exception 'error message must be a reason token' using errcode = 'BTVF0';
  end if;
  if p_attempt_record is not null and jsonb_typeof(p_attempt_record) <> 'object' then
    raise exception 'attempt record must be an object' using errcode = 'BTVF0';
  end if;

  v_yield := p_outcome = 'yield' and p_progress_done is not null and p_progress_done > coalesce(v_job.progress_done, -1);
  v_status := case
    when p_outcome = 'succeeded' then 'succeeded'
    when p_outcome = 'failed' then 'failed'
    when p_outcome = 'skipped' then 'cancelled'
    when v_yield then 'queued'
    when v_job.attempt < v_job.max_attempts then 'queued' -- retry, or a yield without progress
    else 'failed' end;

  update public.processing_jobs
     set attempt_log = case when p_attempt_record is null then attempt_log else attempt_log || jsonb_build_array(p_attempt_record) end,
         status = v_status,
         attempt = case when v_yield then attempt - 1 else attempt end,
         next_attempt_at = case when v_status = 'queued' then coalesce(p_next_attempt_at, now()) end,
         lease_expires_at = null,
         error_code = case when v_status = 'succeeded' or v_yield then null
                           when p_outcome = 'skipped' then 'precondition_failed' else p_error_code end,
         error_message = case when v_status = 'succeeded' or v_yield then null
                              when p_outcome = 'skipped' then 'upstream_failed' else p_error_message end,
         progress_done = coalesce(p_progress_done, progress_done),
         progress_total = coalesce(p_progress_total, progress_total),
         finished_at = case when v_status = 'queued' then null else now() end
   where id = p_job_id;
  return v_status;
end $$;

-- ── DB-3 ───────────────────────────────────────────────────────────────────

create function public.heartbeat_processing_job(
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

-- ── DB-4 ───────────────────────────────────────────────────────────────────

create function public.get_processing_job_context(p_job_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'job', jsonb_build_object(
      'id', j.id, 'runId', j.run_id, 'handoverId', j.handover_id, 'sourceId', j.source_id, 'stage', j.stage,
      'status', j.status, 'attempt', j.attempt, 'maxAttempts', j.max_attempts, 'inputHash', encode(j.input_hash, 'hex'),
      'progressDone', j.progress_done, 'progressTotal', j.progress_total),
    'run', jsonb_build_object(
      'status', r.status, 'pipelineVersion', r.pipeline_version, 'aiProvider', r.ai_provider, 'aiConfig', r.ai_config,
      'sourceIds', to_jsonb(r.source_ids)),
    'handover', jsonb_build_object(
      'state', h.state, 'teamName', h.team_name, 'roleTitle', h.role_title, 'deleted', h.deleted_at is not null),
    'source', case when s.id is null then null else jsonb_build_object(
      'kind', s.kind, 'state', s.state, 'accessLevel', s.access_level, 'timezone', s.timezone, 'dateOrder', s.date_order,
      'originalFilename', s.original_filename, 'rawAvailable', s.raw_storage_path is not null,
      'consentAiProvider', s.consent_ai_provider, 'documentDate', s.document_date, 'deleted', s.deleted_at is not null) end,
    'priorSucceeded', exists (
      select 1 from public.processing_jobs p
       where p.handover_id = j.handover_id and p.run_id <> j.run_id and p.stage = j.stage
         and p.source_id is not distinct from j.source_id and p.input_hash = j.input_hash and p.status = 'succeeded'))
    from public.processing_jobs j
    join public.processing_runs r on r.id = j.run_id
    join public.handovers h on h.id = j.handover_id
    left join public.sources s on s.id = j.source_id
   where j.id = p_job_id
$$;

-- ── DB-5 ───────────────────────────────────────────────────────────────────
-- Masked rows only (they are persisted masked, §10.3). Excluded participants and conversations are never
-- persisted; the filters below are defence in depth.

create function public.list_extraction_messages(p_source_id uuid, p_after_seq int, p_limit int)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_s public.sources;
begin
  if p_limit is null or p_limit < 1 or p_limit > 2000 then
    raise exception 'invalid page size' using errcode = 'BTVF0';
  end if;
  select * into v_s from public.sources where id = p_source_id;
  if not found or v_s.deleted_at is not null then
    raise exception 'source not found' using errcode = 'BTNF0';
  end if;
  if v_s.state <> 'parsed' then
    raise exception 'source is not parsed' using errcode = 'BTIT0';
  end if;
  return jsonb_build_object(
    'accessLevel', v_s.access_level,
    'messages', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', m.id, 'seq', m.seq, 'conversationLocalId', c.local_id, 'authorLabel', sp.display_label,
               'sentAt', m.sent_at, 'kind', m.kind, 'body', m.body) order by m.seq)
        from (select * from public.source_messages m0
               where m0.source_id = p_source_id and m0.seq > coalesce(p_after_seq, -1)
                 and m0.kind in ('text', 'document_block')
               order by m0.seq limit p_limit) m
        left join public.source_conversations c on c.id = m.conversation_id
        left join public.source_participants sp on sp.id = m.participant_id
       where coalesce(c.excluded, false) = false and coalesce(sp.excluded, false) = false), '[]'::jsonb));
end $$;

-- ── DB-6 ───────────────────────────────────────────────────────────────────

create function public.list_points_for_pipeline(p_handover_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'pointId', p.id, 'category', p.category, 'origin', p.origin, 'extractionRunId', p.extraction_run_id,
           'extractionAccessLevel', p.extraction_access_level, 'accessLevel', p.access_level,
           'evidenceStatus', p.evidence_status, 'reviewState', p.review_state, 'privacyReview', p.privacy_review,
           'currentRevisionId', p.current_revision_id,
           'title', case when r.redacted_at is null then r.title end,
           'statement', case when r.redacted_at is null then r.statement end,
           'attributes', case when r.redacted_at is null then r.attributes end,
           'redacted', r.redacted_at is not null,
           'newestEvidenceAt', (select max(q.message_sent_at) from public.point_evidence pe
                                  join public.evidence_quotes q on q.id = pe.evidence_id
                                 where pe.point_id = p.id and pe.excluded_at is null),
           'lastSupportedAt', p.last_supported_at) order by p.created_at, p.id), '[]'::jsonb)
    from public.handover_points p
    left join public.point_revisions r on r.id = p.current_revision_id
   where p.handover_id = p_handover_id and p.erased_at is null
$$;

-- ── DB-7 ───────────────────────────────────────────────────────────────────

create function public.list_quotes_for_check(p_source_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'evidenceId', q.id, 'sourceMessageId', q.source_message_id, 'quoteText', q.quote_text,
           'quoteStart', q.quote_start, 'quoteEnd', q.quote_end, 'quoteCheck', q.quote_check,
           'messageBody', m.body) order by q.created_at, q.id), '[]'::jsonb)
    from public.evidence_quotes q
    left join public.source_messages m on m.id = q.source_message_id
   where q.source_id = p_source_id and q.kind = 'source_quote' and q.quote_check = 'pending'
$$;

-- ── DB-8 ───────────────────────────────────────────────────────────────────
-- §10.8/§11.8 rule 1: the claim (current revision), the quote and ≤3 neighbours from the quote's own
-- source (same access level), never the extractor's stance. Privacy-held and redacted points are skipped.

create function public.list_links_needing_support(p_handover_id uuid, p_limit int)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_limit is null or p_limit < 1 or p_limit > 500 then
    raise exception 'invalid page size' using errcode = 'BTVF0';
  end if;
  return coalesce((
    select jsonb_agg(x.obj order by x.created_at, x.id) from (
      select pe.id, pe.created_at, jsonb_build_object(
               'pointEvidenceId', pe.id, 'pointId', p.id, 'revisionId', p.current_revision_id,
               'claim', jsonb_build_object('category', p.category, 'title', r.title, 'statement', r.statement,
                                           'attributes', r.attributes),
               'evidenceKind', q.kind,
               'quote', jsonb_build_object('text', q.quote_text, 'authorLabel', q.author_label, 'sentAt', q.message_sent_at),
               'context', case when q.kind = 'source_quote' and m.id is not null then coalesce((
                   select jsonb_agg(jsonb_build_object('authorLabel', sp.display_label, 'sentAt', n.sent_at, 'body', n.body)
                                    order by n.seq)
                     from (select * from public.source_messages n0
                            where n0.source_id = m.source_id and n0.id <> m.id and n0.kind in ('text', 'document_block')
                            order by abs(n0.seq - m.seq), n0.seq limit 3) n
                     left join public.source_participants sp on sp.id = n.participant_id), '[]'::jsonb)
                 else '[]'::jsonb end) as obj
        from public.point_evidence pe
        join public.handover_points p on p.id = pe.point_id
        join public.point_revisions r on r.id = p.current_revision_id
        join public.evidence_quotes q on q.id = pe.evidence_id
        left join public.source_messages m on m.id = q.source_message_id
       where pe.handover_id = p_handover_id and pe.excluded_at is null
         and p.erased_at is null and p.privacy_review <> 'required' and r.redacted_at is null
         and q.quote_check in ('exact', 'normalized')
         and (pe.support_verdict = 'unchecked' or pe.verified_revision_id is distinct from p.current_revision_id)
       order by pe.created_at, pe.id
       limit p_limit) x), '[]'::jsonb);
end $$;

-- ── DB-9 ───────────────────────────────────────────────────────────────────

create function public.list_gap_questions_for_pipeline(p_handover_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', g.id, 'pointId', g.point_id, 'category', g.category, 'status', g.status,
           'isSystem', g.created_by is null,
           'question', case when g.created_by is null then g.question end) order by g.created_at, g.id), '[]'::jsonb)
    from public.gap_questions g
   where g.handover_id = p_handover_id
$$;

-- ── DB-10 ──────────────────────────────────────────────────────────────────

create function public.set_point_sort_keys(p_handover_id uuid, p_run_id uuid, p_keys jsonb)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n int;
begin
  if p_keys is null or jsonb_typeof(p_keys) <> 'array' then
    raise exception 'keys must be an array' using errcode = 'BTVF0';
  end if;
  perform public._lock_handover_for_share(p_handover_id);
  perform public._require_active_run(p_handover_id, p_run_id);
  update public.handover_points p
     set sort_key = (k ->> 'sortKey')::double precision
    from jsonb_array_elements(p_keys) k
   where p.id = (k ->> 'pointId')::uuid and p.handover_id = p_handover_id and p.erased_at is null;
  get diagnostics v_n = row_count;
  return v_n;
end $$;

-- ── QA-M1: the database refuses implausible quote checks (defence in depth for §10.7) ────────────────
-- The worker computes the check (lib/ai quote-check); the database no longer trusts it blindly:
--   * exact / normalized need offsets and a quote of at least 12 characters (§10.7 rule 4; the 3-word rule
--     stays in TypeScript, which segments words per script);
--   * exact must occur verbatim in the message body;
--   * offsets are JavaScript (UTF-16 code unit) coordinates, so they are bounded by 2 × char_length(body).

create function public._quote_check_plausible(p_check text, p_quote text, p_start int, p_end int, p_body text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case
    when p_check in ('pending', 'not_found') then true
    when p_check in ('exact', 'normalized') then
      p_start is not null and p_end is not null and p_body is not null and p_end > p_start
      and p_end <= 2 * char_length(p_body) and char_length(btrim(p_quote)) >= 12
      and (p_check <> 'exact' or strpos(p_body, p_quote) > 0)
    else false end
$$;

create or replace function public.record_quote_check(p_evidence_id uuid, p_quote_check text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_q public.evidence_quotes;
  v_body text;
begin
  select * into v_q from public.evidence_quotes where id = p_evidence_id;
  if not found then
    raise exception 'evidence not found' using errcode = 'BTNF0';
  end if;
  perform public._lock_handover_for_share(v_q.handover_id);
  perform public._require_active_run(v_q.handover_id); -- N3
  if v_q.kind = 'source_quote' then
    select body into v_body from public.source_messages where id = v_q.source_message_id;
    if not public._quote_check_plausible(p_quote_check, v_q.quote_text, v_q.quote_start, v_q.quote_end, v_body) then
      raise exception 'quote check is not consistent with the message' using errcode = 'BTVF0';
    end if;
  end if;
  update public.evidence_quotes set quote_check = p_quote_check, quote_checked_at = now()
   where id = p_evidence_id and kind = 'source_quote';
end $$;

-- ── DB-11 ──────────────────────────────────────────────────────────────────
-- Same signature and behaviour, except that (a) quotes without offsets (not_found) are deduplicated by
-- their text too, so two different mis-cited quotes on one message keep their own audit rows (§10.7.3),
-- and (b) a new quote's check must be plausible against the message body (QA-M1).

create or replace function public.add_source_quote_evidence(
  p_point_id uuid, p_source_message_id uuid, p_quote_text text, p_quote_start int, p_quote_end int, p_quote_check text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_handover uuid;
  v_quote uuid;
  v_link uuid;
begin
  select handover_id into v_handover from public.handover_points where id = p_point_id;
  if v_handover is null then
    raise exception 'point not found' using errcode = 'BTNF0';
  end if;
  perform public._lock_handover_for_share(v_handover);
  perform public._require_active_run(v_handover); -- N3

  select id into v_quote from public.evidence_quotes
   where source_message_id = p_source_message_id and quote_start is not distinct from p_quote_start
     and quote_end is not distinct from p_quote_end
     and (p_quote_start is not null or quote_text = p_quote_text);
  if v_quote is null then
    if not public._quote_check_plausible(coalesce(p_quote_check, 'pending'), p_quote_text, p_quote_start, p_quote_end,
             (select body from public.source_messages where id = p_source_message_id and handover_id = v_handover)) then
      raise exception 'quote check is not consistent with the message' using errcode = 'BTVF0';
    end if;
    insert into public.evidence_quotes (handover_id, kind, source_id, source_message_id, quote_text, quote_start, quote_end,
                                        message_sent_at, author_label, author_identity_kind, author_identity_hash,
                                        author_identity_pepper_version, source_title, location, quote_check,
                                        quote_checked_at, access_level)
    select m.handover_id, 'source_quote', m.source_id, m.id, p_quote_text, p_quote_start, p_quote_end, m.sent_at,
           sp.display_label, sp.identity_kind, sp.identity_hash, sp.identity_pepper_version, s.title, m.location,
           coalesce(p_quote_check, 'pending'), case when p_quote_check is not null and p_quote_check <> 'pending' then now() end,
           s.access_level
      from public.source_messages m
      join public.sources s on s.id = m.source_id
      left join public.source_participants sp on sp.id = m.participant_id
     where m.id = p_source_message_id and m.handover_id = v_handover
    returning id into v_quote;
    if v_quote is null then
      raise exception 'message not found' using errcode = 'BTNF0';
    end if;
  end if;

  insert into public.point_evidence (handover_id, point_id, evidence_id)
  values (v_handover, p_point_id, v_quote)
  on conflict (point_id, evidence_id) do nothing
  returning id into v_link;
  if v_link is null then
    select id into v_link from public.point_evidence where point_id = p_point_id and evidence_id = v_quote;
  end if;
  return v_link;
end $$;

-- ── R1 ─────────────────────────────────────────────────────────────────────
-- One source under the caller's RLS (§8.3, §8.5): invisible, deleted and unknown all return NULL.

create function public.api_get_source(p_source_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select public._source_json(s)
    from public.sources s
   where s.id = p_source_id and s.deleted_at is null and public.is_member(s.handover_id)
$$;

-- ── R2 ─────────────────────────────────────────────────────────────────────
-- previewSource (§10.3 step 1): re-validates the actor as a source manager. Writes nothing; never changes
-- state; only an uploaded or failed source whose raw upload is present and whose consent is recorded.

create function public.source_preview_target(p_actor_profile_id uuid, p_source_id uuid)
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
  if v_s.state not in ('uploaded', 'failed') then
    raise exception 'source cannot be previewed in state %', v_s.state using errcode = 'BTIT0';
  end if;
  if v_s.raw_storage_path is null then
    raise exception 'the raw upload is no longer available' using errcode = 'BTPF0';
  end if;
  if v_s.consent_recorded_at is null then
    raise exception 'record consent first' using errcode = 'BTPF0';
  end if;
  return jsonb_build_object(
    'handover_id', v_s.handover_id, 'raw_storage_path', v_s.raw_storage_path, 'size_bytes', v_s.size_bytes,
    'sha256', encode(v_s.sha256, 'hex'), 'kind', v_s.kind, 'timezone', v_s.timezone, 'date_order', v_s.date_order,
    'original_filename', v_s.original_filename);
end $$;

-- ── grants (the grants migration revoked default privileges) ──────────────

revoke execute on function
  public._pipeline_stage_rank(text),
  public._quote_check_plausible(text, text, int, int, text),
  public.claim_ready_processing_jobs(int, int),
  public.complete_processing_job(uuid, int, text, jsonb, text, text, timestamptz, int, int),
  public.heartbeat_processing_job(uuid, int, int, int, int),
  public.get_processing_job_context(uuid),
  public.list_extraction_messages(uuid, int, int),
  public.list_points_for_pipeline(uuid),
  public.list_quotes_for_check(uuid),
  public.list_links_needing_support(uuid, int),
  public.list_gap_questions_for_pipeline(uuid),
  public.set_point_sort_keys(uuid, uuid, jsonb),
  public.api_get_source(uuid),
  public.source_preview_target(uuid, uuid)
from public, anon, authenticated, service_role;

grant execute on function
  public.claim_ready_processing_jobs(int, int),
  public.complete_processing_job(uuid, int, text, jsonb, text, text, timestamptz, int, int),
  public.heartbeat_processing_job(uuid, int, int, int, int),
  public.get_processing_job_context(uuid),
  public.list_extraction_messages(uuid, int, int),
  public.list_points_for_pipeline(uuid),
  public.list_quotes_for_check(uuid),
  public.list_links_needing_support(uuid, int),
  public.list_gap_questions_for_pipeline(uuid),
  public.set_point_sort_keys(uuid, uuid, jsonb),
  public.source_preview_target(uuid, uuid)
to service_role;

grant execute on function public.api_get_source(uuid) to authenticated;
