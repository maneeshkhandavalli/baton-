/**
 * Telegram route handlers (Round 4, Worker 03). app/api/connectors/telegram/* are thin wrappers around these.
 *
 *   GET  /api/connectors/telegram/install  → https://t.me/<bot>?startgroup=baton (add the bot to a group)
 *   POST /api/connectors/telegram/webhook  → X-Telegram-Bot-Api-Secret-Token first, then the Update:
 *        `/handover` → a group admin (not anonymous) gets the signed intent in a PRIVATE message; the group only
 *        sees a pointer (Telegram has no ephemeral replies, and a link posted in the group could be opened by any
 *        member, who would then own the group's Baton connection). A status when already capturing;
 *        messages / edits → ingestEvent (consent gate, de-dup by `tg:<update_id>`);
 *        my_chat_member left/kicked → installation revoked (lifecycle).
 */

import { httpStatusFor, ingestEvent } from "../../ingest";
import { verifyTelegramSecret } from "../../verify";
import { handoverCommand, isConfigured, json, logCode, logOutcome, notFound, parseJson, readRawBody, redirectExternal, text, type BotRouteDeps } from "../bots/shared";
import { helpText, pauseChannel, statusText, unknownActionText } from "../bots/commands";
import { telegramCall } from "./api";
import { isGroupAdmin, parseTelegramUpdate } from "./server";

export async function handleTelegramInstall(_request: Request, deps: BotRouteDeps): Promise<Response> {
  if (!isConfigured("telegram", deps.env)) return notFound();
  const bot = (deps.env.TELEGRAM_BOT_USERNAME ?? "").replace(/^@/, "");
  if (!/^[A-Za-z0-9_]{5,64}$/.test(bot)) return notFound();
  return redirectExternal(`https://t.me/${bot}?startgroup=baton`);
}

export async function handleTelegramWebhook(request: Request, deps: BotRouteDeps): Promise<Response> {
  if (!isConfigured("telegram", deps.env)) return notFound();
  if (!verifyTelegramSecret(deps.env.TELEGRAM_WEBHOOK_SECRET ?? "", request.headers.get("x-telegram-bot-api-secret-token"))) {
    logCode(deps, "telegram", "update", "bad_secret");
    return text("unauthorized", 401);
  }
  const raw = await readRawBody(request);
  if (raw === null) return text("Payload too large", 413);
  const parsed = parseTelegramUpdate(parseJson(raw), deps.env);
  if (parsed.kind === "invalid") return json({ ok: true }); // acknowledged, nothing stored; a retry would not help

  if (parsed.kind === "command") {
    let reply: string;
    if (parsed.action === "help") reply = helpText("telegram"); // static, for anyone
    else if (parsed.action === null) reply = unknownActionText("telegram");
    else if (!parsed.isGroup) reply = "Add me to a group, then send /handover in that group to connect it to a Baton handover.";
    else if (parsed.action === "status" || parsed.action === "pause") {
      // The same rule as /handover: a group admin (an anonymous admin is one, and needs no private message here).
      if (!(await isGroupAdmin(deps, parsed.chatId, parsed.fromId, parsed.anonymousAdmin))) {
        reply = parsed.action === "pause" ? "Only a group admin can pause Baton in this group." : "Only a group admin can check Baton's status in this group.";
      } else if (parsed.action === "status") {
        reply = await statusText(deps.store, "telegram", parsed.chatId, parsed.chatId);
      } else {
        const r = await pauseChannel(deps.store, "telegram", parsed.chatId, parsed.chatId);
        if (r.paused > 0) logCode(deps, "telegram", "command", "paused_by_channel_admin");
        reply = r.text;
      }
    } else if (parsed.anonymousAdmin || !parsed.fromId) reply = "Baton sends the connect link privately, so it can't answer an anonymous admin. Turn off “Remain anonymous” for yourself, then send /handover again.";
    else if (!(await isGroupAdmin(deps, parsed.chatId, parsed.fromId, false))) reply = "Only a group admin can connect this group to a Baton handover.";
    else {
      const cmd = await handoverCommand(deps.store, deps.env, deps.now(), { provider: "telegram", account: parsed.chatId, accountLabel: parsed.chatTitle, channel: parsed.chatId, channelLabel: parsed.chatTitle });
      if (!cmd.hasLink) reply = cmd.text;
      else {
        const bot = (deps.env.TELEGRAM_BOT_USERNAME ?? "").replace(/^@/, "");
        try {
          await telegramCall(deps, "sendMessage", { chat_id: Number(parsed.fromId), text: `For the group “${parsed.chatTitle}”:\n${cmd.text}`, link_preview_options: { is_disabled: true } });
          reply = "I've sent you the link to connect this group in a private message. Nothing is saved until the handover's creator confirms in Baton.";
        } catch {
          logCode(deps, "telegram", "command", "private_message_failed");
          reply = `I can't message you privately yet. Open a chat with @${bot}, press Start, then send /handover here again.`;
        }
      }
    }
    // Webhook reply: Telegram performs this sendMessage itself.
    return json({
      method: "sendMessage",
      chat_id: parsed.chatId,
      text: reply,
      link_preview_options: { is_disabled: true },
      ...(parsed.messageId !== null ? { reply_parameters: { message_id: parsed.messageId, allow_sending_without_reply: true } } : {}),
    });
  }

  const outcome = await ingestEvent(deps.store, parsed.event);
  logOutcome(deps, "telegram", parsed.event.eventType, outcome);
  return json({ ok: outcome.status !== "failed" }, httpStatusFor(outcome));
}
