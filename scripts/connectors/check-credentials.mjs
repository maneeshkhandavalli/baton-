#!/usr/bin/env node
/**
 * Checks connector credentials in an env file against the providers, printing ONLY non-secret facts.
 *
 *   node scripts/connectors/check-credentials.mjs .env.connectors-test.local
 *
 * Telegram  getMe (username, can read all group messages) + getWebhookInfo (host, pending, last error)
 * Discord   GET /applications/@me with the bot token (id matches DISCORD_APPLICATION_ID, Message Content intent)
 * GitHub    App JWT from GITHUB_APP_ID + GITHUB_APP_PRIVATE_KEY → GET /app (slug, permissions, events)
 * Slack     format checks only (client id/secret and signing secret are first used at install / on each request)
 * Never prints a token, secret, key or request body; errors are reduced to provider status codes.
 */
import { createSign } from "node:crypto";
import { readFileSync } from "node:fs";

const file = process.argv[2] ?? ".env.connectors-test.local";
const env = {};
for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
  const m = /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(line);
  if (m) env[m[1]] = m[2].replace(/^"(.*)"$/, "$1");
}
const has = (k) => typeof env[k] === "string" && env[k].trim() !== "";
const out = (provider, ok, text) => console.log(`${ok ? "OK  " : "FAIL"} ${provider.padEnd(9)} ${text}`);
const skip = (provider, missing) => console.log(`--   ${provider.padEnd(9)} not filled: ${missing.join(", ")}`);
const missing = (keys) => keys.filter((k) => !has(k));
const getJson = async (url, init = {}) => {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(15_000) });
  let body = null;
  try {
    body = await res.json();
  } catch {
    /* non-JSON */
  }
  return { status: res.status, body };
};
const hostOf = (u) => {
  try {
    return new URL(u).host;
  } catch {
    return "(none)";
  }
};

async function telegram() {
  const need = missing(["TELEGRAM_BOT_TOKEN", "TELEGRAM_BOT_USERNAME", "TELEGRAM_WEBHOOK_SECRET"]);
  if (need.length) return skip("telegram", need);
  const base = `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}`;
  const me = await getJson(`${base}/getMe`);
  if (!me.body?.ok) return out("telegram", false, `getMe refused (HTTP ${me.status}): check TELEGRAM_BOT_TOKEN`);
  const u = me.body.result;
  const nameOk = u.username?.toLowerCase() === env.TELEGRAM_BOT_USERNAME.replace(/^@/, "").toLowerCase();
  out("telegram", nameOk, `bot @${u.username}${nameOk ? "" : ` ≠ TELEGRAM_BOT_USERNAME`} · can read all group messages: ${u.can_read_all_group_messages ? "yes" : "NO (BotFather /setprivacy → Disable)"} · joins groups: ${u.can_join_groups ? "yes" : "NO"}`);
  const wh = await getJson(`${base}/getWebhookInfo`);
  const w = wh.body?.result ?? {};
  out("telegram", !w.last_error_message, `webhook host: ${w.url ? hostOf(w.url) : "(not set)"} · expected: ${hostOf(env.BATON_SITE_URL)} · pending: ${w.pending_update_count ?? 0}${w.last_error_message ? ` · last error: ${String(w.last_error_message).slice(0, 120)}` : ""}`);
}

async function discord() {
  const need = missing(["DISCORD_APPLICATION_ID", "DISCORD_PUBLIC_KEY", "DISCORD_CLIENT_SECRET", "DISCORD_BOT_TOKEN"]);
  if (need.length) return skip("discord", need);
  if (!/^[0-9a-f]{64}$/i.test(env.DISCORD_PUBLIC_KEY)) out("discord", false, "DISCORD_PUBLIC_KEY is not 64 hex characters");
  const app = await getJson("https://discord.com/api/v10/applications/@me", { headers: { authorization: `Bot ${env.DISCORD_BOT_TOKEN}` } });
  if (app.status !== 200) return out("discord", false, `bot token refused (HTTP ${app.status}): check DISCORD_BOT_TOKEN`);
  const a = app.body;
  const idOk = a.id === env.DISCORD_APPLICATION_ID;
  const flags = Number(a.flags ?? 0);
  const content = (flags & (1 << 18)) !== 0 || (flags & (1 << 19)) !== 0;
  out("discord", idOk && content, `application "${a.name}" ${idOk ? "matches DISCORD_APPLICATION_ID" : "≠ DISCORD_APPLICATION_ID"} · Message Content intent: ${content ? "on" : "OFF (Bot → Message Content Intent)"} · redirects registered: ${(a.redirect_uris ?? []).map(hostOf).join(", ") || "(none)"}`);
}

function githubJwt() {
  const key = env.GITHUB_APP_PRIVATE_KEY.replace(/\\n/g, "\n");
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  const unsigned = `${b64({ alg: "RS256", typ: "JWT" })}.${b64({ iat: now - 60, exp: now + 540, iss: env.GITHUB_APP_ID })}`;
  const sig = createSign("RSA-SHA256").update(unsigned).sign(key).toString("base64url");
  return `${unsigned}.${sig}`;
}

async function github() {
  const need = missing(["GITHUB_APP_ID", "GITHUB_APP_SLUG", "GITHUB_APP_CLIENT_ID", "GITHUB_APP_CLIENT_SECRET", "GITHUB_APP_PRIVATE_KEY", "GITHUB_WEBHOOK_SECRET"]);
  if (need.length) return skip("github", need);
  let jwt;
  try {
    jwt = githubJwt();
  } catch {
    return out("github", false, "GITHUB_APP_PRIVATE_KEY is not a usable PEM key (use \\n for line breaks)");
  }
  const app = await getJson("https://api.github.com/app", { headers: { authorization: `Bearer ${jwt}`, accept: "application/vnd.github+json", "user-agent": "baton-credential-check" } });
  if (app.status !== 200) return out("github", false, `App JWT refused (HTTP ${app.status}): check GITHUB_APP_ID / GITHUB_APP_PRIVATE_KEY`);
  const a = app.body;
  const slugOk = a.slug === env.GITHUB_APP_SLUG;
  const clientOk = !a.client_id || a.client_id === env.GITHUB_APP_CLIENT_ID;
  const perms = Object.entries(a.permissions ?? {}).map(([k, v]) => `${k}:${v}`).join(", ");
  const writes = Object.values(a.permissions ?? {}).some((v) => v === "write" || v === "admin");
  out("github", slugOk && clientOk && !writes, `app "${a.slug}" ${slugOk ? "" : "≠ GITHUB_APP_SLUG "}${clientOk ? "" : "· client id ≠ GITHUB_APP_CLIENT_ID "}· permissions: ${perms || "(none)"}${writes ? " · HAS WRITE PERMISSIONS (should be read-only)" : ""} · events: ${(a.events ?? []).join(", ") || "(none)"}`);
}

function slack() {
  const need = missing(["SLACK_CLIENT_ID", "SLACK_CLIENT_SECRET", "SLACK_SIGNING_SECRET"]);
  if (need.length) return skip("slack", need);
  const idOk = /^\d+\.\d+$/.test(env.SLACK_CLIENT_ID);
  const sigOk = /^[0-9a-f]{32}$/i.test(env.SLACK_SIGNING_SECRET);
  out("slack", idOk && sigOk, `client id format ${idOk ? "ok" : "unexpected (Basic Information → Client ID)"} · signing secret format ${sigOk ? "ok" : "unexpected (32 hex)"} · optional flags: private channels ${env.SLACK_PRIVATE_CHANNELS === "1" ? "ON" : "off"}, slash command ${env.SLACK_SLASH_COMMAND === "1" ? "ON" : "off"} (verified for real at install / first signed event)`);
}

console.log(`[check-credentials] ${file} · site: ${env.BATON_SITE_URL ?? "(unset)"} · supabase: ${hostOf(env.NEXT_PUBLIC_SUPABASE_URL)}`);
for (const k of ["CONNECTOR_STATE_SECRET", "CONNECTOR_SECRET_KEY", "CONNECTOR_SYNC_SECRET"]) {
  if (!has(k) || env[k].length < 32) out("shared", false, `${k} missing or shorter than 32 characters`);
}
if (has("CONNECTOR_SYNC_SECRET") && env.CONNECTOR_SYNC_SECRET === env.CRON_SECRET) out("shared", false, "CONNECTOR_SYNC_SECRET must differ from CRON_SECRET");
for (const check of [telegram, discord, github, slack]) {
  try {
    await check();
  } catch (e) {
    out(check.name, false, `check failed: ${e?.name ?? "error"} (network or provider unavailable)`);
  }
}
