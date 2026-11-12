/**
 * Data transfer objects (docs/architecture/shared-contracts.md §11.6).
 *
 * DTOs use camelCase and ISO-8601 strings for timestamps. The DB access layer maps rows to these
 * shapes; raw database rows never reach UI code (§2). Every list is already filtered by RLS.
 */

import type {
  AccessLevel,
  AccessTokenStatus,
  EvidenceKind,
  EvidenceStance,
  EvidenceStatus,
  ExclusionKind,
  ExclusionRequestedVia,
  ExclusionScope,
  GapAnswerStatus,
  GapPriority,
  GapQuestionStatus,
  HandoverState,
  IdentityKind,
  MaskKind,
  MemberRole,
  MessageKind,
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
  TokenPurpose,
} from "./enums";
import type { MessageLocation } from "./parser";
import type { PointAttributes } from "./schemas";

export interface HandoverSummary {
  id: string;
  title: string;
  teamName: string;
  roleTitle: string | null;
  /** R3: the draft's free-text description (masked), so the wizard can show and edit it. */
  description: string | null;
  state: HandoverState;
  viewerRole: MemberRole;
  viewerIsCreator: boolean;
  viewerClearance: AccessLevel;
  currentPublicationId: string | null;
  /** An open creatorship offer (§12.9). Visible to the creator and to the offered member; otherwise null. */
  pendingCreatorTransfer: { toMemberId: string; offeredAt: string } | null;
  createdAt: string;
  updatedAt: string;
}

export interface MemberSummary {
  id: string;
  displayName: string; // per-handover label: duplicates get a stable " #abcd" suffix (§12.3)
  role: MemberRole;
  clearance: AccessLevel | null; // null unless the viewer is the creator
  ackRequired: boolean;
  isCreator: boolean;
  /** True for exactly one row: the signed-in viewer's own membership. */
  isViewer: boolean;
}

/** An open creatorship offer addressed to the signed-in user (§12.9, `/account`). */
export interface CreatorTransferOffer {
  handoverId: string;
  handoverTitle: string;
  offeredByLabel: string;
  offeredAt: string;
}

/**
 * Invitation and Gap Interview links (§12.4). Review roles see Gap Interview links; only the creator
 * sees member invitations and their recipient address. The raw token is never listed.
 */
export interface AccessTokenSummary {
  id: string;
  purpose: TokenPurpose;
  status: AccessTokenStatus;
  grantRole: MemberRole | null; // member_invite only
  recipientEmail: string | null; // member_invite, creator only
  maxAccessLevel: AccessLevel; // gap_interview
  expiresAt: string;
  maxUses: number;
  useCount: number;
  revokedAt: string | null;
  createdAt: string;
}

/** Returned once by inviteMember and createGapInterviewLink; `url` contains the raw token. */
export interface CreatedLink {
  tokenId: string;
  url: string;
  expiresAt: string;
}

/** Returned by publishHandover (§9.2). */
export interface PublicationSummary {
  publicationId: string;
  handoverId: string;
  version: number;
  publishedAt: string;
  handoverState: HandoverState; // "approved" after a publish
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

/** A parsed chat participant (§6.6). Review roles only, within clearance. The identity hash is never returned. */
export interface SourceParticipantSummary {
  id: string;
  sourceId: string;
  sourceTitle: string;
  localId: string;
  displayLabel: string; // "Removed participant" after an erasure
  identityKind: IdentityKind;
  messageCount: number;
  excluded: boolean;
}

/** A recorded exclusion (§6.8), for settings. Review roles only. Never names the participant. */
export interface ExclusionSummary {
  id: string;
  kind: ExclusionKind;
  scope: ExclusionScope;
  sourceId: string | null; // null when handover-wide
  identityKind: IdentityKind | null; // participant only
  conversationLocalId: string | null;
  rangeStart: string | null;
  rangeEnd: string | null;
  reason: string | null;
  requestedVia: ExclusionRequestedVia;
  createdAt: string;
}

/**
 * Messages around one quoted message (§11.6). Review roles only, within clearance. Messages are
 * masked; excluded and erased messages do not exist, and pruned ones are simply absent.
 */
export interface SourceMessageContext {
  pointEvidenceId: string;
  sourceId: string;
  sourceTitle: string;
  available: boolean; // false once the quoted message was pruned (§12.6) or the source removed
  messages: Array<{
    seq: number;
    sentAt: string | null;
    authorLabel: string | null;
    kind: MessageKind;
    body: string;
    location: MessageLocation | null;
    isQuoted: boolean;
  }>;
  hasMoreBefore: boolean;
  hasMoreAfter: boolean;
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
  /**
   * Name identities only: participants in OTHER sources with the same saved name. They are not erased
   * (names are weak identities); the creator reviews each one separately (§12.8). Always 0 for phone.
   */
  sameNameParticipantsElsewhere: number;
}

/** Returned by `getAccountDeletionBlockers` (§11.3, §12.9). */
export interface AccountDeletionBlockers {
  createdHandovers: Array<{ id: string; title: string; deleted: boolean }>;
}
