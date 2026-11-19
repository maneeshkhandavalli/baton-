/**
 * Minimal GitHub REST client over `ctx.fetch` (server only). Every call is authenticated with a short-lived token
 * passed in by the caller (installation token, app JWT, or a user-to-server token that is discarded right after
 * use). Errors are ProviderError codes only: response bodies, tokens and URLs never appear in messages or logs.
 *
 * Pagination follows the `Link: <…>; rel="next"` header, and only to https://api.github.com (a token is never
 * sent to another host). Rate limits (429, or 403 with x-ratelimit-remaining: 0 / retry-after) become
 * ProviderError("rate_limited", retryAfterSeconds).
 */

import { ProviderError } from "../adapter";

export const GITHUB_API = "https://api.github.com";
export const GITHUB_WEB = "https://github.com";
const API_VERSION = "2022-11-28";

export interface GithubHttp {
  fetch: typeof fetch;
  now(): number;
}

export type GithubAuth = { kind: "bearer"; token: string } | { kind: "basic"; user: string; password: string } | { kind: "none" };

export interface GithubCall {
  method?: "GET" | "POST" | "DELETE";
  auth: GithubAuth;
  /** JSON body (POST/DELETE). */
  body?: Record<string, unknown>;
}

function headers(auth: GithubAuth, hasBody: boolean): Record<string, string> {
  const h: Record<string, string> = {
    accept: "application/vnd.github+json",
    "x-github-api-version": API_VERSION,
    "user-agent": "Baton-Connector",
  };
  if (hasBody) h["content-type"] = "application/json";
  if (auth.kind === "bearer") h.authorization = `Bearer ${auth.token}`;
  if (auth.kind === "basic") h.authorization = `Basic ${Buffer.from(`${auth.user}:${auth.password}`).toString("base64")}`;
  return h;
}

/** Maps a non-2xx response to a ProviderError (never reads or exposes the body). */
export function errorForResponse(res: Response, nowMs: number): ProviderError {
  const remaining = res.headers.get("x-ratelimit-remaining");
  const retryAfter = res.headers.get("retry-after");
  if (res.status === 429 || (res.status === 403 && (remaining === "0" || retryAfter !== null))) {
    let seconds: number | null = null;
    if (retryAfter && /^\d{1,6}$/.test(retryAfter)) seconds = Number(retryAfter);
    else {
      const reset = res.headers.get("x-ratelimit-reset");
      if (reset && /^\d{1,12}$/.test(reset)) seconds = Math.max(1, Number(reset) - Math.floor(nowMs / 1000));
    }
    return new ProviderError("rate_limited", seconds ?? 60);
  }
  if (res.status === 401) return new ProviderError("unauthorized");
  if (res.status === 403) return new ProviderError("forbidden");
  if (res.status === 404 || res.status === 410) return new ProviderError("not_found");
  if (res.status >= 500) return new ProviderError("unavailable");
  return new ProviderError("invalid_response");
}

function assertGithubUrl(url: string, base: string): void {
  if (!url.startsWith(`${base}/`)) throw new ProviderError("invalid_response");
}

async function send(http: GithubHttp, url: string, call: GithubCall): Promise<Response> {
  const hasBody = call.body !== undefined;
  try {
    return await http.fetch(url, {
      method: call.method ?? "GET",
      headers: headers(call.auth, hasBody),
      body: hasBody ? JSON.stringify(call.body) : undefined,
      redirect: "error",
    });
  } catch {
    throw new ProviderError("unavailable");
  }
}

async function readJson(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    throw new ProviderError("invalid_response");
  }
}

/** One request to the REST API (`pathOrUrl` is "/path" or an absolute https://api.github.com URL). */
export async function githubRequest(http: GithubHttp, pathOrUrl: string, call: GithubCall): Promise<{ data: unknown; next: string | null; status: number }> {
  const url = pathOrUrl.startsWith("/") ? GITHUB_API + pathOrUrl : pathOrUrl;
  assertGithubUrl(url, GITHUB_API);
  const res = await send(http, url, call);
  if (!res.ok) throw errorForResponse(res, http.now());
  if (res.status === 204) return { data: null, next: null, status: 204 };
  return { data: await readJson(res), next: nextLink(res.headers.get("link")), status: res.status };
}

/** Parses `Link: <url>; rel="next"`; only api.github.com URLs are followed. */
export function nextLink(header: string | null): string | null {
  if (!header) return null;
  for (const part of header.split(",")) {
    const m = /<([^>]+)>\s*;\s*rel="next"/.exec(part.trim());
    if (m && m[1].startsWith(`${GITHUB_API}/`)) return m[1];
  }
  return null;
}

/**
 * Collects items across pages. `pick` extracts the array from each page (e.g. `d => d.repositories`).
 * Stops at `maxItems` or `maxPages`, whichever comes first.
 */
export async function githubPaginate<T>(
  http: GithubHttp,
  path: string,
  auth: GithubAuth,
  pick: (data: unknown) => unknown[],
  map: (item: unknown) => T | null,
  limits: { maxItems: number; maxPages: number },
): Promise<T[]> {
  const out: T[] = [];
  let url: string | null = path;
  for (let page = 0; url && page < limits.maxPages && out.length < limits.maxItems; page++) {
    const r: { data: unknown; next: string | null } = await githubRequest(http, url, { auth });
    for (const item of pick(r.data)) {
      const v = map(item);
      if (v !== null) out.push(v);
      if (out.length >= limits.maxItems) break;
    }
    url = r.next;
  }
  return out;
}

/**
 * Exchanges an OAuth `code` (from the install callback) for a user-to-server token. Returns null when GitHub
 * refuses the code (expired, reused, wrong client). The token is returned to the caller only to prove access
 * and must be discarded right after (never stored).
 */
export async function exchangeOAuthCode(http: GithubHttp, clientId: string, clientSecret: string, code: string): Promise<string | null> {
  let res: Response;
  try {
    res = await http.fetch(`${GITHUB_WEB}/login/oauth/access_token`, {
      method: "POST",
      headers: { accept: "application/json", "content-type": "application/json", "user-agent": "Baton-Connector" },
      body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, code }),
      redirect: "error",
    });
  } catch {
    throw new ProviderError("unavailable");
  }
  if (!res.ok) throw errorForResponse(res, http.now());
  const data = (await readJson(res)) as Record<string, unknown> | null;
  const token = data && typeof data.access_token === "string" ? data.access_token : null;
  return token && token.length > 0 && token.length < 1000 ? token : null;
}

/** Best-effort revocation of a user-to-server token (DELETE /applications/{client_id}/token). Never throws. */
export async function revokeUserToken(http: GithubHttp, clientId: string, clientSecret: string, token: string): Promise<void> {
  try {
    await githubRequest(http, `/applications/${encodeURIComponent(clientId)}/token`, {
      method: "DELETE",
      auth: { kind: "basic", user: clientId, password: clientSecret },
      body: { access_token: token },
    });
  } catch {
    // the token expires on its own (8 h); it was never stored
  }
}
