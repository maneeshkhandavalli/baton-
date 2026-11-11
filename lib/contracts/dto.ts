/**
 * Data transfer objects (docs/architecture/shared-contracts.md §11.6).
 *
 * DTOs use camelCase and ISO-8601 strings for timestamps. The DB access layer maps rows to these
 * shapes; raw database rows never reach UI code (§2). Every list is already filtered by RLS.
 */

import type {
  AccessLevel,
  EvidenceKind,
  EvidenceStance,
  EvidenceStatus,
  GapAnswerStatus,
  GapPriority,
  GapQuestionStatus,
  HandoverState,
  MaskKind,
  MemberRole,
  PipelineStage,
  PointCategory,
  PointOrigin,
  PrivacyHoldReason,
  PrivacyReviewState,
  PrivacySurfaceKind,
  QuoteCheck,
  RedactionKind,
  ReviewActionType,
  ReviewState,
  RunStatus,
  SourceKind,
  SourceState,
  SupportVerdict,
} from "./enums";
import type { MessageLocation } from "./parser";
import type { PointAttributes } from "./schemas";

export interface HandoverSummary {
  id: string;
  title: string;
  teamName: string;
  roleTitle: string | null;
  state: HandoverState;
  viewerRole: MemberRole;
  viewerIsCreator: boolean;
  viewerClearance: AccessLevel;
  currentPublicationId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface MemberSummary {
  id: string;
  displayName: string;
  role: MemberRole;
  clearance: AccessLevel | null; // null unless the viewer is the creator
  ackRequired: boolean;
}

export interface SourceSummary {
  id: string;
  handoverId: string;
  kind: SourceKind;
  title: string;
  state: SourceState;
  accessLevel: AccessLevel;
  sizeBytes: number;
  consentRecordedAt: string | null;
  rawDeletedAt: string | null;
  firstMessageAt: string | null;
  lastMessageAt: string | null;
  messageCount: number | null;
  maskingCounts: Partial<Record<MaskKind, number>> | null;
  errorCode: string | null;
}

export interface SourceUploadTicket {
  sourceId: string;
  signedUploadUrl: string;
  token: string;
  expiresAt: string;
}

export interface EvidenceItem {
  pointEvidenceId: string;
  evidenceId: string;
  kind: EvidenceKind;
  quote: string;
  authorLabel: string | null;
  sentAt: string | null;
  sourceTitle: string | null;
  location: MessageLocation | null;
  quoteCheck: QuoteCheck;
  supportVerdict: SupportVerdict;
  verdictRationale: string | null;
  isCurrentRevisionVerdict: boolean;
  excluded: boolean;
  exclusionReason: string | null;
  accessLevel: AccessLevel;
}

export interface PointSummary {
  id: string;
  category: PointCategory;
  title: string;
  statement: string;
  evidenceStatus: EvidenceStatus;
  reviewState: ReviewState;
  accessLevel: AccessLevel;
  isPotentiallyOutdated: boolean;
  origin: PointOrigin;
  evidenceCount: number; // count of VISIBLE evidence
  privacyReview: PrivacyReviewState; // §5.5
  lastSupportedAt: string | null;
  updatedAt: string;
}

/** One surface in a point's privacy review set (§5.5). Review roles only. */
export interface PrivacySurface {
  kind: PrivacySurfaceKind;
  id: string; // point, point_revision, review_action, point_evidence, gap_question or gap_answer id
  revisionNumber?: number; // "revision" only
  fields: Record<string, string | null>; // current text of every field the surface covers (§5.5 table)
  sharedWithPointIds: string[]; // gap_answer only: other points that use its testimony
}

export interface PointRevisionSummary {
  id: string;
  number: number;
  title: string;
  statement: string;
  attributes: PointAttributes | Record<string, never>; // `{}` once tombstoned
  editReason: string | null;
  authorLabel: string | null;
  createdAt: string;
  redaction: RedactionKind | null;
}

export interface PointDetail extends PointSummary {
  currentRevisionId: string;
  revisionNumber: number;
  attributes: PointAttributes;
  inferenceRationale: string | null;
  privacyReviewFlaggedAt: string | null; // set while privacyReview = "required"; the UI shows "some evidence was removed"
  privacyReviewReason: PrivacyHoldReason | null;
  privacySurfaces: PrivacySurface[] | null; // the review set (§5.5) while required; review roles only
  privacyReviewDigest: string | null; // echo back as surfacesDigest when resolving
  inferredConfirmation: { by: string; at: string } | null;
  conflictResolution: { note: string; by: string; at: string } | null;
  evidence: EvidenceItem[]; // sorted by sentAt DESC (newest first), nulls last
  // Full stored text of every revision (review roles only, RLS). After a privacy redaction the stored
  // text IS the replacement or the tombstone, so the original can never be returned.
  revisions: PointRevisionSummary[];
  reviewHistory: Array<{ action: ReviewActionType; actorLabel: string | null; note: string | null; createdAt: string }>;
}

export interface GapAnswerSummary {
  id: string;
  answererLabel: string;
  text: string;
  status: GapAnswerStatus;
  privacyHeld: boolean;
  createdAt: string;
}

export interface GapQuestionSummary {
  id: string;
  pointId: string | null;
  category: PointCategory | null;
  question: string;
  context: string | null;
  priority: GapPriority;
  status: GapQuestionStatus;
  privacyHeld: boolean; // always false for non-review roles: held questions are not returned to them at all (§8.4)
  // Review roles: all answers. Other members: only their own, never held ones.
  answers: GapAnswerSummary[];
}

export type GapInterviewQuestion = Pick<GapQuestionSummary, "id" | "question" | "context" | "priority" | "category">;

/** Only open, non-held questions in the token's scope (§5.5). */
export interface GapInterview {
  handoverTitle: string;
  questions: GapInterviewQuestion[];
}

export interface ProcessingStatus {
  handoverState: HandoverState;
  run: null | {
    id: string;
    status: RunStatus;
    startedAt: string | null;
    finishedAt: string | null;
    stages: Array<{ stage: PipelineStage; status: RunStatus; done: number; total: number }>;
    error: { code: string; message: string } | null;
  };
  sources: SourceSummary[];
}

export const READINESS_BLOCKERS = [
  "processing_incomplete",
  "pending_points",
  "unconfirmed_inferred",
  "unresolved_conflicts",
  "open_required_gaps",
  "no_incoming_recipient", // no incoming member AND no pending incoming member_invite token
  "no_approved_points",
  "privacy_review_required", // any visible point with privacyReview = "required" (§5.5)
] as const;
export type ReadinessBlocker = (typeof READINESS_BLOCKERS)[number];

/** Only computed for review roles (full clearance). */
export interface ReadinessReport {
  canPublish: boolean;
  blockers: Array<{ kind: ReadinessBlocker; count: number; pointIds: string[] }>;
  counts: { byStatus: Record<EvidenceStatus, number>; byReviewState: Record<ReviewState, number>; outdated: number };
  score: number; // 0–100, informational only; never gates publication
}

export type PublishedEvidenceItem =
  | {
      evidenceId: string; // evidence_quotes.id at publish time; stable, and kept after redaction
      redacted: false;
      kind: EvidenceKind;
      quote: string;
      authorLabel: string | null;
      sentAt: string | null;
      sourceTitle: string | null;
      stance: EvidenceStance;
      authorProfileId: string | null; // set only for account-derived testimony labels (§12.9)
    }
  | { evidenceId: string; redacted: true }; // nothing else about erased evidence survives

export interface PublishedPointContent {
  title: string;
  statement: string;
  attributes: PointAttributes;
  evidenceStatus: EvidenceStatus;
  isPotentiallyOutdated: boolean;
  isKnownGap: boolean;
  textRedacted?: boolean; // set by a privacy "redact" decision (§5.5)
  // byProfileId lets account deletion find and anonymise byLabel (§12.9)
  inferredConfirmation: { byLabel: string; byProfileId: string; at: string } | null;
  conflictResolution: { note: string; byLabel: string; byProfileId: string; at: string } | null;
  evidence: PublishedEvidenceItem[]; // newest first; redacted items are moved to the end
  evidenceRedacted: boolean; // true once any item was redacted (§5.5, §12.8)
}

export interface PublishedHandover {
  handoverId: string;
  title: string;
  teamName: string;
  roleTitle: string | null;
  publicationId: string;
  version: number;
  publishedAt: string;
  publishedByLabel: string; // read live from profiles via published_by, never snapshotted
  summary: string | null;
  sections: Array<{ category: PointCategory; points: Array<{ id: string; content: PublishedPointContent }> }>; // RLS-filtered; empty sections omitted
  viewerAcknowledgedAt: string | null;
}

/** Returned by `eraseParticipant` (§11.3). Counts only. */
export interface ErasureReport {
  messagesDeleted: number;
  quotesDeleted: number;
  pointsErased: number;
  pointsFlaggedForPrivacyReview: number;
  publicationsRedacted: number;
  acknowledgementsInvalidated: number;
}

/** Returned by `getAccountDeletionBlockers` (§11.3, §12.9). */
export interface AccountDeletionBlockers {
  createdHandovers: Array<{ id: string; title: string; deleted: boolean }>;
}
