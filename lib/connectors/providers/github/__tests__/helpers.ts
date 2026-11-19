// Shared synthetic fixtures for the GitHub connector tests. No real credentials, no network.
import { createHmac, generateKeyPairSync } from "node:crypto";

import { MemoryConnectorStore } from "../../../store-memory";

export const NOW = Date.parse("2026-11-19T10:00:00Z");
export const CREATOR = "11111111-1111-4111-8111-111111111111";
export const OTHER = "22222222-2222-4222-8222-222222222222";
export const HANDOVER = "33333333-3333-4333-8333-333333333333";
export const INSTALLATION_ID = "777001";
export const REPO_ID = "4242";

// A throwaway key generated per test run (never a real GitHub App key).
const keys = generateKeyPairSync("rsa", { modulusLength: 2048 });
export const TEST_PUBLIC_KEY = keys.publicKey;
export const TEST_PRIVATE_PEM = keys.privateKey.export({ type: "pkcs1", format: "pem" }).toString();

export const SECRETS = {
  webhook: "whsec_synthetic_test_value_0001",
  state: "state_secret_synthetic_test_value_0123456789",
  clientSecret: "client_secret_synthetic_test_value",
  userToken: "ghu_synthetic_user_token",
  installationToken: "ghs_synthetic_test_token",
  code: "synthcode0123456789",
};

export const ENV: Record<string, string> = {
  BATON_SITE_URL: "https://baton.example.test",
  CONNECTOR_STATE_SECRET: SECRETS.state,
  CONNECTOR_SECRET_KEY: Buffer.alloc(32, 7).toString("base64url"),
  GITHUB_APP_ID: "123456",
  GITHUB_APP_SLUG: "baton-handover-test",
  GITHUB_APP_PRIVATE_KEY: TEST_PRIVATE_PEM.trim().replace(/\n/g, "\\n"), // escaped, as in a .env file
  GITHUB_WEBHOOK_SECRET: SECRETS.webhook,
  GITHUB_APP_CLIENT_ID: "Iv1.synthetic0000",
  GITHUB_APP_CLIENT_SECRET: SECRETS.clientSecret,
};

export const sign = (body: string, secret = SECRETS.webhook) => "sha256=" + createHmac("sha256", secret).update(body).digest("hex");

export async function setupStore(opts: { consent?: boolean; settings?: Record<string, unknown> } = {}) {
  // Consent recorded two hours before NOW: fixture items created at 09:00 are inside the capture window.
  const store = new MemoryConnectorStore(() => NOW - 2 * 3600 * 1000);
  store.handovers.set(HANDOVER, { id: HANDOVER, creatorProfileId: CREATOR, state: "draft" });
  const user = { kind: "user", profileId: CREATOR } as const;
  const inst = await store.upsertInstallation(user, { provider: "github", externalAccountId: INSTALLATION_ID, accountLabel: "acme", scopes: ["issues", "metadata"], credentials: null });
  const link = await store.linkChannel(user, { installationId: inst.id, handoverId: HANDOVER, externalChannelId: REPO_ID, channelLabel: "acme/sponsors", settings: opts.settings });
  if (opts.consent !== false) await store.recordCaptureConsent(user, link.id, "connector-capture-v1");
  return { store, user, inst, link };
}

export interface FakeCall {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: string | null;
}

/** A fetch fake: `handler` answers by method + URL; every call is recorded. */
export function fakeFetch(handler: (method: string, url: URL, call: FakeCall) => Response | Promise<Response>) {
  const calls: FakeCall[] = [];
  const fetchFn = (async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = String(input instanceof Request ? input.url : input);
    const call: FakeCall = {
      method: init.method ?? "GET",
      url,
      headers: Object.fromEntries(Object.entries((init.headers as Record<string, string>) ?? {}).map(([k, v]) => [k.toLowerCase(), v])),
      body: typeof init.body === "string" ? init.body : null,
    };
    calls.push(call);
    return handler(call.method, new URL(url), call);
  }) as typeof fetch;
  return { fetch: fetchFn, calls };
}

export const jsonResponse = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

export const SENDER = { login: "asha", type: "User" };
export const REPO = { id: Number(REPO_ID), full_name: "acme/sponsors", default_branch: "main" };
export const INSTALLATION = { id: Number(INSTALLATION_ID) };

export const basePayload = (extra: Record<string, unknown>) => ({ installation: INSTALLATION, repository: REPO, sender: SENDER, ...extra });

export const issue = (over: Record<string, unknown> = {}) => ({
  number: 12,
  title: "Track sponsor payments",
  body: "We need one sheet for sponsor payments.",
  user: { login: "asha", type: "User" },
  created_at: "2026-11-19T09:00:00Z",
  updated_at: "2026-11-19T09:00:00Z",
  closed_at: null,
  state_reason: null,
  ...over,
});

export const pr = (over: Record<string, unknown> = {}) => ({
  number: 7,
  title: "Add sponsor tracker",
  body: "Adds the tracker.\n\n<!-- template: remove this -->",
  user: { login: "ravi", type: "User" },
  draft: false,
  merged: false,
  created_at: "2026-11-19T09:10:00Z",
  updated_at: "2026-11-19T09:10:00Z",
  closed_at: null,
  merged_at: null,
  ...over,
});
