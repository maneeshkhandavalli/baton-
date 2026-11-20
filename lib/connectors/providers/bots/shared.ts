/**
 * Shared helpers for the chat-bot connectors (Discord, Slack, Telegram; Worker 03). Server only, no React.
 *
 *  - `BotRouteDeps`: what every route handler gets (the adapter context plus the signed-in actor lookup and a
 *    code-only logger). Routes in app/api/connectors/<p>/ build it from lib/connectors/server.ts; tests build it
 *    from a MemoryConnectorStore, a fake fetch and an injected clock.
 *  - OAuth `state` issue/verify bound to the signed-in Baton user (CSRF), and the redirects back to Baton.
 *  - The `/handover` bot-command answer: a signed link intent URL, or a short status for a capturing channel.
 *  - Capture notices posted in the channel (consent transparency).
 *
 * Nothing here logs or returns credentials, message content or provider user ids.
 */

import { randomBytes } from "node:crypto";

import { loginPath } from "../../../supabase/redirects";
import { ConnectorStoreError } from "../../errors";
import { connectorConfigured, connectorPaths, connectorUrls, siteBaseUrl } from "../../config";
import { LINK_INTENT_TTL_S, OAUTH_STATE_TTL_S, signConnectorState, verifyConnectorState } from "../../state";
import type { ConnectorProvider, ConnectorStore, EventOutcome } from "../../types";
import type { AdapterContext } from "../adapter";
import { ProviderError } from "../adapter";

export type BotProvider = Extract<ConnectorProvider, "discord" | "slack" | "telegram">;

export interface ConnectorLogEntry {
  scope: "connector";
  provider: ConnectorProvider;
  event: string;
  code: string;
}

export interface BotRouteDeps extends AdapterContext {
  /** The verified Baton user of this request (getVerifiedActor), or null when signed out. */
  getActor(): Promise<{ profileId: string } | null>;
  /** Code-only log line; defaults to console.warn(JSON). Never receives content, ids of people or secrets. */
  log?(entry: ConnectorLogEntry): void;
}

export function logCode(deps: Pick<BotRouteDeps, "log">, provider: ConnectorProvider, event: string, code: string): void {
  const entry: ConnectorLogEntry = { scope: "connector", provider, event, code };
  if (deps.log) deps.log(entry);
  else console.warn(JSON.stringify(entry));
}

export const PROVIDER_NAMES: Record<ConnectorProvider, string> = { github: "GitHub", discord: "Discord", slack: "Slack", telegram: "Telegram" };

const NO_STORE = { "cache-control": "no-store" } as const;

export function notFound(): Response {
  return new Response("Not found", { status: 404, headers: NO_STORE });
}

export function json(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: NO_STORE });
}

export function text(body: string, status: number): Response {
  return new Response(body, { status, headers: { ...NO_STORE, "content-type": "text/plain; charset=utf-8" } });
}

/** 302 to a same-site path (absolute URL from BATON_SITE_URL; never a host from the request). */
export function redirectTo(env: AdapterContext["env"], pathAndQuery: string): Response {
  return new Response(null, { status: 302, headers: { ...NO_STORE, location: siteBaseUrl(env) + pathAndQuery } });
}

/** 302 to an external provider URL (fixed provider hosts only). */
export function redirectExternal(url: string): Response {
  return new Response(null, { status: 302, headers: { ...NO_STORE, location: url } });
}

export function isConfigured(provider: BotProvider, env: AdapterContext["env"]): boolean {
  return connectorConfigured(provider, env);
}

export const nonce = () => randomBytes(12).toString("base64url");

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ── OAuth install/callback ──────────────────────────────────────────────────

export type InstallStart =
  | { ok: true; state: string; redirectUri: string; handoverId: string | null }
  | { ok: false; response: Response };

/**
 * First half of an OAuth install: the signed-in handover creator (checked with the store, which applies the same
 * creator rule as the database) gets a signed `state` bound to their profile and the handover.
 */
export async function beginInstall(provider: BotProvider, request: Request, deps: BotRouteDeps): Promise<InstallStart> {
  if (!isConfigured(provider, deps.env)) return { ok: false, response: notFound() };
  const url = new URL(request.url);
  const actor = await deps.getActor();
  if (!actor) return { ok: false, response: redirectTo(deps.env, loginRedirectPath(connectorPaths.install(provider) + url.search)) };
  const rawHandover = url.searchParams.get("handover");
  const handoverId = rawHandover && UUID.test(rawHandover) ? rawHandover.toLowerCase() : null;
  if (rawHandover && !handoverId) return { ok: false, response: text("Unknown handover.", 400) };
  if (handoverId) {
    try {
      await deps.store.listLinksForHandover({ kind: "user", profileId: actor.profileId }, handoverId);
    } catch {
      logCode(deps, provider, "install", "not_creator");
      return { ok: false, response: redirectTo(deps.env, afterInstallPath(provider, handoverId, "not_creator")) };
    }
  }
  const state = signConnectorState(deps.env.CONNECTOR_STATE_SECRET ?? "", {
    t: "oauth", p: provider, profileId: actor.profileId, handoverId, nonce: nonce(), exp: Math.floor(deps.now() / 1000) + OAUTH_STATE_TTL_S,
  });
  return { ok: true, state, redirectUri: connectorUrls(provider, deps.env).callback, handoverId };
}

export type CallbackCheck =
  | { ok: true; profileId: string; handoverId: string | null; code: string; redirectUri: string }
  | { ok: false; response: Response };

/**
 * First half of an OAuth callback: the `state` must verify, be for this provider, be unexpired, and have been
 * issued to the user who is signed in now. Only then is the code exchanged (by the caller, server side).
 */
export async function checkCallback(provider: BotProvider, request: Request, deps: BotRouteDeps): Promise<CallbackCheck> {
  if (!isConfigured(provider, deps.env)) return { ok: false, response: notFound() };
  const url = new URL(request.url);
  const actor = await deps.getActor();
  if (!actor) return { ok: false, response: redirectTo(deps.env, loginRedirectPath(connectorPaths.callback(provider) + url.search)) };
  const check = verifyConnectorState(deps.env.CONNECTOR_STATE_SECRET ?? "", url.searchParams.get("state"), deps.now());
  if (!check.ok || check.payload.t !== "oauth" || check.payload.p !== provider) {
    logCode(deps, provider, "oauth_callback", check.ok ? "state_mismatch" : `state_${check.reason}`);
    return { ok: false, response: text("This connection link is invalid or has expired. Start again from the handover's settings.", 400) };
  }
  if (check.payload.profileId !== actor.profileId) {
    logCode(deps, provider, "oauth_callback", "state_wrong_user");
    return { ok: false, response: text("This connection was started by someone else. Start again from the handover's settings.", 403) };
  }
  const handoverId = check.payload.handoverId;
  if (url.searchParams.get("error")) {
    logCode(deps, provider, "oauth_callback", "denied");
    return { ok: false, response: redirectTo(deps.env, afterInstallPath(provider, handoverId, "authorization_failed")) };
  }
  const code = url.searchParams.get("code");
  if (!code || code.length > 512) return { ok: false, response: redirectTo(deps.env, afterInstallPath(provider, handoverId, "invalid_request")) };
  return { ok: true, profileId: actor.profileId, handoverId, code, redirectUri: connectorUrls(provider, deps.env).callback };
}

/**
 * Result codes on the redirect back to Baton (`?connector=<p>&status=<code>#connectors`), shared with the GitHub
 * connector so the panel shows one readable message per code.
 */
export type InstallStatusCode =
  | "connected"
  | "invalid_request"
  | "authorization_failed"
  | "connected_by_someone_else"
  | "not_creator"
  | "rate_limited"
  | "missing_permissions"
  | "unavailable";

/** Where a finished (or failed) install lands: the handover's Connected channels panel, or /connect. */
export function afterInstallPath(provider: BotProvider, handoverId: string | null, status: InstallStatusCode): string {
  const q = new URLSearchParams({ connector: provider, status });
  return handoverId ? `/handover/${encodeURIComponent(handoverId)}/settings?${q}#connectors` : `${connectorPaths.connect}?${q}`;
}

export function loginRedirectPath(next: string): string {
  return loginPath(next);
}

/** Maps a failure during a callback to a status code for the redirect (never the provider's message). */
export function callbackErrorCode(e: unknown): InstallStatusCode {
  if (e instanceof ConnectorStoreError) return e.code === "conflict" ? "connected_by_someone_else" : e.code === "forbidden" ? "not_creator" : "unavailable";
  if (e instanceof ProviderError) {
    if (e.code === "rate_limited") return "rate_limited";
    if (e.code === "unavailable" || e.code === "not_configured") return "unavailable";
    return "authorization_failed";
  }
  return "unavailable";
}

// ── Bot command (/handover) ─────────────────────────────────────────────────

export interface CommandContext {
  provider: BotProvider;
  /** Provider account (Discord guild, Slack team, Telegram chat) and channel; ids only go into the signed intent. */
  account: string;
  accountLabel: string;
  channel: string;
  channelLabel: string;
}

/** Signed `/connect?intent=` URL for a channel. Holds ids and labels only, never message content. */
export function intentUrl(env: AdapterContext["env"], nowMs: number, c: CommandContext): string {
  const token = signConnectorState(env.CONNECTOR_STATE_SECRET ?? "", {
    t: "intent", p: c.provider, account: c.account, accountLabel: c.accountLabel.slice(0, 120), channel: c.channel, channelLabel: c.channelLabel.slice(0, 120),
    nonce: nonce(), exp: Math.floor(nowMs / 1000) + LINK_INTENT_TTL_S,
  });
  return `${connectorUrls(c.provider, env).connect}?intent=${encodeURIComponent(token)}`;
}

/**
 * The reply to `/handover`: a short status when the channel is already being captured, otherwise the link to
 * connect it. The command itself links and captures nothing.
 */
export async function handoverCommandReply(store: ConnectorStore, env: AdapterContext["env"], nowMs: number, c: CommandContext): Promise<string> {
  return (await handoverCommand(store, env, nowMs, c)).text;
}

/** Same as handoverCommandReply, and says whether the text carries a connect link (so it can be sent privately). */
export async function handoverCommand(store: ConnectorStore, env: AdapterContext["env"], nowMs: number, c: CommandContext): Promise<{ text: string; hasLink: boolean }> {
  let capturing = 0;
  try {
    capturing = (await store.capturingLinks(c.provider, c.account, c.channel)).length;
  } catch {
    capturing = 0;
  }
  if (capturing > 0) {
    return { hasLink: false, text: `Baton is saving messages in this channel for ${capturing === 1 ? "a handover" : `${capturing} handovers`}. A channel admin or the handover’s creator can pause or stop it in Baton.` };
  }
  const minutes = Math.round(LINK_INTENT_TTL_S / 60);
  return { hasLink: true, text: `To save this channel’s messages to a Baton handover, the handover’s creator opens this link within ${minutes} minutes and confirms there: ${intentUrl(env, nowMs, c)}\nNothing is saved until they confirm.` };
}

// ── Capture notices ─────────────────────────────────────────────────────────

/**
 * A person's Baton display name made safe to post in a chat: no mention or markup syntax (@, <, >, #, *, _, `, ~, |, [, ]),
 * no control characters, at most 60 characters. Null when nothing readable is left. Never an email or an id.
 */
export function safeDisplayName(name: string | null | undefined): string | null {
  if (!name || name.includes("@")) return null; // an email-shaped name is never posted
  const clean = name
    .replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e]/g, "")
    .replace(/[<>#*_`~|[\]\\]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 60)
    .trim();
  return clean.length > 0 ? clean : null;
}

/**
 * The notice posted in a channel when capture starts, pauses or stops. Names the person in Baton who did it (their
 * Baton display name, made safe by safeDisplayName) so the channel knows who is saving its messages; no emails, ids
 * or handover titles. Without a usable name it falls back to the neutral wording.
 */
export function captureNotice(change: "started" | "paused" | "stopped", by?: string | null): string {
  const who = safeDisplayName(by);
  switch (change) {
    case "started":
      return who
        ? `${who} connected this channel to a Baton handover. Baton is now saving messages in this channel for that handover. A channel admin or the handover’s creator can pause or stop it in Baton.`
        : "Baton is now saving messages in this channel for a handover. A channel admin or the handover’s creator can pause or stop it in Baton.";
    case "paused":
      return `Baton has paused saving messages in this channel${who ? ` (paused by ${who})` : ""}. Nothing new is saved until the handover’s creator resumes it.`;
    case "stopped":
      return `Baton has stopped saving messages in this channel${who ? ` (stopped by ${who})` : ""}. Messages it had not yet added to the handover were deleted.`;
  }
}

// ── Webhook answers ─────────────────────────────────────────────────────────

/** Logs a non-processed outcome as a code (never the payload) and returns the HTTP status for the provider. */
export function logOutcome(deps: Pick<BotRouteDeps, "log">, provider: BotProvider, eventType: string, outcome: EventOutcome): void {
  if (outcome.status === "failed") logCode(deps, provider, eventType, outcome.code);
}

/** Reads the raw body with a hard cap (providers send small JSON; anything larger is refused before parsing). */
export async function readRawBody(request: Request, maxBytes = 1_000_000): Promise<string | null> {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > maxBytes) return null;
  const body = await request.text();
  return Buffer.byteLength(body, "utf8") > maxBytes ? null : body;
}

export function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
export const str = (v: unknown): string | null => (typeof v === "string" ? v : typeof v === "number" && Number.isFinite(v) ? String(v) : null);

/** Maps an HTTP status from a provider API to a ProviderError code (no body, no URL in the error). */
export function statusError(status: number, retryAfterSeconds: number | null = null): ProviderError {
  if (status === 429) return new ProviderError("rate_limited", retryAfterSeconds);
  if (status === 401) return new ProviderError("unauthorized");
  if (status === 403) return new ProviderError("forbidden");
  if (status === 404) return new ProviderError("not_found");
  if (status >= 500) return new ProviderError("unavailable");
  return new ProviderError("invalid_response");
}

export function retryAfter(headers: Headers, body?: unknown): number | null {
  const h = Number(headers.get("retry-after"));
  if (Number.isFinite(h) && h > 0) return Math.ceil(h);
  if (isObject(body) && typeof body.retry_after === "number" && body.retry_after > 0) return Math.ceil(body.retry_after);
  return null;
}

/** Calls ctx.fetch; network failures become ProviderError("unavailable") (the URL may hold a token: never surfaced). */
export async function providerFetch(ctx: Pick<AdapterContext, "fetch">, url: string, init: RequestInit): Promise<Response> {
  try {
    return await ctx.fetch(url, init);
  } catch {
    throw new ProviderError("unavailable");
  }
}

export async function readJson(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    throw new ProviderError("invalid_response");
  }
}

export function isoFromSeconds(seconds: number): string {
  return new Date(seconds * 1000).toISOString();
}
