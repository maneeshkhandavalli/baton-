/**
 * Minimal Slack Web API client over `ctx.fetch`. The per-workspace bot token is sealed at rest
 * (lib/connectors/secrets.ts) and opened server-side via `ctx.credentials(installation)`; it travels only in the
 * Authorization header and never appears in errors or logs.
 */

import type { SlackOptions } from "../../config";
import type { InstallationRecord } from "../../types";
import { ProviderError, type AdapterContext } from "../adapter";
import { isObject, providerFetch, readJson, retryAfter, statusError } from "../bots/shared";

export const SLACK_API = "https://slack.com/api";
export const SLACK_AUTHORIZE_URL = "https://slack.com/oauth/v2/authorize";

/**
 * Bot scopes, each with the reason it is needed (shown in the setup guide, docs/round4/setup/SLACK_SCOPE_AUDIT.md).
 *
 * Required (always requested, and checked on the OAuth callback — an install missing any of them is refused):
 *  channels:history   read messages of public channels the app was added to (message.channels, history import)
 *  channels:read      list public channels for the picker, read a channel's name and membership
 *  chat:write         post the capture notice (started / paused / stopped) — part of the consent design
 *  users:read         turn a message author into a display name (users.info); ids are never stored
 *
 * Optional, off by default (server env flags, see slackOptions):
 *  SLACK_PRIVATE_CHANNELS=1  groups:history, groups:read  — private channels the app was invited to
 *  SLACK_SLASH_COMMAND=1     commands                     — the /handover slash command
 */
export const SLACK_REQUIRED_SCOPES = ["channels:history", "channels:read", "chat:write", "users:read"] as const;
export const SLACK_PRIVATE_CHANNEL_SCOPES = ["groups:history", "groups:read"] as const;
export const SLACK_SLASH_COMMAND_SCOPES = ["commands"] as const;

export { slackOptions, type SlackOptions } from "../../config";

/** Exactly the bot scopes the install URL requests for these options (required first, then optional). */
export function slackBotScopes(options: SlackOptions): string[] {
  return [...SLACK_REQUIRED_SCOPES, ...(options.privateChannels ? SLACK_PRIVATE_CHANNEL_SCOPES : []), ...(options.slashCommand ? SLACK_SLASH_COMMAND_SCOPES : [])];
}

/** Required scopes Slack did NOT grant (empty = the install keeps attribution and the consent notice). */
export function missingRequiredSlackScopes(granted: readonly string[]): string[] {
  const g = new Set(granted);
  return SLACK_REQUIRED_SCOPES.filter((s) => !g.has(s));
}

const AUTH_ERRORS = new Set(["invalid_auth", "not_authed", "token_revoked", "token_expired", "account_inactive", "no_permission"]);
const FORBIDDEN_ERRORS = new Set(["missing_scope", "not_in_channel", "restricted_action", "access_denied", "ekm_access_denied"]);
const NOT_FOUND_ERRORS = new Set(["channel_not_found", "user_not_found", "is_archived"]);

export function slackErrorCode(error: unknown): ProviderError {
  const e = typeof error === "string" ? error : "";
  if (e === "ratelimited") return new ProviderError("rate_limited");
  if (AUTH_ERRORS.has(e)) return new ProviderError("unauthorized");
  if (FORBIDDEN_ERRORS.has(e)) return new ProviderError("forbidden");
  if (NOT_FOUND_ERRORS.has(e)) return new ProviderError("not_found");
  return new ProviderError("invalid_response");
}

/** POST form-encoded to a Web API method with a bot token; returns the `ok: true` body. */
export async function slackCall(ctx: Pick<AdapterContext, "fetch">, token: string | null, method: string, params: Record<string, string | number | boolean | undefined>, json = false): Promise<Record<string, unknown>> {
  const headers: Record<string, string> = { "content-type": json ? "application/json; charset=utf-8" : "application/x-www-form-urlencoded" };
  if (token) headers.authorization = `Bearer ${token}`;
  const clean = Object.fromEntries(Object.entries(params).filter(([, v]) => v !== undefined).map(([k, v]) => [k, String(v)]));
  const res = await providerFetch(ctx, `${SLACK_API}/${method}`, { method: "POST", headers, body: json ? JSON.stringify(params) : new URLSearchParams(clean).toString() });
  if (!res.ok) throw statusError(res.status, retryAfter(res.headers));
  const body = await readJson(res);
  if (!isObject(body)) throw new ProviderError("invalid_response");
  if (body.ok !== true) throw slackErrorCode(body.error);
  return body;
}

/** The workspace's bot token (decrypted server-side) or ProviderError("unauthorized"). */
export async function botToken(ctx: AdapterContext, installation: InstallationRecord): Promise<string> {
  const token = await ctx.credentials(installation);
  if (!token) throw new ProviderError("unauthorized");
  return token;
}

/** Server-side OAuth v2 code exchange. */
export async function exchangeSlackCode(ctx: Pick<AdapterContext, "env" | "fetch">, code: string, redirectUri: string): Promise<{ teamId: string; teamName: string; token: string; scopes: string[] }> {
  const clientId = ctx.env.SLACK_CLIENT_ID;
  const secret = ctx.env.SLACK_CLIENT_SECRET;
  if (!clientId || !secret) throw new ProviderError("not_configured");
  const body = await slackCall(ctx, null, "oauth.v2.access", { client_id: clientId, client_secret: secret, code, redirect_uri: redirectUri });
  const team = isObject(body.team) ? body.team : null;
  if (body.token_type !== "bot" || typeof body.access_token !== "string" || !team || typeof team.id !== "string") throw new ProviderError("invalid_response");
  return {
    teamId: team.id,
    teamName: typeof team.name === "string" ? team.name : "Slack workspace",
    token: body.access_token,
    scopes: typeof body.scope === "string" ? body.scope.split(",").filter(Boolean) : [],
  };
}
