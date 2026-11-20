#!/usr/bin/env node
// Registers Baton's global `/handover` slash command (with its optional `action`: connect, status, pause, help) for
// the Discord application. The OWNER runs this once with their own credentials; it is never run by CI or by agents.
//
//   DISCORD_APPLICATION_ID=... DISCORD_BOT_TOKEN=... node scripts/connectors/discord-register-commands.mjs
//
// Prints the command id and name only. Never prints the token or the response body of a failure.
// The payload and the call live in bot-commands.mjs (tested with a fake fetch; importing it calls nothing).

import { pathToFileURL } from "node:url";

import { registerDiscordCommands } from "./bot-commands.mjs";

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const r = await registerDiscordCommands({ env: process.env, fetch });
  for (const line of r.lines) (r.ok ? console.log : console.error)(line);
  if (!r.ok) process.exit(1);
}
