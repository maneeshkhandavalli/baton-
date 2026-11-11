/**
 * Access tokens (§12.4): 32 random bytes, base64url (43 characters). Only SHA-256 hashes are stored;
 * the raw token is returned once to the creating action and is never logged.
 * Web Crypto only, so this works in Node and edge runtimes alike.
 */

const RAW_TOKEN = /^[A-Za-z0-9_-]{43}$/;

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function generateRawToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return toBase64Url(bytes);
}

/** Cheap shape check before any database round trip. Unknown shapes are simply invalid. */
export function isWellFormedToken(raw: string): boolean {
  return RAW_TOKEN.test(raw);
}

export async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return toHex(new Uint8Array(digest));
}

/** PostgREST accepts bytea parameters in Postgres hex format: "\x…". */
export function hexToBytea(hex: string): string {
  if (!/^[0-9a-f]*$/.test(hex) || hex.length % 2 !== 0) throw new Error("invalid hex");
  return `\\x${hex}`;
}

export async function tokenHashParam(raw: string): Promise<string> {
  return hexToBytea(await sha256Hex(raw));
}
