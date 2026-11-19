#!/usr/bin/env node
// Points the shared Baton Telegram bot at <BATON_SITE_URL>/api/connectors/telegram/webhook (Round 4, Worker 03).
// The OWNER runs this with their own credentials; it is never run by CI or by agents.
//
//   BATON_SITE_URL=https://your-site TELEGRAM_BOT_TOKEN=... TELEGRAM_WEBHOOK_SECRET=... node scripts/connectors/telegram-set-webhook.mjs
//   add --info to only print the current webhook status (URL host, pending updates, last error) without changing it.
//
// Never prints the token or the secret.

const site = process.env.BATON_SITE_URL;
const token = process.env.TELEGRAM_BOT_TOKEN;
const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
const infoOnly = process.argv.includes("--info");

if (!token || (!infoOnly && (!site || !secret))) {
  console.error("Set BATON_SITE_URL, TELEGRAM_BOT_TOKEN and TELEGRAM_WEBHOOK_SECRET in the environment first.");
  process.exit(1);
}

async function call(method, params) {
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(params),
  });
  const body = await res.json().catch(() => null);
  if (!body?.ok) {
    console.error(`Telegram ${method} failed (HTTP ${res.status}${body?.error_code ? `, code ${body.error_code}` : ""}).`);
    process.exit(1);
  }
  return body.result;
}

if (!infoOnly) {
  const origin = new URL(site);
  if (origin.protocol !== "https:") {
    console.error("BATON_SITE_URL must be https:// (Telegram only delivers webhooks over HTTPS).");
    process.exit(1);
  }
  if (!/^[A-Za-z0-9_-]{1,256}$/.test(secret)) {
    console.error("TELEGRAM_WEBHOOK_SECRET may only contain A-Z, a-z, 0-9, _ and - (1-256 characters).");
    process.exit(1);
  }
  await call("setWebhook", {
    url: `${origin.origin}/api/connectors/telegram/webhook`,
    secret_token: secret,
    allowed_updates: ["message", "edited_message", "my_chat_member"],
    drop_pending_updates: false,
  });
  console.log(`Webhook set to ${origin.origin}/api/connectors/telegram/webhook`);
}

const info = await call("getWebhookInfo", {});
const host = info.url ? new URL(info.url).host : "(none)";
console.log(`Current webhook host: ${host}; pending updates: ${info.pending_update_count ?? 0}${info.last_error_message ? `; last error: ${info.last_error_message}` : ""}`);
const me = await call("getMe", {});
console.log(`Bot @${me.username}: can read all group messages = ${me.can_read_all_group_messages ? "yes" : "NO (turn off privacy mode in BotFather: /setprivacy -> Disable)"}`);
