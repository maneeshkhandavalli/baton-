/**
 * Minimal Discord REST client (API v10) over `ctx.fetch`. The bot token comes from DISCORD_BOT_TOKEN (app-level;
 * Discord has no per-guild token) and travels only in the Authorization header. Errors carry a code, never the
 * response body.
 */

import { ProviderError, type AdapterContext } from "../adapter";
import { isObject, providerFetch, readJson, retryAfter, statusError } from "../bots/shared";

export const DISCORD_API = "https://discord.com/api/v10";
export const DISCORD_AUTHORIZE_URL = "https://discord.com/oauth2/authorize";

/** View Channels (1 << 10) + Send Messages (1 << 11) + Read Message History (1 << 16). */
export const DISCORD_BOT_PERMISSIONS = String((1 << 10) | (1 << 11) | (1 << 16));
export const DISCORD_SCOPES = ["bot", "applications.commands"] as const;

/** Discord epoch (2015-01-01T00:00:00Z) in ms; snowflake = (ms - epoch) << 22. */
export const DISCORD_EPOCH_MS = BigInt(1420070400000);

export function snowflakeForTime(ms: number): string {
  const t = BigInt(Math.max(0, Math.floor(ms))) - DISCORD_EPOCH_MS;
  return (t > BigInt(0) ? t << BigInt(22) : BigInt(0)).toString();
}

export function timeOfSnowflake(id: string): number {
  return Number((BigInt(id) >> BigInt(22)) + DISCORD_EPOCH_MS);
}

export function isSnowflake(v: unknown): v is string {
  return typeof v === "string" && /^\d{1,20}$/.test(v);
}

/** Larger snowflake (compared numerically). */
export function maxSnowflake(a: string, b: string): string {
  return BigInt(a) >= BigInt(b) ? a : b;
}

function botToken(ctx: Pick<AdapterContext, "env">): string {
  const t = ctx.env.DISCORD_BOT_TOKEN;
  if (!t) throw new ProviderError("not_configured");
  return t;
}

export async function discordBotRequest(ctx: Pick<AdapterContext, "env" | "fetch">, method: "GET" | "POST" | "DELETE", path: string, body?: unknown): Promise<unknown> {
  const res = await providerFetch(ctx, DISCORD_API + path, {
    method,
    headers: {
      authorization: `Bot ${botToken(ctx)}`,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
      "user-agent": "DiscordBot (baton-connector, 1)",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.status === 204) return null;
  if (!res.ok) {
    let parsed: unknown = null;
    if (res.status === 429) parsed = await res.json().catch(() => null);
    throw statusError(res.status, retryAfter(res.headers, parsed));
  }
  return readJson(res);
}

/** Server-side OAuth2 code exchange (bot install). Returns the guild the bot was added to, from Discord's answer. */
export async function exchangeDiscordCode(ctx: Pick<AdapterContext, "env" | "fetch">, code: string, redirectUri: string): Promise<{ guildId: string; guildName: string | null; scopes: string[] }> {
  const clientId = ctx.env.DISCORD_APPLICATION_ID;
  const secret = ctx.env.DISCORD_CLIENT_SECRET;
  if (!clientId || !secret) throw new ProviderError("not_configured");
  const res = await providerFetch(ctx, `${DISCORD_API}/oauth2/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", authorization: `Basic ${Buffer.from(`${clientId}:${secret}`).toString("base64")}` },
    body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: redirectUri }).toString(),
  });
  if (!res.ok) throw statusError(res.status === 400 ? 401 : res.status, retryAfter(res.headers));
  const body = await readJson(res);
  // The user access token in this answer is not needed and is discarded (never stored).
  if (!isObject(body) || !isObject(body.guild) || !isSnowflake(body.guild.id)) throw new ProviderError("invalid_response");
  const scopes = typeof body.scope === "string" ? body.scope.split(/\s+/).filter(Boolean) : [...DISCORD_SCOPES];
  return { guildId: body.guild.id, guildName: typeof body.guild.name === "string" ? body.guild.name : null, scopes };
}
