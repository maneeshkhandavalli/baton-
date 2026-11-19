/**
 * Test helpers for the bot connectors (synthetic only; never imported by the app). A fake `fetch` that answers by
 * method + URL prefix and records every call, and `BotRouteDeps` around a MemoryConnectorStore with a fixed clock.
 */

import { generateKeyPairSync } from "node:crypto";

import { parseConnectorSecretKey } from "../../secrets";
import { MemoryConnectorStore } from "../../store-memory";
import type { ConnectorLogEntry, BotRouteDeps } from "./shared";

export const NOW = Date.parse("2026-11-19T10:00:00Z");
export const CREATOR = "11111111-1111-4111-8111-111111111111";
export const OTHER = "22222222-2222-4222-8222-222222222222";
export const HANDOVER = "33333333-3333-4333-8333-333333333333";
export const SITE = "https://baton.example.test";
export const STATE_SECRET = "state-secret-synthetic-0123456789abcdef";
/** 32 zero-ish bytes, base64url: synthetic key for sealing in tests. */
export const SECRET_KEY_RAW = Buffer.alloc(32, 7).toString("base64url");

export const discordKeys = generateKeyPairSync("ed25519");
export const DISCORD_PUBLIC_KEY_HEX = (discordKeys.publicKey.export({ format: "der", type: "spki" }) as Buffer).subarray(12).toString("hex");

export const SYNTHETIC_ENV: Record<string, string> = {
  BATON_SITE_URL: SITE,
  CONNECTOR_STATE_SECRET: STATE_SECRET,
  CONNECTOR_SECRET_KEY: SECRET_KEY_RAW,
  DISCORD_APPLICATION_ID: "900000000000000001",
  DISCORD_PUBLIC_KEY: DISCORD_PUBLIC_KEY_HEX,
  DISCORD_BOT_TOKEN: "discord-synthetic-token",
  DISCORD_CLIENT_SECRET: "discord-synthetic-client-secret",
  SLACK_CLIENT_ID: "111.222",
  SLACK_CLIENT_SECRET: "slack-synthetic-client-secret",
  SLACK_SIGNING_SECRET: "slack-synthetic-signing-secret",
  TELEGRAM_BOT_TOKEN: "123456:telegram-synthetic-token",
  TELEGRAM_BOT_USERNAME: "BatonHandoverBot",
  TELEGRAM_WEBHOOK_SECRET: "telegram-synthetic-webhook-secret",
};

export interface FetchCall {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: string | null;
}

export type FakeAnswer = { status?: number; json?: unknown; headers?: Record<string, string> } | ((call: FetchCall) => { status?: number; json?: unknown; headers?: Record<string, string> });

/** routes: "GET https://host/path" prefix → answer (first match wins; longest prefixes first is the caller's job). */
export function fakeFetch(routes: Array<[string, FakeAnswer]>) {
  const calls: FetchCall[] = [];
  const fn = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const method = (init?.method ?? "GET").toUpperCase();
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((v, k) => (headers[k] = v));
    const call: FetchCall = { method, url, headers, body: typeof init?.body === "string" ? init.body : null };
    calls.push(call);
    const hit = routes.find(([k]) => `${method} ${url}`.startsWith(k));
    if (!hit) return new Response(JSON.stringify({ message: "no fake route" }), { status: 599 });
    const a = typeof hit[1] === "function" ? hit[1](call) : hit[1];
    return new Response(a.json === undefined ? null : JSON.stringify(a.json), { status: a.status ?? 200, headers: { "content-type": "application/json", ...(a.headers ?? {}) } });
  }) as typeof fetch;
  return { fetch: fn, calls };
}

export function makeDeps(opts: { store?: MemoryConnectorStore; fetch?: typeof fetch; actor?: string | null; env?: Record<string, string | undefined>; now?: number } = {}) {
  const now = opts.now ?? NOW;
  const store = opts.store ?? new MemoryConnectorStore(() => now);
  if (!store.handovers.has(HANDOVER)) store.handovers.set(HANDOVER, { id: HANDOVER, creatorProfileId: CREATOR, state: "draft" });
  const env = opts.env ?? { ...SYNTHETIC_ENV };
  const key = parseConnectorSecretKey(env.CONNECTOR_SECRET_KEY, env.CONNECTOR_SECRET_KEY_VERSION);
  const logs: ConnectorLogEntry[] = [];
  const actor = opts.actor === undefined ? CREATOR : opts.actor;
  const deps: BotRouteDeps = {
    store,
    env,
    fetch: opts.fetch ?? fakeFetch([]).fetch,
    now: () => now,
    secretKey: key.ok ? key.key : null,
    async credentials(installation) {
      if (!key.ok) return null;
      const { openCredentials } = await import("../../secrets");
      return openCredentials(key.key, installation.provider, installation.externalAccountId, await store.getInstallationCredentials(installation.id));
    },
    async getActor() {
      return actor ? { profileId: actor } : null;
    },
    log: (e) => logs.push(e),
  };
  return { deps, store, logs, env };
}

export function getRequest(url: string): Request {
  return new Request(url, { method: "GET" });
}
