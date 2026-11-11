/**
 * Deterministic, RFC 4122-valid UUIDs for seed data, so the canonical Zod input schemas
 * (`z.uuid()`) accept them. Runtime-created rows use `crypto.randomUUID()`.
 */

export const NS = {
  profile: 0x81,
  handover: 0xa1,
  member: 0xa2,
  source: 0xa3,
  point: 0xb1,
  revision: 0xb2,
  evidence: 0xc1,
  pointEvidence: 0xc2,
  gapQuestion: 0xd1,
  gapAnswer: 0xd2,
  publication: 0xe1,
  run: 0xf1,
  participant: 0xa4,
  exclusion: 0xa5,
  token: 0xa6,
} as const;

export function seedId(ns: number, n: number): string {
  return `${ns.toString(16).padStart(8, "0")}-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
}

export function newId(): string {
  return crypto.randomUUID();
}

/** 43-character base64url-looking token (§12.4 shape). Seed tokens are readable on purpose. */
export function seedToken(label: string): string {
  return (label + "_" + "x".repeat(43)).slice(0, 43);
}

export function newToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
