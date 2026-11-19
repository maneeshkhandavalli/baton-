/**
 * Slack adapter (Round 4, Worker 03). Push-based: the Events API delivers `message` events to the webhook
 * (routes.ts). Installation = workspace (team id); the bot token is sealed at rest and opened per call.
 *
 * Authors are resolved to DISPLAY NAMES with users.info (cached per request), only for channels that are actually
 * capturing; user ids are never stored. A bot that is not a member of a channel cannot read it: the picker flags
 * `blockedReason: "bot_not_member"` (fix: `/invite @Baton Handover` in the channel).
 */

import type { ConnectorMessage, InstallationRecord, NormalizedEvent } from "../../types";
import { ProviderError, type AdapterContext, type ChannelChoice, type ProviderServerAdapter } from "../adapter";
import { captureNotice, isObject, str } from "../bots/shared";
import { botToken, slackCall, slackOptions } from "./api";

/** A message whose author still has to be turned into a display name. */
export interface PendingSlackMessage {
  message: Omit<ConnectorMessage, "authorLabel">;
  /** Slack user id, used ONLY to look up the display name, never stored. */
  user: string | null;
  /** Display name Slack already sent with the event (user_profile), when present. */
  profileName: string | null;
}

export type SlackEventParsed =
  | { kind: "challenge"; challenge: string }
  | { kind: "event"; event: NormalizedEvent; pending: PendingSlackMessage[]; /** event came from a private channel (`channel_type: "group"`) */ privateChannel: boolean }
  | { kind: "invalid" };

/** Slack `ts` ("1700000000.123456") → ISO 8601. */
export function tsToIso(ts: string): string | null {
  if (!/^\d{1,12}(\.\d{1,9})?$/.test(ts)) return null;
  return new Date(Math.floor(Number(ts) * 1000)).toISOString();
}

/** Subtypes that are a person's message. Everything else (joins, topic changes, bots…) is skipped. */
const PERSON_SUBTYPES = new Set([undefined, "thread_broadcast", "file_share", "me_message"]);

function profileName(m: Record<string, unknown>): string | null {
  const p = isObject(m.user_profile) ? m.user_profile : null;
  return (p && ((str(p.display_name) ?? "").trim() || (str(p.real_name) ?? "").trim())) || null;
}

/** One Slack message object → a pending message, or null to skip (pure). */
export function mapSlackMessage(m: Record<string, unknown>, opts: { editedAt?: string | null } = {}): PendingSlackMessage | null {
  const subtype = typeof m.subtype === "string" ? m.subtype : undefined;
  if (m.bot_id || subtype === "bot_message" || !PERSON_SUBTYPES.has(subtype)) return null;
  const ts = str(m.ts);
  const sentAt = ts ? tsToIso(ts) : null;
  if (!ts || !sentAt) return null;
  const text = typeof m.text === "string" ? m.text : "";
  const hasFiles = Array.isArray(m.files) && m.files.length > 0;
  if (text.trim() === "" && !hasFiles) return null;
  const threadTs = str(m.thread_ts);
  const edited = opts.editedAt ?? (isObject(m.edited) && typeof m.edited.ts === "string" ? tsToIso(m.edited.ts) : null);
  return {
    message: {
      providerMessageId: ts,
      sentAt,
      kind: text.trim() === "" ? "media_omitted" : "text",
      text: text.trim() === "" ? "" : text,
      replyToId: threadTs && threadTs !== ts ? threadTs : null,
      editedAt: edited,
    },
    user: str(m.user),
    profileName: profileName(m),
  };
}

/** An Events API envelope → challenge / NormalizedEvent with pending authors (pure). */
export function parseSlackEnvelope(body: unknown): SlackEventParsed {
  if (!isObject(body)) return { kind: "invalid" };
  if (body.type === "url_verification") return typeof body.challenge === "string" && body.challenge.length <= 200 ? { kind: "challenge", challenge: body.challenge } : { kind: "invalid" };
  if (body.type !== "event_callback" || typeof body.event_id !== "string" || !isObject(body.event)) return { kind: "invalid" };
  const team = str(body.team_id);
  const ev = body.event;
  const type = String(ev.type ?? "unknown");
  const subtype = typeof ev.subtype === "string" ? ev.subtype : null;
  const channel = str(ev.channel);
  const base: NormalizedEvent = { provider: "slack", deliveryId: body.event_id, eventType: subtype ? `${type}.${subtype}` : type, externalAccountId: team, externalChannelId: channel, messages: [] };
  const privateChannel = ev.channel_type === "group" || type === "group_left";
  const out = (pending: PendingSlackMessage[], over: Partial<NormalizedEvent> = {}): SlackEventParsed => ({ kind: "event", event: { ...base, ...over }, pending, privateChannel });

  switch (type) {
    case "app_uninstalled":
      return out([], { externalChannelId: null, lifecycle: { kind: "uninstalled", reason: "provider_uninstalled" } });
    case "tokens_revoked": {
      const bots = isObject(ev.tokens) && Array.isArray(ev.tokens.bot) ? ev.tokens.bot : [];
      return out([], { externalChannelId: null, lifecycle: bots.length > 0 ? { kind: "token_revoked", reason: "token_revoked" } : null });
    }
    case "channel_left":
    case "group_left":
      return channel ? out([], { lifecycle: { kind: "channel_removed", reason: "bot_removed_from_channel" } }) : out([]);
    case "message":
      break;
    default:
      return out([]);
  }

  if (subtype === "message_changed" && isObject(ev.message)) {
    const edited = isObject(ev.message.edited) && typeof ev.message.edited.ts === "string" ? tsToIso(ev.message.edited.ts) : null;
    const p = mapSlackMessage({ ...ev.message, subtype: undefined }, { editedAt: edited ?? (str(ev.event_ts) ? tsToIso(String(ev.event_ts)) : null) });
    return out(p && !ev.message.bot_id ? [p] : []);
  }
  if (subtype === "message_deleted") {
    const ts = str(ev.deleted_ts);
    const prev = isObject(ev.previous_message) ? ev.previous_message : null;
    const sentAt = ts ? tsToIso(ts) : null;
    if (!ts || !sentAt || (prev && (prev.bot_id || prev.subtype === "bot_message"))) return out([]);
    return out([{ message: { providerMessageId: ts, sentAt, kind: "deleted", text: "", replyToId: null, editedAt: null }, user: prev ? str(prev.user) : null, profileName: prev ? profileName(prev) : null }]);
  }
  const p = mapSlackMessage(ev);
  return out(p ? [p] : []);
}

/** Resolves pending authors to display names (users.info, cached in `cache`). Never returns ids. */
export async function resolveAuthors(ctx: AdapterContext, token: string | null, pending: readonly PendingSlackMessage[], cache = new Map<string, string>()): Promise<ConnectorMessage[]> {
  const out: ConnectorMessage[] = [];
  for (const p of pending) {
    let label = p.profileName;
    if (!label && p.user && token) {
      if (!cache.has(p.user)) cache.set(p.user, await displayName(ctx, token, p.user));
      label = cache.get(p.user) ?? null;
    }
    out.push({ ...p.message, authorLabel: label || "Slack member" });
  }
  return out;
}

async function displayName(ctx: AdapterContext, token: string, user: string): Promise<string> {
  try {
    const r = await slackCall(ctx, token, "users.info", { user });
    const u = isObject(r.user) ? r.user : null;
    if (!u) return "Slack member";
    if (u.is_bot === true) return "Slack app";
    const prof = isObject(u.profile) ? u.profile : {};
    return ((str(prof.display_name) ?? "").trim() || (str(prof.real_name) ?? "").trim() || (str(u.real_name) ?? "").trim() || (str(u.name) ?? "").trim() || "Slack member").slice(0, 120);
  } catch (e) {
    if (e instanceof ProviderError && e.code === "rate_limited") throw e;
    return "Slack member";
  }
}

/** True for a private channel (conversations.* objects; `is_group` on very old workspaces). */
export function isPrivateSlackChannel(c: Record<string, unknown>): boolean {
  return c.is_private === true || c.is_group === true;
}

/**
 * A conversation → picker choice. Private channels are refused with `private_channel` unless the server enabled
 * them (SLACK_PRIVATE_CHANNELS=1): they are never silently linked without the optional scopes.
 */
function choice(c: Record<string, unknown>, privateChannels: boolean): ChannelChoice | null {
  const id = str(c.id);
  if (!id || c.is_archived === true || c.is_im === true || c.is_mpim === true) return null;
  const blockedReason = isPrivateSlackChannel(c) && !privateChannels ? "private_channel" : c.is_member === true ? null : "bot_not_member";
  return { id, label: `#${str(c.name) ?? "channel"}`, blockedReason };
}

export const slackAdapter: ProviderServerAdapter = {
  provider: "slack",

  async listChannels(ctx, installation) {
    const token = await botToken(ctx, installation);
    const { privateChannels } = slackOptions(ctx.env);
    // Without groups:read Slack answers missing_scope for private_channel, so the type is requested only when enabled.
    const types = privateChannels ? "public_channel,private_channel" : "public_channel";
    const out: ChannelChoice[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 10; page++) {
      const r = await slackCall(ctx, token, "conversations.list", { types, exclude_archived: true, limit: 200, cursor });
      for (const c of Array.isArray(r.channels) ? r.channels : []) {
        const ch = isObject(c) ? choice(c, privateChannels) : null;
        if (ch) out.push(ch);
      }
      const next = isObject(r.response_metadata) ? str(r.response_metadata.next_cursor) : null;
      if (!next) break;
      cursor = next;
    }
    return out.sort((a, b) => Number(!!a.blockedReason) - Number(!!b.blockedReason) || a.label.localeCompare(b.label));
  },

  async describeChannel(ctx, installation, externalChannelId) {
    if (!/^[CG][A-Z0-9]{2,30}$/.test(externalChannelId)) return null;
    const token = await botToken(ctx, installation);
    try {
      const r = await slackCall(ctx, token, "conversations.info", { channel: externalChannelId });
      return isObject(r.channel) ? choice(r.channel, slackOptions(ctx.env).privateChannels) : null;
    } catch (e) {
      if (e instanceof ProviderError && (e.code === "not_found" || e.code === "forbidden")) return null;
      throw e;
    }
  },

  async fetchHistory(ctx, installation, link, sinceIso, limit) {
    const token = await botToken(ctx, installation);
    const oldest = (Date.parse(sinceIso) / 1000).toFixed(6);
    const pending: PendingSlackMessage[] = [];
    let cursor: string | undefined;
    while (pending.length < limit) {
      const r = await slackCall(ctx, token, "conversations.history", { channel: link.externalChannelId, oldest, limit: Math.min(200, limit - pending.length + 20), cursor });
      for (const m of Array.isArray(r.messages) ? r.messages : []) {
        const p = isObject(m) ? mapSlackMessage(m) : null;
        if (p) pending.push(p);
      }
      const next = isObject(r.response_metadata) ? str(r.response_metadata.next_cursor) : null;
      if (!next || r.has_more !== true) break;
      cursor = next;
    }
    // conversations.history is newest first
    pending.sort((a, b) => Number(a.message.providerMessageId) - Number(b.message.providerMessageId));
    return resolveAuthors(ctx, token, pending.slice(-limit));
  },

  async announceCapture(ctx, installation, link, change) {
    const token = await botToken(ctx, installation);
    await slackCall(ctx, token, "chat.postMessage", { channel: link.externalChannelId, text: captureNotice(change), unfurl_links: false, unfurl_media: false });
  },

  async revokeAtProvider(ctx, installation) {
    const token = await ctx.credentials(installation);
    if (!token) return;
    try {
      await slackCall(ctx, token, "auth.revoke", {});
    } catch (e) {
      if (e instanceof ProviderError && e.code === "unauthorized") return; // already revoked
      throw e;
    }
  },
};

export function installationToken(ctx: AdapterContext, installation: InstallationRecord | null): Promise<string | null> {
  return installation ? ctx.credentials(installation) : Promise.resolve(null);
}
