/**
 * `analyze` job (§10.9 as amended by W0 decisions I2.3 and I2.6).
 *
 * Duplicates and conflicts are handled in the serial extract stage. Outdated flags and access floors are
 * derived by `recompute_point_status` (triggers, and `_close_run` for every point), so they are not
 * written here. What remains is the D21 coverage check: a checklist category with no live point gets
 * its checklist questions as category-level system gap questions. Idempotent: a system question with the
 * same category and text is never created twice.
 */

import type { PointCategory } from "../../contracts/enums";
import { createSystemGapQuestion, listGapQuestionsForPipeline, listPointsForPipeline, type PipelinePoint } from "../../db/pipeline";
import { EXPECTED_KNOWLEDGE_CHECKLIST, gapPriority, type ChecklistItem } from "../checklist";
import type { StageContext } from "../stage-context";
import type { StageOutcome } from "../types";

/** A category is covered by any point a reviewer has not rejected. */
export function coveredCategories(points: ReadonlyArray<Pick<PipelinePoint, "category" | "reviewState">>): Set<PointCategory> {
  return new Set(points.filter((p) => p.reviewState !== "rejected").map((p) => p.category));
}

export function uncoveredChecklistItems(
  points: ReadonlyArray<Pick<PipelinePoint, "category" | "reviewState">>,
  existingSystemQuestions: ReadonlyArray<{ category: PointCategory | null; question: string | null; pointId: string | null }>,
): ChecklistItem[] {
  const covered = coveredCategories(points);
  const asked = new Set(
    existingSystemQuestions.filter((q) => q.pointId === null && q.question !== null).map((q) => `${q.category}\u0000${q.question}`),
  );
  return EXPECTED_KNOWLEDGE_CHECKLIST.filter((item) => !covered.has(item.category) && !asked.has(`${item.category}\u0000${item.question}`));
}

export async function runAnalyze(ctx: StageContext): Promise<StageOutcome> {
  const handoverId = ctx.job.job.handoverId;
  const [points, questions] = await Promise.all([
    listPointsForPipeline(ctx.db, handoverId),
    listGapQuestionsForPipeline(ctx.db, handoverId),
  ]);
  const items = uncoveredChecklistItems(points, questions.filter((q) => q.isSystem));
  let created = 0;
  for (const item of items) {
    await createSystemGapQuestion(ctx.db, {
      handoverId,
      pointId: null,
      category: item.category,
      question: item.question,
      context: null,
      priority: gapPriority(item.category),
      accessLevel: "everyone",
    });
    created += 1;
  }
  ctx.logger.info("analyze_done", { jobId: ctx.claimed.id, points: points.length, checklistQuestions: created });
  return { kind: "succeeded", progress: { done: 1, total: 1 } };
}
