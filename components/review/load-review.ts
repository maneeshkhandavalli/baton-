import type { GapQuestionSummary, HandoverSummary, PointDetail, ReadinessReport, SourceSummary } from "@/lib/contracts/dto";
import type { ExtractionReport, PointReviewFlag, UnreviewedSignalMessage } from "@/lib/contracts/extraction";
import type { BatonQueries } from "@/lib/contracts/queries";

export interface ReviewData {
  handover: HandoverSummary;
  points: PointDetail[];
  readiness: ReadinessReport | null;
  gapQuestions: GapQuestionSummary[];
  sources: SourceSummary[];
  /** R3 Task 03: coverage, unreviewed signals and review flags (null / empty when unavailable). */
  extraction: ExtractionReport | null;
  unreviewedSignals: UnreviewedSignalMessage[];
  pointFlags: PointReviewFlag[];
  /** Round 4 audit C2: the viewer's member label, to label their own testimony "Your statement". */
  viewerLabel: string | null;
}

export type ReviewLoad = { kind: "ok"; data: ReviewData } | { kind: "not_found" } | { kind: "not_reviewer"; handover: HandoverSummary };

/** Everything the review workspace needs, through the read facade only (§11.1). */
export async function loadReview(queries: BatonQueries, handoverId: string): Promise<ReviewLoad> {
  const handover = await queries.getHandover(handoverId);
  if (!handover.ok) return { kind: "not_found" };
  if (handover.data.viewerRole !== "outgoing" && handover.data.viewerRole !== "reviewer") {
    return { kind: "not_reviewer", handover: handover.data };
  }
  const [list, readiness, gaps, sources, extraction, signals, flags, members] = await Promise.all([
    queries.listPoints(handoverId),
    queries.getReadiness(handoverId),
    queries.listGapQuestions(handoverId),
    queries.listSources(handoverId),
    queries.getExtractionReport(handoverId),
    queries.listUnreviewedSignals(handoverId, 50),
    queries.listPointFlags(handoverId),
    queries.listMembers(handoverId),
  ]);
  const ids = list.ok ? list.data.map((p) => p.id) : [];
  const details = await Promise.all(ids.map((id) => queries.getPoint(id)));
  return {
    kind: "ok",
    data: {
      handover: handover.data,
      points: details.flatMap((d) => (d.ok ? [d.data] : [])),
      readiness: readiness.ok ? readiness.data : null,
      gapQuestions: gaps.ok ? gaps.data : [],
      sources: sources.ok ? sources.data : [],
      extraction: extraction.ok ? extraction.data : null,
      unreviewedSignals: signals.ok ? signals.data : [],
      pointFlags: flags.ok ? flags.data : [],
      viewerLabel: members.ok ? (members.data.find((m) => m.isViewer)?.displayName ?? null) : null,
    },
  };
}
