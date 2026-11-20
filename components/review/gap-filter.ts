/**
 * Round 4 audit C3: the review page's "Gaps" filter and the readiness blocker "N required gaps are unanswered" must
 * agree. A point belongs to the Gaps filter when its evidence is missing, or when an open Gap Interview question is
 * attached to it. Required questions that aren't attached to any point can't be shown as cards: they are counted
 * separately so the panel can point to the Gap Interview instead of showing an empty filter. Pure, no React.
 */

import type { GapQuestionSummary, PointDetail, ReadinessReport } from "@/lib/contracts/dto";

export interface GapFilterModel {
  /** Points the Gaps filter shows (not rejected). */
  pointIds: Set<string>;
  /** Open required questions, the same number the readiness blocker counts. */
  openRequired: number;
  /** Open required questions with no point on this page (answered on the Gap Interview page only). */
  unattachedRequired: number;
}

export function gapFilterModel(
  points: readonly Pick<PointDetail, "id" | "evidenceStatus" | "reviewState">[],
  gapQuestions: readonly Pick<GapQuestionSummary, "pointId" | "status" | "priority">[],
  readiness: Pick<ReadinessReport, "blockers"> | null,
): GapFilterModel {
  const live = points.filter((p) => p.reviewState !== "rejected");
  const liveIds = new Set(live.map((p) => p.id));
  const open = gapQuestions.filter((q) => q.status === "open");
  const pointIds = new Set(live.filter((p) => p.evidenceStatus === "missing").map((p) => p.id));
  for (const q of open) if (q.pointId && liveIds.has(q.pointId)) pointIds.add(q.pointId);
  const blocker = readiness?.blockers.find((b) => b.kind === "open_required_gaps");
  for (const id of blocker?.pointIds ?? []) if (liveIds.has(id)) pointIds.add(id);
  const requiredOpen = open.filter((q) => q.priority === "required");
  const openRequired = blocker?.count ?? requiredOpen.length;
  const attached = requiredOpen.filter((q) => q.pointId && liveIds.has(q.pointId)).length;
  return { pointIds, openRequired, unattachedRequired: Math.max(0, openRequired - attached) };
}
