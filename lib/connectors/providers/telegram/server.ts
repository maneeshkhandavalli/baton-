/**
 * Telegram adapter (Round 4, Worker 03). One shared Baton bot; the INSTALLATION is the group chat (its id is both
 * the external account and the channel). Main's `linkFromIntent` creates the installation when the creator links a
 * group from a `/handover` intent. Messages arrive by webhook (routes.ts); there is no history API for bots, so
 * `fetchHistory` is absent: only messages sent after the bot joined AND after consent are captured.
 *
 * Privacy mode: with BotFather's privacy mode ON a bot only sees commands and replies to it. `listChannels` /
 * `describeChannel` flag `blockedReason: "privacy_mode"` unless privacy mode is off or the bot is a group admin.
 */

import type { ConnectorMessage, InstallationRecord, NormalizedEvent } from "../../types";
import { ProviderError, type AdapterContext, type ChannelChoice, type ProviderServerAdapter } from "../adapter";
import { parseCommandAction, type BotCommandAction } from "../bots/commands";
import { captureNotice, isObject, isoFromSeconds, str } from "../bots/shared";
import { getMe, telegramCall } from "./api";

const GROUP_TYPES = new Set(["group", "supergroup"]);
/** Content a person sent that Baton does not keep (no file, no contact details, no location). */
const MEDIA_KEYS = ["photo", "video", "document", "audio", "voice", "video_note", "sticker", "animation", "contact", "location", "venue", "poll", "dice", "game", "story", "paid_media"];

/** The bot's own numeric id is the part of the token before ":" (no API call needed). */
export function botIdFromToken(token: string | undefined): string | null {
  const m = token?.match(/^(\d{1,20}):/);
  return m ? m[1] : null;
}

export type TelegramParsed =
  | { kind: "command"; action: BotCommandAction | null; chatId: string; chatTitle: string; isGroup: boolean; messageId: number | null; fromId: string | null; anonymousAdmin: boolean }
  | { kind: "event"; event: NormalizedEvent }
  | { kind: "invalid" };

function authorLabel(m: Record<string, unknown>, chat: Record<string, unknown>): string | null {
  if (isObject(m.sender_chat)) return str(m.sender_chat.title) ?? str(chat.title) ?? "Group admin"; // anonymous admin / linked channel
  if (!isObject(m.from)) return null;
  const name = [str(m.from.first_name), str(m.from.last_name)].filter(Boolean).join(" ").trim();
  return name || str(m.from.username) || null;
}

/** One message / edited_message → a ConnectorMessage, or a skip reason (pure). Display names only, never phone numbers. */
export function mapTelegramMessage(m: Record<string, unknown>, botToken: string | undefined, edited: boolean): { message: ConnectorMessage } | { skip: "bot_or_self_message" | "system" | "invalid" } {
  const chat = isObject(m.chat) ? m.chat : null;
  if (!chat || typeof m.message_id !== "number" || typeof m.date !== "number") return { skip: "invalid" };
  if (isObject(m.from) && (m.from.is_bot === true || String(m.from.id) === botIdFromToken(botToken))) return { skip: "bot_or_self_message" };
  if (isObject(m.sender_chat) && m.sender_chat.id !== chat.id) return { skip: "bot_or_self_message" }; // posts relayed from a linked channel
  const content = typeof m.text === "string" ? m.text : typeof m.caption === "string" ? m.caption : "";
  const hasMedia = MEDIA_KEYS.some((k) => m[k] !== undefined);
  if (content.trim() === "" && !hasMedia) return { skip: "system" }; // service messages: members joined/left, title changes, pins…
  const label = authorLabel(m, chat);
  if (!label) return { skip: "invalid" };
  const reply = isObject(m.reply_to_message) && typeof m.reply_to_message.message_id === "number" ? String(m.reply_to_message.message_id) : null;
  return {
    message: {
      providerMessageId: String(m.message_id),
      sentAt: isoFromSeconds(m.date),
      authorLabel: label,
      kind: content.trim() === "" ? "media_omitted" : "text",
      text: content.trim() === "" ? "" : content,
      replyToId: reply,
      editedAt: edited && typeof m.edit_date === "number" ? isoFromSeconds(m.edit_date) : null,
    },
  };
}

const COMMAND_RE = /^\/(handover|start|status|pause|help)(?:@([A-Za-z0-9_]{1,64}))?(?=\s|$)([\s\S]*)$/i;

/** True when `text` is one of our commands (/handover, /start, /status, /pause, /help), addressed to no bot or to ours. */
export function isOurCommand(text: unknown, botUsername: string | undefined): boolean {
  return ourCommandAction(text, botUsername) !== undefined;
}

/**
 * The action of our command: /handover and /start connect (or take an argument: "/handover status"); /status,
 * /pause and /help name theirs. undefined = not our command (captured like any message once consented); null = our
 * /handover with an unknown argument.
 */
export function ourCommandAction(text: unknown, botUsername: string | undefined): BotCommandAction | null | undefined {
  if (typeof text !== "string") return undefined;
  const m = text.match(COMMAND_RE);
  if (!m) return undefined;
  if (m[2] && !(!!botUsername && m[2].toLowerCase() === botUsername.replace(/^@/, "").toLowerCase())) return undefined;
  const name = m[1].toLowerCase();
  if (name === "start") return "connect";
  if (name === "handover") return parseCommandAction(m[3]);
  return name as BotCommandAction;
}

/** A Telegram Update → a bot command, a NormalizedEvent for ingest, or invalid (pure). */
export function parseTelegramUpdate(update: unknown, env: Record<string, string | undefined>): TelegramParsed {
  if (!isObject(update) || typeof update.update_id !== "number") return { kind: "invalid" };
  const deliveryId = `tg:${update.update_id}`;
  const base = (type: string, chatId: string | null): NormalizedEvent => ({ provider: "telegram", deliveryId, eventType: type, externalAccountId: chatId, externalChannelId: chatId, messages: [] });

  if (isObject(update.my_chat_member)) {
    const u = update.my_chat_member;
    const chatId = isObject(u.chat) ? str(u.chat.id) : null;
    const member = isObject(u.new_chat_member) ? u.new_chat_member : null;
    const isUs = !!member && isObject(member.user) && String(member.user.id) === botIdFromToken(env.TELEGRAM_BOT_TOKEN);
    if (chatId && isUs && (member!.status === "left" || member!.status === "kicked")) {
      return { kind: "event", event: { ...base("bot_removed", chatId), lifecycle: { kind: "uninstalled", reason: "bot_removed" } } };
    }
    return { kind: "event", event: base("my_chat_member", chatId) };
  }

  const edited = isObject(update.edited_message);
  const m = isObject(update.message) ? update.message : isObject(update.edited_message) ? update.edited_message : null;
  if (!m || !isObject(m.chat)) return { kind: "event", event: base("unsupported", null) };
  const chat = m.chat;
  const chatId = str(chat.id);
  if (!chatId) return { kind: "invalid" };
  const isGroup = GROUP_TYPES.has(String(chat.type));

  const action = edited ? undefined : ourCommandAction(m.text, env.TELEGRAM_BOT_USERNAME);
  if (action !== undefined) {
    return {
      kind: "command", action, chatId, chatTitle: str(chat.title) ?? "Telegram group", isGroup, messageId: typeof m.message_id === "number" ? m.message_id : null,
      fromId: isObject(m.from) ? str(m.from.id) : null,
      anonymousAdmin: isObject(m.sender_chat) && m.sender_chat.id === chat.id,
    };
  }
  if (!isGroup) return { kind: "event", event: base("private_or_channel", null) };

  // A group upgraded to a supergroup gets a new id: pause links of the old id (buffered messages are kept).
  if (m.migrate_to_chat_id !== undefined) {
    return { kind: "event", event: { ...base("chat_migrated", chatId), lifecycle: { kind: "channel_removed", reason: "telegram_chat_migrated" } } };
  }
  const mapped = mapTelegramMessage(m, env.TELEGRAM_BOT_TOKEN, edited);
  const event = base(edited ? "edited_message" : "message", chatId);
  if ("message" in mapped) event.messages = [mapped.message];
  return { kind: "event", event };
}

/** Group admins (and anonymous admins) may connect a group; Telegram has no ephemeral replies, so the link is public. */
export async function isGroupAdmin(ctx: Pick<AdapterContext, "env" | "fetch">, chatId: string, userId: string | null, anonymousAdmin: boolean): Promise<boolean> {
  if (anonymousAdmin) return true;
  if (!userId) return false;
  try {
    const member = await telegramCall(ctx, "getChatMember", { chat_id: chatId, user_id: Number(userId) });
    return isObject(member) && (member.status === "administrator" || member.status === "creator");
  } catch {
    return false;
  }
}

async function privacyBlocked(ctx: AdapterContext, chatId: string): Promise<boolean> {
  const me = await getMe(ctx);
  if (me.canReadAllGroupMessages) return false;
  try {
    const member = await telegramCall(ctx, "getChatMember", { chat_id: chatId, user_id: me.id });
    return !(isObject(member) && (member.status === "administrator" || member.status === "creator")); // admins see every message
  } catch {
    return true;
  }
}

async function describeChat(ctx: AdapterContext, installation: InstallationRecord, chatId: string): Promise<ChannelChoice | null> {
  if (installation.provider !== "telegram" || chatId !== installation.externalAccountId) return null;
  let chat: unknown;
  try {
    chat = await telegramCall(ctx, "getChat", { chat_id: chatId });
  } catch (e) {
    if (e instanceof ProviderError && (e.code === "not_found" || e.code === "forbidden")) return null;
    throw e;
  }
  if (!isObject(chat) || !GROUP_TYPES.has(String(chat.type))) return null;
  return { id: chatId, label: str(chat.title) ?? "Telegram group", blockedReason: (await privacyBlocked(ctx, chatId)) ? "privacy_mode" : null };
}

export const telegramAdapter: ProviderServerAdapter = {
  provider: "telegram",

  async listChannels(ctx, installation) {
    const one = await describeChat(ctx, installation, installation.externalAccountId);
    return one ? [one] : [];
  },

  async describeChannel(ctx, installation, externalChannelId) {
    return describeChat(ctx, installation, externalChannelId);
  },

  async announceCapture(ctx, installation, link, change, by) {
    if (link.externalChannelId !== installation.externalAccountId) return;
    await telegramCall(ctx, "sendMessage", { chat_id: link.externalChannelId, text: captureNotice(change, by), link_preview_options: { is_disabled: true } });
  },

  async revokeAtProvider(ctx, installation) {
    try {
      await telegramCall(ctx, "leaveChat", { chat_id: installation.externalAccountId });
    } catch (e) {
      if (e instanceof ProviderError && (e.code === "not_found" || e.code === "forbidden")) return; // already removed
      throw e;
    }
  },
};
