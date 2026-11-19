/**
 * In-memory ConnectorStore for unit and integration tests (no database). It enforces the SAME rules as the SQL
 * functions in supabase/migrations/20261119800200_connectors.sql, so adapter tests exercise real behaviour:
 * creator-only linking and consent, capture only while `capturing`, de-duplication and the retry/reclaim rules
 * of the event ledger, revocation purging buffered content, and the per-link buffer bound.
 *
 * Not for production use. Lives under lib/ so tests of every worker can import it.
 */

import { ConnectorStoreError } from "./errors";
import {
  CONNECTOR_MESSAGE_LIMITS,
  type BufferResult,
  type ChannelLinkRecord,
  type ConnectorActor,
  type ConnectorMessage,
  type ConnectorProvider,
  type ConnectorStore,
  type EventReceipt,
  type EventStatus,
  type FlushBatch,
  type InstallationRecord,
  type InstallationStatus,
  type LinkChannelInput,
  type UpsertInstallationInput,
} from "./types";

/** A `received` delivery older than this is considered abandoned (crashed handler) and may be processed again. */
export const EVENT_RECLAIM_MS = 5 * 60 * 1000;

export interface MemoryHandover {
  id: string;
  creatorProfileId: string;
  /** "draft" | "in_review" | "published" | "archived" … only used by the source writer fake. */
  state: string;
}

interface EventRow {
  id: string;
  provider: ConnectorProvider;
  deliveryId: string;
  status: EventStatus;
  attempts: number;
  receivedAt: number;
  detail: string | null;
}

interface BufferRow extends ConnectorMessage {
  bufferId: string;
  linkId: string;
  seq: number;
}

export interface MemoryAuditRow {
  action: string;
  actor: string;
  entityId: string;
  handoverId: string | null;
}

export class MemoryConnectorStore implements ConnectorStore {
  readonly handovers = new Map<string, MemoryHandover>();
  readonly events: EventRow[] = [];
  readonly audit: MemoryAuditRow[] = [];
  private readonly installations = new Map<string, InstallationRecord & { credentials: string | null }>();
  private readonly links = new Map<string, ChannelLinkRecord>();
  private readonly buffer: BufferRow[] = [];
  private seq = 0;
  private ids = 0;

  private readonly now: () => number;
  constructor(now: () => number = Date.now) {
    this.now = now;
  }

  private id(prefix: string): string {
    this.ids += 1;
    // uuid-shaped so code that validates ids accepts them
    return `00000000-0000-4000-8000-${(prefix.charCodeAt(0) * 1_000_000 + this.ids).toString(16).padStart(12, "0")}`;
  }

  private iso(): string {
    return new Date(this.now()).toISOString();
  }

  private actorKey(actor: ConnectorActor): string {
    return actor.kind === "user" ? `user:${actor.profileId}` : actor.kind;
  }

  private requireCreator(actor: ConnectorActor, handoverId: string): void {
    const h = this.handovers.get(handoverId);
    if (!h) throw new ConnectorStoreError("not_found");
    if (actor.kind !== "user" || actor.profileId !== h.creatorProfileId) throw new ConnectorStoreError("forbidden");
  }

  // ── events ──
  async recordEvent(input: { provider: ConnectorProvider; deliveryId: string; externalAccountId: string | null; eventType: string }): Promise<EventReceipt> {
    if (!input.deliveryId || input.deliveryId.length > 200) throw new ConnectorStoreError("validation_failed");
    const existing = this.events.find((e) => e.provider === input.provider && e.deliveryId === input.deliveryId);
    if (!existing) {
      const row: EventRow = { id: this.id("e"), provider: input.provider, deliveryId: input.deliveryId, status: "received", attempts: 1, receivedAt: this.now(), detail: null };
      this.events.push(row);
      return { eventId: row.id, process: true, previousStatus: null, attempts: 1 };
    }
    const previousStatus = existing.status;
    const reclaim = existing.status === "failed" || (existing.status === "received" && this.now() - existing.receivedAt > EVENT_RECLAIM_MS);
    if (reclaim) {
      existing.status = "received";
      existing.attempts += 1;
      existing.receivedAt = this.now();
    }
    return { eventId: existing.id, process: reclaim, previousStatus, attempts: existing.attempts };
  }

  async finishEvent(eventId: string, outcome: Parameters<ConnectorStore["finishEvent"]>[1]): Promise<void> {
    const e = this.events.find((x) => x.id === eventId);
    if (!e) throw new ConnectorStoreError("not_found");
    e.status = outcome.status;
    e.detail = outcome.status === "ignored" ? outcome.reason : outcome.status === "failed" ? outcome.code : null;
  }

  // ── installations ──
  async upsertInstallation(actor: ConnectorActor, input: UpsertInstallationInput): Promise<InstallationRecord> {
    if (actor.kind !== "user") throw new ConnectorStoreError("forbidden");
    let row = [...this.installations.values()].find((i) => i.provider === input.provider && i.externalAccountId === input.externalAccountId && i.status !== "revoked");
    if (row) {
      Object.assign(row, { accountLabel: input.accountLabel, scopes: [...input.scopes], credentials: input.credentials ?? row.credentials, hasCredentials: (input.credentials ?? row.credentials) !== null, status: "active", statusReason: null, updatedAt: this.iso() });
      this.audit.push({ action: "connector.installation_updated", actor: this.actorKey(actor), entityId: row.id, handoverId: null });
    } else {
      row = {
        id: this.id("i"), provider: input.provider, externalAccountId: input.externalAccountId, accountLabel: input.accountLabel,
        status: "active", statusReason: null, installedByProfileId: actor.profileId, scopes: [...input.scopes],
        hasCredentials: input.credentials !== null, credentials: input.credentials, createdAt: this.iso(), updatedAt: this.iso(),
      };
      this.installations.set(row.id, row);
      this.audit.push({ action: "connector.installed", actor: this.actorKey(actor), entityId: row.id, handoverId: null });
    }
    return this.publicInstallation(row);
  }

  private publicInstallation(row: InstallationRecord & { credentials: string | null }): InstallationRecord {
    const { credentials: _c, ...rest } = row;
    void _c;
    return { ...rest, scopes: [...rest.scopes] };
  }

  async findInstallation(provider: ConnectorProvider, externalAccountId: string): Promise<InstallationRecord | null> {
    const all = [...this.installations.values()].filter((i) => i.provider === provider && i.externalAccountId === externalAccountId);
    const live = all.find((i) => i.status !== "revoked") ?? all[all.length - 1];
    return live ? this.publicInstallation(live) : null;
  }

  async getInstallation(installationId: string): Promise<InstallationRecord | null> {
    const row = this.installations.get(installationId);
    return row ? this.publicInstallation(row) : null;
  }

  async getInstallationCredentials(installationId: string): Promise<string | null> {
    const row = this.installations.get(installationId);
    return row && row.status !== "revoked" ? row.credentials : null;
  }

  async setInstallationStatus(actor: ConnectorActor, installationId: string, status: Exclude<InstallationStatus, "revoked">, reason: string | null): Promise<void> {
    const row = this.installations.get(installationId);
    if (!row) throw new ConnectorStoreError("not_found");
    if (row.status === "revoked") throw new ConnectorStoreError("invalid_transition");
    if (actor.kind === "user" && actor.profileId !== row.installedByProfileId) throw new ConnectorStoreError("forbidden");
    Object.assign(row, { status, statusReason: reason, updatedAt: this.iso() });
    this.audit.push({ action: `connector.installation_${status}`, actor: this.actorKey(actor), entityId: row.id, handoverId: null });
  }

  async revokeInstallation(actor: ConnectorActor, installationId: string, reason: string): Promise<void> {
    const row = this.installations.get(installationId);
    if (!row) throw new ConnectorStoreError("not_found");
    if (actor.kind === "user" && actor.profileId !== row.installedByProfileId) throw new ConnectorStoreError("forbidden");
    if (row.status === "revoked") return;
    Object.assign(row, { status: "revoked", statusReason: reason, credentials: null, hasCredentials: false, updatedAt: this.iso() });
    for (const link of this.links.values()) {
      if (link.installationId === installationId && link.state !== "revoked") this.revokeLinkRow(link, actor);
    }
    this.audit.push({ action: "connector.installation_revoked", actor: this.actorKey(actor), entityId: row.id, handoverId: null });
  }

  // ── links ──
  async linkChannel(actor: ConnectorActor, input: LinkChannelInput): Promise<ChannelLinkRecord> {
    this.requireCreator(actor, input.handoverId);
    const inst = this.installations.get(input.installationId);
    if (!inst) throw new ConnectorStoreError("not_found");
    if (inst.status !== "active") throw new ConnectorStoreError("invalid_transition");
    if (actor.kind !== "user" || inst.installedByProfileId !== actor.profileId) throw new ConnectorStoreError("forbidden");
    const existing = [...this.links.values()].find(
      (l) => l.installationId === input.installationId && l.externalChannelId === input.externalChannelId && l.handoverId === input.handoverId && l.state !== "revoked",
    );
    if (existing) return { ...existing };
    const link: ChannelLinkRecord = {
      id: this.id("l"), installationId: inst.id, provider: inst.provider, handoverId: input.handoverId, externalChannelId: input.externalChannelId,
      channelLabel: input.channelLabel, state: "pending_consent", settings: { ...(input.settings ?? {}) }, consentVersion: null, consentedAt: null,
      consentedByProfileId: null, sourceId: null, bufferedCount: 0, lastEventAt: null, lastFlushAt: null, lastFlushError: null, pullCursor: null, createdAt: this.iso(), updatedAt: this.iso(),
    };
    this.links.set(link.id, link);
    this.audit.push({ action: "connector.channel_linked", actor: this.actorKey(actor), entityId: link.id, handoverId: link.handoverId });
    return { ...link };
  }

  private requireLink(linkId: string): ChannelLinkRecord {
    const l = this.links.get(linkId);
    if (!l) throw new ConnectorStoreError("not_found");
    return l;
  }

  async recordCaptureConsent(actor: ConnectorActor, linkId: string, consentVersion: string): Promise<ChannelLinkRecord> {
    const l = this.requireLink(linkId);
    this.requireCreator(actor, l.handoverId);
    if (l.state === "revoked") throw new ConnectorStoreError("invalid_transition");
    if (!consentVersion) throw new ConnectorStoreError("validation_failed");
    const inst = this.installations.get(l.installationId);
    if (!inst || inst.status !== "active") throw new ConnectorStoreError("invalid_transition");
    Object.assign(l, { state: "capturing", consentVersion, consentedAt: this.iso(), consentedByProfileId: (actor as { profileId: string }).profileId, updatedAt: this.iso() });
    this.audit.push({ action: "connector.capture_consented", actor: this.actorKey(actor), entityId: l.id, handoverId: l.handoverId });
    return { ...l };
  }

  async setLinkState(actor: ConnectorActor, linkId: string, state: "capturing" | "paused"): Promise<ChannelLinkRecord> {
    const l = this.requireLink(linkId);
    if (actor.kind === "user") this.requireCreator(actor, l.handoverId);
    if (l.state === "revoked") throw new ConnectorStoreError("invalid_transition");
    if (state === "capturing") {
      if (actor.kind !== "user") throw new ConnectorStoreError("forbidden"); // only a person resumes capture
      if (l.consentVersion === null) throw new ConnectorStoreError("invalid_transition"); // resume needs prior consent
    }
    if (l.state !== state) {
      Object.assign(l, { state, updatedAt: this.iso() });
      this.audit.push({ action: `connector.capture_${state === "paused" ? "paused" : "resumed"}`, actor: this.actorKey(actor), entityId: l.id, handoverId: l.handoverId });
    }
    return { ...l };
  }

  private revokeLinkRow(l: ChannelLinkRecord, actor: ConnectorActor): void {
    for (let i = this.buffer.length - 1; i >= 0; i--) if (this.buffer[i].linkId === l.id) this.buffer.splice(i, 1);
    Object.assign(l, { state: "revoked", bufferedCount: 0, updatedAt: this.iso() });
    this.audit.push({ action: "connector.channel_unlinked", actor: this.actorKey(actor), entityId: l.id, handoverId: l.handoverId });
  }

  async revokeLink(actor: ConnectorActor, linkId: string): Promise<void> {
    const l = this.requireLink(linkId);
    if (actor.kind === "user") this.requireCreator(actor, l.handoverId);
    if (l.state === "revoked") return;
    this.revokeLinkRow(l, actor);
  }

  async updateLinkSettings(actor: ConnectorActor, linkId: string, settings: Record<string, unknown>): Promise<ChannelLinkRecord> {
    const l = this.requireLink(linkId);
    this.requireCreator(actor, l.handoverId);
    if (l.state === "revoked") throw new ConnectorStoreError("invalid_transition");
    Object.assign(l, { settings: { ...settings }, updatedAt: this.iso() });
    this.audit.push({ action: "connector.settings_changed", actor: this.actorKey(actor), entityId: l.id, handoverId: l.handoverId });
    return { ...l };
  }

  async getLink(linkId: string): Promise<ChannelLinkRecord | null> {
    const l = this.links.get(linkId);
    return l ? { ...l } : null;
  }

  async listLinksForHandover(actor: ConnectorActor, handoverId: string): Promise<ChannelLinkRecord[]> {
    this.requireCreator(actor, handoverId);
    return [...this.links.values()].filter((l) => l.handoverId === handoverId).map((l) => ({ ...l }));
  }

  async listInstallationsForProfile(profileId: string): Promise<InstallationRecord[]> {
    return [...this.installations.values()].filter((i) => i.installedByProfileId === profileId && i.status !== "revoked").map((i) => this.publicInstallation(i));
  }

  async capturingLinks(provider: ConnectorProvider, externalAccountId: string, externalChannelId: string): Promise<ChannelLinkRecord[]> {
    return [...this.links.values()]
      .filter((l) => {
        const inst = this.installations.get(l.installationId);
        return l.provider === provider && l.externalChannelId === externalChannelId && l.state === "capturing" && inst?.externalAccountId === externalAccountId && inst.status === "active";
      })
      .map((l) => ({ ...l }));
  }

  // ── buffer ──
  async bufferMessages(linkId: string, messages: readonly ConnectorMessage[]): Promise<BufferResult> {
    const l = this.requireLink(linkId);
    if (l.state !== "capturing") return { inserted: 0, updated: 0, refused: true };
    let inserted = 0;
    let updated = 0;
    for (const m of messages) {
      const existing = this.buffer.find((b) => b.linkId === linkId && b.providerMessageId === m.providerMessageId);
      if (existing) {
        Object.assign(existing, { ...m, bufferId: existing.bufferId, linkId, seq: existing.seq });
        updated += 1;
        continue;
      }
      if (l.bufferedCount >= CONNECTOR_MESSAGE_LIMITS.bufferedPerLink) throw new ConnectorStoreError("precondition_failed");
      this.seq += 1;
      this.buffer.push({ ...m, bufferId: this.id("b"), linkId, seq: this.seq });
      l.bufferedCount += 1;
      inserted += 1;
    }
    l.lastEventAt = this.iso();
    return { inserted, updated, refused: false };
  }

  async linksDueForFlush(limit: number): Promise<string[]> {
    return [...this.links.values()].filter((l) => l.state !== "revoked" && l.bufferedCount > 0).slice(0, limit).map((l) => l.id);
  }

  async takeFlushBatch(linkId: string): Promise<FlushBatch | null> {
    const l = this.requireLink(linkId);
    if (l.state === "revoked" || l.consentedByProfileId === null) return null;
    const rows = this.buffer
      .filter((b) => b.linkId === linkId)
      .sort((a, b) => a.sentAt.localeCompare(b.sentAt) || a.seq - b.seq)
      .slice(0, CONNECTOR_MESSAGE_LIMITS.messagesPerFlush);
    if (rows.length === 0) return null;
    return {
      linkId, handoverId: l.handoverId, actorProfileId: l.consentedByProfileId, sourceId: l.sourceId, channelLabel: l.channelLabel, provider: l.provider,
      messages: rows.map(({ linkId: _l, seq: _s, ...m }) => (void _l, void _s, { ...m })),
    };
  }

  async completeFlush(linkId: string, bufferIds: readonly string[], sourceId: string): Promise<void> {
    const l = this.requireLink(linkId);
    const ids = new Set(bufferIds);
    for (let i = this.buffer.length - 1; i >= 0; i--) if (this.buffer[i].linkId === linkId && ids.has(this.buffer[i].bufferId)) this.buffer.splice(i, 1);
    l.bufferedCount = this.buffer.filter((b) => b.linkId === linkId).length;
    Object.assign(l, { sourceId, lastFlushAt: this.iso(), lastFlushError: null, updatedAt: this.iso() });
    this.audit.push({ action: "connector.flushed", actor: "system", entityId: l.id, handoverId: l.handoverId });
  }

  async recordFlushError(linkId: string, code: string): Promise<void> {
    const l = this.requireLink(linkId);
    Object.assign(l, { lastFlushError: code, updatedAt: this.iso() });
  }

  async setPullCursor(linkId: string, cursor: string): Promise<void> {
    const l = this.requireLink(linkId);
    if (!cursor || cursor.length > 200) throw new ConnectorStoreError("validation_failed");
    l.pullCursor = cursor;
  }

  async capturingLinksForProvider(provider: ConnectorProvider, limit: number): Promise<ChannelLinkRecord[]> {
    return [...this.links.values()]
      .filter((l) => l.provider === provider && l.state === "capturing" && this.installations.get(l.installationId)?.status === "active")
      .slice(0, limit)
      .map((l) => ({ ...l }));
  }

  /** Test helper: buffered messages of a link, oldest first. */
  bufferedFor(linkId: string): ConnectorMessage[] {
    return this.buffer.filter((b) => b.linkId === linkId).sort((a, b) => a.seq - b.seq).map(({ bufferId: _b, linkId: _l, seq: _s, ...m }) => (void _b, void _l, void _s, m));
  }
}
