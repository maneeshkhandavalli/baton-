/**
 * Encryption of provider credentials at rest (server only). AES-256-GCM with a key from CONNECTOR_SECRET_KEY
 * (32 random bytes, base64url) and a version from CONNECTOR_SECRET_KEY_VERSION (default "c1"). The database only
 * ever stores the envelope, never plaintext; credentials never reach the browser, logs or the client bundle.
 *
 * Envelope: "<version>.<iv b64url>.<tag b64url>.<ciphertext b64url>". The AAD binds the envelope to its
 * provider and external account, so an envelope copied to another installation does not decrypt.
 */

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export const CONNECTOR_SECRET_KEY_VERSIONS = ["c1"] as const;
export type ConnectorSecretKeyVersion = (typeof CONNECTOR_SECRET_KEY_VERSIONS)[number];

export interface ConnectorSecretKey {
  version: ConnectorSecretKeyVersion;
  key: Buffer;
}

export type KeyCheck = { ok: true; key: ConnectorSecretKey } | { ok: false; reason: "missing" | "invalid" };

export function parseConnectorSecretKey(raw: string | undefined, version: string | undefined): KeyCheck {
  if (!raw) return { ok: false, reason: "missing" };
  const v = version || "c1";
  if (!(CONNECTOR_SECRET_KEY_VERSIONS as readonly string[]).includes(v)) return { ok: false, reason: "invalid" };
  let key: Buffer;
  try {
    key = Buffer.from(raw, "base64url");
  } catch {
    return { ok: false, reason: "invalid" };
  }
  if (key.length !== 32) return { ok: false, reason: "invalid" };
  return { ok: true, key: { version: v as ConnectorSecretKeyVersion, key } };
}

/** Reads the server environment. The only reader of CONNECTOR_SECRET_KEY. */
export function getConnectorSecretKey(env: Record<string, string | undefined> = process.env): KeyCheck {
  return parseConnectorSecretKey(env.CONNECTOR_SECRET_KEY, env.CONNECTOR_SECRET_KEY_VERSION);
}

const aad = (provider: string, externalAccountId: string) => Buffer.from(`baton:connector:${provider}:${externalAccountId}`, "utf8");

export function sealCredentials(key: ConnectorSecretKey, provider: string, externalAccountId: string, plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key.key, iv);
  cipher.setAAD(aad(provider, externalAccountId));
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return [key.version, iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), ct.toString("base64url")].join(".");
}

/** null when the envelope is malformed, from another key version, or bound to another account (fail closed). */
export function openCredentials(key: ConnectorSecretKey, provider: string, externalAccountId: string, envelope: string | null): string | null {
  if (!envelope) return null;
  const parts = envelope.split(".");
  if (parts.length !== 4 || parts[0] !== key.version) return null;
  try {
    const decipher = createDecipheriv("aes-256-gcm", key.key, Buffer.from(parts[1], "base64url"));
    decipher.setAAD(aad(provider, externalAccountId));
    decipher.setAuthTag(Buffer.from(parts[2], "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(parts[3], "base64url")), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}
