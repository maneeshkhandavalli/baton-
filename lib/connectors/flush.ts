/**
 * Flush: buffered connector messages of one link → a `chat_import` source of its handover (Round 4 contract §5).
 *
 *  - First flush: a NEW source. Later flushes: a NEW VERSION of the link's source (Task 05 Living Handover), so
 *    change detection compares the new messages with the existing points and the creator reviews the changes.
 *    Each version holds only the messages since the previous flush (a delta), so buffered content can be deleted
 *    as soon as it is safely inside a confirmed upload.
 *  - Consent: capture consent (link) allowed the messages to be BUFFERED. Processing still needs the existing
 *    per-source consent of the creator (record_source_consent: AI provider, access level), exactly like an
 *    upload. A flush never records that consent.
 *  - Failure is safe: buffer rows are deleted only after the upload is confirmed (completeFlush). A refusal
 *    (handover published, an earlier update awaiting consent, source limits) keeps the messages buffered and is
 *    shown on the link as `lastFlushError`.
 */

import { CONNECTOR_MESSAGE_LIMITS, type ConnectorStore } from "./types";
import { serializeTranscript, transcriptFileName } from "./transcript";

/** Why a flush could not write a source now. Shown to the creator; the messages stay buffered. */
export const FLUSH_REFUSALS = [
  "handover_not_accepting_updates", // published/archived: reopen for review to bring new messages in
  "awaiting_consent", // the previous update from this channel still needs the creator's consent
  "update_in_progress", // a processing run or another update is in progress
  "source_removed", // the creator removed the channel's source; unlink or relink
  "source_limit", // 10 sources / 100 versions per handover
  "creator_changed", // the person who consented is no longer the creator
  "unchanged", // identical content (cannot happen with deltas; kept for completeness)
  "internal",
] as const;
export type FlushRefusal = (typeof FLUSH_REFUSALS)[number];

export interface SourceWriteInput {
  linkId: string;
  handoverId: string;
  previousSourceId: string | null;
  fileName: string;
  bytes: Uint8Array;
}

/** Implemented by lib/connectors/source-writer.ts (database + storage) and by test fakes. */
export interface SourceWriter {
  write(input: SourceWriteInput): Promise<{ ok: true; sourceId: string } | { ok: false; refusal: FlushRefusal }>;
}

export type FlushOutcome =
  | { status: "flushed"; sourceId: string; messages: number; remaining: boolean }
  | { status: "nothing_to_flush" }
  | { status: "refused"; refusal: FlushRefusal };

export async function flushLink(store: ConnectorStore, writer: SourceWriter, linkId: string): Promise<FlushOutcome> {
  const batch = await store.takeFlushBatch(linkId);
  if (!batch || batch.messages.length === 0) return { status: "nothing_to_flush" };
  const bytes = serializeTranscript(batch.provider, batch.channelLabel, batch.messages);
  let result: Awaited<ReturnType<SourceWriter["write"]>>;
  try {
    result = await writer.write({
      linkId,
      handoverId: batch.handoverId,
      previousSourceId: batch.sourceId,
      fileName: transcriptFileName(batch.provider, batch.channelLabel),
      bytes,
    });
  } catch {
    result = { ok: false, refusal: "internal" };
  }
  if (!result.ok) {
    await store.recordFlushError(linkId, result.refusal);
    return { status: "refused", refusal: result.refusal };
  }
  await store.completeFlush(linkId, batch.messages.map((m) => m.bufferId), result.sourceId);
  return { status: "flushed", sourceId: result.sourceId, messages: batch.messages.length, remaining: batch.messages.length >= CONNECTOR_MESSAGE_LIMITS.messagesPerFlush };
}

/** Scheduled sweep: flush every due link once, within a fixed budget. Never throws; counts only. */
export async function flushDueLinks(store: ConnectorStore, writer: SourceWriter, budget: { maxLinks: number; deadlineMs: number }, now: () => number = Date.now) {
  const started = now();
  const counts = { flushed: 0, refused: 0, nothing: 0, failed: 0 };
  let ids: string[];
  try {
    ids = await store.linksDueForFlush(budget.maxLinks);
  } catch {
    return { ...counts, failed: 1 };
  }
  for (const id of ids) {
    if (now() - started > budget.deadlineMs) break;
    try {
      const r = await flushLink(store, writer, id);
      if (r.status === "flushed") counts.flushed += 1;
      else if (r.status === "refused") counts.refused += 1;
      else counts.nothing += 1;
    } catch {
      counts.failed += 1;
    }
  }
  return counts;
}
