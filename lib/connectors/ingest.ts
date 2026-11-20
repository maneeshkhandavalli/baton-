/**
 * Shared event ingestion (Round 4 connector contract §4). Every provider webhook route does:
 *
 *   1. verify the request signature with the raw body (adapter; reject 401 before parsing JSON),
 *   2. parse into a NormalizedEvent (adapter; unknown events → messages: [] and eventType kept),
 *   3. `ingestEvent(store, event)` (this file), and answer the provider quickly (2xx unless `failed`).
 *
 * Guarantees: de-duplication by (provider, deliveryId); nothing is stored unless a link of that exact channel is
 * `capturing` (explicit creator consent); lifecycle signals (uninstall, token revoked) are applied first; content is
 * never logged. A `failed` outcome means the provider should retry (respond 5xx); everything else is final (2xx).
 */

import {
  type ChannelLinkRecord,
  CONNECTOR_MESSAGE_KINDS,
  CONNECTOR_MESSAGE_LIMITS,
  type ConnectorMessage,
  type ConnectorStore,
  type EventOutcome,
  type NormalizedEvent,
} from "./types";
import { ConnectorStoreError } from "./errors";

export interface IngestLogger {
  info(event: string, fields: Record<string, string | number | boolean | null>): void;
  warn(event: string, fields: Record<string, string | number | boolean | null>): void;
}

const silent: IngestLogger = { info() {}, warn() {} };

const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,9})?(Z|[+-]\d{2}:\d{2})$/;

/** Trims and validates adapter output; drops what cannot be a message. Pure. */
export function sanitizeMessages(messages: readonly ConnectorMessage[]): ConnectorMessage[] {
  const L = CONNECTOR_MESSAGE_LIMITS;
  const out: ConnectorMessage[] = [];
  for (const m of messages.slice(0, L.messagesPerEvent)) {
    if (!m || typeof m.providerMessageId !== "string" || m.providerMessageId.length === 0) continue;
    if (m.providerMessageId.length > L.providerMessageIdChars) continue;
    if (typeof m.sentAt !== "string" || !ISO_RE.test(m.sentAt) || Number.isNaN(Date.parse(m.sentAt))) continue;
    if (!(CONNECTOR_MESSAGE_KINDS as readonly string[]).includes(m.kind)) continue;
    const text = typeof m.text === "string" ? stripControl(m.text).slice(0, L.textChars) : "";
    const authorLabel = typeof m.authorLabel === "string" ? stripControl(m.authorLabel).replace(/\s+/g, " ").trim().slice(0, L.authorLabelChars) : "";
    if (m.kind === "text" && text.trim() === "") continue;
    if (m.kind !== "system" && authorLabel === "") continue;
    out.push({
      providerMessageId: m.providerMessageId,
      sentAt: new Date(m.sentAt).toISOString(),
      authorLabel,
      kind: m.kind,
      text: m.kind === "media_omitted" || m.kind === "deleted" ? "" : text,
      replyToId: typeof m.replyToId === "string" && m.replyToId.length <= L.providerMessageIdChars ? m.replyToId : null,
      // A deletion is a privacy tombstone: it carries no edit time, so the capture-window check uses only the original
      // send time and a deletion is never refused because of an earlier edit made in another window or a pause.
      editedAt: m.kind !== "deleted" && typeof m.editedAt === "string" && ISO_RE.test(m.editedAt) ? new Date(m.editedAt).toISOString() : null,
    });
  }
  return out;
}

/** Removes C0/C1 control characters except tab and newline (they break the line-based transcript). */
function stripControl(s: string): string {
  return s.replace(/\r\n?/g, "\n").replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u2028\u2029]/g, "");
}

export interface IngestOptions {
  /**
   * Per-link selection (contract change requested by Worker 02): which of the event's messages ONE capturing link
   * keeps, from that link's own settings (e.g. GitHub event families). A link that keeps nothing is skipped.
   */
  filter?: (link: ChannelLinkRecord, messages: ConnectorMessage[]) => ConnectorMessage[];
}

export async function ingestEvent(store: ConnectorStore, event: NormalizedEvent, logger: IngestLogger = silent, options: IngestOptions = {}): Promise<EventOutcome> {
  const base = { provider: event.provider, eventType: event.eventType };
  let receipt;
  try {
    receipt = await store.recordEvent({
      provider: event.provider,
      deliveryId: event.deliveryId,
      externalAccountId: event.externalAccountId,
      eventType: event.eventType,
    });
  } catch {
    logger.warn("connector_event_ledger_unavailable", base);
    return { status: "failed", code: "store_unavailable" };
  }
  if (!receipt.process) {
    logger.info("connector_event_duplicate", { ...base, attempts: receipt.attempts });
    return { status: "duplicate" };
  }

  try {
    const outcome = await route(store, event, options);
    if (outcome.status === "processed") await store.finishEvent(receipt.eventId, { status: "processed" });
    else if (outcome.status === "ignored") await store.finishEvent(receipt.eventId, { status: "ignored", reason: outcome.reason });
    else if (outcome.status === "failed") await store.finishEvent(receipt.eventId, { status: "failed", code: outcome.code });
    logger.info("connector_event", { ...base, status: outcome.status, ...(outcome.status === "processed" ? { buffered: outcome.buffered, links: outcome.links } : {}), ...(outcome.status === "ignored" ? { reason: outcome.reason } : {}) });
    return outcome;
  } catch {
    // The ledger row stays `received`/marked failed so the provider's retry (or the reclaim window) reprocesses it.
    await store.finishEvent(receipt.eventId, { status: "failed", code: "internal" }).catch(() => {});
    logger.warn("connector_event_failed", { ...base, code: "internal" });
    return { status: "failed", code: "internal" };
  }
}

async function route(store: ConnectorStore, event: NormalizedEvent, options: IngestOptions): Promise<EventOutcome> {
  if (event.externalAccountId === null) return { status: "ignored", reason: "unsupported_event" };
  const installation = await store.findInstallation(event.provider, event.externalAccountId);
  if (!installation) return { status: "ignored", reason: "no_installation" };

  if (event.lifecycle) {
    const actor = { kind: "provider" } as const;
    switch (event.lifecycle.kind) {
      case "uninstalled":
      case "token_revoked":
        await store.revokeInstallation(actor, installation.id, event.lifecycle.reason);
        break;
      case "suspended":
        if (installation.status !== "revoked") await store.setInstallationStatus(actor, installation.id, "suspended", event.lifecycle.reason);
        break;
      case "unsuspended":
        if (installation.status === "suspended") await store.setInstallationStatus(actor, installation.id, "active", null);
        break;
      case "channel_removed":
        if (event.externalChannelId) {
          for (const link of await store.capturingLinks(event.provider, event.externalAccountId, event.externalChannelId)) {
            await store.setLinkState(actor, link.id, "paused");
          }
        }
        break;
    }
    return { status: "processed", buffered: 0, links: 0 };
  }

  if (installation.status !== "active") return { status: "ignored", reason: "installation_inactive" };
  if (event.externalChannelId === null) return { status: "ignored", reason: "unsupported_event" };
  const messages = sanitizeMessages(event.messages);
  if (messages.length === 0) return { status: "ignored", reason: event.messages.length === 0 ? "unsupported_event" : "empty" };

  const links = await store.capturingLinks(event.provider, event.externalAccountId, event.externalChannelId);
  if (links.length === 0) return { status: "ignored", reason: "no_capturing_link" };

  let buffered = 0;
  let accepted = 0;
  let filteredOut = 0;
  let outsideWindow = 0;
  let full = 0;
  for (const link of links) {
    const selected = options.filter ? options.filter(link, messages) : messages;
    if (selected.length === 0) {
      filteredOut += 1;
      continue;
    }
    // PR #7 review, finding 4: the per-link limit (CONNECTOR_MESSAGE_LIMITS.bufferedPerLink) is enforced by the store,
    // atomically and only for NEW messages (an edit of an already-buffered message is always applied). A full link is
    // skipped, never the whole fan-out: every other link of this channel still receives the event.
    let r: Awaited<ReturnType<ConnectorStore["bufferMessages"]>>;
    try {
      r = await store.bufferMessages(link.id, selected);
    } catch (e) {
      if (e instanceof ConnectorStoreError && e.code === "precondition_failed") {
        full += 1;
        continue;
      }
      throw e;
    }
    if (r.refused) continue;
    if (r.inserted + r.updated === 0 && r.outsideWindow > 0) {
      outsideWindow += 1; // nothing authorised for this link (sent or edited outside its capture windows)
      continue;
    }
    accepted += 1;
    buffered += r.inserted + r.updated;
  }
  // Any full link: the delivery is incomplete, so report it as failed (HTTP 503) and let the provider retry. The ledger
  // reprocesses a failed delivery, and buffering upserts by provider message id, so links that already took the
  // messages are unchanged by the retry (no duplicates); pull-based sync keeps its cursor until the event succeeds.
  if (full > 0) return { status: "failed", code: "buffer_full" };
  if (accepted === 0) {
    if (outsideWindow > 0) return { status: "ignored", reason: "outside_capture_window" };
    return { status: "ignored", reason: filteredOut === links.length ? "unsupported_event" : "no_capturing_link" };
  }
  return { status: "processed", buffered, links: accepted };
}

/** HTTP status a webhook route should answer for an outcome (providers retry on 5xx). */
export function httpStatusFor(outcome: EventOutcome): number {
  // buffer_full is retryable too (PR #7 review, finding 4): a link's buffer frees up at its next flush.
  return outcome.status === "failed" ? 503 : 200;
}

// ── history imports (consent-time) ───────────────────────────────────────────

/**
 * Splits an ordered message list into consecutive batches of at most `size` (default: the 100-message event
 * contract), keeping the order. Pure.
 */
export function historyBatches<T>(messages: readonly T[], size: number = CONNECTOR_MESSAGE_LIMITS.messagesPerEvent): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < messages.length; i += size) out.push(messages.slice(i, i + size));
  return out;
}

/** Deterministic, distinct delivery id of history batch `index` (zero-padded so ids sort in batch order). */
export const historyDeliveryId = (prefix: string, index: number): string => `${prefix}:${String(index).padStart(3, "0")}`;

export interface HistoryImportResult {
  /** Batches sent through ingestEvent (0 when there was nothing to import). */
  batches: number;
  /** Messages buffered (inserted or updated) across processed batches. */
  buffered: number;
  /** Batches that failed (after one immediate retry); empty when the whole import is safely buffered. */
  failed: Array<{ index: number; deliveryId: string; code: string }>;
}

/**
 * PR #7 second review, fix 1: a consent-time history import may hold up to messagesPerFlush (5,000) messages, but an
 * event carries at most messagesPerEvent (100) — sanitizeMessages drops the rest. So history goes through the ORDINARY
 * ingest path in ordered batches of ≤ 100, each with its own deterministic delivery id (ledger de-duplication, capture
 * windows, sanitising and per-link filtering all apply unchanged). Every outcome is checked:
 *  - processed / duplicate (already done) / ignored (e.g. nothing in the batch was inside the capture window, or it
 *    sanitised to nothing) → done; ignoring is a final, truthful outcome, never a failure;
 *  - failed → retried once immediately (the ledger reclaims a failed delivery; buffering upserts by provider message
 *    id, so a retry never duplicates); still failing → reported in `failed`, and the caller must surface it.
 * Messages beyond messagesPerFlush are not imported (the documented upper limit; adapters already cap their fetch).
 */
export async function ingestHistory(
  store: ConnectorStore,
  base: Pick<NormalizedEvent, "provider" | "externalAccountId" | "externalChannelId"> & { deliveryPrefix: string },
  messages: readonly ConnectorMessage[],
  logger: IngestLogger = silent,
  options: IngestOptions = {},
): Promise<HistoryImportResult> {
  const batches = historyBatches(messages.slice(0, CONNECTOR_MESSAGE_LIMITS.messagesPerFlush));
  const result: HistoryImportResult = { batches: batches.length, buffered: 0, failed: [] };
  for (const [index, batch] of batches.entries()) {
    const deliveryId = historyDeliveryId(base.deliveryPrefix, index);
    const event: NormalizedEvent = {
      provider: base.provider, deliveryId, eventType: "history_import",
      externalAccountId: base.externalAccountId, externalChannelId: base.externalChannelId, messages: batch,
    };
    let outcome = await ingestEvent(store, event, logger, options);
    if (outcome.status === "failed") outcome = await ingestEvent(store, event, logger, options);
    if (outcome.status === "processed") result.buffered += outcome.buffered;
    else if (outcome.status === "failed") result.failed.push({ index, deliveryId, code: outcome.code });
  }
  return result;
}
