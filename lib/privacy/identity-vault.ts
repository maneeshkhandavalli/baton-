/**
 * Identity vault cryptography (Round 3 Task 02, PRIV-1). Server-only by construction: the key comes from
 * the caller (read from `IDENTITY_MAP_KEY` by getIdentityMapKey on the server), never from a NEXT_PUBLIC_
 * variable, and nothing here logs.
 *
 * - The `[PERSON_n]` → label mapping is encrypted with AES-256-GCM (authenticated encryption). The
 *   additional authenticated data binds each ciphertext to its handover, person key and key version, so
 *   a ciphertext copied to another row or handover fails to decrypt.
 * - Two independent subkeys are derived from the master key with HKDF-SHA256: one for encryption, one for
 *   the person key.
 * - person key = HMAC-SHA256(person subkey, "baton:person:v1" ‖ handover id ‖ identity kind ‖ identity hash).
 *   It is keyed AND scoped to one handover, so the same person gets unrelated keys in different handovers
 *   (no cross-workspace tracking), and it cannot be computed without the server key.
 */

import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes } from "node:crypto";

export const IDENTITY_MAP_KEY_VERSIONS = ["k1"] as const;
export type IdentityMapKeyVersion = (typeof IDENTITY_MAP_KEY_VERSIONS)[number];

export interface IdentityMapKey {
  version: IdentityMapKeyVersion;
  /** AES-256-GCM key. */
  encKey: Buffer;
  /** HMAC key for person keys. */
  personKey: Buffer;
}

export type IdentityMapKeyResult = { ok: true; key: IdentityMapKey } | { ok: false; reason: "missing" | "invalid" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Parses the master key: exactly 32 bytes, written as 64 hex characters or as base64 (44 characters with
 * padding). The version must be a known one. Never echoes the value.
 */
export function parseIdentityMapKey(raw: string | undefined, version: string | undefined): IdentityMapKeyResult {
  if (raw === undefined || raw.trim() === "") return { ok: false, reason: "missing" };
  const v = (version ?? "k1").trim();
  if (!(IDENTITY_MAP_KEY_VERSIONS as readonly string[]).includes(v)) return { ok: false, reason: "invalid" };
  const s = raw.trim();
  let master: Buffer | null = null;
  if (/^[0-9a-fA-F]{64}$/.test(s)) master = Buffer.from(s, "hex");
  else if (/^[A-Za-z0-9+/]{43}=$/.test(s)) master = Buffer.from(s, "base64");
  if (!master || master.length !== 32) return { ok: false, reason: "invalid" };
  if (master.every((b) => b === master![0])) return { ok: false, reason: "invalid" }; // all-zero or constant keys
  const derive = (info: string) => Buffer.from(hkdfSync("sha256", master!, Buffer.from("baton-identity-vault", "utf8"), Buffer.from(info, "utf8"), 32));
  return { ok: true, key: { version: v as IdentityMapKeyVersion, encKey: derive(`enc:${v}`), personKey: derive(`person:${v}`) } };
}

/** Reads the server environment. The only reader of IDENTITY_MAP_KEY / IDENTITY_MAP_KEY_VERSION. */
export function getIdentityMapKey(env: Record<string, string | undefined> = process.env): IdentityMapKeyResult {
  return parseIdentityMapKey(env.IDENTITY_MAP_KEY, env.IDENTITY_MAP_KEY_VERSION);
}

function requireUuid(id: string): string {
  if (!UUID.test(id)) throw new Error("handover id must be a UUID");
  return id.toLowerCase();
}

/** Handover-scoped, keyed person key (64 hex). */
export function personKeyFor(key: IdentityMapKey, handoverId: string, identityKind: string, identityHash: string): string {
  if (!/^[0-9a-f]{64}$/.test(identityHash)) throw new Error("identity hash must be 64 lower-case hex");
  if (identityKind !== "name" && identityKind !== "phone") throw new Error("unknown identity kind");
  return createHmac("sha256", key.personKey)
    .update(`baton:person:v1\u0000${requireUuid(handoverId)}\u0000${identityKind}\u0000${identityHash}`, "utf8")
    .digest("hex");
}

function aad(handoverId: string, personKey: string, version: string): Buffer {
  if (!/^[0-9a-f]{64}$/.test(personKey)) throw new Error("person key must be 64 lower-case hex");
  return Buffer.from(`baton:person-label:v1\u0000${requireUuid(handoverId)}\u0000${personKey}\u0000${version}`, "utf8");
}

export interface SealedLabel {
  /** base64: 12-byte nonce ‖ ciphertext ‖ 16-byte tag. */
  sealed: string;
  keyVersion: IdentityMapKeyVersion;
}

/** Encrypts a label for one person (`personKey`) of `handoverId`. A fresh random nonce every time. */
export function sealLabel(key: IdentityMapKey, handoverId: string, personKey: string, label: string): SealedLabel {
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key.encKey, nonce);
  cipher.setAAD(aad(handoverId, personKey, key.version));
  const ct = Buffer.concat([cipher.update(label, "utf8"), cipher.final()]);
  return { sealed: Buffer.concat([nonce, ct, cipher.getAuthTag()]).toString("base64"), keyVersion: key.version };
}

/** Decrypts; null when the ciphertext, binding or key does not verify (never throws, never says why). */
export function openLabel(key: IdentityMapKey, handoverId: string, personKey: string, sealed: string, keyVersion: string): string | null {
  try {
    if (keyVersion !== key.version) return null;
    const buf = Buffer.from(sealed, "base64");
    if (buf.length < 12 + 16) return null;
    const decipher = createDecipheriv("aes-256-gcm", key.encKey, buf.subarray(0, 12));
    decipher.setAAD(aad(handoverId, personKey, keyVersion));
    decipher.setAuthTag(buf.subarray(buf.length - 16));
    return Buffer.concat([decipher.update(buf.subarray(12, buf.length - 16)), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}
