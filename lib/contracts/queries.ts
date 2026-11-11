/**
 * Read facade (docs/architecture/shared-contracts.md §11.1, §11.6).
 *
 * Implemented by lib/mocks (UI agent) during parallel development and by lib/db (Supabase agent).
 * lib/data (main) chooses which one the app uses. Every method enforces access through RLS and
 * returns `not_found` for anything the viewer may not see (§8.5).
 */

import type { Result } from "./api";
import type {
  GapInterview,
  GapQuestionSummary,
  HandoverSummary,
  MemberSummary,
  PointDetail,
  PointSummary,
  ProcessingStatus,
  PublishedHandover,
  ReadinessReport,
  SourceSummary,
} from "./dto";
import type { EvidenceStatus, PointCategory, ReviewState } from "./enums";

export interface PointListFilter {
  category?: PointCategory;
  status?: EvidenceStatus;
  reviewState?: ReviewState;
}

export interface BatonQueries {
  listMyHandovers(): Promise<Result<HandoverSummary[]>>;
  getHandover(id: string): Promise<Result<HandoverSummary>>;
  listMembers(handoverId: string): Promise<Result<MemberSummary[]>>;
  listSources(handoverId: string): Promise<Result<SourceSummary[]>>;
  getProcessingStatus(handoverId: string): Promise<Result<ProcessingStatus>>;
  listPoints(handoverId: string, filter?: PointListFilter): Promise<Result<PointSummary[]>>;
  getPoint(pointId: string): Promise<Result<PointDetail>>;
  listGapQuestions(handoverId: string): Promise<Result<GapQuestionSummary[]>>;
  getReadiness(handoverId: string): Promise<Result<ReadinessReport>>;
  getPublishedHandover(handoverId: string): Promise<Result<PublishedHandover>>;
  /** Server-only; uses token redemption. Returns only open, non-held questions in the token's scope (§5.5). */
  getGapInterview(token: string): Promise<Result<GapInterview>>;
}
