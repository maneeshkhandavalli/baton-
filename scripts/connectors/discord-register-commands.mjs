#!/usr/bin/env node
// Registers Baton's global `/handover` slash command for the Discord application (Round 4, Worker 03).
// The OWNER runs this once with their own credentials; it is never run by CI or by agents.
//
//   DISCORD_APPLICATION_ID=... DISCORD_BOT_TOKEN=... node scripts/connectors/discord-register-commands.mjs
//
// Prints the command id and name only. Never prints the token or the response body of a failure.

const appId = process.env.DISCORD_APPLICATION_ID;
const token = process.env.DISCORD_BOT_TOKEN;
if (!appId || !token) {
  console.error("Set DISCORD_APPLICATION_ID and DISCORD_BOT_TOKEN in the environment first.");
  process.exit(1);
}
if (!/^\d{5,20}$/.test(appId)) {
  console.error("DISCORD_APPLICATION_ID must be the numeric application id.");
  process.exit(1);
}

const command = {
  name: "handover",
  type: 1, // CHAT_INPUT
  description: "Connect this channel to a Baton handover (or see whether it is being saved)",
  contexts: [0], // guilds only
  integration_types: [0], // guild install
};

const res = await fetch(`https://discord.com/api/v10/applications/${appId}/commands`, {
  method: "PUT", // bulk overwrite: exactly this one global command
  headers: { authorization: `Bot ${token}`, "content-type": "application/json" },
  body: JSON.stringify([command]),
});
if (!res.ok) {
  console.error(`Discord answered HTTP ${res.status}. Check the application id and bot token.`);
  process.exit(1);
}
const body = await res.json();
for (const c of Array.isArray(body) ? body : []) console.log(`Registered /${c.name} (id ${c.id}). Global commands can take a few minutes to appear.`);
