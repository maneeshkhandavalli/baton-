/**
 * GitHub App authentication (server only).
 *
 *  1. App JWT: RS256 over {iat: now − 60 s, exp: now + 9 min, iss: GITHUB_APP_ID}, signed with the app's private
 *     key (GITHUB_APP_PRIVATE_KEY, PEM; real newlines or `\n` escapes both accepted). Lives ≤ 10 min by GitHub rule.
 *  2. Installation token: POST /app/installations/{id}/access_tokens with the JWT → a token valid for 1 hour,
 *     limited to the installation's repositories and the app's read-only permissions.
 *
 * Installation tokens are cached IN MEMORY ONLY (per server instance, until 5 minutes before expiry). Nothing here is
 * ever written to the database, logged, or returned to a browser. The private key is parsed per use and never
 * echoed in errors.
 */

import { createPrivateKey, sign, type KeyObject } from "node:crypto";

import { ProviderConfigError, ProviderError, type ProviderConfigReason } from "../adapter";
import { githubRequest, type GithubHttp } from "./api";

const b64u = (v: Buffer | string) => Buffer.from(v).toString("base64url");

/** Accepts a PEM with real newlines, with literal "\n" escapes, wrapped in quotes, or with Windows line endings. */
export function normalizePrivateKey(raw: string | undefined): string | null {
  if (!raw) return null;
  let pem = raw.trim();
  if ((pem.startsWith('"') && pem.endsWith('"')) || (pem.startsWith("'") && pem.endsWith("'"))) pem = pem.slice(1, -1);
  pem = pem.replace(/\\r/g, "").replace(/\\n/g, "\n").replace(/\r\n?/g, "\n").trim();
  // A PEM pasted into a single-line dashboard field often arrives with its line breaks turned into spaces:
  // rebuild the body (base64 never contains spaces) so the key still parses.
  const flat = /^(-----BEGIN (?:RSA )?PRIVATE KEY-----)\s+([A-Za-z0-9+/=\s]+?)\s+(-----END (?:RSA )?PRIVATE KEY-----)$/.exec(pem);
  if (flat && !pem.includes("\n")) pem = `${flat[1]}\n${flat[2].split(/\s+/).join("\n")}\n${flat[3]}`;
  if (!/^-----BEGIN (RSA )?PRIVATE KEY-----\n[\s\S]+\n-----END (RSA )?PRIVATE KEY-----$/.test(pem)) return null;
  return `${pem}\n`;
}

function loadKey(raw: string | undefined): KeyObject {
  if (!raw || raw.trim() === "") throw new ProviderConfigError("github_private_key_missing");
  const pem = normalizePrivateKey(raw);
  if (!pem) throw new ProviderConfigError("github_private_key_unparsable");
  let key: KeyObject;
  try {
    key = createPrivateKey(pem);
  } catch {
    throw new ProviderConfigError("github_private_key_unparsable"); // never echo the key or the parser's message
  }
  if (key.asymmetricKeyType !== "rsa") throw new ProviderConfigError("github_private_key_not_rsa");
  return key;
}

/**
 * Why a GITHUB_APP_ID value cannot be used, as a fixed code (never the value), or null when it is a numeric App ID.
 * GitHub shows two ids on the app page: the numeric "App ID" (what a JWT's `iss` needs) and the "Client ID"
 * (`Iv1.` followed by hex, or `Iv23` and letters on newer apps). Pasting the Client ID is the usual mistake.
 */
export function githubAppIdProblem(appId: string | undefined): ProviderConfigReason | null {
  const v = appId?.trim() ?? "";
  if (v === "") return "github_app_id_missing";
  if (/^\d{1,20}$/.test(v)) return null;
  if (/^Iv\d*[.A-Za-z0-9]/.test(v)) return "github_app_id_is_client_id";
  return "github_app_id_not_numeric";
}

/** JWT that authenticates as the GitHub App (≤ 10 min). */
export function createAppJwt(appId: string | undefined, privateKey: string | undefined, nowMs: number): string {
  const problem = githubAppIdProblem(appId);
  if (problem || !appId) throw new ProviderConfigError(problem ?? "github_app_id_missing");
  const key = loadKey(privateKey);
  const now = Math.floor(nowMs / 1000);
  const header = b64u(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = b64u(JSON.stringify({ iat: now - 60, exp: now + 9 * 60, iss: appId.trim() }));
  const signature = sign("sha256", Buffer.from(`${header}.${payload}`), key);
  return `${header}.${payload}.${b64u(signature)}`;
}

interface CachedToken {
  token: string;
  expiresAtMs: number;
}

/** Re-mint when less than this remains (a long history import must not run on an expiring token). */
export const TOKEN_REFRESH_MARGIN_MS = 5 * 60 * 1000;

export class InstallationTokenCache {
  private readonly tokens = new Map<string, CachedToken>();

  /** A valid installation token for `installationId` (cached or freshly minted). */
  async get(http: GithubHttp, env: Record<string, string | undefined>, installationId: string): Promise<string> {
    if (!/^\d{1,20}$/.test(installationId)) throw new ProviderError("not_found");
    const hit = this.tokens.get(installationId);
    if (hit && hit.expiresAtMs - http.now() > TOKEN_REFRESH_MARGIN_MS) return hit.token;
    this.tokens.delete(installationId);

    const jwt = createAppJwt(env.GITHUB_APP_ID, env.GITHUB_APP_PRIVATE_KEY, http.now());
    const r = await githubRequest(http, `/app/installations/${installationId}/access_tokens`, { method: "POST", auth: { kind: "bearer", token: jwt }, body: {} });
    const data = r.data as Record<string, unknown> | null;
    const token = data && typeof data.token === "string" ? data.token : null;
    const expiresAt = data && typeof data.expires_at === "string" ? Date.parse(data.expires_at) : NaN;
    if (!token || Number.isNaN(expiresAt)) throw new ProviderError("invalid_response");
    this.tokens.set(installationId, { token, expiresAtMs: expiresAt });
    return token;
  }

  /** Forget a token (after a 401, or when the installation is disconnected). */
  invalidate(installationId: string): void {
    this.tokens.delete(installationId);
  }

  get size(): number {
    return this.tokens.size;
  }
}

/** Process-wide cache (memory only; a cold start simply mints a new token). */
export const installationTokens = new InstallationTokenCache();
