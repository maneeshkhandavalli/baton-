#!/usr/bin/env node
// Sets the command menu of the shared Baton Telegram bot (setMyCommands): /handover, /status, /pause, /help in group
// chats and /help in private chats. The OWNER runs this once with their own token; it is never run by CI or by agents.
//
//   TELEGRAM_BOT_TOKEN=... node scripts/connectors/telegram-set-commands.mjs
//
// Prints the scopes and command names only. Never prints the token.
// The payload and the calls live in bot-commands.mjs (tested with a fake fetch; importing it calls nothing).

import { pathToFileURL } from "node:url";

import { setTelegramCommands } from "./bot-commands.mjs";

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const r = await setTelegramCommands({ env: process.env, fetch });
  for (const line of r.lines) (r.ok ? console.log : console.error)(line);
  if (!r.ok) process.exit(1);
}
