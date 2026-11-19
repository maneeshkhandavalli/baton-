/**
 * Discord adapter (Round 4, Worker 03). Discord is PULL-based for messages (contract §2): message events exist only
 * on the Gateway, which a serverless deployment cannot hold, so Main's scheduled sync and "Bring in new messages"
 * call `pullNew` for capturing links (REST `GET /channels/{id}/messages?after=<cursor>`). Interactions (the
 * `/handover` command) arrive by HTTP (routes.ts).
 *
 * Revocation: Discord does not deliver "bot removed from guild" over HTTP. A pull that answers 403/404 throws
 * ProviderError("forbidden" | "not_found"); Main pauses the link. "Disconnect" in Baton makes the bot leave the guild.
 *
 * Limits of pulling: edits and deletions of messages that were already pulled are not seen (they arrive only on
 * the Gateway). Messages pulled before an edit keep their pulled text.
 */

import type { ChannelLinkRecord, ConnectorMessage, InstallationRecord } from "../../types";
import { ProviderError, type AdapterContext, type ChannelChoice, type ProviderServerAdapter } from "../adapter";
import { captureNotice, isObject, str } from "../bots/shared";
import { discordBotRequest, isSnowflake, maxSnowflake, snowflakeForTime } from "./api";

/** Guild text (0) and announcement (5) channels. */
const TEXT_CHANNEL_TYPES = new Set([0, 5]);
/** DEFAULT (0) and REPLY (19) messages are people talking; every other type is a system event. */
const PERSON_MESSAGE_TYPES = new Set([0, 19]);
const PAGE = 100;

export type DiscordMapResult = { message: ConnectorMessage } | { skip: "bot_or_self_message" | "system" | "empty" | "invalid" };

/** One Discord message object → a ConnectorMessage (pure). Display names only; never ids or emails. */
export function mapDiscordMessage(raw: unknown, applicationId: string | undefined): DiscordMapResult {
  if (!isObject(raw) || !isSnowflake(raw.id) || typeof raw.timestamp !== "string" || !isObject(raw.author)) return { skip: "invalid" };
  const author = raw.author;
  if (author.bot === true || author.system === true || (applicationId && author.id === applicationId) || raw.webhook_id) return { skip: "bot_or_self_message" };
  if (typeof raw.type === "number" && !PERSON_MESSAGE_TYPES.has(raw.type)) return { skip: "system" };
  const label = (str(author.global_name) || str(author.username) || "").trim();
  if (!label) return { skip: "invalid" };
  const content = typeof raw.content === "string" ? raw.content : "";
  const hasMedia =
    (Array.isArray(raw.attachments) && raw.attachments.length > 0) ||
    (Array.isArray(raw.sticker_items) && raw.sticker_items.length > 0) ||
    (Array.isArray(raw.embeds) && raw.embeds.length > 0);
  if (content.trim() === "" && !hasMedia) return { skip: "empty" };
  const ref = isObject(raw.message_reference) && isSnowflake(raw.message_reference.message_id) ? raw.message_reference.message_id : null;
  const sentAt = new Date(raw.timestamp);
  if (Number.isNaN(sentAt.getTime())) return { skip: "invalid" };
  const edited = typeof raw.edited_timestamp === "string" && !Number.isNaN(Date.parse(raw.edited_timestamp)) ? new Date(raw.edited_timestamp).toISOString() : null;
  return {
    message: {
      providerMessageId: raw.id,
      sentAt: sentAt.toISOString(),
      authorLabel: label,
      kind: content.trim() === "" ? "media_omitted" : "text",
      text: content.trim() === "" ? "" : content,
      replyToId: raw.type === 19 ? ref : null,
      editedAt: edited,
    },
  };
}

function ensureDiscordChannel(installation: InstallationRecord, channelId: string): void {
  if (installation.provider !== "discord" || !isSnowflake(channelId)) throw new ProviderError("not_found");
}

/**
 * Messages after `afterId`, oldest first, following pages forward until `limit`. Returns the mapped messages and the
 * newest id SEEN (including skipped bot/system messages, so they are not pulled again).
 */
export async function pullAfter(ctx: AdapterContext, channelId: string, afterId: string, limit: number): Promise<{ messages: ConnectorMessage[]; newest: string | null }> {
  const appId = ctx.env.DISCORD_APPLICATION_ID;
  const messages: ConnectorMessage[] = [];
  let cursor = afterId;
  let newest: string | null = null;
  let seen = 0;
  const max = Math.max(1, Math.floor(limit));
  while (seen < max) {
    const page = Math.min(PAGE, max - seen);
    const body = await discordBotRequest(ctx, "GET", `/channels/${channelId}/messages?after=${cursor}&limit=${page}`);
    if (!Array.isArray(body)) throw new ProviderError("invalid_response");
    // Discord answers newest first; sort oldest first by snowflake.
    const batch = (body.filter((m) => isObject(m) && isSnowflake(m.id)) as Array<Record<string, unknown> & { id: string }>).sort((a, b) =>
      BigInt(a.id) < BigInt(b.id) ? -1 : 1,
    );
    for (const m of batch) {
      newest = newest === null ? m.id : maxSnowflake(newest, m.id);
      const r = mapDiscordMessage(m, appId);
      if ("message" in r) messages.push(r.message);
    }
    seen += batch.length;
    if (batch.length < page || newest === null) break;
    cursor = newest;
  }
  return { messages, newest };
}

async function channelChoice(ctx: AdapterContext, installation: InstallationRecord, channelId: string): Promise<ChannelChoice | null> {
  let body: unknown;
  try {
    body = await discordBotRequest(ctx, "GET", `/channels/${channelId}`);
  } catch (e) {
    if (e instanceof ProviderError && (e.code === "not_found" || e.code === "forbidden")) return null;
    throw e;
  }
  if (!isObject(body) || body.guild_id !== installation.externalAccountId || !TEXT_CHANNEL_TYPES.has(Number(body.type))) return null;
  return { id: channelId, label: `#${str(body.name) ?? "channel"}`, blockedReason: null };
}

/** First pull of a link: start at its consent time (nothing before consent is captured unless history was chosen). */
export function initialCursor(link: Pick<ChannelLinkRecord, "consentedAt" | "createdAt">, nowMs: number): string {
  const at = Date.parse(link.consentedAt ?? "") || Date.parse(link.createdAt) || nowMs;
  return snowflakeForTime(at);
}

export const discordAdapter: ProviderServerAdapter = {
  provider: "discord",

  async listChannels(ctx, installation) {
    if (!isSnowflake(installation.externalAccountId)) throw new ProviderError("not_found");
    const body = await discordBotRequest(ctx, "GET", `/guilds/${installation.externalAccountId}/channels`);
    if (!Array.isArray(body)) throw new ProviderError("invalid_response");
    return (body.filter((c) => isObject(c) && isSnowflake(c.id) && TEXT_CHANNEL_TYPES.has(Number(c.type))) as Array<Record<string, unknown> & { id: string }>)
      .sort((a, b) => Number(a.position ?? 0) - Number(b.position ?? 0))
      .map((c) => ({ id: c.id, label: `#${str(c.name) ?? "channel"}`, blockedReason: null }));
  },

  async describeChannel(ctx, installation, externalChannelId) {
    if (!isSnowflake(externalChannelId)) return null;
    return channelChoice(ctx, installation, externalChannelId);
  },

  cursorAt(nowMs) {
    return snowflakeForTime(nowMs);
  },

  async pullNew(ctx, installation, link, limit) {
    ensureDiscordChannel(installation, link.externalChannelId);
    const start = link.pullCursor && isSnowflake(link.pullCursor) ? link.pullCursor : initialCursor(link, ctx.now());
    const { messages, newest } = await pullAfter(ctx, link.externalChannelId, start, limit);
    return { messages, cursor: newest ?? start };
  },

  async fetchHistory(ctx, installation, link, sinceIso, limit) {
    ensureDiscordChannel(installation, link.externalChannelId);
    const since = Date.parse(sinceIso);
    if (Number.isNaN(since)) return [];
    return (await pullAfter(ctx, link.externalChannelId, snowflakeForTime(since), limit)).messages;
  },

  async announceCapture(ctx, installation, link, change) {
    ensureDiscordChannel(installation, link.externalChannelId);
    await discordBotRequest(ctx, "POST", `/channels/${link.externalChannelId}/messages`, { content: captureNotice(change), allowed_mentions: { parse: [] } });
  },

  async revokeAtProvider(ctx, installation) {
    if (!isSnowflake(installation.externalAccountId)) return;
    try {
      await discordBotRequest(ctx, "DELETE", `/users/@me/guilds/${installation.externalAccountId}`);
    } catch (e) {
      if (e instanceof ProviderError && (e.code === "not_found" || e.code === "forbidden")) return; // already gone
      throw e;
    }
  },
};
