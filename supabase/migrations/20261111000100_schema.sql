-- Baton schema (docs/architecture/shared-contracts.md §6, Revision 7).
--
-- Conventions (§2):
--   * enums are text + CHECK, mirroring lib/contracts/enums.ts (D20). lib/db/__tests__/enum-sync.test.ts
--     fails if these lists drift from the TypeScript constants.
--   * every handover-owned table carries handover_id and references other handover-owned rows through
--     composite FKs (§6.0), so no row can point into another handover.
--   * PostgreSQL 15+ features used: UNIQUE NULLS NOT DISTINCT, ON DELETE SET NULL (column_list).

create extension if not exists citext with schema extensions;

-- ── Helpers needed by table definitions ──────────────────────────────────────

-- §8.1: everyone (0) < leads_only (1) < reviewer_only (2). NULL for anything else.
create function public.access_rank(p_level text)
returns int
language sql
immutable
parallel safe
set search_path = ''
as $$
  select case p_level when 'everyone' then 0 when 'leads_only' then 1 when 'reviewer_only' then 2 end
$$;

-- The stricter of two access levels (NULL-tolerant).
create function public.max_access(p_a text, p_b text)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select case
    when p_a is null then p_b
    when p_b is null then p_a
    when public.access_rank(p_b) > public.access_rank(p_a) then p_b
    else p_a
  end
$$;

-- ── 6.1 profiles ─────────────────────────────────────────────────────────────

create table public.profiles (
  id uuid primary key references auth.users (id) on delete restrict,
  display_name text not null check (char_length(display_name) between 1 and 120),
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

-- ── 6.2 handovers ────────────────────────────────────────────────────────────

create table public.handovers (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(title) between 3 and 120),
  team_name text not null check (char_length(team_name) between 2 and 120),
  role_title text check (role_title is null or char_length(role_title) <= 120),
  description text check (description is null or char_length(description) <= 2000),
  created_by uuid not null references public.profiles (id) on delete restrict,
  state text not null default 'draft'
    check (state in ('draft', 'processing', 'in_review', 'approved', 'acknowledged')),
  current_publication_id uuid,
  evidence_as_of timestamptz,
  pending_creator_member_id uuid,
  creator_transfer_offered_at timestamptz,
  last_error_code text,
  last_error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint handovers_transfer_offer_pair
    check ((pending_creator_member_id is null) = (creator_transfer_offered_at is null))
);
create index handovers_created_by_idx on public.handovers (created_by);
create index handovers_state_idx on public.handovers (state) where deleted_at is null;

-- ── 6.3 handover_members ─────────────────────────────────────────────────────

create table public.handover_members (
  id uuid primary key default gen_random_uuid(),
  handover_id uuid not null references public.handovers (id) on delete cascade,
  profile_id uuid not null references public.profiles (id) on delete restrict,
  role text not null check (role in ('outgoing', 'incoming', 'lead', 'reviewer')),
  clearance text not null check (clearance in ('everyone', 'leads_only', 'reviewer_only')),
  ack_required boolean not null,
  invited_by uuid references public.profiles (id) on delete set null,
  invitation_token_id uuid,
  joined_at timestamptz not null default now(),
  removed_at timestamptz,
  -- Review roles always see everything under review (§6.3).
  constraint handover_members_review_role_clearance
    check (role not in ('outgoing', 'reviewer') or clearance = 'reviewer_only'),
  constraint handover_members_handover_profile_key unique (handover_id, profile_id),
  constraint handover_members_handover_id_key unique (handover_id, id)
);
create index handover_members_profile_idx on public.handover_members (profile_id);
create index handover_members_handover_role_idx on public.handover_members (handover_id, role);

-- ── 6.4 access_tokens ────────────────────────────────────────────────────────

create table public.access_tokens (
  id uuid primary key default gen_random_uuid(),
  handover_id uuid not null references public.handovers (id) on delete cascade,
  created_by uuid not null references public.profiles (id),
  purpose text not null check (purpose in ('member_invite', 'gap_interview')),
  token_hash bytea not null check (length(token_hash) = 32), -- SHA-256; the raw token is never stored
  recipient_email extensions.citext,
  grant_role text check (grant_role in ('outgoing', 'incoming', 'lead', 'reviewer')),
  grant_clearance text check (grant_clearance in ('everyone', 'leads_only', 'reviewer_only')),
  max_access_level text not null default 'everyone'
    check (max_access_level in ('everyone', 'leads_only', 'reviewer_only')),
  expires_at timestamptz not null,
  max_uses int not null default 1 check (max_uses > 0),
  use_count int not null default 0 check (use_count >= 0 and use_count <= max_uses),
  revoked_at timestamptz,
  last_used_at timestamptz,
  created_at timestamptz not null default now(),
  constraint access_tokens_invite_fields
    check (purpose <> 'member_invite' or (grant_role is not null and recipient_email is not null)),
  constraint access_tokens_gap_max_uses check (purpose <> 'gap_interview' or max_uses <= 20), -- §12.4, M6
  constraint access_tokens_invite_single_use check (purpose <> 'member_invite' or max_uses = 1),
  constraint access_tokens_gap_no_grant
    check (purpose <> 'gap_interview' or (grant_role is null and grant_clearance is null)),
  constraint access_tokens_review_grant_clearance
    check (grant_role is null or grant_role not in ('outgoing', 'reviewer')
           or grant_clearance is null or grant_clearance = 'reviewer_only'),
  constraint access_tokens_token_hash_key unique (token_hash),
  constraint access_tokens_handover_id_key unique (handover_id, id),
  constraint access_tokens_id_purpose_key unique (id, purpose)
);
create index access_tokens_handover_purpose_idx on public.access_tokens (handover_id, purpose);

-- ── 6.5 sources ──────────────────────────────────────────────────────────────

create table public.sources (
  id uuid primary key default gen_random_uuid(),
  handover_id uuid not null references public.handovers (id) on delete cascade,
  uploaded_by uuid not null references public.profiles (id),
  consent_recorded_by uuid references public.profiles (id),
  kind text not null check (kind in ('whatsapp_export', 'pdf', 'docx', 'markdown', 'text')),
  title text not null check (char_length(title) between 1 and 255),
  original_filename text not null check (char_length(original_filename) between 1 and 255),
  mime_type text not null check (char_length(mime_type) <= 127),
  size_bytes bigint not null check (size_bytes > 0 and size_bytes <= 26214400), -- 25 MB (D15)
  sha256 bytea not null check (length(sha256) = 32),
  state text not null default 'pending_upload'
    check (state in ('pending_upload', 'uploaded', 'parsing', 'parsed', 'failed', 'removed')),
  access_level text not null default 'everyone' check (access_level in ('everyone', 'leads_only', 'reviewer_only')),
  consent_statement_version text,
  consent_ai_provider text,
  consent_recorded_at timestamptz,
  raw_storage_path text,
  raw_deleted_at timestamptz,
  timezone text not null,
  date_order text check (date_order in ('dmy', 'mdy', 'ymd')),
  document_date date,
  parser_version text,
  message_count int,
  first_message_at timestamptz,
  last_message_at timestamptz,
  masking_counts jsonb,
  error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint sources_consent_complete
    check ((consent_recorded_at is null)
           = (consent_statement_version is null and consent_ai_provider is null and consent_recorded_by is null)),
  constraint sources_handover_id_key unique (handover_id, id)
);
create unique index sources_handover_sha256_key on public.sources (handover_id, sha256) where deleted_at is null;
create index sources_handover_state_idx on public.sources (handover_id, state);

-- ── 6.6 source_participants ──────────────────────────────────────────────────

create table public.source_participants (
  id uuid primary key default gen_random_uuid(),
  handover_id uuid not null references public.handovers (id) on delete cascade,
  source_id uuid not null,
  local_id text not null,
  display_label text not null,
  identity_kind text not null check (identity_kind in ('phone', 'name')), -- R8: namespace of the hash (§12.11)
  identity_hash bytea not null,
  identity_pepper_version text not null check (identity_pepper_version = 'p1'), -- §12.8 point 9
  message_count int,
  excluded boolean not null default false,
  constraint source_participants_source_fk
    foreign key (handover_id, source_id) references public.sources (handover_id, id) on delete cascade,
  constraint source_participants_source_local_key unique (source_id, local_id),
  constraint source_participants_source_id_key unique (source_id, id)
);
create index source_participants_identity_idx on public.source_participants (handover_id, identity_kind, identity_hash);

-- ── 6.7 source_conversations ─────────────────────────────────────────────────

create table public.source_conversations (
  id uuid primary key default gen_random_uuid(),
  handover_id uuid not null references public.handovers (id) on delete cascade,
  source_id uuid not null,
  local_id text not null,
  started_at timestamptz,
  ended_at timestamptz,
  message_count int,
  participant_local_ids text[] not null default '{}',
  preview text check (preview is null or char_length(preview) <= 140),
  excluded boolean not null default false,
  constraint source_conversations_source_fk
    foreign key (handover_id, source_id) references public.sources (handover_id, id) on delete cascade,
  constraint source_conversations_source_local_key unique (source_id, local_id),
  constraint source_conversations_source_id_key unique (source_id, id)
);

-- ── 6.8 source_exclusions ────────────────────────────────────────────────────

create table public.source_exclusions (
  id uuid primary key default gen_random_uuid(),
  handover_id uuid not null references public.handovers (id) on delete cascade,
  source_id uuid, -- NULL: applies to every source of the handover
  requested_by uuid references public.profiles (id) on delete set null,
  kind text not null check (kind in ('participant', 'conversation', 'date_range')),
  participant_identity_kind text check (participant_identity_kind in ('phone', 'name')), -- R8
  participant_identity_hash bytea,
  participant_identity_pepper_version text check (participant_identity_pepper_version = 'p1'),
  conversation_local_id text,
  -- R8 (D32): the ParseContext a positional conversation id was chosen in (§10.3)
  parse_timezone text,
  parse_date_order text check (parse_date_order in ('dmy', 'mdy', 'ymd')),
  parser_version text,
  range_start timestamptz,
  range_end timestamptz,
  reason text,
  requested_via text not null check (requested_via in ('uploader', 'participant_request')),
  created_at timestamptz not null default now(),
  constraint source_exclusions_source_fk
    foreign key (handover_id, source_id) references public.sources (handover_id, id) on delete cascade,
  -- identity kind, hash and pepper version are set together: all three or none (§6.8)
  constraint source_exclusions_hash_pair
    check ((participant_identity_hash is null) = (participant_identity_pepper_version is null)
           and (participant_identity_hash is null) = (participant_identity_kind is null)),
  constraint source_exclusions_kind_fields check (
    case kind
      when 'participant' then participant_identity_hash is not null
      -- conversation local ids are per source and positional, so a conversation exclusion names its
      -- source and the parse context it was chosen in (D32)
      when 'conversation' then conversation_local_id is not null and source_id is not null
                               and parse_timezone is not null and parser_version is not null
      when 'date_range' then range_start is not null and range_end is not null and range_start <= range_end
    end
  ),
  constraint source_exclusions_context_only_conversation
    check (kind = 'conversation' or (parse_timezone is null and parse_date_order is null and parser_version is null)),
  constraint source_exclusions_identity_only_participant
    check (kind = 'participant' or participant_identity_hash is null),
  constraint source_exclusions_handover_id_key unique (handover_id, id)
);
create unique index source_exclusions_handover_participant_key
  on public.source_exclusions (handover_id, participant_identity_kind, participant_identity_hash, participant_identity_pepper_version)
  where kind = 'participant' and source_id is null;
create index source_exclusions_handover_idx on public.source_exclusions (handover_id);

-- ── 6.9 source_messages ──────────────────────────────────────────────────────

create table public.source_messages (
  id uuid primary key default gen_random_uuid(),
  handover_id uuid not null references public.handovers (id) on delete cascade,
  source_id uuid not null,
  conversation_id uuid,
  participant_id uuid,
  seq int not null check (seq >= 0),
  sent_at timestamptz,
  kind text not null check (kind in ('text', 'system', 'media_omitted', 'deleted', 'document_block')),
  body text not null,
  body_sha256 bytea not null,
  location jsonb,
  constraint source_messages_source_fk
    foreign key (handover_id, source_id) references public.sources (handover_id, id) on delete cascade,
  constraint source_messages_conversation_fk
    foreign key (source_id, conversation_id) references public.source_conversations (source_id, id) on delete cascade,
  constraint source_messages_participant_fk
    foreign key (source_id, participant_id) references public.source_participants (source_id, id) on delete cascade,
  constraint source_messages_source_seq_key unique (source_id, seq),
  constraint source_messages_handover_id_key unique (handover_id, id)
);
create index source_messages_handover_sent_idx on public.source_messages (handover_id, sent_at);
create index source_messages_conversation_idx on public.source_messages (conversation_id);
create index source_messages_participant_idx on public.source_messages (participant_id);

-- ── 6.17 processing_runs ─────────────────────────────────────────────────────

create table public.processing_runs (
  id uuid primary key default gen_random_uuid(),
  handover_id uuid not null references public.handovers (id) on delete cascade,
  triggered_by uuid references public.profiles (id) on delete set null,
  status text not null default 'queued' check (status in ('queued', 'running', 'succeeded', 'failed', 'cancelled')),
  source_ids uuid[] not null, -- immutable snapshot; validated by start_processing (§6.0 exceptions)
  pipeline_version text not null,
  ai_provider text not null,
  ai_config jsonb not null,
  started_at timestamptz,
  finished_at timestamptz,
  error_code text,
  error_message text,
  created_at timestamptz not null default now(),
  constraint processing_runs_handover_id_key unique (handover_id, id)
);
create unique index processing_runs_one_active_key
  on public.processing_runs (handover_id) where status in ('queued', 'running');

-- ── 6.11 handover_points ─────────────────────────────────────────────────────

create table public.handover_points (
  id uuid primary key default gen_random_uuid(),
  handover_id uuid not null references public.handovers (id) on delete cascade,
  current_revision_id uuid, -- composite FK added below (deferrable); NOT NULL enforced at commit
  category text not null check (category in (
    'decision', 'owner', 'open_task', 'blocker', 'risk', 'dependency',
    'recurring_problem', 'contact', 'next_action', 'account_access')),
  origin text not null check (origin in ('extracted', 'gap_answer', 'manual')),
  evidence_status text not null default 'missing' check (evidence_status in ('sourced', 'inferred', 'conflicting', 'missing')),
  review_state text not null default 'pending' check (review_state in ('pending', 'approved', 'rejected')),
  approved_as_known_gap boolean not null default false,
  inference_rationale text,
  inferred_confirmed_by uuid references public.profiles (id) on delete set null,
  inferred_confirmed_at timestamptz,
  conflict_resolution_note text,
  conflict_resolved_by uuid references public.profiles (id) on delete set null,
  conflict_resolved_at timestamptz,
  access_floor text not null default 'everyone' check (access_floor in ('everyone', 'leads_only', 'reviewer_only')),
  access_override text check (access_override in ('everyone', 'leads_only', 'reviewer_only')),
  access_level text generated always as (public.max_access(access_floor, access_override)) stored,
  last_supported_at timestamptz,
  is_potentially_outdated boolean not null default false,
  sort_key double precision not null default 0,
  extraction_run_id uuid,
  extraction_access_level text check (extraction_access_level in ('everyone', 'leads_only', 'reviewer_only')),
  erased_at timestamptz,
  privacy_review text not null default 'none' check (privacy_review in ('none', 'required', 'cleared')),
  privacy_review_flagged_at timestamptz,
  status_computed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint handover_points_flagged_when_required
    check (privacy_review <> 'required' or privacy_review_flagged_at is not null),
  constraint handover_points_run_fk
    foreign key (handover_id, extraction_run_id) references public.processing_runs (handover_id, id)
    on delete set null (extraction_run_id),
  constraint handover_points_handover_id_key unique (handover_id, id)
);
create index handover_points_category_idx on public.handover_points (handover_id, category);
create index handover_points_status_idx on public.handover_points (handover_id, evidence_status);
create index handover_points_review_idx on public.handover_points (handover_id, review_state);
create index handover_points_access_idx on public.handover_points (handover_id, access_level);

-- ── 6.12 point_revisions ─────────────────────────────────────────────────────

create table public.point_revisions (
  id uuid primary key default gen_random_uuid(),
  handover_id uuid not null references public.handovers (id) on delete cascade,
  point_id uuid not null,
  revision_number int not null check (revision_number >= 1),
  title text not null,
  statement text not null,
  attributes jsonb not null check (jsonb_typeof(attributes) = 'object'),
  author_kind text not null check (author_kind in ('system', 'profile')),
  author_profile_id uuid references public.profiles (id) on delete set null,
  ai_provenance jsonb,
  edit_reason text,
  redacted_at timestamptz,
  redaction_kind text check (redaction_kind in ('tombstone', 'replacement')),
  created_at timestamptz not null default now(),
  constraint point_revisions_redaction_pair check ((redacted_at is null) = (redaction_kind is null)),
  constraint point_revisions_system_provenance check (author_kind <> 'system' or ai_provenance is not null),
  constraint point_revisions_point_fk
    foreign key (handover_id, point_id) references public.handover_points (handover_id, id) on delete cascade,
  constraint point_revisions_point_number_key unique (point_id, revision_number),
  constraint point_revisions_point_id_key unique (point_id, id)
);
create index point_revisions_point_idx on public.point_revisions (point_id);

alter table public.handover_points
  add constraint handover_points_current_revision_fk
  foreign key (id, current_revision_id) references public.point_revisions (point_id, id)
  deferrable initially deferred;

-- ── 6.15 gap_questions ───────────────────────────────────────────────────────

create table public.gap_questions (
  id uuid primary key default gen_random_uuid(),
  handover_id uuid not null references public.handovers (id) on delete cascade,
  point_id uuid,
  assigned_member_id uuid,
  created_by uuid references public.profiles (id) on delete set null,
  category text check (category in (
    'decision', 'owner', 'open_task', 'blocker', 'risk', 'dependency',
    'recurring_problem', 'contact', 'next_action', 'account_access')),
  question text not null,
  context text,
  priority text not null check (priority in ('required', 'optional')),
  status text not null default 'open' check (status in ('open', 'answered', 'waived')),
  access_level text not null check (access_level in ('everyone', 'leads_only', 'reviewer_only')),
  waived_reason text,
  sort_key double precision,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint gap_questions_point_fk
    foreign key (handover_id, point_id) references public.handover_points (handover_id, id) on delete cascade,
  constraint gap_questions_assignee_fk
    foreign key (handover_id, assigned_member_id) references public.handover_members (handover_id, id)
    on delete set null (assigned_member_id),
  constraint gap_questions_handover_id_key unique (handover_id, id)
);
create index gap_questions_status_idx on public.gap_questions (handover_id, status);
create index gap_questions_point_idx on public.gap_questions (point_id);

-- ── 6.4.1 access_token_questions ─────────────────────────────────────────────

create table public.access_token_questions (
  handover_id uuid not null references public.handovers (id) on delete cascade,
  token_id uuid not null,
  gap_question_id uuid not null,
  token_purpose text not null default 'gap_interview' check (token_purpose = 'gap_interview'),
  created_at timestamptz not null default now(),
  primary key (token_id, gap_question_id),
  constraint access_token_questions_token_fk
    foreign key (handover_id, token_id) references public.access_tokens (handover_id, id) on delete cascade,
  constraint access_token_questions_token_purpose_fk
    foreign key (token_id, token_purpose) references public.access_tokens (id, purpose) on delete cascade,
  constraint access_token_questions_question_fk
    foreign key (handover_id, gap_question_id) references public.gap_questions (handover_id, id) on delete cascade
);
create index access_token_questions_question_idx on public.access_token_questions (gap_question_id);

-- ── 6.16 gap_answers ─────────────────────────────────────────────────────────

create table public.gap_answers (
  id uuid primary key default gen_random_uuid(),
  handover_id uuid not null references public.handovers (id) on delete cascade,
  gap_question_id uuid not null,
  answered_via_token_id uuid,
  answered_by_profile_id uuid,
  answer_text text not null,
  answerer_label text not null,
  status text not null default 'submitted' check (status in ('submitted', 'accepted', 'rejected')),
  reviewed_by uuid references public.profiles (id) on delete set null,
  reviewed_at timestamptz,
  review_note text,
  created_at timestamptz not null default now(),
  constraint gap_answers_one_answerer check (num_nonnulls(answered_via_token_id, answered_by_profile_id) = 1),
  constraint gap_answers_question_fk
    foreign key (handover_id, gap_question_id) references public.gap_questions (handover_id, id) on delete cascade,
  constraint gap_answers_token_fk
    foreign key (handover_id, answered_via_token_id) references public.access_tokens (handover_id, id),
  constraint gap_answers_token_scope_fk
    foreign key (answered_via_token_id, gap_question_id) references public.access_token_questions (token_id, gap_question_id),
  constraint gap_answers_member_fk
    foreign key (handover_id, answered_by_profile_id) references public.handover_members (handover_id, profile_id),
  constraint gap_answers_handover_id_key unique (handover_id, id)
);
create index gap_answers_question_idx on public.gap_answers (gap_question_id);
create index gap_answers_status_idx on public.gap_answers (handover_id, status);

-- ── 6.10 evidence_quotes ─────────────────────────────────────────────────────

create table public.evidence_quotes (
  id uuid primary key default gen_random_uuid(),
  handover_id uuid not null references public.handovers (id) on delete cascade,
  kind text not null check (kind in ('source_quote', 'testimony')),
  source_id uuid,
  source_message_id uuid,
  gap_answer_id uuid,
  stated_by_profile_id uuid references public.profiles (id) on delete set null,
  quote_text text not null,
  quote_start int,
  quote_end int,
  message_sent_at timestamptz,
  author_label text,
  author_identity_kind text check (author_identity_kind in ('phone', 'name')), -- R8 snapshot
  author_identity_hash bytea,
  author_identity_pepper_version text check (author_identity_pepper_version = 'p1'),
  source_title text,
  location jsonb,
  quote_check text not null default 'pending' check (quote_check in ('pending', 'exact', 'normalized', 'not_found')),
  quote_checked_at timestamptz,
  access_level text not null check (access_level in ('everyone', 'leads_only', 'reviewer_only')),
  created_at timestamptz not null default now(),
  constraint evidence_quotes_hash_pair
    check ((author_identity_hash is null) = (author_identity_pepper_version is null)
           and (author_identity_hash is null) = (author_identity_kind is null)),
  constraint evidence_quotes_offsets
    check ((quote_start is null) = (quote_end is null) and (quote_start is null or (quote_start >= 0 and quote_end >= quote_start))),
  constraint evidence_quotes_testimony_origin
    check (kind <> 'testimony' or gap_answer_id is not null or stated_by_profile_id is not null),
  constraint evidence_quotes_testimony_exact check (kind <> 'testimony' or quote_check = 'exact'),
  constraint evidence_quotes_testimony_no_source
    check (kind <> 'testimony' or (source_id is null and source_message_id is null)),
  constraint evidence_quotes_source_fk
    foreign key (handover_id, source_id) references public.sources (handover_id, id) on delete set null (source_id),
  constraint evidence_quotes_message_fk
    foreign key (handover_id, source_message_id) references public.source_messages (handover_id, id)
    on delete set null (source_message_id),
  constraint evidence_quotes_answer_fk
    foreign key (handover_id, gap_answer_id) references public.gap_answers (handover_id, id) on delete cascade,
  constraint evidence_quotes_handover_id_key unique (handover_id, id)
);
create unique index evidence_quotes_message_span_key
  on public.evidence_quotes (source_message_id, quote_start, quote_end) where source_message_id is not null;
create unique index evidence_quotes_gap_answer_key on public.evidence_quotes (gap_answer_id) where gap_answer_id is not null;
create index evidence_quotes_handover_idx on public.evidence_quotes (handover_id);
create index evidence_quotes_source_idx on public.evidence_quotes (source_id);
create index evidence_quotes_author_hash_idx on public.evidence_quotes (handover_id, author_identity_kind, author_identity_hash)
  where author_identity_hash is not null;

-- ── 6.13 point_evidence ──────────────────────────────────────────────────────

create table public.point_evidence (
  id uuid primary key default gen_random_uuid(),
  handover_id uuid not null references public.handovers (id) on delete cascade,
  point_id uuid not null,
  evidence_id uuid not null,
  support_verdict text not null default 'unchecked'
    check (support_verdict in ('unchecked', 'supports', 'partial', 'contradicts', 'irrelevant')),
  verdict_rationale text,
  verifier_provenance jsonb,
  verified_revision_id uuid,
  verified_at timestamptz,
  excluded_at timestamptz,
  excluded_by uuid references public.profiles (id) on delete set null,
  exclusion_reason text,
  created_at timestamptz not null default now(),
  constraint point_evidence_verdict_recorded
    check (support_verdict = 'unchecked'
           or (verified_revision_id is not null and verifier_provenance is not null and verified_at is not null)),
  constraint point_evidence_point_fk
    foreign key (handover_id, point_id) references public.handover_points (handover_id, id) on delete cascade,
  constraint point_evidence_evidence_fk
    foreign key (handover_id, evidence_id) references public.evidence_quotes (handover_id, id) on delete cascade,
  constraint point_evidence_revision_fk
    foreign key (point_id, verified_revision_id) references public.point_revisions (point_id, id),
  constraint point_evidence_point_evidence_key unique (point_id, evidence_id),
  constraint point_evidence_point_id_key unique (point_id, id)
);
create index point_evidence_evidence_idx on public.point_evidence (evidence_id);
create index point_evidence_point_idx on public.point_evidence (point_id);
create index point_evidence_handover_idx on public.point_evidence (handover_id);

-- ── 6.14 review_actions ──────────────────────────────────────────────────────

create table public.review_actions (
  id uuid primary key default gen_random_uuid(),
  handover_id uuid not null references public.handovers (id) on delete cascade,
  point_id uuid not null,
  revision_id uuid,
  point_evidence_id uuid,
  actor_profile_id uuid references public.profiles (id) on delete set null,
  action text not null check (action in (
    'approve', 'reject', 'reopen', 'edit', 'confirm_inferred', 'resolve_conflict', 'exclude_evidence',
    'restore_evidence', 'change_access', 'auto_reopen', 'privacy_hold', 'resolve_privacy_review')),
  from_review_state text check (from_review_state in ('pending', 'approved', 'rejected')),
  to_review_state text check (to_review_state in ('pending', 'approved', 'rejected')),
  note text,
  metadata jsonb,
  created_at timestamptz not null default now(),
  constraint review_actions_point_fk
    foreign key (handover_id, point_id) references public.handover_points (handover_id, id) on delete cascade,
  constraint review_actions_revision_fk
    foreign key (point_id, revision_id) references public.point_revisions (point_id, id),
  constraint review_actions_link_fk
    foreign key (point_id, point_evidence_id) references public.point_evidence (point_id, id)
    on delete set null (point_evidence_id)
);
create index review_actions_point_idx on public.review_actions (point_id, created_at desc);
create index review_actions_handover_idx on public.review_actions (handover_id, created_at desc);

-- ── 6.17 processing_jobs ─────────────────────────────────────────────────────

create table public.processing_jobs (
  id uuid primary key default gen_random_uuid(),
  handover_id uuid not null references public.handovers (id) on delete cascade,
  run_id uuid not null,
  source_id uuid,
  stage text not null check (stage in ('parse', 'extract', 'verify_quotes', 'verify_support', 'analyze', 'prepare_review')),
  status text not null default 'queued' check (status in ('queued', 'running', 'succeeded', 'failed', 'cancelled')),
  attempt int not null default 0 check (attempt >= 0),
  max_attempts int not null default 3 check (max_attempts >= 1),
  input_hash bytea not null,
  ai_provenance jsonb,
  attempt_log jsonb not null default '[]' check (jsonb_typeof(attempt_log) = 'array'),
  progress_done int,
  progress_total int,
  lease_expires_at timestamptz,
  next_attempt_at timestamptz,
  error_code text,
  error_message text,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  constraint processing_jobs_run_fk
    foreign key (handover_id, run_id) references public.processing_runs (handover_id, id) on delete cascade,
  constraint processing_jobs_source_fk
    foreign key (handover_id, source_id) references public.sources (handover_id, id) on delete cascade,
  constraint processing_jobs_run_stage_source_key unique nulls not distinct (run_id, stage, source_id)
);
create index processing_jobs_poll_idx on public.processing_jobs (status, next_attempt_at);
create index processing_jobs_run_idx on public.processing_jobs (run_id);

-- ── 6.18 handover_publications, publication_points ───────────────────────────

create table public.handover_publications (
  id uuid primary key default gen_random_uuid(),
  handover_id uuid not null references public.handovers (id) on delete cascade,
  version int not null check (version >= 1),
  published_by uuid not null references public.profiles (id) on delete restrict,
  published_at timestamptz not null default now(),
  summary text,
  supersedes_id uuid,
  redacted_at timestamptz,
  constraint handover_publications_supersedes_fk
    foreign key (handover_id, supersedes_id) references public.handover_publications (handover_id, id),
  constraint handover_publications_version_key unique (handover_id, version),
  constraint handover_publications_handover_id_key unique (handover_id, id)
);

alter table public.handovers
  add constraint handovers_current_publication_fk
  foreign key (id, current_publication_id) references public.handover_publications (handover_id, id)
  deferrable initially deferred;

alter table public.handovers
  add constraint handovers_pending_creator_fk
  foreign key (id, pending_creator_member_id) references public.handover_members (handover_id, id)
  on delete set null (pending_creator_member_id);

alter table public.handover_members
  add constraint handover_members_invitation_fk
  foreign key (handover_id, invitation_token_id) references public.access_tokens (handover_id, id)
  on delete set null (invitation_token_id);

create table public.publication_points (
  id uuid primary key default gen_random_uuid(),
  handover_id uuid not null references public.handovers (id) on delete cascade,
  publication_id uuid not null,
  point_id uuid not null,
  revision_id uuid not null,
  category text not null check (category in (
    'decision', 'owner', 'open_task', 'blocker', 'risk', 'dependency',
    'recurring_problem', 'contact', 'next_action', 'account_access')),
  evidence_status text not null check (evidence_status in ('sourced', 'inferred', 'conflicting', 'missing')),
  access_level text not null check (access_level in ('everyone', 'leads_only', 'reviewer_only')),
  is_potentially_outdated boolean not null default false,
  is_known_gap boolean not null default false,
  sort_key double precision,
  content jsonb not null check (jsonb_typeof(content) = 'object'),
  redacted_at timestamptz,
  privacy_hold boolean not null default false,
  constraint publication_points_publication_fk
    foreign key (handover_id, publication_id) references public.handover_publications (handover_id, id) on delete cascade,
  constraint publication_points_point_fk
    foreign key (handover_id, point_id) references public.handover_points (handover_id, id) on delete cascade,
  constraint publication_points_revision_fk
    foreign key (point_id, revision_id) references public.point_revisions (point_id, id),
  constraint publication_points_publication_point_key unique (publication_id, point_id)
);
create index publication_points_access_idx on public.publication_points (publication_id, access_level);
create index publication_points_order_idx on public.publication_points (publication_id, category, sort_key);
create index publication_points_point_idx on public.publication_points (point_id);
create index publication_points_revision_idx on public.publication_points (revision_id);

-- ── 6.19 acknowledgements ────────────────────────────────────────────────────

create table public.acknowledgements (
  id uuid primary key default gen_random_uuid(),
  handover_id uuid not null references public.handovers (id) on delete cascade,
  publication_id uuid not null,
  profile_id uuid not null,
  statement_version text not null,
  acknowledged_at timestamptz not null default now(),
  note text,
  invalidated_at timestamptz,
  invalidation_reason text check (invalidation_reason in ('participant_erasure', 'privacy_review')),
  constraint acknowledgements_invalidation_pair check ((invalidated_at is null) = (invalidation_reason is null)),
  constraint acknowledgements_publication_fk
    foreign key (handover_id, publication_id) references public.handover_publications (handover_id, id) on delete cascade,
  constraint acknowledgements_member_fk
    foreign key (handover_id, profile_id) references public.handover_members (handover_id, profile_id) on delete cascade
);
create unique index acknowledgements_valid_key
  on public.acknowledgements (publication_id, profile_id) where invalidated_at is null;

-- ── 6.20 audit_logs ──────────────────────────────────────────────────────────

create table public.audit_logs (
  id bigint generated always as identity primary key,
  handover_id uuid references public.handovers (id) on delete set null, -- D17: survives purge
  actor_profile_id uuid references public.profiles (id) on delete set null,
  actor_token_id uuid references public.access_tokens (id) on delete set null,
  action text not null,
  entity_type text not null,
  entity_id uuid,
  before jsonb,
  after jsonb,
  access_level text not null default 'reviewer_only' check (access_level in ('everyone', 'leads_only', 'reviewer_only')),
  request_id text,
  created_at timestamptz not null default now()
);
create index audit_logs_handover_idx on public.audit_logs (handover_id, created_at desc);
create index audit_logs_entity_idx on public.audit_logs (entity_type, entity_id);

-- ── 6.21 participant_erasures ────────────────────────────────────────────────

create table public.participant_erasures (
  id uuid primary key, -- the recovery-manifest eventId; never generated by the database
  handover_id uuid not null references public.handovers (id) on delete cascade,
  exclusion_id uuid not null,
  identity_kind text not null check (identity_kind in ('phone', 'name')), -- R8
  scope_source_id uuid, -- R8: the one source a name erasure is limited to; NULL for phone
  actor_profile_id uuid references public.profiles (id) on delete set null,
  applied_at timestamptz not null default now(),
  replayed boolean not null default false,
  constraint participant_erasures_exclusion_fk
    foreign key (handover_id, exclusion_id) references public.source_exclusions (handover_id, id) on delete cascade,
  constraint participant_erasures_scope_source_fk
    foreign key (handover_id, scope_source_id) references public.sources (handover_id, id) on delete set null (scope_source_id),
  -- Phone erasures are handover-wide. A name erasure is inserted with its scope source (erase_participant);
  -- the column becomes NULL later only through the source purge.
  constraint participant_erasures_phone_unscoped check (identity_kind <> 'phone' or scope_source_id is null)
);

-- ── 6.8.1 source_identity_confirmations (R8, D29) ────────────────────────────
-- A creator's explicit decision on whether a participant of one source is the person named by a
-- handover-wide NAME exclusion. Never inferred. Functions: 20261111000650_identity_confirmations.sql.

create table public.source_identity_confirmations (
  id uuid primary key default gen_random_uuid(),
  handover_id uuid not null references public.handovers (id) on delete cascade,
  source_id uuid not null,
  exclusion_id uuid not null,
  decision text not null check (decision in ('same_person', 'different_person')),
  decided_by uuid references public.profiles (id) on delete set null,
  decided_at timestamptz not null default now(),
  constraint source_identity_confirmations_source_fk
    foreign key (handover_id, source_id) references public.sources (handover_id, id) on delete cascade,
  constraint source_identity_confirmations_exclusion_fk
    foreign key (handover_id, exclusion_id) references public.source_exclusions (handover_id, id) on delete cascade,
  constraint source_identity_confirmations_key unique (source_id, exclusion_id)
);
create index source_identity_confirmations_exclusion_idx on public.source_identity_confirmations (exclusion_id);

-- RLS is enabled on every table; policies live in the access-control migration.
alter table public.profiles enable row level security;
alter table public.handovers enable row level security;
alter table public.handover_members enable row level security;
alter table public.access_tokens enable row level security;
alter table public.access_token_questions enable row level security;
alter table public.sources enable row level security;
alter table public.source_participants enable row level security;
alter table public.source_conversations enable row level security;
alter table public.source_exclusions enable row level security;
alter table public.source_messages enable row level security;
alter table public.processing_runs enable row level security;
alter table public.processing_jobs enable row level security;
alter table public.handover_points enable row level security;
alter table public.point_revisions enable row level security;
alter table public.point_evidence enable row level security;
alter table public.evidence_quotes enable row level security;
alter table public.review_actions enable row level security;
alter table public.gap_questions enable row level security;
alter table public.gap_answers enable row level security;
alter table public.handover_publications enable row level security;
alter table public.publication_points enable row level security;
alter table public.acknowledgements enable row level security;
alter table public.audit_logs enable row level security;
alter table public.participant_erasures enable row level security;
alter table public.source_identity_confirmations enable row level security;
