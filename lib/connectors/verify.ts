/**
 * Shared request-verification primitives for provider webhooks (server only). Provider adapters compose these;
 * they never compare secrets with `===`.
 *
 *   GitHub   X-Hub-Signature-256: "sha256=" + hex(HMAC-SHA256(webhook secret, raw body))
 *   Slack    X-Slack-Signature:   "v0=" + hex(HMAC-SHA256(signing secret, "v0:" + X-Slack-Request-Timestamp + ":" + raw body)),
 *            timestamp within ±5 minutes
 *   Discord  X-Signature-Ed25519 / X-Signature-Timestamp: Ed25519(public key, timestamp + raw body)
 *   Telegram X-Telegram-Bot-Api-Secret-Token equals the secret_token given to setWebhook
 */

import { createHmac, createPublicKey, timingSafeEqual, verify as cryptoVerify } from "node:crypto";

/** Constant-time string comparison (false on length mismatch, without leaking which byte differs). */
export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ab.length !== bb.length) {
    timingSafeEqual(ab, ab); // keep timing roughly independent of the mismatch
    return false;
  }
  return timingSafeEqual(ab, bb);
}

export function hmacSha256Hex(secret: string, payload: string | Uint8Array): string {
  return createHmac("sha256", secret).update(payload).digest("hex");
}

/** True when `timestampSeconds` is within `toleranceSeconds` of now (replay window). */
export function withinReplayWindow(timestampSeconds: string | null, nowMs: number, toleranceSeconds = 300): boolean {
  if (!timestampSeconds || !/^\d{1,12}$/.test(timestampSeconds)) return false;
  return Math.abs(nowMs / 1000 - Number(timestampSeconds)) <= toleranceSeconds;
}

/** GitHub webhook signature check. */
export function verifyGithubSignature(secret: string, rawBody: string, header: string | null): boolean {
  if (!secret || !header || !header.startsWith("sha256=")) return false;
  return safeEqual(header, `sha256=${hmacSha256Hex(secret, rawBody)}`);
}

/** Slack request signature check (signing secret, v0 scheme, replay window). */
export function verifySlackSignature(signingSecret: string, rawBody: string, timestamp: string | null, signature: string | null, nowMs: number): boolean {
  if (!signingSecret || !signature || !withinReplayWindow(timestamp, nowMs)) return false;
  return safeEqual(signature, `v0=${hmacSha256Hex(signingSecret, `v0:${timestamp}:${rawBody}`)}`);
}

/** Discord interaction signature check (Ed25519 over timestamp + raw body). */
export function verifyDiscordSignature(publicKeyHex: string, rawBody: string, signatureHex: string | null, timestamp: string | null): boolean {
  if (!publicKeyHex || !signatureHex || !timestamp) return false;
  if (!/^[0-9a-f]{64}$/i.test(publicKeyHex) || !/^[0-9a-f]{128}$/i.test(signatureHex)) return false;
  try {
    // SPKI DER prefix for an Ed25519 public key, followed by the 32 raw key bytes.
    const der = Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), Buffer.from(publicKeyHex, "hex")]);
    const key = createPublicKey({ key: der, format: "der", type: "spki" });
    return cryptoVerify(null, Buffer.from(timestamp + rawBody, "utf8"), key, Buffer.from(signatureHex, "hex"));
  } catch {
    return false;
  }
}

/** Telegram webhook secret header check. */
export function verifyTelegramSecret(expected: string, header: string | null): boolean {
  if (!expected || !header) return false;
  return safeEqual(header, expected);
}
