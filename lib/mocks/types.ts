/**
 * Internal row shapes for the in-memory mock store.
 *
 * These are NOT shared contracts. They loosely mirror the §6 tables so the mock can derive the
 * canonical DTOs (lib/contracts/dto.ts) the same way the real DB layer will. UI code never imports
 * from this file; it only sees DTOs through `BatonQueries` and the mock actions.
 */

import type { MessageLocation, ParseContext, SourcePreview } from "@/lib/contracts/parser";
import type {
  AccessLevel,
  EvidenceKind,
  ExclusionKind,
  ExclusionRequestedVia,
  GapPriority,
  GapQuestionStatus,
  HandoverState,
  IdentityKind,
  IdentityMatchDecision,
  IdentityPepperVersion,
  MaskKind,
  MemberRole,
  PointCategory,
  PointOrigin,
  PrivacyReviewState,
  QuoteCheck,
  ReviewState,
  RunStatus,
  SourceKind,
  SourceState,
  SupportVerdict,
  TokenPurpose,
} from "@/lib/contracts/enums";
import type { GapAnswerSummary, PointDetail, PointRevisionSummary, PublishedPointContent } from "@/lib/contracts/dto";

export interface MockProfile {
  id: string;
  displayName: string;
  email: string;
}

export interface MockHandover {
  id: string;
  title: string;
  teamName: string;
  roleTitle: string | null;
  description: string | null;
  state: HandoverState;
  createdBy: string; // profile id
  currentPublicationId: string | null;
  createdAt: string;
  updatedAt: string;
  evidenceAsOf: string | null;
  lastError: { code: string; message: string } | null;
  deletedAt: string | null;
  /** Whether a run has ever succeeded (decides processing → draft vs in_review on failure, §9.1). */
  hadSuccessfulRun: boolean;
  /** Open creatorship offer (§6.2 `pending_creator_member_id`, `creator_transfer_offered_at`). */
  pendingCreatorTransfer: { toMemberId: string; offeredAt: string; offeredBy: string } | null;
  /** Set when a soft-deleted handover is hard-purged (immediately via `deleteAccount`, or after the grace period). */
  purgedAt: string | null;
}

export interface MockMember {
  id: string;
  handoverId: string;
  profileId: string | null;
  displayName: string;
  email: string;
  role: MemberRole;
  clearance: AccessLevel;
  ackRequired: boolean;
  removedAt: string | null;
}

export interface MockSource {
  id: string;
  handoverId: string;
  kind: SourceKind;
  title: string;
  state: SourceState;
  accessLevel: AccessLevel;
  sizeBytes: number;
  sha256: string;
  consentRecordedAt: string | null;
  rawDeletedAt: string | null;
  firstMessageAt: string | null;
  lastMessageAt: string | null;
  messageCount: number | null;
  maskingCounts: Partial<Record<MaskKind, number>> | null;
  errorCode: string | null;
  timezone: string;
  documentDate: string | null;
  /**
   * The rule-free preview (what the parser would see with no exclusions). `previewSource` applies
   * the current exclusion rules to it on every call (D33), so excluded people never reach the UI.
   */
  basePreview: SourcePreview | null;
  /** `identity_confirmation_required` and similar parse failures surface through `errorCode`. */
  removedAt: string | null;
}

/** A parsed chat participant (§6.6). Only retained participants are stored. */
export interface MockParticipant {
  id: string;
  handoverId: string;
  sourceId: string;
  localId: string;
  displayLabel: string;
  identityKind: IdentityKind;
  identityHash: string;
  identityPepperVersion: IdentityPepperVersion;
  messageCount: number;
}

/** A `source_exclusions` row (§6.8). Append-only. */
export interface MockExclusion {
  id: string;
  handoverId: string;
  /** null = handover-wide. */
  sourceId: string | null;
  kind: ExclusionKind;
  identityKind: IdentityKind | null;
  identityHash: string | null;
  identityPepperVersion: IdentityPepperVersion | null;
  conversationLocalId: string | null;
  parseContext: ParseContext | null;
  rangeStart: string | null;
  rangeEnd: string | null;
  reason: string | null;
  requestedVia: ExclusionRequestedVia;
  requestedBy: string | null;
  createdAt: string;
}

/** A `source_identity_confirmations` row (§6.8.1). One per (source, exclusion). */
export interface MockIdentityConfirmation {
  sourceId: string;
  exclusionId: string;
  decision: IdentityMatchDecision;
  decidedBy: string;
  decidedAt: string;
}

export interface MockLink {
  pointEvidenceId: string;
  evidenceId: string;
  kind: EvidenceKind;
  quote: string;
  authorLabel: string | null;
  sentAt: string | null;
  sourceId: string | null;
  location: MessageLocation | null;
  quoteCheck: QuoteCheck;
  supportVerdict: SupportVerdict;
  verdictRationale: string | null;
  /** PI-11: the injection guard replaced the model's promoting verdict (EvidenceItem.guarded). */
  guarded?: boolean;
  modelVerdict?: "supports" | "partial" | null;
  verifiedRevisionId: string | null;
  excluded: boolean;
  exclusionReason: string | null;
  accessLevel: AccessLevel;
}

export interface MockPoint {
  id: string;
  handoverId: string;
  category: PointCategory;
  origin: PointOrigin;
  /** Oldest first; the last entry is the current revision. */
  revisions: PointRevisionSummary[];
  links: MockLink[];
  inferenceRationale: string | null;
  reviewState: ReviewState;
  accessOverride: AccessLevel | null;
  inferredConfirmation: { by: string; at: string } | null;
  conflictResolution: { note: string; by: string; at: string } | null;
  approvedAsKnownGap: boolean;
  reviewHistory: PointDetail["reviewHistory"];
  privacyReview: PrivacyReviewState;
  sortKey: number;
  updatedAt: string;
  /** Simulated async `verify_support` re-check after an edit (D16). Epoch ms. */
  reverifyAt: number | null;
}

export interface MockGapAnswer extends GapAnswerSummary {
  answeredByProfileId: string | null;
  viaToken: string | null;
}

export interface MockGapQuestion {
  id: string;
  handoverId: string;
  pointId: string | null;
  category: PointCategory | null;
  question: string;
  context: string | null;
  priority: GapPriority;
  status: GapQuestionStatus;
  accessLevel: AccessLevel;
  answers: MockGapAnswer[];
  createdAt: string;
}

export interface MockToken {
  id: string;
  /** The raw token. The real table stores only its SHA-256 hash (§6.4); the mock keeps it to resolve links. */
  token: string;
  purpose: TokenPurpose;
  handoverId: string;
  /** gap_interview: the questions in scope (access_token_questions). */
  questionIds: string[];
  maxAccessLevel: AccessLevel;
  /** member_invite only. */
  grantRole: MemberRole | null;
  recipientEmail: string | null;
  /**
   * Mock stand-in for a redeemed invite plus a signed-in session: the profile that the
   * `/h/[token]` page reads as. The real flow redeems the token and uses the auth session (§12.3).
   */
  sessionProfileId: string | null;
  redeemedAt: string | null;
  expiresAt: string;
  revokedAt: string | null;
  maxUses: number;
  useCount: number;
  createdBy: string;
  createdAt: string;
}

export interface MockPublicationPoint {
  id: string;
  category: PointCategory;
  accessLevel: AccessLevel;
  sortKey: number;
  content: PublishedPointContent;
}

export interface MockPublication {
  id: string;
  handoverId: string;
  version: number;
  publishedAt: string;
  publishedBy: string; // profile id
  summary: string | null;
  points: MockPublicationPoint[];
  acknowledgements: Array<{ profileId: string; at: string }>;
}

export interface MockRun {
  id: string;
  handoverId: string;
  status: RunStatus;
  startedAt: string;
  durationMs: number;
  finishedAt: string | null;
  error: { code: string; message: string } | null;
}

export interface MockStore {
  /** The signed-in profile for workspace pages (mock session). */
  viewerId: string;
  /**
   * Profile of the last `/h/[token]` reader. Mock-only stand-in for the invitee's auth session, so
   * `acknowledgePublication` knows who is acknowledging (the real action uses the session).
   */
  readerSessionId: string | null;
  profiles: MockProfile[];
  handovers: MockHandover[];
  members: MockMember[];
  sources: MockSource[];
  participants: MockParticipant[];
  exclusions: MockExclusion[];
  identityConfirmations: MockIdentityConfirmation[];
  points: MockPoint[];
  gapQuestions: MockGapQuestion[];
  tokens: MockToken[];
  publications: MockPublication[];
  runs: MockRun[];
}
