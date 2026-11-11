/**
 * `prepare_review` job (§10.10). Ends at human review: nothing is approved, rejected or published here.
 *
 * - One system gap question per `missing` point that has none yet (any status: a waived or answered
 *   question is not asked again). Skipped for privacy-held, rejected and redacted points. The question is
 *   asked at the point's own `access_level`, so it never reaches anyone the point is hidden from (§8.4).
 * - Review order (`sort_key`): conflicting, inferred, missing, sourced; newest evidence first within each.
 */

import type { EvidenceStatus } from "../../contracts/enums";
import { DbError } from "../../db/errors";
import { createSystemGapQuestion, listGapQuestionsForPipeline, listPointsForPipeline, setPointSortKeys, type PipelinePoint } from "../../db/pipeline";
import { gapPriority } from "../checklist";
import type { StageContext } from "../stage-context";
import type { StageOutcome } from "../types";

const STATUS_ORDER: Record<EvidenceStatus, number> = { conflicting: 0, inferred: 1, missing: 2, sourced: 3 };
const QUESTION_TITLE_MAX = 120;

type SortablePoint = Pick<PipelinePoint, "pointId" | "evidenceStatus" | "newestEvidenceAt">;

function statusRank(status: string): number {
  return Object.hasOwn(STATUS_ORDER, status) ? STATUS_ORDER[status as EvidenceStatus] : 4;
}

function timeOf(iso: string | null): number {
  const t = iso === null ? Number.NaN : Date.parse(iso);
  return Number.isNaN(t) ? Number.NEGATIVE_INFINITY : t;
}

/** §10.10 order. Ties fall back to the point id so the order is deterministic. */
export function reviewOrder<T extends SortablePoint>(points: readonly T[]): T[] {
  return [...points].sort(
    (a, b) =>
      statusRank(a.evidenceStatus) - statusRank(b.evidenceStatus) ||
      timeOf(b.newestEvidenceAt) - timeOf(a.newestEvidenceAt) ||
      (a.pointId < b.pointId ? -1 : a.pointId > b.pointId ? 1 : 0),
  );
}

export function pointsNeedingQuestions(
  points: readonly PipelinePoint[],
  questions: ReadonlyArray<{ pointId: string | null }>,
): PipelinePoint[] {
  const asked = new Set(questions.map((q) => q.pointId).filter((id): id is string => id !== null));
  return points.filter(
    (p) =>
      p.evidenceStatus === "missing" &&
      p.privacyReview !== "required" &&
      p.reviewState !== "rejected" &&
      !p.redacted &&
      p.title !== null &&
      !asked.has(p.pointId),
  );
}

export function questionForPoint(title: string): string {
  const t = title.length > QUESTION_TITLE_MAX ? `${title.slice(0, QUESTION_TITLE_MAX - 1)}…` : title;
  return `No source confirms this yet: "${t}". What do you know about it?`;
}

export async function runPrepareReview(ctx: StageContext): Promise<StageOutcome> {
  const { handoverId, runId } = ctx.job.job;
  const [points, questions] = await Promise.all([
    listPointsForPipeline(ctx.db, handoverId),
    listGapQuestionsForPipeline(ctx.db, handoverId),
  ]);

  let created = 0;
  let skipped = 0;
  for (const p of pointsNeedingQuestions(points, questions)) {
    try {
      await createSystemGapQuestion(ctx.db, {
        handoverId,
        pointId: p.pointId,
        category: null, // a point question takes the point's category (SQL)
        question: questionForPoint(p.title as string),
        context: null,
        priority: gapPriority(p.category),
        accessLevel: p.accessLevel,
      });
      created += 1;
    } catch (e) {
      // The point was erased or put on privacy hold after the read: never ask about it (§5.5).
      if (e instanceof DbError && (e.code === "precondition_failed" || e.code === "not_found")) {
        skipped += 1;
        continue;
      }
      throw e;
    }
  }

  const keys = reviewOrder(points).map((p, i) => ({ pointId: p.pointId, sortKey: i + 1 }));
  if (keys.length > 0) await setPointSortKeys(ctx.db, { handoverId, runId, keys });

  ctx.logger.info("prepare_review_done", { jobId: ctx.claimed.id, points: points.length, gapQuestions: created, skipped });
  return { kind: "succeeded", progress: { done: 1, total: 1 } };
}
