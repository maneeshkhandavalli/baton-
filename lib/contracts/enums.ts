/**
 * Canonical domain enums (docs/architecture/shared-contracts.md §3).
 *
 * Every enum is a `const` tuple plus a derived union type. Postgres stores them as
 * `text` + `CHECK`, generated from these arrays (D20). Do not rename values.
 */

export const POINT_CATEGORIES = [
  "decision",
  "owner",
  "open_task",
  "blocker",
  "risk",
  "dependency",
  "recurring_problem",
  "contact",
  "next_action",
  "account_access", // D4
] as const;
export type PointCategory = (typeof POINT_CATEGORIES)[number];

// Values match the Phase 01 types/status.ts. Do not rename.
export const EVIDENCE_STATUSES = ["sourced", "inferred", "conflicting", "missing"] as const;
export type EvidenceStatus = (typeof EVIDENCE_STATUSES)[number];

// Ordered from least to most restrictive. Array order IS the rank (§8.1).
export const ACCESS_LEVELS = ["everyone", "leads_only", "reviewer_only"] as const;
export type AccessLevel = (typeof ACCESS_LEVELS)[number];

// Creator is an authority, not a membership role (§8.2).
export const MEMBER_ROLES = ["outgoing", "incoming", "lead", "reviewer"] as const;
export type MemberRole = (typeof MEMBER_ROLES)[number];

// The creator's own membership role (D23, §6.3).
export const CREATOR_ROLES = ["outgoing", "reviewer"] as const satisfies readonly MemberRole[];
export type CreatorRole = (typeof CREATOR_ROLES)[number];

// Roles whose clearance is fixed at reviewer_only (§6.3).
export const REVIEW_MEMBER_ROLES = ["outgoing", "reviewer"] as const satisfies readonly MemberRole[];
export type ReviewMemberRole = (typeof REVIEW_MEMBER_ROLES)[number];

export const HANDOVER_STATES = ["draft", "processing", "in_review", "approved", "acknowledged"] as const;
export type HandoverState = (typeof HANDOVER_STATES)[number];

export const REVIEW_STATES = ["pending", "approved", "rejected"] as const;
export type ReviewState = (typeof REVIEW_STATES)[number];

// Separate from review state and evidence status (§5.5). Set to "required" by participant erasure,
// or when a testimony the point uses is redacted or removed during another privacy review.
export const PRIVACY_REVIEW_STATES = ["none", "required", "cleared"] as const;
export type PrivacyReviewState = (typeof PRIVACY_REVIEW_STATES)[number];

export const PRIVACY_HOLD_REASONS = ["participant_erasure", "linked_evidence_changed"] as const;
export type PrivacyHoldReason = (typeof PRIVACY_HOLD_REASONS)[number];

// Decision on the point itself (the current revision and point-level text).
export const PRIVACY_REVIEW_DECISIONS = ["keep", "redact", "withdraw"] as const;
export type PrivacyReviewDecision = (typeof PRIVACY_REVIEW_DECISIONS)[number];

// Related text surfaces in a point's review set (§5.5). "point" is decided with
// PRIVACY_REVIEW_DECISIONS; every other kind, including each earlier "revision", with
// PRIVACY_SURFACE_DECISIONS.
export const PRIVACY_SURFACE_KINDS = [
  "point",
  "revision",
  "review_note",
  "evidence_note",
  "gap_question",
  "gap_answer",
] as const;
export type PrivacySurfaceKind = (typeof PRIVACY_SURFACE_KINDS)[number];

// The surface kinds that carry their own decision in `surfaces` (everything except "point").
export const RELATED_PRIVACY_SURFACE_KINDS = [
  "revision",
  "review_note",
  "evidence_note",
  "gap_question",
  "gap_answer",
] as const satisfies readonly PrivacySurfaceKind[];
export type RelatedPrivacySurfaceKind = (typeof RELATED_PRIVACY_SURFACE_KINDS)[number];

export const PRIVACY_SURFACE_DECISIONS = ["keep", "redact", "remove"] as const;
export type PrivacySurfaceDecision = (typeof PRIVACY_SURFACE_DECISIONS)[number];

// How a point revision's original text was removed (§6.12).
export const REDACTION_KINDS = ["tombstone", "replacement"] as const;
export type RedactionKind = (typeof REDACTION_KINDS)[number];

export const REVIEW_ACTION_TYPES = [
  "approve",
  "reject",
  "reopen",
  "edit",
  "confirm_inferred",
  "resolve_conflict",
  "exclude_evidence",
  "restore_evidence",
  "change_access",
  "auto_reopen", // system only: evidence changed after approval
  "privacy_hold", // system only: participant erasure flagged the point (§5.5)
  "resolve_privacy_review", // keep | redact | withdraw (§5.5)
] as const;
export type ReviewActionType = (typeof REVIEW_ACTION_TYPES)[number];

export const POINT_ORIGINS = ["extracted", "gap_answer", "manual"] as const;
export type PointOrigin = (typeof POINT_ORIGINS)[number];

export const EVIDENCE_KINDS = ["source_quote", "testimony"] as const;
export type EvidenceKind = (typeof EVIDENCE_KINDS)[number];

// Quote EXISTENCE: deterministic string check (§10.7)
export const QUOTE_CHECKS = ["pending", "exact", "normalized", "not_found"] as const;
export type QuoteCheck = (typeof QUOTE_CHECKS)[number];

// Quote SUPPORT: does the quote back the specific claim? (§10.8)
export const SUPPORT_VERDICTS = ["unchecked", "supports", "partial", "contradicts", "irrelevant"] as const;
export type SupportVerdict = (typeof SUPPORT_VERDICTS)[number];

// A cited or published quote's stance towards the claim (§10.6, §11.6).
export const EVIDENCE_STANCES = ["supports", "contradicts"] as const;
export type EvidenceStance = (typeof EVIDENCE_STANCES)[number];

export const SOURCE_KINDS = ["whatsapp_export", "pdf", "docx", "markdown", "text"] as const;
export type SourceKind = (typeof SOURCE_KINDS)[number];

export const SOURCE_STATES = ["pending_upload", "uploaded", "parsing", "parsed", "failed", "removed"] as const;
export type SourceState = (typeof SOURCE_STATES)[number];

// Chat-export date order (§6.5, §11.4).
export const DATE_ORDERS = ["dmy", "mdy", "ymd"] as const;
export type DateOrder = (typeof DATE_ORDERS)[number];

export const MESSAGE_KINDS = ["text", "system", "media_omitted", "deleted", "document_block"] as const;
export type MessageKind = (typeof MESSAGE_KINDS)[number];

export const EXCLUSION_KINDS = ["participant", "conversation", "date_range"] as const;
export type ExclusionKind = (typeof EXCLUSION_KINDS)[number];

export const MASK_KINDS = [
  "phone",
  "email",
  "upi",
  "bank_account",
  "ifsc",
  "card",
  "government_id",
  "password",
  "api_key",
  "secret",
] as const;
export type MaskKind = (typeof MASK_KINDS)[number];

// Identity-pepper versions (§12.8 point 9). v1 is a stable, non-rotating secret: "p1" only.
export const IDENTITY_PEPPER_VERSIONS = ["p1"] as const;
export type IdentityPepperVersion = (typeof IDENTITY_PEPPER_VERSIONS)[number];

export const GAP_QUESTION_STATUSES = ["open", "answered", "waived"] as const;
export type GapQuestionStatus = (typeof GAP_QUESTION_STATUSES)[number];

export const GAP_PRIORITIES = ["required", "optional"] as const;
export type GapPriority = (typeof GAP_PRIORITIES)[number];

export const GAP_ANSWER_STATUSES = ["submitted", "accepted", "rejected"] as const;
export type GapAnswerStatus = (typeof GAP_ANSWER_STATUSES)[number];

export const GAP_ANSWER_DECISIONS = ["accept", "reject"] as const;
export type GapAnswerDecision = (typeof GAP_ANSWER_DECISIONS)[number];

export const TOKEN_PURPOSES = ["member_invite", "gap_interview"] as const;
export type TokenPurpose = (typeof TOKEN_PURPOSES)[number];

export const RUN_STATUSES = ["queued", "running", "succeeded", "failed", "cancelled"] as const;
export type RunStatus = (typeof RUN_STATUSES)[number]; // used by processing_runs and processing_jobs

export const PIPELINE_STAGES = [
  "parse",
  "extract",
  "verify_quotes",
  "verify_support",
  "analyze",
  "prepare_review",
] as const;
export type PipelineStage = (typeof PIPELINE_STAGES)[number];

// Category attribute value sets (§3.1).
export const RISK_LEVELS = ["low", "medium", "high"] as const;
export type RiskLevel = (typeof RISK_LEVELS)[number];

export const DEPENDENCY_TYPES = ["person", "organisation", "system", "event"] as const;
export type DependencyType = (typeof DEPENDENCY_TYPES)[number];

export const CONTACT_CHANNELS = ["whatsapp", "email", "phone", "in_person", "other"] as const;
export type ContactChannel = (typeof CONTACT_CHANNELS)[number];

export const DIRECT_CONTACT_CHANNELS = ["phone", "email"] as const;
export type DirectContactChannel = (typeof DIRECT_CONTACT_CHANNELS)[number];
