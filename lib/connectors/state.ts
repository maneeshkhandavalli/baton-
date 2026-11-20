/**
 * Signed, expiring tokens for connector flows (server only), keyed by CONNECTOR_STATE_SECRET:
 *
 *  - OAuth/install `state`: binds the provider callback to the Baton user who started it and to the handover
 *    (CSRF protection; a callback whose state was not issued to the signed-in user is refused).
 *  - Link intents: a bot command (`/handover` in Discord/Slack/Telegram) answers with a Baton URL carrying a
 *    signed intent naming the provider account and channel. Opening it does nothing by itself: the signed-in
 *    handover creator picks the handover and gives consent in Baton.
 *
 * Format: base64url(JSON payload) + "." + base64url(HMAC-SHA256). Payloads hold ids only, never content.
 */

import { createHmac } from "node:crypto";

import { safeEqual } from "./verify";
import { isConnectorProvider, type ConnectorProvider } from "./types";

export type ConnectorStatePayload =
  // inst: GitHub only, set when the app was already installed and Baton sends the user through a separate
  // authorization round trip to get the code that proves access to that installation (see github/routes.ts).
  | { t: "oauth"; p: ConnectorProvider; profileId: string; handoverId: string | null; nonce: string; exp: number; inst?: string }
  | { t: "intent"; p: ConnectorProvider; account: string; accountLabel: string; channel: string; channelLabel: string; nonce: string; exp: number };

const b64u = (b: Buffer | string) => Buffer.from(b).toString("base64url");

export function signConnectorState(secret: string, payload: ConnectorStatePayload): string {
  if (!secret || secret.length < 32) throw new Error("CONNECTOR_STATE_SECRET missing or shorter than 32 characters");
  const body = b64u(JSON.stringify(payload));
  return `${body}.${b64u(createHmac("sha256", secret).update(body).digest())}`;
}

export type StateCheck = { ok: true; payload: ConnectorStatePayload } | { ok: false; reason: "malformed" | "bad_signature" | "expired" };

export function verifyConnectorState(secret: string, token: string | null | undefined, nowMs: number): StateCheck {
  if (!secret || secret.length < 32 || typeof token !== "string" || token.length > 4096) return { ok: false, reason: "malformed" };
  const dot = token.indexOf(".");
  if (dot <= 0 || dot !== token.lastIndexOf(".")) return { ok: false, reason: "malformed" };
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  if (!safeEqual(sig, b64u(createHmac("sha256", secret).update(body).digest()))) return { ok: false, reason: "bad_signature" };
  let payload: ConnectorStatePayload;
  try {
    payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    return { ok: false, reason: "malformed" };
  }
  if (!payload || (payload.t !== "oauth" && payload.t !== "intent") || !isConnectorProvider(payload.p) || typeof payload.exp !== "number") {
    return { ok: false, reason: "malformed" };
  }
  if (payload.exp * 1000 < nowMs) return { ok: false, reason: "expired" };
  return { ok: true, payload };
}

/** Lifetimes: OAuth round trips are short; a link intent posted in a chat lives a little longer. */
export const OAUTH_STATE_TTL_S = 10 * 60;
export const LINK_INTENT_TTL_S = 30 * 60;
