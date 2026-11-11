-- Sources (§6.5, §10.3), members and invitations (§6.3, §12.3), tokens (§6.4, §12.4) and creator
-- transfer (§12.9). Raw tokens never reach the database: callers pass SHA-256(raw token) as bytea.

-- ── Sources ──────────────────────────────────────────────────────────────────

create function public._require_source_manager(p_actor_profile_id uuid, p_handover_id uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public._is_member_as(p_actor_profile_id, p_handover_id) then
    raise exception 'handover not found' using errcode = 'BTNF0';
  end if;
  if not (public._is_creator_as(p_actor_profile_id, p_handover_id) or public._member_role_as(p_actor_profile_id, p_handover_id) = 'outgoing') then
    raise exception 'only the creator or an outgoing member manages sources' using errcode = 'BTFB0';
  end if;
end $$;

-- Returns the new source id; the private storage path is raw/{handover_id}/{source_id} (§11.2).
create function public.create_source(p_actor_profile_id uuid, 
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
begin
  v_h := public._lock_handover_for_share(p_handover_id);
  perform public._require_source_manager(p_actor_profile_id, p_handover_id);
  if v_h.state not in ('draft', 'in_review') then
    raise exception 'sources can be added in draft or review only' using errcode = 'BTIT0';
  end if;
  if (select count(*) from public.sources where handover_id = p_handover_id and deleted_at is null) >= 10 then
    raise exception 'a handover has at most 10 sources' using errcode = 'BTPF0'; -- D15
  end if;
  if p_sha256_hex !~ '^[a-f0-9]{64}$' then
    raise exception 'invalid checksum' using errcode = 'BTVF0';
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
                        jsonb_build_object('kind', p_kind, 'sizeBytes', p_size_bytes));
  return v_id;
end $$;

-- M5: the client's size and SHA-256 are never trusted. The server downloads the object with the service
-- role, measures it, and passes the MEASURED values here; they must equal both the declared values on the
-- source row (which also back the duplicate check) and the size Storage recorded for the object.
-- On mismatch nothing changes and the caller deletes the object so a correct file can be uploaded.
create function public.source_upload_target(p_actor_profile_id uuid, p_source_id uuid)
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
                            'sha256', encode(v_s.sha256, 'hex'));
end $$;

create function public.confirm_source_uploaded(
  p_actor_profile_id uuid, p_source_id uuid, p_measured_size bigint, p_measured_sha256_hex text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := public._require_actor(p_actor_profile_id);
  v_s public.sources;
  v_storage_size bigint;
  v_found boolean;
begin
  select * into v_s from public.sources where id = p_source_id;
  if not found or v_s.deleted_at is not null then
    raise exception 'source not found' using errcode = 'BTNF0';
  end if;
  perform public._lock_handover_for_share(v_s.handover_id);
  perform public._require_source_manager(p_actor_profile_id, v_s.handover_id);
  select * into v_s from public.sources where id = p_source_id for update;
  if v_s.state <> 'pending_upload' then
    raise exception 'source is not awaiting upload' using errcode = 'BTIT0';
  end if;
  select true, nullif(o.metadata ->> 'size', '')::bigint into v_found, v_storage_size
    from storage.objects o where o.bucket_id = 'source-uploads' and o.name = v_s.raw_storage_path;
  if v_found is null then
    raise exception 'the upload has not arrived' using errcode = 'BTPF0';
  end if;
  if p_measured_size is null or p_measured_sha256_hex is null
     or p_measured_size <> v_s.size_bytes
     or (v_storage_size is not null and v_storage_size <> p_measured_size)
     or lower(p_measured_sha256_hex) !~ '^[a-f0-9]{64}$'
     or decode(lower(p_measured_sha256_hex), 'hex') <> v_s.sha256 then
    raise exception 'the uploaded file does not match what was declared' using errcode = 'BTVF0';
  end if;
  update public.sources set state = 'uploaded' where id = p_source_id;
  perform public._audit(v_s.handover_id, v_actor, null, 'source.uploaded', 'source', p_source_id, null,
                        jsonb_build_object('state', 'uploaded', 'sizeBytes', p_measured_size));
end $$;

-- Worker (service_role): what the parse job must re-verify after downloading the raw bytes (M5).
create function public.raw_source_for_processing(p_source_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('raw_storage_path', s.raw_storage_path, 'size_bytes', s.size_bytes,
                            'sha256', encode(s.sha256, 'hex'), 'state', s.state, 'kind', s.kind,
                            'timezone', s.timezone, 'date_order', s.date_order, 'original_filename', s.original_filename)
    from public.sources s where s.id = p_source_id and s.deleted_at is null
$$;

-- Lowering a source's access level requires the creator and is audited (§8.4). Changing it recomputes
-- every point that references the source (trigger chain sources → evidence_quotes → points).
create function public.record_source_consent(p_actor_profile_id uuid, 
  p_source_id uuid, p_statement_version text, p_ai_provider text, p_access_level text, p_timezone text,
  p_date_order text default null, p_document_date date default null
)
returns void
language plpgsql
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
  perform public._lock_handover_for_share(v_s.handover_id);
  perform public._require_source_manager(p_actor_profile_id, v_s.handover_id);
  select * into v_s from public.sources where id = p_source_id for update;
  if coalesce(btrim(p_statement_version), '') = '' or coalesce(btrim(p_ai_provider), '') = '' then
    raise exception 'consent statement and provider are required' using errcode = 'BTVF0';
  end if;
  if public.access_rank(p_access_level) is null then
    raise exception 'unknown access level' using errcode = 'BTVF0';
  end if;
  if public.access_rank(p_access_level) < public.access_rank(v_s.access_level)
     and v_s.consent_recorded_at is not null and not public._is_creator_as(v_actor, v_s.handover_id) then
    raise exception 'only the creator can lower a source''s access level' using errcode = 'BTFB0';
  end if;

  update public.sources
     set consent_statement_version = p_statement_version, consent_ai_provider = p_ai_provider,
         consent_recorded_at = now(), consent_recorded_by = v_actor, access_level = p_access_level,
         timezone = p_timezone, date_order = p_date_order, document_date = p_document_date
   where id = p_source_id;
  perform public._audit(v_s.handover_id, v_actor, null, 'source.consent_recorded', 'source', p_source_id,
                        jsonb_build_object('accessLevel', v_s.access_level),
                        jsonb_build_object('accessLevel', p_access_level, 'statementVersion', p_statement_version,
                                           'provider', p_ai_provider));
end $$;

-- Exclusions before the final parse (§10.3 step 2, §11.3 addExclusion, schemas.ts addExclusionInput). After
-- a successful parse a participant opt-out is a participant erasure instead (§12.8), so parsed and removed
-- sources are refused. The handover is derived from the source (S12); the caller never names it.
--   participant:  p_scope 'source' | 'handover'; identity kind, 64-hex hash and pepper version 'p1'.
--                 A handover-wide NAME rule is only detected in other sources (§6.8.1). In the source it
--                 was chosen in it applies, through a companion source-scoped row, because the person
--                 picked that participant there explicitly.
--   conversation: always source-scoped; c_N plus the ParseContext of the preview it was chosen from (D32).
--   date_range:   p_scope 'source' | 'handover'; both ends, start <= end.
create function public.add_exclusion(p_actor_profile_id uuid,
  p_source_id uuid, p_kind text, p_scope text default 'source',
  p_identity_kind text default null, p_participant_identity_hash_hex text default null, p_pepper_version text default null,
  p_conversation_local_id text default null, p_parse_timezone text default null, p_parse_date_order text default null,
  p_parser_version text default null,
  p_range_start timestamptz default null, p_range_end timestamptz default null, p_reason text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := public._require_actor(p_actor_profile_id);
  v_s public.sources;
  v_hash bytea;
  v_scope_source uuid;
  v_reason text := nullif(btrim(p_reason), '');
  v_id uuid;
begin
  select * into v_s from public.sources where id = p_source_id;
  if not found or v_s.deleted_at is not null then
    raise exception 'source not found' using errcode = 'BTNF0';
  end if;
  perform public._lock_handover_for_share(v_s.handover_id);
  perform public._require_source_manager(p_actor_profile_id, v_s.handover_id);
  select * into v_s from public.sources where id = p_source_id for update;
  if v_s.state in ('parsed', 'removed') or v_s.deleted_at is not null then
    raise exception 'this source was already parsed; use participant erasure instead' using errcode = 'BTIT0';
  end if;

  if p_scope is null or p_scope not in ('source', 'handover') then
    raise exception 'unknown exclusion scope' using errcode = 'BTVF0';
  end if;
  if v_reason is not null and char_length(v_reason) > 500 then
    raise exception 'the reason is too long' using errcode = 'BTVF0';
  end if;
  v_scope_source := case when p_scope = 'source' then p_source_id end;

  if p_kind = 'participant' then
    if p_identity_kind is null or p_identity_kind not in ('phone', 'name')
       or p_participant_identity_hash_hex is null or p_participant_identity_hash_hex !~ '^[0-9a-f]{64}$'
       or p_pepper_version is distinct from 'p1' then
      raise exception 'a participant exclusion needs identity kind, hash and pepper version' using errcode = 'BTVF0';
    end if;
    if p_conversation_local_id is not null or p_parse_timezone is not null or p_parser_version is not null
       or p_range_start is not null or p_range_end is not null then
      raise exception 'unexpected fields for a participant exclusion' using errcode = 'BTVF0';
    end if;
    v_hash := decode(p_participant_identity_hash_hex, 'hex');
  elsif p_kind = 'conversation' then
    if p_scope <> 'source' then
      raise exception 'conversation exclusions apply to their own source only' using errcode = 'BTVF0';
    end if;
    if p_conversation_local_id is null or p_conversation_local_id !~ '^c_[1-9][0-9]*$'
       or coalesce(btrim(p_parse_timezone), '') = '' or coalesce(btrim(p_parser_version), '') = ''
       or (p_parse_date_order is not null and p_parse_date_order not in ('dmy', 'mdy', 'ymd')) then
      raise exception 'a conversation exclusion needs its id and parse context' using errcode = 'BTVF0';
    end if;
    if p_identity_kind is not null or p_participant_identity_hash_hex is not null or p_pepper_version is not null
       or p_range_start is not null or p_range_end is not null then
      raise exception 'unexpected fields for a conversation exclusion' using errcode = 'BTVF0';
    end if;
  elsif p_kind = 'date_range' then
    if p_range_start is null or p_range_end is null or p_range_start > p_range_end then
      raise exception 'a date range needs a start and an end, in order' using errcode = 'BTVF0';
    end if;
    if p_identity_kind is not null or p_participant_identity_hash_hex is not null or p_pepper_version is not null
       or p_conversation_local_id is not null or p_parse_timezone is not null or p_parser_version is not null then
      raise exception 'unexpected fields for a date range exclusion' using errcode = 'BTVF0';
    end if;
  else
    raise exception 'unknown exclusion kind' using errcode = 'BTVF0';
  end if;

  if p_kind = 'participant' and p_scope = 'handover' then
    insert into public.source_exclusions (handover_id, source_id, requested_by, kind, participant_identity_kind,
                                          participant_identity_hash, participant_identity_pepper_version, reason, requested_via)
    values (v_s.handover_id, null, v_actor, 'participant', p_identity_kind, v_hash, p_pepper_version, v_reason, 'uploader')
    on conflict (handover_id, participant_identity_kind, participant_identity_hash, participant_identity_pepper_version)
      where kind = 'participant' and source_id is null
    do nothing
    returning id into v_id;
    if v_id is null then
      select id into v_id from public.source_exclusions
       where handover_id = v_s.handover_id and kind = 'participant' and source_id is null
         and participant_identity_kind = p_identity_kind and participant_identity_hash = v_hash
         and participant_identity_pepper_version = p_pepper_version;
    end if;
    -- D29: a name rule never applies to another source by itself; here, in the source the participant was
    -- picked from, it applies through an explicit source-scoped row (no inference across sources).
    if p_identity_kind = 'name' and not exists (
      select 1 from public.source_exclusions
       where source_id = p_source_id and kind = 'participant' and participant_identity_kind = 'name'
         and participant_identity_hash = v_hash and participant_identity_pepper_version = p_pepper_version
    ) then
      insert into public.source_exclusions (handover_id, source_id, requested_by, kind, participant_identity_kind,
                                            participant_identity_hash, participant_identity_pepper_version, reason,
                                            requested_via)
      values (v_s.handover_id, p_source_id, v_actor, 'participant', 'name', v_hash, p_pepper_version, v_reason, 'uploader');
    end if;
  else
    insert into public.source_exclusions (handover_id, source_id, requested_by, kind, participant_identity_kind,
                                          participant_identity_hash, participant_identity_pepper_version,
                                          conversation_local_id, parse_timezone, parse_date_order, parser_version,
                                          range_start, range_end, reason, requested_via)
    values (v_s.handover_id, v_scope_source, v_actor, p_kind, p_identity_kind, v_hash,
            case when p_kind = 'participant' then p_pepper_version end,
            p_conversation_local_id, p_parse_timezone, p_parse_date_order, p_parser_version,
            p_range_start, p_range_end, v_reason, 'uploader')
    returning id into v_id;
  end if;

  -- Never the identity hash, the conversation id or the reason (they can identify a person).
  perform public._audit(v_s.handover_id, v_actor, null, 'source.exclusion_added', 'source_exclusion', v_id, null,
                        jsonb_build_object('kind', p_kind, 'scope', p_scope, 'sourceId', p_source_id,
                                           'identityKind', p_identity_kind));
  return v_id;
end $$;

-- parse_exclusion_rules moved to 20261111000650_identity_confirmations.sql (R8 rule feed with modes).

-- Soft delete (§6.5): excludes all evidence links from the source (reason 'source_removed'), which
-- recomputes their points. The caller deletes the raw object after commit and calls mark_source_raw_deleted.
create function public.remove_source(p_actor_profile_id uuid, p_source_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := public._require_actor(p_actor_profile_id);
  v_s public.sources;
  v_h public.handovers;
begin
  select * into v_s from public.sources where id = p_source_id;
  if not found or v_s.deleted_at is not null then
    raise exception 'source not found' using errcode = 'BTNF0';
  end if;
  v_h := public._lock_handover_for_share(v_s.handover_id);
  perform public._require_source_manager(p_actor_profile_id, v_s.handover_id);
  if v_h.state = 'processing' then
    raise exception 'sources cannot be removed while processing' using errcode = 'BTIT0';
  end if;
  update public.sources set deleted_at = now(), state = 'removed' where id = p_source_id;
  update public.point_evidence pe
     set excluded_at = now(), excluded_by = v_actor, exclusion_reason = 'source_removed'
    from public.evidence_quotes q
   where q.id = pe.evidence_id and q.source_id = p_source_id and pe.excluded_at is null;
  perform public._audit(v_s.handover_id, v_actor, null, 'source.removed', 'source', p_source_id,
                        jsonb_build_object('state', v_s.state), jsonb_build_object('state', 'removed'));
  return v_s.raw_storage_path;
end $$;

-- ── Tokens (§6.4, §12.4) ─────────────────────────────────────────────────────

-- A usable token row, or NULL. Hash lookup through the unique index: the raw token has 256 bits of
-- entropy, so a timing difference on its SHA-256 reveals nothing usable.
create function public._usable_token(p_token_hash bytea, p_purpose text)
returns public.access_tokens
language sql
stable
security definer
set search_path = ''
as $$
  select t.*
    from public.access_tokens t join public.handovers h on h.id = t.handover_id
   where t.token_hash = p_token_hash and t.purpose = p_purpose
     and t.revoked_at is null and t.expires_at > now() and t.use_count < t.max_uses and h.deleted_at is null
$$;

create function public.create_gap_interview_link(p_actor_profile_id uuid, 
  p_handover_id uuid, p_token_hash bytea, p_question_ids uuid[], p_max_access_level text, p_expires_at timestamptz,
  p_max_uses int default 20
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := public._require_actor(p_actor_profile_id);
  v_id uuid;
begin
  perform public._lock_handover_for_share(p_handover_id);
  if not public._is_review_role_as(v_actor, p_handover_id) then
    raise exception 'handover not found' using errcode = 'BTNF0';
  end if;
  if p_expires_at <= now() or p_expires_at > now() + interval '30 days' then
    raise exception 'links expire within 30 days' using errcode = 'BTVF0';
  end if;
  if coalesce(cardinality(p_question_ids), 0) = 0 or cardinality(p_question_ids) > 50 then
    raise exception 'choose 1 to 50 questions' using errcode = 'BTVF0'; -- createGapLinkInput
  end if;
  if p_max_uses is null or p_max_uses < 1 or p_max_uses > 20 then
    raise exception 'a Gap Interview link allows 1 to 20 uses' using errcode = 'BTVF0'; -- §12.4, M6
  end if;
  if exists (
    select 1 from unnest(p_question_ids) qid
    where not exists (select 1 from public.gap_questions q where q.id = qid and q.handover_id = p_handover_id)
       or not public._gap_question_answerable(qid)
  ) then
    raise exception 'question not found' using errcode = 'BTNF0';
  end if;
  insert into public.access_tokens (handover_id, created_by, purpose, token_hash, max_access_level, expires_at, max_uses)
  values (p_handover_id, v_actor, 'gap_interview', p_token_hash, p_max_access_level, p_expires_at, p_max_uses)
  returning id into v_id;
  insert into public.access_token_questions (handover_id, token_id, gap_question_id)
  select p_handover_id, v_id, qid from unnest(p_question_ids) qid group by qid;
  perform public._audit(p_handover_id, v_actor, null, 'token.created', 'access_token', v_id, null,
                        jsonb_build_object('purpose', 'gap_interview', 'questions', cardinality(p_question_ids),
                                           'maxAccessLevel', p_max_access_level));
  return v_id;
end $$;

-- Token holders see only open, non-held questions in scope and at or below the token's level (§5.5).
create function public.get_gap_interview(p_token_hash bytea)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_t public.access_tokens := public._usable_token(p_token_hash, 'gap_interview');
begin
  if v_t.id is null then
    raise exception 'link invalid' using errcode = 'BTTI0';
  end if;
  return jsonb_build_object(
    'handover_title', (select title from public.handovers where id = v_t.handover_id),
    'questions', coalesce((
      select jsonb_agg(jsonb_build_object('id', q.id, 'question', q.question, 'context', q.context,
                                          'priority', q.priority, 'category', q.category) order by q.sort_key, q.id)
        from public.access_token_questions tq join public.gap_questions q on q.id = tq.gap_question_id
       where tq.token_id = v_t.id
         and public.access_rank(q.access_level) <= public.access_rank(v_t.max_access_level)
         and public._gap_question_answerable(q.id)
    ), '[]'::jsonb));
end $$;

-- Token answers (service_role). Each submission counts as one use of the link.
create function public.submit_gap_answers_with_token(p_token_hash bytea, p_answerer_label text, p_answers jsonb)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_t public.access_tokens := public._usable_token(p_token_hash, 'gap_interview');
  v_item jsonb;
  v_q uuid;
  v_n int := 0;
begin
  if v_t.id is null then
    raise exception 'link invalid' using errcode = 'BTTI0';
  end if;
  perform public._lock_handover_for_share(v_t.handover_id);
  select * into v_t from public.access_tokens where id = v_t.id for update;
  if v_t.revoked_at is not null or v_t.expires_at <= now() or v_t.use_count >= v_t.max_uses then
    raise exception 'link invalid' using errcode = 'BTTI0';
  end if;
  if coalesce(btrim(p_answerer_label), '') = '' then
    raise exception 'a name is required' using errcode = 'BTVF0';
  end if;
  if jsonb_typeof(p_answers) <> 'array' or jsonb_array_length(p_answers) = 0 then
    raise exception 'at least one answer is required' using errcode = 'BTVF0';
  end if;

  for v_item in select * from jsonb_array_elements(p_answers) loop
    v_q := (v_item ->> 'gapQuestionId')::uuid;
    -- Held questions fail exactly like unknown ones (§5.5, §8.5).
    if not exists (
      select 1 from public.access_token_questions tq join public.gap_questions q on q.id = tq.gap_question_id
      where tq.token_id = v_t.id and q.id = v_q
        and public.access_rank(q.access_level) <= public.access_rank(v_t.max_access_level)
    ) or not public._gap_question_answerable(v_q) then
      raise exception 'question not found' using errcode = 'BTNF0';
    end if;
    insert into public.gap_answers (handover_id, gap_question_id, answered_via_token_id, answer_text, answerer_label)
    values (v_t.handover_id, v_q, v_t.id, btrim(v_item ->> 'answerText'), left(btrim(p_answerer_label), 80));
    v_n := v_n + 1;
  end loop;

  update public.access_tokens set use_count = use_count + 1, last_used_at = now() where id = v_t.id;
  perform public._audit(v_t.handover_id, null, v_t.id, 'token.redeemed', 'access_token', v_t.id, null,
                        jsonb_build_object('purpose', 'gap_interview', 'answers', v_n));
  return v_n;
end $$;

create function public.revoke_access_token(p_actor_profile_id uuid, p_token_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := public._require_actor(p_actor_profile_id);
  v_t public.access_tokens;
begin
  select * into v_t from public.access_tokens where id = p_token_id;
  if not found or not public._is_member_as(v_actor, v_t.handover_id) then
    raise exception 'link not found' using errcode = 'BTNF0';
  end if;
  perform public._lock_handover_for_share(v_t.handover_id);
  -- §11.3 revokeAccessToken: the creator revokes any token; other review roles revoke Gap Interview links.
  -- Invitations are invisible to non-creators (§12.4), so for them an invitation is simply not found.
  if not public._is_creator_as(v_actor, v_t.handover_id) then
    if not public._is_review_role_as(v_actor, v_t.handover_id) or v_t.purpose <> 'gap_interview' then
      raise exception 'link not found' using errcode = 'BTNF0';
    end if;
  end if;
  update public.access_tokens set revoked_at = coalesce(revoked_at, now()) where id = p_token_id;
  perform public._audit(v_t.handover_id, v_actor, null, 'token.revoked', 'access_token', p_token_id, null,
                        jsonb_build_object('purpose', v_t.purpose));
end $$;

-- Settings listing of the handover's links (§11.6 AccessTokenSummary, BatonQueries.listAccessTokens):
-- metadata only, never hashes or raw tokens. Review roles see Gap Interview links; only the creator also
-- sees member invitations and their recipient address (§12.4). access_tokens has no client SELECT, so this
-- is SECURITY DEFINER and checks the CALLER (auth.uid()) itself. NULL = not visible (not_found).
-- status precedence: revoked > expired > exhausted > active. Pending invitations =
-- (p_purpose 'member_invite', p_active_only true).
create function public.list_access_tokens(p_handover_id uuid, p_purpose text default null, p_active_only boolean default false)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select case when public._is_review_role_as(auth.uid(), p_handover_id)
                   and exists (select 1 from public.handovers h where h.id = p_handover_id and h.deleted_at is null)
              then coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', t.id, 'purpose', t.purpose, 'status', t.status, 'grant_role', t.grant_role,
             'recipient_email', case when t.purpose = 'member_invite' then t.recipient_email::text end,
             'max_access_level', t.max_access_level, 'expires_at', t.expires_at, 'max_uses', t.max_uses,
             'use_count', t.use_count, 'revoked_at', t.revoked_at, 'created_at', t.created_at)
           order by t.created_at desc, t.id)
      from (
        select t.*,
               case when t.revoked_at is not null then 'revoked'
                    when t.expires_at <= now() then 'expired'
                    when t.use_count >= t.max_uses then 'exhausted'
                    else 'active' end as status
          from public.access_tokens t
         where t.handover_id = p_handover_id
           and (t.purpose = 'gap_interview' or public._is_creator_as(auth.uid(), p_handover_id))
           and (p_purpose is null or t.purpose = p_purpose)
      ) t
     where not coalesce(p_active_only, false) or t.status = 'active'
  ), '[]'::jsonb) end
$$;

-- ── Members (§6.3, §12.3) ────────────────────────────────────────────────────

create function public.invite_member(p_actor_profile_id uuid, 
  p_handover_id uuid, p_email text, p_role text, p_clearance text, p_token_hash bytea, p_expires_at timestamptz
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := public._require_actor(p_actor_profile_id);
  v_id uuid;
begin
  -- FOR SHARE serialises with acknowledgePublication's FOR UPDATE, so a final acknowledgement can never
  -- miss a pending incoming invite created at the same moment (D9).
  perform public._lock_handover_for_share(p_handover_id);
  if not public._is_member_as(v_actor, p_handover_id) then
    raise exception 'handover not found' using errcode = 'BTNF0';
  end if;
  if not public._is_creator_as(v_actor, p_handover_id) then
    raise exception 'only the creator can invite members' using errcode = 'BTFB0';
  end if;
  if p_role in ('outgoing', 'reviewer') and p_clearance is not null and p_clearance <> 'reviewer_only' then
    raise exception 'review roles always have reviewer_only clearance' using errcode = 'BTVF0';
  end if;
  if p_expires_at <= now() or p_expires_at > now() + interval '30 days' then
    raise exception 'invites expire within 30 days' using errcode = 'BTVF0';
  end if;
  if exists (
    select 1 from public.handover_members m join auth.users u on u.id = m.profile_id
    where m.handover_id = p_handover_id and m.removed_at is null and lower(u.email) = lower(btrim(p_email))
  ) then
    raise exception 'this person is already a member' using errcode = 'BTCF0';
  end if;
  insert into public.access_tokens (handover_id, created_by, purpose, token_hash, recipient_email, grant_role,
                                    grant_clearance, expires_at, max_uses)
  values (p_handover_id, v_actor, 'member_invite', p_token_hash, lower(btrim(p_email)), p_role,
          case when p_role in ('outgoing', 'reviewer') then 'reviewer_only' else p_clearance end, p_expires_at, 1)
  returning id into v_id;
  perform public._audit(p_handover_id, v_actor, null, 'member.invited', 'access_token', v_id, null,
                        jsonb_build_object('role', p_role));
  return v_id;
end $$;

-- Before sign-in (service_role): the address a magic link must go to. Never returned to the browser.
create function public.peek_member_invite(p_token_hash bytea)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_t public.access_tokens := public._usable_token(p_token_hash, 'member_invite');
begin
  if v_t.id is null then
    raise exception 'invite invalid' using errcode = 'BTTI0';
  end if;
  return jsonb_build_object('recipient_email', v_t.recipient_email::text, 'handover_id', v_t.handover_id);
end $$;

-- After sign-in (service_role, §12.3 steps 1 and 3–5). p_profile_id comes from the verified Supabase
-- session (auth.getUser on the server). H3: the email address and its confirmation state are read from
-- auth.users HERE, never taken from the caller, and an unconfirmed address can never redeem an invite.
create function public.redeem_member_invite(p_token_hash bytea, p_profile_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_t public.access_tokens := public._usable_token(p_token_hash, 'member_invite');
  v_existing public.handover_members;
  v_member uuid;
  v_clearance text;
  v_email text;
  v_confirmed timestamptz;
begin
  if v_t.id is null then
    raise exception 'invite invalid' using errcode = 'BTTI0';
  end if;
  perform public._lock_handover_for_share(v_t.handover_id);
  select * into v_t from public.access_tokens where id = v_t.id for update;
  if v_t.revoked_at is not null or v_t.expires_at <= now() or v_t.use_count >= v_t.max_uses then
    raise exception 'invite invalid' using errcode = 'BTTI0';
  end if;
  select u.email, u.email_confirmed_at into v_email, v_confirmed
    from auth.users u join public.profiles p on p.id = u.id
   where u.id = p_profile_id and u.deleted_at is null and p.deleted_at is null;
  if v_email is null then
    raise exception 'profile not found' using errcode = 'BTUA0';
  end if;
  -- Never reveal which check failed (§3.2): unconfirmed and mismatched addresses look the same.
  if v_confirmed is null or lower(v_email) <> lower(v_t.recipient_email::text) then
    raise exception 'invite invalid' using errcode = 'BTTI0';
  end if;

  v_clearance := case
    when v_t.grant_role in ('outgoing', 'reviewer') then 'reviewer_only'
    else coalesce(v_t.grant_clearance, case v_t.grant_role when 'lead' then 'leads_only' else 'everyone' end)
  end;

  select * into v_existing from public.handover_members where handover_id = v_t.handover_id and profile_id = p_profile_id for update;
  if found and v_existing.removed_at is null then
    raise exception 'already a member' using errcode = 'BTCF0';
  elsif found then
    update public.handover_members
       set role = v_t.grant_role, clearance = v_clearance, ack_required = v_t.grant_role = 'incoming',
           invited_by = v_t.created_by, invitation_token_id = v_t.id, joined_at = now(), removed_at = null
     where id = v_existing.id
    returning id into v_member;
  else
    insert into public.handover_members (handover_id, profile_id, role, clearance, ack_required, invited_by, invitation_token_id)
    values (v_t.handover_id, p_profile_id, v_t.grant_role, v_clearance, v_t.grant_role = 'incoming', v_t.created_by, v_t.id)
    returning id into v_member;
  end if;

  update public.access_tokens set use_count = use_count + 1, last_used_at = now() where id = v_t.id;
  perform public._audit(v_t.handover_id, p_profile_id, v_t.id, 'token.redeemed', 'access_token', v_t.id, null,
                        jsonb_build_object('purpose', 'member_invite'));
  perform public._audit(v_t.handover_id, p_profile_id, v_t.id, 'member.joined', 'handover_member', v_member, null,
                        jsonb_build_object('role', v_t.grant_role, 'clearance', v_clearance));
  return jsonb_build_object('handover_id', v_t.handover_id, 'role', v_t.grant_role, 'member_id', v_member);
end $$;

create function public.update_member_clearance(p_actor_profile_id uuid, p_member_id uuid, p_clearance text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := public._require_actor(p_actor_profile_id);
  v_m public.handover_members;
begin
  select * into v_m from public.handover_members where id = p_member_id;
  if not found or not public._is_member_as(v_actor, v_m.handover_id) then
    raise exception 'member not found' using errcode = 'BTNF0';
  end if;
  perform public._lock_handover_for_share(v_m.handover_id);
  if not public._is_creator_as(v_actor, v_m.handover_id) then
    raise exception 'only the creator changes clearance' using errcode = 'BTFB0';
  end if;
  select * into v_m from public.handover_members where id = p_member_id for update;
  if v_m.removed_at is not null then
    raise exception 'member not found' using errcode = 'BTNF0';
  end if;
  if v_m.role in ('outgoing', 'reviewer') then
    raise exception 'review roles always have reviewer_only clearance' using errcode = 'BTIT0';
  end if;
  if public.access_rank(p_clearance) is null then
    raise exception 'unknown access level' using errcode = 'BTVF0';
  end if;
  update public.handover_members set clearance = p_clearance where id = p_member_id;
  perform public._audit(v_m.handover_id, v_actor, null, 'member.clearance_changed', 'handover_member', p_member_id,
                        jsonb_build_object('clearance', v_m.clearance), jsonb_build_object('clearance', p_clearance));
end $$;

-- Takes FOR UPDATE first: removing the offered member clears an open creator-transfer offer (§12.9).
create function public.remove_member(p_actor_profile_id uuid, p_member_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := public._require_actor(p_actor_profile_id);
  v_m public.handover_members;
  v_h public.handovers;
begin
  select * into v_m from public.handover_members where id = p_member_id;
  if not found or not public._is_member_as(v_actor, v_m.handover_id) then
    raise exception 'member not found' using errcode = 'BTNF0';
  end if;
  v_h := public._lock_handover_for_update(v_m.handover_id);
  if not public._is_creator_as(v_actor, v_m.handover_id) then
    raise exception 'only the creator removes members' using errcode = 'BTFB0';
  end if;
  select * into v_m from public.handover_members where id = p_member_id for update;
  if v_m.removed_at is not null then
    raise exception 'member not found' using errcode = 'BTNF0';
  end if;
  update public.handover_members set removed_at = now() where id = p_member_id; -- trigger refuses the creator
  if v_h.pending_creator_member_id = p_member_id then
    update public.handovers set pending_creator_member_id = null, creator_transfer_offered_at = null where id = v_h.id;
  end if;
  update public.gap_questions set assigned_member_id = null where assigned_member_id = p_member_id;
  perform public._audit(v_m.handover_id, v_actor, null, 'member.removed', 'handover_member', p_member_id,
                        jsonb_build_object('role', v_m.role), jsonb_build_object('removed', true));
end $$;

-- ── Creator transfer (§12.9) ─────────────────────────────────────────────────

create function public.offer_creator_transfer(p_actor_profile_id uuid, p_handover_id uuid, p_to_member_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := public._require_actor(p_actor_profile_id);
  v_h public.handovers;
  v_m public.handover_members;
begin
  v_h := public._lock_handover_for_update(p_handover_id);
  if not public._is_member_as(v_actor, p_handover_id) then
    raise exception 'handover not found' using errcode = 'BTNF0';
  end if;
  if not public._is_creator_as(v_actor, p_handover_id) then
    raise exception 'only the creator can offer creatorship' using errcode = 'BTFB0';
  end if;
  select * into v_m from public.handover_members where id = p_to_member_id and handover_id = p_handover_id;
  if not found or v_m.removed_at is not null then
    raise exception 'member not found' using errcode = 'BTNF0';
  end if;
  if v_m.profile_id = v_h.created_by then
    raise exception 'the creator cannot transfer to themselves' using errcode = 'BTVF0';
  end if;
  if v_m.role not in ('outgoing', 'reviewer') then
    raise exception 'creatorship can only go to an outgoing or reviewer member' using errcode = 'BTVF0';
  end if;
  update public.handovers set pending_creator_member_id = p_to_member_id, creator_transfer_offered_at = now()
   where id = p_handover_id;
  perform public._audit(p_handover_id, v_actor, null, 'handover.creator_transfer_offered', 'handover_member', p_to_member_id,
                        null, jsonb_build_object('offered', true));
end $$;

-- SECURITY DEFINER; re-checks every invariant itself, so no caller can bypass them (§12.9).
create function public.transfer_creator(p_handover_id uuid, p_to_member_id uuid, p_actor_profile_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_h public.handovers;
  v_m public.handover_members;
begin
  perform public._require_actor(p_actor_profile_id); -- H1
  v_h := public._lock_handover_for_update(p_handover_id);
  select * into v_m from public.handover_members where id = p_to_member_id and handover_id = p_handover_id for update;
  if not found or v_m.removed_at is not null or v_m.role not in ('outgoing', 'reviewer')
     or v_m.profile_id = v_h.created_by
     or v_h.pending_creator_member_id is distinct from p_to_member_id
     or v_m.profile_id <> p_actor_profile_id
     or v_h.creator_transfer_offered_at < now() - interval '14 days' then
    raise exception 'creator transfer is not valid' using errcode = 'BTIT0';
  end if;
  perform set_config('baton.creator_transfer', 'on', true);
  update public.handovers
     set created_by = v_m.profile_id, pending_creator_member_id = null, creator_transfer_offered_at = null
   where id = p_handover_id;
  perform set_config('baton.creator_transfer', 'off', true);
  perform public._audit(p_handover_id, p_actor_profile_id, null, 'handover.creator_transferred', 'handover', p_handover_id,
                        jsonb_build_object('createdBy', v_h.created_by), jsonb_build_object('createdBy', v_m.profile_id));
end $$;

create function public.respond_to_creator_transfer(p_actor_profile_id uuid, p_handover_id uuid, p_accept boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := public._require_actor(p_actor_profile_id);
  v_h public.handovers;
  v_offered uuid;
begin
  v_h := public._lock_handover_for_update(p_handover_id);
  if not public._is_member_as(v_actor, p_handover_id) then
    raise exception 'handover not found' using errcode = 'BTNF0';
  end if;
  select profile_id into v_offered from public.handover_members where id = v_h.pending_creator_member_id and removed_at is null;
  if v_offered is distinct from v_actor then
    raise exception 'no creatorship offer for you' using errcode = 'BTNF0';
  end if;
  if v_h.creator_transfer_offered_at < now() - interval '14 days' then
    -- A lapsed offer is treated as absent everywhere (transfer_creator re-checks the age).
    raise exception 'the offer has lapsed' using errcode = 'BTIT0';
  end if;
  if p_accept then
    perform public.transfer_creator(p_handover_id, v_h.pending_creator_member_id, v_actor);
  else
    update public.handovers set pending_creator_member_id = null, creator_transfer_offered_at = null where id = p_handover_id;
    perform public._audit(p_handover_id, v_actor, null, 'handover.creator_transfer_declined', 'handover', p_handover_id,
                          null, jsonb_build_object('declined', true));
  end if;
end $$;
