/**
 * Scheduled connector sync (Round 4 contract §2): pull new messages for PULL-based providers (Discord), then flush
 * every due link into its chat_import source. Counts only; never content. Used by POST /api/connectors/sync and,
 * per link, by the "Bring in new messages" action.
 */

import { flushDueLinks, type SourceWriter } from "./flush";
import { ingestEvent } from "./ingest";
import { ProviderError, type AdapterContext, type ProviderServerAdapter } from "./providers/adapter";
import { CONNECTOR_MESSAGE_LIMITS, CONNECTOR_PROVIDERS, type ChannelLinkRecord, type ConnectorMessage, type ConnectorProvider, type ConnectorStore } from "./types";

/** Pulls one capturing link once (no-op for push providers). Returns the number of messages buffered. */
/**
 * Pulled pages and history imports belong to ONE link: other links of the same channel have their own consent
 * (start time, history days) and their own cursor, so they must never receive these messages.
 */
export function onlyLink(linkId: string) {
  return (l: ChannelLinkRecord, m: ConnectorMessage[]) => (l.id === linkId ? m : []);
}

export async function pullLink(store: ConnectorStore, adapter: ProviderServerAdapter, ctx: AdapterContext, link: ChannelLinkRecord): Promise<number> {
  if (!adapter.pullNew || link.state !== "capturing") return 0;
  const inst = await store.getInstallation(link.installationId);
  if (!inst || inst.status !== "active") return 0;
  let page: Awaited<ReturnType<NonNullable<ProviderServerAdapter["pullNew"]>>>;
  try {
    page = await adapter.pullNew(ctx, inst, link, CONNECTOR_MESSAGE_LIMITS.messagesPerEvent);
  } catch (e) {
    // lost access to the channel: stop capturing (a person must resume); other errors retry next sweep
    if (e instanceof ProviderError && (e.code === "forbidden" || e.code === "not_found" || e.code === "unauthorized")) {
      await store.setLinkState({ kind: "system" }, link.id, "paused").catch(() => {});
      await store.recordFlushError(link.id, `provider_${e.code}`).catch(() => {});
    }
    return 0;
  }
  if (page.messages.length === 0) {
    if (page.cursor && page.cursor !== link.pullCursor) await store.setPullCursor(link.id, page.cursor);
    return 0;
  }
  const outcome = await ingestEvent(store, {
    provider: link.provider,
    deliveryId: `pull:${link.id}:${page.cursor ?? page.messages[page.messages.length - 1].providerMessageId}`,
    eventType: "pull",
    externalAccountId: inst.externalAccountId,
    externalChannelId: link.externalChannelId,
    messages: page.messages,
  }, undefined, { filter: onlyLink(link.id) });
  // advance the cursor only when the messages are safely buffered (or were already, as a duplicate)
  if ((outcome.status === "processed" || outcome.status === "duplicate") && page.cursor) await store.setPullCursor(link.id, page.cursor);
  return outcome.status === "processed" ? outcome.buffered : 0;
}

export interface SyncDeps {
  store: ConnectorStore;
  adapter(provider: ConnectorProvider): Promise<ProviderServerAdapter>;
  ctx: AdapterContext;
  writer: SourceWriter;
  /** Providers whose adapters are configured on this server. */
  enabled(provider: ConnectorProvider): boolean;
  now(): number;
}

export async function runConnectorSync(deps: SyncDeps, budget: { maxLinks: number; deadlineMs: number }) {
  const started = deps.now();
  const counts = { pulledLinks: 0, pulledMessages: 0, flushed: 0, refused: 0, nothing: 0, failed: 0 };
  for (const provider of CONNECTOR_PROVIDERS) {
    if (!deps.enabled(provider)) continue;
    let adapter: ProviderServerAdapter;
    try {
      adapter = await deps.adapter(provider);
    } catch {
      continue;
    }
    if (!adapter.pullNew) continue;
    const links = await deps.store.capturingLinksForProvider(provider, budget.maxLinks).catch(() => []);
    for (const link of links) {
      if (deps.now() - started > budget.deadlineMs / 2) break; // keep half the budget for flushing
      try {
        counts.pulledMessages += await pullLink(deps.store, adapter, deps.ctx, link);
        counts.pulledLinks += 1;
      } catch {
        counts.failed += 1;
      }
    }
  }
  const remaining = Math.max(0, budget.deadlineMs - (deps.now() - started));
  const f = await flushDueLinks(deps.store, deps.writer, { maxLinks: budget.maxLinks, deadlineMs: remaining }, deps.now);
  return { ...counts, flushed: f.flushed, refused: f.refused, nothing: f.nothing, failed: counts.failed + f.failed };
}
