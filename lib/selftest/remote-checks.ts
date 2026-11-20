/**
 * Network checks for /test (Telegram webhook, Omega usage, own pages). `fetch` is injected so tests can feed
 * provider answers that contain secrets and assert they never reach the output. Error rows carry fixed text or
 * an HTTP status only: never a URL (the Telegram URL contains the bot token) or a provider body.
 */

import { omegaBaseUrl } from "../ai/config";
import { hostOf, redactText, secretValues } from "./redact";
import { fail, ok, warn, type CheckRow, type SelfTestEnv } from "./types";

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export const CHECK_TIMEOUT_MS = 5_000;

async function getJson(fetchImpl: FetchLike, url: string, init: RequestInit = {}): Promise<{ status: number; body: unknown }> {
  const res = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(CHECK_TIMEOUT_MS), cache: "no-store" });
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  return { status: res.status, body };
}

/** Telegram getWebhookInfo: webhook HOST, pending count, last error (trimmed), and whether the host is ours. */
export async function telegramWebhookCheck(env: SelfTestEnv, fetchImpl: FetchLike): Promise<CheckRow> {
  const token = env.TELEGRAM_BOT_TOKEN?.trim();
  if (!token) return warn("Telegram webhook", "skipped, Telegram is not configured");
  const res = await getJson(fetchImpl, `https://api.telegram.org/bot${token}/getWebhookInfo`);
  const body = res.body as { ok?: boolean; result?: { url?: string; pending_update_count?: number; last_error_message?: string } } | null;
  if (!body?.ok || !body.result) return fail("Telegram webhook", `getWebhookInfo refused (HTTP ${res.status})`);
  const w = body.result;
  const host = hostOf(w.url);
  const siteHost = hostOf(env.BATON_SITE_URL);
  const pending = typeof w.pending_update_count === "number" ? w.pending_update_count : 0;
  // Telegram's error text can echo the request; drop URLs and any configured secret before showing it.
  const rawError = typeof w.last_error_message === "string" ? redactText(w.last_error_message, secretValues(env)).replace(/https?:\/\/\S+/g, "[url]") : "";
  const lastError = rawError ? `, last error: ${rawError.slice(0, 120)}` : "";
  const detail = `host ${host ?? "(not set)"}${siteHost ? (host === siteHost ? ", matches the site" : `, expected ${siteHost}`) : ""}, pending ${pending}${lastError}`;
  if (!host || (siteHost && host !== siteHost)) return fail("Telegram webhook", detail);
  return lastError ? warn("Telegram webhook", detail) : ok("Telegram webhook", detail);
}

/** Finds the first numeric field whose key matches, a few levels deep. */
function findNumber(value: unknown, key: RegExp, depth = 0): number | null {
  if (depth > 3 || value === null || typeof value !== "object") return null;
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (key.test(k) && typeof v === "number" && Number.isFinite(v)) return v;
  }
  for (const v of Object.values(value as Record<string, unknown>)) {
    const found = findNumber(v, key, depth + 1);
    if (found !== null) return found;
  }
  return null;
}

/** Omega quota: remaining and used tokens and usage percent only (GET <base>/v1/usage). */
export async function omegaUsageCheck(env: SelfTestEnv, fetchImpl: FetchLike): Promise<CheckRow> {
  if (env.AI_PROVIDER !== "omega") return ok("Omega usage", "skipped, the provider is not omega");
  const key = env.OMEGA_API_KEY?.trim();
  const base = omegaBaseUrl(env.OMEGA_API_BASE_URL);
  if (!key) return fail("Omega usage", "OMEGA_API_KEY is not set");
  if (!base) return fail("Omega usage", "OMEGA_API_BASE_URL is not a safe https URL");
  const res = await getJson(fetchImpl, `${base}/v1/usage`, { headers: { "x-api-key": key, authorization: `Bearer ${key}`, accept: "application/json" } });
  if (res.status !== 200) return fail("Omega usage", `usage endpoint answered HTTP ${res.status}`);
  const remaining = findNumber(res.body, /remain/i);
  const used = findNumber(res.body, /^(used|used_tokens|tokens_used|usage)$/i) ?? findNumber(res.body, /used/i);
  const percent = findNumber(res.body, /percent|pct/i);
  const fmt = (n: number | null) => (n === null ? "n/a" : n.toLocaleString("en-US"));
  const detail = `remaining ${fmt(remaining)}, used ${fmt(used)}, usage ${percent === null ? "n/a" : `${Math.round(percent * 10) / 10}%`} (host ${hostOf(base)})`;
  if (remaining === null && used === null && percent === null) return warn("Omega usage", `reachable, but no usage numbers recognised (host ${hostOf(base)})`);
  if ((percent !== null && percent >= 90) || remaining === 0) return warn("Omega usage", detail);
  return ok("Omega usage", detail);
}

export const PAGE_PATHS = ["/", "/login", "/demo", "/demo/workspace"] as const;

/** Server-side GET of a page on the configured site origin; redirects are never followed. */
export async function pageCheck(siteOrigin: string, path: string, fetchImpl: FetchLike, now: () => number = Date.now): Promise<CheckRow> {
  const started = now();
  const res = await fetchImpl(new URL(path, siteOrigin).toString(), { redirect: "manual", signal: AbortSignal.timeout(CHECK_TIMEOUT_MS), cache: "no-store" });
  const ms = Math.round(now() - started);
  try {
    await res.body?.cancel();
  } catch {
    /* body already consumed or not streamable */
  }
  const name = `GET ${path}`;
  if (res.status >= 200 && res.status < 300) return ok(name, `HTTP ${res.status} in ${ms} ms`);
  if (res.status >= 300 && res.status < 400) {
    const loc = res.headers.get("location");
    const target = loc ? (hostOf(new URL(loc, siteOrigin).toString()) === hostOf(siteOrigin) ? `same host ${new URL(loc, siteOrigin).pathname}` : `another host`) : "no location";
    return warn(name, `HTTP ${res.status} redirect to ${target} in ${ms} ms`);
  }
  return fail(name, `HTTP ${res.status} in ${ms} ms`);
}
