/**
 * `extract` job (§10.6, §12.10, W0 decisions I2.3–I2.5, I2.8). One job per source; DB-1 runs extract
 * jobs of a run one at a time, so cross-source dedup has no race.
 *
 * 1. Provider for the run snapshot; provenance written before the first call (§11.8 rule 3).
 * 2. The source's persisted, masked text messages only (never raw uploads), chunked deterministically by
 *    conversation within `EXTRACT_REQUEST_LIMITS`. One source = one access level (QA-M8), and that level
 *    becomes every new point's `extraction_access_level`.
 * 3. Per-run budget (≤ 200 extract calls): this source may use its share, `floor(200 / sources)`.
 * 4. Per chunk: `extractCandidates`; each candidate either attaches to a matching point (dedup.ts) or is
 *    inserted. Citations are stored with `quote_check = 'pending'` (verify_quotes decides): `matchedText`
 *    with its offsets for exact/normalized, the model's quote without offsets for not_found.
 * 5. Checkpoint: `progress_done` = chunks finished. Near the deadline the job yields and resumes there;
 *    a retry also resumes there. (DB-13 is deferred: a crash inside a chunk can repeat that chunk; the
 *    statement dedup absorbs exact repeats.)
 */

import type { AiAttemptRecord, ExtractRequest } from "../../ai/provider";
import { EXTRACT_REQUEST_LIMITS } from "../../ai/limits";
import type { AccessLevel } from "../../contracts/enums";
import { POINT_CATEGORIES } from "../../contracts/enums";
import { DbError } from "../../db/errors";
import {
  addSourceQuoteEvidence,
  insertExtractedPoint,
  listExtractionMessages,
  listPointsForPipeline,
  type ExtractionMessage,
} from "../../db/pipeline";
import type { CheckedCandidate } from "../ai";
import { mapAiFailure } from "../ai";
import { planChunks } from "../chunk";
import { PointIndex } from "../dedup";
import type { StageContext } from "../stage-context";
import { failed, type StageOutcome } from "../types";
import { callSignal, startAiStage } from "./ai-prelude";

export const EXTRACT_CALLS_PER_RUN = 200;
const MESSAGE_PAGE = 2000;
/** Stop starting new chunks this long before the drain deadline. */
export const EXTRACT_YIELD_MARGIN_MS = 45_000;

type LoadedMessages = { ok: true; accessLevel: AccessLevel; messages: ExtractionMessage[] } | { ok: false };

async function loadMessages(ctx: StageContext, sourceId: string): Promise<LoadedMessages> {
  const messages: ExtractionMessage[] = [];
  let accessLevel: AccessLevel | null = null;
  let afterSeq = -1;
  for (;;) {
    const page = await listExtractionMessages(ctx.db, { sourceId, afterSeq, limit: MESSAGE_PAGE });
    if (accessLevel === null) accessLevel = page.accessLevel;
    else if (page.accessLevel !== accessLevel) return { ok: false }; // the source's level changed mid-read
    if (page.messages.length === 0) break;
    messages.push(...page.messages);
    afterSeq = page.messages[page.messages.length - 1].seq;
    if (page.messages.length < MESSAGE_PAGE) break;
  }
  return accessLevel === null ? { ok: false } : { ok: true, accessLevel, messages };
}

interface Counters {
  inserted: number;
  merged: number;
  duplicatesWithoutEvidence: number;
  citations: number;
  citationsRejected: number;
  dropped: number;
}

async function storeCandidate(
  ctx: StageContext,
  candidate: CheckedCandidate,
  chunkMessageIds: ReadonlySet<string>,
  index: PointIndex,
  accessLevel: AccessLevel,
  provenance: Record<string, unknown>,
  counters: Counters,
): Promise<void> {
  const shape = { category: candidate.category, statement: candidate.statement, attributes: candidate.attributes as Record<string, unknown> };
  const citations = candidate.citations.filter((c) => chunkMessageIds.has(c.messageId)); // defence in depth (§10.6)
  let pointId = index.find(shape);

  if (pointId !== null) {
    if (citations.length === 0) {
      counters.duplicatesWithoutEvidence += 1;
      return;
    }
    counters.merged += 1;
  } else {
    pointId = await insertExtractedPoint(ctx.db, {
      handoverId: ctx.job.job.handoverId,
      runId: ctx.job.job.runId,
      category: candidate.category,
      title: candidate.title,
      statement: candidate.statement,
      attributes: candidate.attributes as Record<string, unknown>,
      inferenceRationale: candidate.inferenceRationale,
      extractionAccessLevel: accessLevel,
      aiProvenance: provenance,
    });
    index.add(pointId, shape);
    counters.inserted += 1;
  }

  for (const c of citations) {
    const located = c.quoteCheck !== "not_found" && c.matchedText !== null && c.quoteStart !== null && c.quoteEnd !== null;
    try {
      await addSourceQuoteEvidence(ctx.db, {
        pointId,
        sourceMessageId: c.messageId,
        quote: located ? (c.matchedText as string) : c.quote,
        quoteStart: located ? c.quoteStart : null,
        quoteEnd: located ? c.quoteEnd : null,
        quoteCheck: "pending",
      });
      counters.citations += 1;
    } catch (e) {
      // The message was erased meanwhile, or the database found the citation implausible: drop it.
      if (e instanceof DbError && (e.code === "not_found" || e.code === "validation_failed")) {
        counters.citationsRejected += 1;
        continue;
      }
      throw e;
    }
  }
}

export async function runExtract(ctx: StageContext): Promise<StageOutcome> {
  const sourceId = ctx.job.job.sourceId;
  if (!sourceId) return failed("internal", "internal");

  const prelude = await startAiStage(ctx, "extract");
  if (!prelude.ok) return { kind: "failed", failure: prelude.failure };

  const loaded = await loadMessages(ctx, sourceId);
  if (!loaded.ok) return failed("conflict", "source_changed", true);
  const { accessLevel } = loaded;

  const handover = { teamName: ctx.job.handover.teamName, roleTitle: ctx.job.handover.roleTitle };
  const plan = planChunks(loaded.messages, handover, EXTRACT_REQUEST_LIMITS);
  const total = plan.chunks.length;
  const budget = Math.floor(EXTRACT_CALLS_PER_RUN / Math.max(1, ctx.job.run.sourceIds.length));
  if (total > budget) {
    ctx.logger.warn("extract_budget_exceeded", { jobId: ctx.claimed.id, sourceId, chunks: total, budget });
    return failed("payload_too_large", "ai_budget_exceeded");
  }

  const start = Math.min(Math.max(0, ctx.job.job.progressDone ?? 0), total);
  const index = new PointIndex(await listPointsForPipeline(ctx.db, ctx.job.job.handoverId), accessLevel);
  const counters: Counters = { inserted: 0, merged: 0, duplicatesWithoutEvidence: 0, citations: 0, citationsRejected: 0, dropped: 0 };
  let lastAttempt: AiAttemptRecord | undefined;

  for (let i = start; i < total; i += 1) {
    if (i > start && ctx.now() > ctx.deadlineAt - EXTRACT_YIELD_MARGIN_MS) {
      log(ctx, sourceId, counters, i, total, plan);
      return { kind: "yield", progress: { done: i, total } };
    }
    const chunk = plan.chunks[i];
    const req: ExtractRequest = {
      handover,
      categories: POINT_CATEGORIES,
      messages: chunk.map((m) => ({ id: m.id, authorLabel: m.authorLabel, sentAt: m.sentAt, body: m.body })),
    };
    const result = await ctx.ai.extractCandidates(prelude.provider, req, {
      attempt: ctx.claimed.attempt,
      runConfig: prelude.runConfig,
      signal: callSignal(ctx),
    });
    if (!result.ok) {
      log(ctx, sourceId, counters, i, total, plan);
      return { kind: "failed", failure: mapAiFailure(result.error), progress: { done: i, total }, ...(result.attempt ? { attemptRecord: result.attempt } : {}) };
    }
    lastAttempt = result.data.attempt;
    counters.dropped += Object.values(result.data.dropped).reduce((a, b) => a + (Number.isFinite(b) ? b : 0), 0);
    const ids = new Set(chunk.map((m) => m.id));
    const provenance = { ...result.data.provenance };
    for (const candidate of result.data.candidates) {
      await storeCandidate(ctx, candidate, ids, index, accessLevel, provenance, counters);
    }
    await ctx.heartbeat({ done: i + 1, total });
  }

  log(ctx, sourceId, counters, total, total, plan);
  return { kind: "succeeded", progress: { done: total, total }, ...(lastAttempt ? { attemptRecord: lastAttempt } : {}) };
}

function log(ctx: StageContext, sourceId: string, c: Counters, done: number, total: number, plan: ReturnType<typeof planChunks>) {
  ctx.logger.info("extract_progress", {
    jobId: ctx.claimed.id,
    sourceId,
    chunksDone: done,
    chunks: total,
    inserted: c.inserted,
    merged: c.merged,
    duplicatesWithoutEvidence: c.duplicatesWithoutEvidence,
    citations: c.citations,
    citationsRejected: c.citationsRejected,
    dropped: c.dropped,
    skippedOversize: plan.skippedOversize,
    skippedEmpty: plan.skippedEmpty,
  });
}
