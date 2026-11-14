/**
 * `extract` job (§10.6, §12.10, W0 decisions I2.3–I2.5, I2.8). One job per source; DB-1 runs extract
 * jobs of a run one at a time, so cross-source dedup has no race.
 *
 * 1. Provider for the run snapshot; provenance written before the first call (§11.8 rule 3).
 * 2. The source's persisted, masked text messages only (never raw uploads), chunked deterministically by
 *    conversation within `EXTRACT_REQUEST_LIMITS`. One source = one access level (QA-M8), and that level
 *    becomes every new point's `extraction_access_level`.
 * 3. Per-run budget (≤ 200 extract calls): this source may use its share, `floor(200 / sources)`.
 * 4. Per chunk: `extractCandidates`; each candidate either attaches to a matching point (dedup.ts) or
 *    becomes a new point. Citations are stored with `quote_check = 'pending'` (verify_quotes decides):
 *    `matchedText` with its offsets for exact/normalized, the model's quote without offsets for not_found.
 * 5. DB-13: the whole chunk (new points, their evidence and the checkpoint `progress_done = i + 1`) is
 *    written by ONE fenced call, `storeExtractChunk`, in one transaction. A crash never leaves a point
 *    without its evidence or evidence without its point, and a retry resumes after the last committed
 *    chunk without repeating it. A new point whose citations were all rejected is not stored unless it is
 *    an inferred claim (it carries an inference rationale). Near the deadline the job yields.
 * 6. DB-12: every write carries this claim (job id + attempt); a stale claim throws ClaimLostError and
 *    the runner drops the job without recording anything.
 */

import type { AiAttemptRecord, ExtractRequest } from "../../ai/provider";
import { EXTRACT_REQUEST_LIMITS } from "../../ai/limits";
import type { AccessLevel } from "../../contracts/enums";
import { POINT_CATEGORIES } from "../../contracts/enums";
import { DbError } from "../../db/errors";
import {
  listExtractionMessages,
  listPointsForPipeline,
  storeExtractChunk,
  type ExtractChunkCitation,
  type ExtractChunkEntry,
  type ExtractionMessage,
} from "../../db/pipeline";
import type { CheckedCandidate } from "../ai";
import { mapAiFailure } from "../ai";
import { planChunks } from "../chunk";
import { PointIndex, type ClaimShape } from "../dedup";
import { claimOf, type StageContext } from "../stage-context";
import { failed, failure, type StageOutcome } from "../types";
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
  /** New claims not stored because every citation was rejected and they carry no inference rationale. */
  unsupported: number;
  dropped: number;
}

/** Local id of a point created earlier in the SAME chunk (resolved after the chunk commits). */
const LOCAL = "local:";

function toCitation(c: CheckedCandidate["citations"][number]): ExtractChunkCitation {
  const located = c.quoteCheck !== "not_found" && c.matchedText !== null && c.quoteStart !== null && c.quoteEnd !== null;
  return {
    messageId: c.messageId,
    quote: located ? (c.matchedText as string) : c.quote,
    quoteStart: located ? c.quoteStart : null,
    quoteEnd: located ? c.quoteEnd : null,
  };
}

/**
 * Builds one chunk's entries in candidate order, deduplicating against existing points AND against new
 * points earlier in the same chunk (they share one entry). Returns the shapes of new entries so the index
 * can learn their real ids after the commit.
 */
export function planChunkEntries(
  candidates: readonly CheckedCandidate[],
  chunkMessageIds: ReadonlySet<string>,
  index: PointIndex,
  counters: Pick<Counters, "merged" | "duplicatesWithoutEvidence">,
): { entries: ExtractChunkEntry[]; newShapes: Map<number, ClaimShape> } {
  const entries: ExtractChunkEntry[] = [];
  const newShapes = new Map<number, ClaimShape>();
  const local = new PointIndex([], "everyone"); // shapes of this chunk's new points → LOCAL + entry index
  for (const candidate of candidates) {
    const shape: ClaimShape = { category: candidate.category, statement: candidate.statement, attributes: candidate.attributes as Record<string, unknown> };
    const citations = candidate.citations.filter((c) => chunkMessageIds.has(c.messageId)).map(toCitation); // defence in depth (§10.6)
    const target = index.find(shape) ?? local.find(shape);
    if (target !== null) {
      if (citations.length === 0) {
        counters.duplicatesWithoutEvidence += 1;
        continue;
      }
      counters.merged += 1;
      if (target.startsWith(LOCAL)) entries[Number(target.slice(LOCAL.length))].citations.push(...citations);
      else entries.push({ pointId: target, citations });
      continue;
    }
    newShapes.set(entries.length, shape);
    local.add(`${LOCAL}${entries.length}`, shape);
    entries.push({
      point: {
        category: candidate.category,
        title: candidate.title,
        statement: candidate.statement,
        attributes: candidate.attributes as Record<string, unknown>,
        inferenceRationale: candidate.inferenceRationale,
      },
      citations,
    });
  }
  return { entries, newShapes };
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
  let index = new PointIndex(await listPointsForPipeline(ctx.db, ctx.job.job.handoverId), accessLevel);
  const counters: Counters = { inserted: 0, merged: 0, duplicatesWithoutEvidence: 0, citations: 0, citationsRejected: 0, unsupported: 0, dropped: 0 };
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
    const { entries, newShapes } = planChunkEntries(result.data.candidates, ids, index, counters);
    let stored: Awaited<ReturnType<typeof storeExtractChunk>>;
    try {
      stored = await storeExtractChunk(ctx.db, claimOf(ctx), {
        chunkIndex: i,
        chunkTotal: total,
        accessLevel,
        aiProvenance: { ...result.data.provenance },
        entries,
      });
    } catch (e) {
      // The source's access level changed (or it was removed) since its messages were read.
      if (e instanceof DbError && e.code === "conflict" && !e.retryable) {
        log(ctx, sourceId, counters, i, total, plan);
        return { kind: "failed", failure: failure("conflict", "source_changed", true), progress: { done: i, total }, ...(lastAttempt ? { attemptRecord: lastAttempt } : {}) };
      }
      throw e;
    }
    if (stored.alreadyCommitted) {
      // Committed by an earlier delivery of this same call: re-read the points so dedup sees them.
      index = new PointIndex(await listPointsForPipeline(ctx.db, ctx.job.job.handoverId), accessLevel);
    } else {
      stored.entries.forEach((r, k) => {
        counters.citations += r.citations;
        counters.citationsRejected += r.rejected;
        const shape = newShapes.get(k);
        if (!shape) return;
        if (r.inserted && r.pointId) {
          counters.inserted += 1;
          index.add(r.pointId, shape);
        } else {
          counters.unsupported += 1;
        }
      });
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
    unsupported: c.unsupported,
    dropped: c.dropped,
    skippedOversize: plan.skippedOversize,
    skippedEmpty: plan.skippedEmpty,
  });
}
