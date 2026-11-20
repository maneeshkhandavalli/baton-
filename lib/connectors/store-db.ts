import "server-only";

/**
 * ConnectorStore backed by the database (service-role client; every function is a SECURITY DEFINER RPC from
 * supabase/migrations/20261119800200_connectors.sql, executable by service_role only). The SQL functions enforce
 * the same rules as MemoryConnectorStore; this file only maps names and shapes.
 */

import type { DbClient } from "../db/client";
import { isDbError } from "../db/errors";
import { callRpc } from "../db/rpc";
import { ConnectorStoreError, type ConnectorStoreErrorCode } from "./errors";
import type {
  BufferResult,
  ChannelLinkRecord,
  ConnectorActor,
  ConnectorMessage,
  ConnectorProvider,
  ConnectorStore,
  EventReceipt,
  FlushBatch,
  InstallationRecord,
  InstallationStatus,
  LinkChannelInput,
  UpsertInstallationInput,
} from "./types";
import { CONNECTOR_MESSAGE_LIMITS } from "./types";

type Row = Record<string, unknown>;

const STORE_CODES: ReadonlySet<string> = new Set(["not_found", "forbidden", "invalid_transition", "validation_failed", "precondition_failed", "conflict"]);

async function rpc(db: DbClient, fn: string, args: Record<string, unknown>): Promise<unknown> {
  try {
    return await callRpc(db, fn, args);
  } catch (e) {
    if (isDbError(e) && STORE_CODES.has(e.code)) throw new ConnectorStoreError(e.code as ConnectorStoreErrorCode);
    throw new ConnectorStoreError("internal");
  }
}

const actorArgs = (a: ConnectorActor) => ({ p_actor_kind: a.kind, p_actor_profile_id: a.kind === "user" ? a.profileId : null });
const str = (v: unknown) => (typeof v === "string" ? v : null);

function installation(r: Row): InstallationRecord {
  return {
    id: String(r.id),
    provider: r.provider as ConnectorProvider,
    externalAccountId: String(r.external_account_id),
    accountLabel: String(r.account_label ?? ""),
    status: r.status as InstallationStatus,
    statusReason: str(r.status_reason),
    installedByProfileId: str(r.installed_by_profile_id),
    scopes: Array.isArray(r.scopes) ? r.scopes.map(String) : [],
    hasCredentials: r.has_credentials === true,
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
  };
}

function link(r: Row): ChannelLinkRecord {
  return {
    id: String(r.id),
    installationId: String(r.installation_id),
    provider: r.provider as ConnectorProvider,
    handoverId: String(r.handover_id),
    externalChannelId: String(r.external_channel_id),
    channelLabel: String(r.channel_label ?? ""),
    state: r.state as ChannelLinkRecord["state"],
    settings: r.settings && typeof r.settings === "object" ? (r.settings as Record<string, unknown>) : {},
    consentVersion: str(r.consent_version),
    consentedAt: str(r.consented_at),
    consentedByProfileId: str(r.consented_by_profile_id),
    sourceId: str(r.source_id),
    bufferedCount: Number(r.buffered_count ?? 0),
    lastEventAt: str(r.last_event_at),
    lastFlushAt: str(r.last_flush_at),
    lastFlushError: str(r.last_flush_error),
    pullCursor: str(r.pull_cursor),
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
  };
}

const rows = (v: unknown): Row[] => (Array.isArray(v) ? (v as Row[]) : []);

export function createDbConnectorStore(db: () => DbClient): ConnectorStore {
  return {
    async recordEvent(i) {
      const r = (await rpc(db(), "connector_record_event", {
        p_provider: i.provider, p_delivery_id: i.deliveryId, p_external_account_id: i.externalAccountId, p_event_type: i.eventType.slice(0, 100),
      })) as Row;
      return { eventId: String(r.event_id), process: r.process === true, previousStatus: (str(r.previous_status) as EventReceipt["previousStatus"]) ?? null, attempts: Number(r.attempts ?? 1) };
    },
    async finishEvent(eventId, o) {
      await rpc(db(), "connector_finish_event", { p_event_id: eventId, p_status: o.status, p_detail: o.status === "ignored" ? o.reason : o.status === "failed" ? o.code : null });
    },
    async upsertInstallation(actor, i: UpsertInstallationInput) {
      return installation((await rpc(db(), "connector_upsert_installation", {
        ...actorArgs(actor), p_provider: i.provider, p_external_account_id: i.externalAccountId, p_account_label: i.accountLabel, p_scopes: i.scopes, p_credentials: i.credentials,
      })) as Row);
    },
    async findInstallation(provider, externalAccountId) {
      const r = await rpc(db(), "connector_find_installation", { p_provider: provider, p_external_account_id: externalAccountId });
      return r ? installation(r as Row) : null;
    },
    async getInstallation(id) {
      const r = await rpc(db(), "connector_get_installation", { p_installation_id: id });
      return r ? installation(r as Row) : null;
    },
    async getInstallationCredentials(id) {
      return str(await rpc(db(), "connector_installation_credentials", { p_installation_id: id }));
    },
    async setInstallationStatus(actor, id, status, reason) {
      await rpc(db(), "connector_set_installation_status", { ...actorArgs(actor), p_installation_id: id, p_status: status, p_reason: reason });
    },
    async revokeInstallation(actor, id, reason) {
      await rpc(db(), "connector_revoke_installation", { ...actorArgs(actor), p_installation_id: id, p_reason: reason });
    },
    async linkChannel(actor, i: LinkChannelInput) {
      return link((await rpc(db(), "connector_link_channel", {
        ...actorArgs(actor), p_installation_id: i.installationId, p_handover_id: i.handoverId, p_external_channel_id: i.externalChannelId, p_channel_label: i.channelLabel, p_settings: i.settings ?? {},
      })) as Row);
    },
    async recordCaptureConsent(actor, linkId, consentVersion) {
      return link((await rpc(db(), "connector_record_capture_consent", { ...actorArgs(actor), p_link_id: linkId, p_consent_version: consentVersion })) as Row);
    },
    async setLinkState(actor, linkId, state) {
      return link((await rpc(db(), "connector_set_link_state", { ...actorArgs(actor), p_link_id: linkId, p_state: state })) as Row);
    },
    async revokeLink(actor, linkId, reason) {
      await rpc(db(), "connector_revoke_link", { ...actorArgs(actor), p_link_id: linkId, p_reason: reason });
    },
    async updateLinkSettings(actor, linkId, settings) {
      return link((await rpc(db(), "connector_update_link_settings", { ...actorArgs(actor), p_link_id: linkId, p_settings: settings })) as Row);
    },
    async getLink(linkId) {
      const r = await rpc(db(), "connector_get_link", { p_link_id: linkId });
      return r ? link(r as Row) : null;
    },
    async listLinksForHandover(actor, handoverId) {
      return rows(await rpc(db(), "connector_list_links_for_handover", { ...actorArgs(actor), p_handover_id: handoverId })).map(link);
    },
    async listInstallationsForProfile(profileId) {
      return rows(await rpc(db(), "connector_list_installations_for_profile", { p_profile_id: profileId })).map(installation);
    },
    async capturingLinks(provider, account, channel) {
      return rows(await rpc(db(), "connector_capturing_links", { p_provider: provider, p_external_account_id: account, p_external_channel_id: channel })).map(link);
    },
    async bufferMessages(linkId, messages: readonly ConnectorMessage[]): Promise<BufferResult> {
      const payload = messages.map((m) => ({
        provider_message_id: m.providerMessageId, sent_at: m.sentAt, author_label: m.authorLabel, kind: m.kind, text: m.text, reply_to_id: m.replyToId ?? null, edited_at: m.editedAt ?? null,
      }));
      const r = (await rpc(db(), "connector_buffer_messages", { p_link_id: linkId, p_messages: payload })) as Row;
      return { inserted: Number(r.inserted ?? 0), updated: Number(r.updated ?? 0), refused: r.refused === true, outsideWindow: Number(r.outside_window ?? 0) };
    },
    async linksDueForFlush(limit) {
      const r = await rpc(db(), "connector_links_due_for_flush", { p_limit: limit });
      return Array.isArray(r) ? r.map(String) : [];
    },
    async takeFlushBatch(linkId): Promise<FlushBatch | null> {
      const r = (await rpc(db(), "connector_take_flush_batch", { p_link_id: linkId, p_limit: CONNECTOR_MESSAGE_LIMITS.messagesPerFlush })) as Row | null;
      if (!r) return null;
      return {
        linkId,
        handoverId: String(r.handover_id),
        actorProfileId: String(r.actor_profile_id),
        sourceId: str(r.source_id),
        channelLabel: String(r.channel_label ?? ""),
        provider: r.provider as ConnectorProvider,
        messages: rows(r.messages).map((m) => ({
          bufferId: String(m.buffer_id),
          providerMessageId: String(m.provider_message_id),
          sentAt: new Date(String(m.sent_at)).toISOString(),
          authorLabel: String(m.author_label ?? ""),
          kind: m.kind as ConnectorMessage["kind"],
          text: String(m.text ?? ""),
          replyToId: str(m.reply_to_id),
          editedAt: str(m.edited_at),
        })),
      };
    },
    async completeFlush(linkId, bufferIds, sourceId) {
      await rpc(db(), "connector_complete_flush", { p_link_id: linkId, p_buffer_ids: [...bufferIds], p_source_id: sourceId });
    },
    async recordFlushError(linkId, code) {
      await rpc(db(), "connector_record_flush_error", { p_link_id: linkId, p_code: code.slice(0, 60) });
    },
    async setPullCursor(linkId, cursor) {
      await rpc(db(), "connector_set_pull_cursor", { p_link_id: linkId, p_cursor: cursor });
    },
    async capturingLinksForProvider(provider, limit) {
      return rows(await rpc(db(), "connector_capturing_links_for_provider", { p_provider: provider, p_limit: limit })).map(link);
    },
  };
}
