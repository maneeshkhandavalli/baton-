// Bot command definitions and the owner-run registration calls (2026-11-21). Pure module: importing it calls no API.
// discord-register-commands.mjs and telegram-set-commands.mjs run these with real fetch only when the OWNER starts
// them; tests (lib/connectors/__tests__/bot-command-scripts.test.ts) call them with a fake fetch.
//
// The commands match the bot handlers in lib/connectors/providers/{discord,telegram}/routes.ts and the shared rules in
// lib/connectors/providers/bots/commands.ts. No secret is ever printed: only command names, ids and HTTP statuses.

export const DISCORD_API = "https://discord.com/api/v10";
export const TELEGRAM_API = "https://api.telegram.org";

/** Discord: ONE global chat-input command, /handover, with an optional `action` choice. */
export const DISCORD_COMMANDS = Object.freeze([
  Object.freeze({
    name: "handover",
    type: 1, // CHAT_INPUT
    description: "Connect this channel to a Baton handover (or see whether it is being saved)",
    contexts: [0], // guilds only
    integration_types: [0], // guild install
    options: [
      {
        type: 3, // STRING
        name: "action",
        description: "What to do (default: get the connect link)",
        required: false,
        choices: [
          { name: "connect", value: "connect" },
          { name: "status", value: "status" },
          { name: "pause", value: "pause" },
          { name: "help", value: "help" },
        ],
      },
    ],
  }),
]);

/** Telegram: the command menu. Group chats get every command; private chats only what works there. */
export const TELEGRAM_GROUP_COMMANDS = Object.freeze([
  { command: "handover", description: "Connect this group to a Baton handover" },
  { command: "status", description: "See whether Baton is saving this group" },
  { command: "pause", description: "Pause saving (group admins only)" },
  { command: "help", description: "What Baton does here" },
]);
export const TELEGRAM_PRIVATE_COMMANDS = Object.freeze([{ command: "help", description: "What Baton does" }]);

/** The setMyCommands calls, one per scope (no token in here: the caller puts it in the URL path). */
export function telegramSetCommandsRequests() {
  return [
    { method: "setMyCommands", body: { commands: TELEGRAM_GROUP_COMMANDS, scope: { type: "all_group_chats" } } },
    { method: "setMyCommands", body: { commands: TELEGRAM_PRIVATE_COMMANDS, scope: { type: "all_private_chats" } } },
  ];
}

/** The Discord bulk-overwrite request (no token in here: the caller adds the Authorization header). */
export function discordRegistrationRequest(appId) {
  if (typeof appId !== "string" || !/^\d{5,20}$/.test(appId)) throw new Error("DISCORD_APPLICATION_ID must be the numeric application id.");
  return { method: "PUT", url: `${DISCORD_API}/applications/${appId}/commands`, body: DISCORD_COMMANDS };
}

/**
 * Registers the Discord commands. Returns the lines to print. Never puts the token in a line or an error.
 * @param {{ env: Record<string, string | undefined>, fetch: typeof fetch }} deps
 */
export async function registerDiscordCommands({ env, fetch }) {
  const appId = env.DISCORD_APPLICATION_ID;
  const token = env.DISCORD_BOT_TOKEN;
  if (!appId || !token) return { ok: false, lines: ["Set DISCORD_APPLICATION_ID and DISCORD_BOT_TOKEN in the environment first."] };
  let req;
  try {
    req = discordRegistrationRequest(appId);
  } catch (e) {
    return { ok: false, lines: [e.message] };
  }
  let res;
  try {
    res = await fetch(req.url, {
      method: req.method, // bulk overwrite: exactly these global commands
      headers: { authorization: `Bot ${token}`, "content-type": "application/json" },
      body: JSON.stringify(req.body),
    });
  } catch {
    return { ok: false, lines: ["Discord could not be reached. Check the network and try again."] };
  }
  if (!res.ok) return { ok: false, lines: [`Discord answered HTTP ${res.status}. Check the application id and bot token.`] };
  const body = await res.json().catch(() => null);
  const lines = (Array.isArray(body) ? body : []).map((c) => `Registered /${c.name} (id ${c.id}). Global commands can take a few minutes to appear.`);
  return { ok: true, lines };
}

/**
 * Sets the Telegram command menu (setMyCommands per scope). Returns the lines to print. Never prints the token.
 * @param {{ env: Record<string, string | undefined>, fetch: typeof fetch }} deps
 */
export async function setTelegramCommands({ env, fetch }) {
  const token = env.TELEGRAM_BOT_TOKEN;
  if (!token) return { ok: false, lines: ["Set TELEGRAM_BOT_TOKEN in the environment first."] };
  const lines = [];
  for (const r of telegramSetCommandsRequests()) {
    let res;
    let body = null;
    try {
      res = await fetch(`${TELEGRAM_API}/bot${token}/${r.method}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(r.body) });
      body = await res.json().catch(() => null);
    } catch {
      return { ok: false, lines: [...lines, "Telegram could not be reached. Check the network and try again."] };
    }
    if (!body?.ok) {
      return { ok: false, lines: [...lines, `Telegram ${r.method} (${r.body.scope.type}) failed (HTTP ${res.status}${body?.error_code ? `, code ${body.error_code}` : ""}).`] };
    }
    lines.push(`Set ${r.body.commands.length} commands for ${r.body.scope.type}: ${r.body.commands.map((c) => `/${c.command}`).join(", ")}`);
  }
  return { ok: true, lines };
}
