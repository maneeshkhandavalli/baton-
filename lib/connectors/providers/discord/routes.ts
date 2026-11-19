/**
 * Discord route handlers (Round 4, Worker 03). The files under app/api/connectors/discord/ are thin wrappers that
 * build `BotRouteDeps` and call these, so tests run them with a constructed Request and a MemoryConnectorStore.
 *
 *   GET  /api/connectors/discord/install?handover=<id>  → discord.com/oauth2/authorize (bot + applications.commands)
 *   GET  /api/connectors/discord/callback               → state check → server-side code exchange → installation
 *   POST /api/connectors/discord/webhook                → interactions endpoint (Ed25519, PING, /handover)
 */

import { verifyDiscordSignature } from "../../verify";
import {
  afterInstallPath,
  beginInstall,
  callbackErrorCode,
  checkCallback,
  handoverCommandReply,
  isConfigured,
  isObject,
  json,
  logCode,
  notFound,
  parseJson,
  readRawBody,
  redirectExternal,
  redirectTo,
  str,
  text,
  type BotRouteDeps,
} from "../bots/shared";
import { DISCORD_AUTHORIZE_URL, DISCORD_BOT_PERMISSIONS, DISCORD_SCOPES, discordBotRequest, exchangeDiscordCode, isSnowflake } from "./api";

/** Interaction types / response types (Discord API). */
const PING = 1;
const APPLICATION_COMMAND = 2;
const PONG = 1;
const CHANNEL_MESSAGE = 4;
const EPHEMERAL = 1 << 6;

export const DISCORD_COMMAND_NAME = "handover";

export async function handleDiscordInstall(request: Request, deps: BotRouteDeps): Promise<Response> {
  const start = await beginInstall("discord", request, deps);
  if (!start.ok) return start.response;
  const q = new URLSearchParams({
    client_id: deps.env.DISCORD_APPLICATION_ID ?? "",
    scope: DISCORD_SCOPES.join(" "),
    permissions: DISCORD_BOT_PERMISSIONS,
    response_type: "code",
    redirect_uri: start.redirectUri,
    state: start.state,
  });
  return redirectExternal(`${DISCORD_AUTHORIZE_URL}?${q}`);
}

export async function handleDiscordCallback(request: Request, deps: BotRouteDeps): Promise<Response> {
  const check = await checkCallback("discord", request, deps);
  if (!check.ok) return check.response;
  try {
    // The guild comes from Discord's token answer, never from the query string (which a person can edit).
    const exchanged = await exchangeDiscordCode(deps, check.code, check.redirectUri);
    let guildName = exchanged.guildName;
    const guild = await discordBotRequest(deps, "GET", `/guilds/${exchanged.guildId}`);
    if (isObject(guild) && typeof guild.name === "string") guildName = guild.name;
    await deps.store.upsertInstallation(
      { kind: "user", profileId: check.profileId },
      { provider: "discord", externalAccountId: exchanged.guildId, accountLabel: (guildName ?? "Discord server").slice(0, 120), scopes: exchanged.scopes, credentials: null },
    );
    return redirectTo(deps.env, afterInstallPath("discord", check.handoverId, "connected"));
  } catch (e) {
    const code = callbackErrorCode(e);
    logCode(deps, "discord", "oauth_callback", code);
    return redirectTo(deps.env, afterInstallPath("discord", check.handoverId, code));
  }
}

/** Interactions endpoint. Signature first on the raw body (401, nothing parsed), then PING or `/handover`. */
export async function handleDiscordWebhook(request: Request, deps: BotRouteDeps): Promise<Response> {
  if (!isConfigured("discord", deps.env)) return notFound();
  const raw = await readRawBody(request);
  if (raw === null) return text("Payload too large", 413);
  const ok = verifyDiscordSignature(deps.env.DISCORD_PUBLIC_KEY ?? "", raw, request.headers.get("x-signature-ed25519"), request.headers.get("x-signature-timestamp"));
  if (!ok) {
    logCode(deps, "discord", "interaction", "bad_signature");
    return text("invalid request signature", 401);
  }
  const body = parseJson(raw);
  if (!isObject(body)) return text("Bad request", 400);
  if (body.type === PING) return json({ type: PONG });
  if (body.type !== APPLICATION_COMMAND || !isObject(body.data) || body.data.name !== DISCORD_COMMAND_NAME) {
    return json({ type: CHANNEL_MESSAGE, data: { content: "Baton doesn't know that command.", flags: EPHEMERAL } });
  }
  const guildId = str(body.guild_id);
  const channelId = str(body.channel_id) ?? (isObject(body.channel) ? str(body.channel.id) : null);
  if (!guildId || !isSnowflake(guildId) || !channelId || !isSnowflake(channelId)) {
    return json({ type: CHANNEL_MESSAGE, data: { content: "Use /handover in a server channel to connect it to a Baton handover.", flags: EPHEMERAL } });
  }
  const installation = await deps.store.findInstallation("discord", guildId).catch(() => null);
  const channelName = isObject(body.channel) ? str(body.channel.name) : null;
  const content = await handoverCommandReply(deps.store, deps.env, deps.now(), {
    provider: "discord",
    account: guildId,
    accountLabel: installation && installation.status !== "revoked" ? installation.accountLabel : "Discord server",
    channel: channelId,
    channelLabel: channelName ? `#${channelName}` : "this channel",
  });
  return json({ type: CHANNEL_MESSAGE, data: { content, flags: EPHEMERAL, allowed_mentions: { parse: [] } } });
}
