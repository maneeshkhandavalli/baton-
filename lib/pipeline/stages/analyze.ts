/**
 * `analyze` job (§10.9 as amended by W0 decisions I2.3 and I2.6).
 *
 * Duplicates and conflicts are handled in the serial extract stage. Outdated flags and access floors are
 * derived by `recompute_point_status` (triggers, and `_close_run` for every point), so they are not
 * written here. What remains is the D21 coverage check: a checklist category with no live point gets
 * its checklist questions as category-level system gap questions. Idempotent: a system question with the
 * same category and text is never created twice.
 *
 * R3 Task 03 (VER-2, VER-3): it also stores review flags (lib/pipeline/review-flags.ts): possible
 * contradictions found in LATER messages beyond the cited ones, and person fields the model wrote that the
 * evidence does not back. Deterministic, no AI; reporting only (a database without the migration skips it).
 *
 * R3 Task 05D: then the deterministic change detection of every source update this run processed
 * (lib/pipeline/change-detection.ts); its single atomic record per update is what lets the update become ready.
 */

import type { PointCategory } from "../../contracts/enums";
import { DbError } from "../../db/errors";
import {
  createSystemGapQuestion,
  listExtractionMessages,
  listGapQuestionsForPipeline,
  listPointsForPipeline,
  type PipelinePoint,
} from "../../db/pipeline";
import type { RetrievalMessage } from "../../signals/contradictions";
import { runChangeDetection } from "../change-detection";
import { CoverageWriter, storeFlagsInBatches } from "../coverage";
import { buildReviewFlags } from "../review-flags";
import { EXPECTED_KNOWLEDGE_CHECKLIST, gapPriority, type ChecklistItem } from "../checklist";
import { claimOf, type StageContext } from "../stage-context";
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
    await createSystemGapQuestion(ctx.db, claimOf(ctx), {
      pointId: null,
      category: item.category,
      question: item.question,
      context: null,
      priority: gapPriority(item.category),
      accessLevel: "everyone",
    });
    created += 1;
  }
  const messages = await loadHandoverMessages(ctx);
  const flags = buildReviewFlags(points, messages);
  const flagsStored = await storeFlagsInBatches(ctx, new CoverageWriter(ctx), flags);
  // R3 Task 05D: compare each source update with the previous version (after the flags, so items can link them)
  const changes = await runChangeDetection(ctx, points);
  ctx.logger.info("analyze_done", {
    jobId: ctx.claimed.id, points: points.length, checklistQuestions: created, reviewFlags: flags.length, flagsStored,
    sourceUpdates: changes.updates, changeItems: changes.items,
  });
  return { kind: "succeeded", progress: { done: 1, total: 1 } };
}

const MESSAGE_PAGE = 2000;

/**
 * Every text message of the run's PARSED sources (stored, masked, pseudonymised), for contradiction retrieval.
 * A source whose parse failed, or that was removed since, has no messages to compare and is skipped.
 */
async function loadHandoverMessages(ctx: StageContext): Promise<RetrievalMessage[]> {
  const out: RetrievalMessage[] = [];
  for (const sourceId of ctx.job.run.sourceIds) {
    let afterSeq = -1;
    for (;;) {
      let page: Awaited<ReturnType<typeof listExtractionMessages>>;
      try {
        page = await listExtractionMessages(ctx.db, { sourceId, afterSeq, limit: MESSAGE_PAGE });
      } catch (e) {
        if (e instanceof DbError && (e.code === "invalid_transition" || e.code === "not_found")) break; // not parsed / gone
        throw e;
      }
      const rows = page?.messages ?? [];
      for (const m of rows) out.push({ id: m.id, sourceId, seq: m.seq, sentAt: m.sentAt, authorLabel: m.authorLabel, body: m.body });
      if (rows.length === 0) break;
      afterSeq = rows[rows.length - 1].seq;
    }
  }
  return out;
}
