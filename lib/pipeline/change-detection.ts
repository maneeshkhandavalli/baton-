/**
 * Change detection in the `analyze` job (R3 Task 05D). For every source update the run is processing:
 * load the previous version's retained evidence and the new version's messages, run the pure detector
 * (lib/signals/change-detection.ts), and record the items with ONE fenced, atomic call per update.
 *
 * - Deterministic and provider-independent: a retry or a reclaimed job computes the same items, and the database
 *   ignores duplicates (unique per update and dedupe key), so a lost lease never duplicates or half-writes them.
 * - A stale worker (lease lost, run closed, update superseded) gets ClaimLostError from the database and stops.
 * - An update whose new version could not be parsed has nothing to compare: it is skipped; the run-close trigger
 *   then records the extraction failure, never "ready".
 * - A database without migration 20261118500100 (PipelineSchemaError) skips detection, logged once.
 * Nothing here logs message text, quotes or names: only ids and counts.
 */

import { DbError } from "../db/errors";
import {
  listChangeDetectionInput,
  listExtractionMessages,
  PipelineSchemaError,
  recordChangeDetection,
  type ChangeDetectionChange,
  type PipelinePoint,
} from "../db/pipeline";
import { CHANGE_DETECTOR_VERSION, detectChanges, sourceFamily, type NewMessage } from "../signals/change-detection";
import { claimOf, type StageContext } from "./stage-context";

const MESSAGE_PAGE = 2000;

export interface ChangeDetectionSummary {
  updates: number;
  recorded: number;
  skipped: number;
  items: number;
  inserted: number;
}

async function loadVersionMessages(ctx: StageContext, change: ChangeDetectionChange): Promise<NewMessage[] | null> {
  const out: NewMessage[] = [];
  let afterSeq = -1;
  for (;;) {
    let page: Awaited<ReturnType<typeof listExtractionMessages>>;
    try {
      page = await listExtractionMessages(ctx.db, { sourceId: change.toSourceId, afterSeq, limit: MESSAGE_PAGE });
    } catch (e) {
      if (e instanceof DbError && (e.code === "invalid_transition" || e.code === "not_found")) return null; // not parsed / gone
      throw e;
    }
    const rows = page?.messages ?? [];
    for (const m of rows) {
      out.push({ id: m.id, seq: m.seq, sentAt: m.sentAt, authorLabel: m.authorLabel, body: m.body, heading: change.headings[m.id] ?? null });
    }
    if (rows.length < MESSAGE_PAGE) break;
    afterSeq = rows[rows.length - 1].seq;
    await ctx.heartbeat();
  }
  return out;
}

export async function runChangeDetection(ctx: StageContext, points: readonly PipelinePoint[]): Promise<ChangeDetectionSummary> {
  const summary: ChangeDetectionSummary = { updates: 0, recorded: 0, skipped: 0, items: 0, inserted: 0 };
  let input: Awaited<ReturnType<typeof listChangeDetectionInput>>;
  try {
    input = await listChangeDetectionInput(ctx.db, ctx.job.job.runId);
  } catch (e) {
    if (!(e instanceof PipelineSchemaError)) throw e;
    ctx.logger.warn("change_detection_unavailable", { jobId: ctx.claimed.id, fn: e.fn });
    return summary;
  }
  summary.updates = input.changes.length;
  for (const change of input.changes) {
    const messages = change.toSourceState === "parsed" ? await loadVersionMessages(ctx, change) : null;
    if (messages === null) {
      summary.skipped += 1;
      ctx.logger.info("change_detection_skipped", { jobId: ctx.claimed.id, changeId: change.changeId, reason: "version_not_parsed" });
      continue;
    }
    const result = detectChanges({
      family: sourceFamily(change.sourceKind),
      watermark: change.fromLastMessageAt,
      basePublicationId: change.basePublicationId,
      basePoints: change.basePoints,
      oldEvidence: change.oldEvidence,
      newMessages: messages,
      newLinks: change.newLinks,
      points,
      anchors: input.anchors,
    });
    const recorded = await recordChangeDetection(ctx.db, claimOf(ctx), {
      changeId: change.changeId,
      detectorVersion: CHANGE_DETECTOR_VERSION,
      items: result.items,
      counts: result.counts,
    });
    summary.recorded += 1;
    summary.items += recorded.items;
    summary.inserted += recorded.inserted;
    ctx.logger.info("change_detection_done", { jobId: ctx.claimed.id, changeId: change.changeId, ...result.counts, inserted: recorded.inserted });
    await ctx.heartbeat();
  }
  return summary;
}
