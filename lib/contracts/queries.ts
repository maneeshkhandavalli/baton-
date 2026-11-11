/**
 * Read facade (docs/architecture/shared-contracts.md §11.1, §11.6).
 *
 * Implemented by lib/mocks (UI agent) during parallel development and by lib/db (Supabase agent).
 * lib/data (main) chooses which one the app uses. Every method enforces access through RLS and
 * returns `not_found` for anything the viewer may not see (§8.5). Reads never mutate (§8.3).
 */

import type { Result } from "./api";
import type {
  AccessTokenSummary,
  CreatorTransferOffer,
  ExclusionSummary,
  GapInterview,
  GapQuestionSummary,
  HandoverSummary,
  MemberSummary,
  PointDetail,
  PointSummary,
  ProcessingStatus,
  PublishedHandover,
  ReadinessReport,
  SourceMessageContext,
  SourceParticipantSummary,
  SourceSummary,
} from "./dto";
import type { EvidenceStatus, PointCategory, ReviewState, TokenPurpose } from "./enums";

export interface PointListFilter {
  category?: PointCategory;
  status?: EvidenceStatus;
  reviewState?: ReviewState;
}

export interface AccessTokenFilter {
  purpose?: TokenPurpose;
  /** Only tokens with status "active". `{ purpose: "member_invite", activeOnly: true }` = pending invitations. */
  activeOnly?: boolean;
}

/** Messages before and after the quoted one. Each is clamped to 0–10; the default is 3. */
export interface MessageContextWindow {
  before?: number;
  after?: number;
}

export const MESSAGE_CONTEXT_MAX = 10;
export const MESSAGE_CONTEXT_DEFAULT = 3;

export interface BatonQueries {
  listMyHandovers(): Promise<Result<HandoverSummary[]>>;
  getHandover(id: string): Promise<Result<HandoverSummary>>;
  /** Active members; `isViewer` marks the signed-in user's own row. */
  listMembers(handoverId: string): Promise<Result<MemberSummary[]>>;
  listSources(handoverId: string): Promise<Result<SourceSummary[]>>;
  /** Review roles. All sources, or one. Excluded participants are listed with `excluded: true`. */
  listParticipants(handoverId: string, sourceId?: string): Promise<Result<SourceParticipantSummary[]>>;
  /** Review roles. */
  listExclusions(handoverId: string): Promise<Result<ExclusionSummary[]>>;
  getProcessingStatus(handoverId: string): Promise<Result<ProcessingStatus>>;
  listPoints(handoverId: string, filter?: PointListFilter): Promise<Result<PointSummary[]>>;
  getPoint(pointId: string): Promise<Result<PointDetail>>;
  /** Review roles, within clearance. `not_found` for testimony links. */
  getSourceMessageContext(pointEvidenceId: string, window?: MessageContextWindow): Promise<Result<SourceMessageContext>>;
  listGapQuestions(handoverId: string): Promise<Result<GapQuestionSummary[]>>;
  getReadiness(handoverId: string): Promise<Result<ReadinessReport>>;
  /**
   * The current publication, for any active member at their clearance. Access is by membership and
   * session only; a token never grants it (§12.3). `not_found` before the first publish.
   */
  getPublishedHandover(handoverId: string): Promise<Result<PublishedHandover>>;
  /** Review roles: Gap Interview links. The creator: also member invitations (§12.4). */
  listAccessTokens(handoverId: string, filter?: AccessTokenFilter): Promise<Result<AccessTokenSummary[]>>;
  /** Offers addressed to the signed-in user (`/account`). */
  listMyCreatorTransferOffers(): Promise<Result<CreatorTransferOffer[]>>;
  /** Server-only; uses token redemption. Returns only open, non-held questions in the token's scope (§5.5). */
  getGapInterview(token: string): Promise<Result<GapInterview>>;
}
