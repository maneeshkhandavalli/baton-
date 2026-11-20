// GitHub verification checklist (2026-11-21): HMAC-SHA256 over the RAW body with the webhook secret, refusals before
// anything is parsed or recorded, duplicate redeliveries (same X-GitHub-Delivery) stored once, a failed delivery
// reprocessed on redelivery, and a numeric App ID diagnostic instead of the generic "not set up". Synthetic only.
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, it } from "node:test";

import { ProviderConfigError, ProviderError } from "../../adapter";
import { verifyGithubSignature } from "../../../verify";
import type { ConnectorStore } from "../../../types";
import { createAppJwt, githubAppIdProblem } from "../app-auth";
import { handleGithubCallback, handleGithubInstall, handleGithubWebhook, type GithubRouteDeps } from "../routes";
import { basePayload, CREATOR, ENV, HANDOVER, issue, NOW, SECRETS, setupStore, sign, TEST_PRIVATE_PEM } from "./helpers";
import { DEMO_ACCOUNTS_FULL_ACCESS } from "../../../../demo-accounts";

const SKIP_F3 = DEMO_ACCOUNTS_FULL_ACCESS ? "judges have full access (owner decision 21 Nov); restores with DEMO_ACCOUNTS_FULL_ACCESS = false" : false;

const SITE = ENV.BATON_SITE_URL;

function req(raw: string, headers: Record<string, string | null>) {
  const h: Record<string, string> = { "content-type": "application/json", "x-github-event": "issues", "x-github-delivery": "aaaaaaaa-0000-4000-8000-000000000001" };
  for (const [k, v] of Object.entries(headers)) {
    if (v === null) delete h[k];
    else h[k] = v;
  }
  return new Request(`${SITE}/api/connectors/github/webhook`, { method: "POST", headers: h, body: raw });
}

async function deps() {
  const s = await setupStore();
  const lines: string[] = [];
  return { ...s, lines, deps: { env: ENV, now: () => NOW, store: () => s.store as ConnectorStore, log: (l: Record<string, unknown>) => lines.push(JSON.stringify(l)) } };
}

const opened = JSON.stringify(basePayload({ action: "opened", issue: issue() }));

describe("GitHub webhook HMAC (X-Hub-Signature-256)", () => {
  it("verifyGithubSignature: exact sha256 HMAC of the raw bytes only", () => {
    const good = "sha256=" + createHmac("sha256", SECRETS.webhook).update(opened).digest("hex");
    assert.equal(verifyGithubSignature(SECRETS.webhook, opened, good), true);
    assert.equal(verifyGithubSignature(SECRETS.webhook, opened + " ", good), false, "one extra byte");
    assert.equal(verifyGithubSignature(SECRETS.webhook, JSON.stringify(JSON.parse(opened), null, 2), good), false, "re-serialised JSON is not the raw body");
    assert.equal(verifyGithubSignature(SECRETS.webhook, opened, good.toUpperCase()), false, "case matters");
    assert.equal(verifyGithubSignature(SECRETS.webhook, opened, good.replace("sha256=", "sha1=")), false, "sha1 header refused");
    assert.equal(verifyGithubSignature(SECRETS.webhook, opened, good.slice(0, -2)), false, "truncated");
    assert.equal(verifyGithubSignature("", opened, good), false, "no secret configured: always refused");
    assert.equal(verifyGithubSignature(SECRETS.webhook, opened, null), false);
  });

  it("the route refuses before parsing or recording: wrong secret, tampered body, sha1-only, missing header", async () => {
    const { deps: d, store } = await deps();
    const tampered = opened.replace("\"opened\"", "\"closed\"");
    assert.notEqual(tampered, opened);
    const cases: Array<[string, Record<string, string | null>]> = [
      [opened, { "x-hub-signature-256": sign(opened, "whsec_not_the_secret") }],
      [tampered, { "x-hub-signature-256": sign(opened) }],
      [opened, { "x-hub-signature-256": null, "x-hub-signature": "sha1=" + createHmac("sha1", SECRETS.webhook).update(opened).digest("hex") }],
      [opened, { "x-hub-signature-256": null }],
    ];
    for (const [raw, headers] of cases) assert.equal((await handleGithubWebhook(req(raw, headers), d)).status, 401);
    assert.equal(store.events.length, 0, "no delivery recorded for an unverified request");
  });

  it("a GITHUB_WEBHOOK_SECRET mismatch is logged as a code only (never the secret or the signature)", async () => {
    const { deps: d, lines } = await deps();
    const badSig = sign(opened, "whsec_not_the_secret");
    await handleGithubWebhook(req(opened, { "x-hub-signature-256": badSig }), d);
    assert.equal(lines.length, 1);
    assert.match(lines[0], /"code":"bad_signature"/);
    assert.ok(!lines[0].includes(SECRETS.webhook) && !lines[0].includes(badSig.slice(7, 30)));
  });
});

describe("GitHub duplicate redelivery (Recent Deliveries → Redeliver)", () => {
  it("the same delivery id three times is recorded and buffered once; the answers are all 200", async () => {
    const { deps: d, store, link } = await deps();
    const statuses = [];
    for (let i = 0; i < 3; i++) statuses.push((await handleGithubWebhook(req(opened, { "x-hub-signature-256": sign(opened), "x-github-delivery": "redeliver-1" }), d)).status);
    assert.deepEqual(statuses, [200, 200, 200]);
    assert.equal(store.events.length, 1);
    assert.equal(store.bufferedFor(link.id).length, 1);
  });

  it("a different delivery of the same issue updates the one buffered message (no duplicate content)", async () => {
    const { deps: d, store, link } = await deps();
    await handleGithubWebhook(req(opened, { "x-hub-signature-256": sign(opened), "x-github-delivery": "a-1" }), d);
    await handleGithubWebhook(req(opened, { "x-hub-signature-256": sign(opened), "x-github-delivery": "a-2" }), d);
    assert.equal(store.events.length, 2);
    assert.equal(store.bufferedFor(link.id).length, 1);
  });

  it("a delivery that failed mid-way is reprocessed when GitHub redelivers it", async () => {
    const { deps: d, store, link } = await deps();
    const flaky: ConnectorStore = Object.create(store);
    flaky.bufferMessages = async () => {
      throw new Error("db timeout");
    };
    assert.equal((await handleGithubWebhook(req(opened, { "x-hub-signature-256": sign(opened), "x-github-delivery": "f-1" }), { ...d, store: () => flaky })).status, 503);
    assert.equal(store.bufferedFor(link.id).length, 0);
    assert.equal((await handleGithubWebhook(req(opened, { "x-hub-signature-256": sign(opened), "x-github-delivery": "f-1" }), d)).status, 200);
    assert.equal(store.bufferedFor(link.id).length, 1);
    assert.equal(store.events.length, 1, "still one ledger row for the delivery");
  });
});

describe("GitHub App ID vs Client ID diagnostic", () => {
  it("names the problem as a fixed code, never the value", () => {
    assert.equal(githubAppIdProblem("123456"), null);
    assert.equal(githubAppIdProblem(" 123456 "), null);
    assert.equal(githubAppIdProblem("Iv1.0123456789abcdef"), "github_app_id_is_client_id");
    assert.equal(githubAppIdProblem("Iv23liAbCdEfGhIjKlMn"), "github_app_id_is_client_id");
    assert.equal(githubAppIdProblem("baton-handover-by-maneesh"), "github_app_id_not_numeric");
    assert.equal(githubAppIdProblem(""), "github_app_id_missing");
    assert.equal(githubAppIdProblem(undefined), "github_app_id_missing");
  });

  it("createAppJwt throws ProviderConfigError (still a not_configured ProviderError) without echoing the value", () => {
    const clientId = "Iv1.0123456789abcdef";
    assert.throws(
      () => createAppJwt(clientId, TEST_PRIVATE_PEM, NOW),
      (e: unknown) => e instanceof ProviderConfigError && e instanceof ProviderError && e.code === "not_configured" && e.reason === "github_app_id_is_client_id" && !e.message.includes(clientId),
    );
    assert.throws(() => createAppJwt("123456", "-----BEGIN PRIVATE KEY-----\nnot base64 at all\n-----END PRIVATE KEY-----", NOW), (e: unknown) => e instanceof ProviderConfigError && e.reason === "github_private_key_unparsable");
    assert.throws(() => createAppJwt("123456", "", NOW), (e: unknown) => e instanceof ProviderConfigError && e.reason === "github_private_key_missing");
  });
});

describe("F3: shared demo accounts can't install or bind the GitHub App", { skip: SKIP_F3 }, () => {
  const KEYS = ["BATON_DEMO_EMAILS", "NEXT_PUBLIC_BATON_DEMO_CREATOR_EMAIL", "NEXT_PUBLIC_BATON_DEMO_INCOMING_EMAIL"] as const;
  let saved: Record<string, string | undefined> = {};
  beforeEach(() => {
    saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
    process.env.BATON_DEMO_EMAILS = "judge.creator@demo.test";
    delete process.env.NEXT_PUBLIC_BATON_DEMO_CREATOR_EMAIL;
    delete process.env.NEXT_PUBLIC_BATON_DEMO_INCOMING_EMAIL;
  });
  afterEach(() => {
    for (const k of KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  function routeDeps(store: ConnectorStore, email: string) {
    let fetched = 0;
    let storeCalls = 0;
    const counting = new Proxy(store, { get: (t, p) => { const v = Reflect.get(t, p); return typeof v === "function" ? (...a: unknown[]) => { storeCalls++; return v.apply(t, a); } : v; } });
    const d: GithubRouteDeps = {
      env: ENV, now: () => NOW, store: () => counting, nonce: () => "n",
      fetch: (async () => { fetched++; throw new Error("no network"); }) as typeof fetch,
      getActor: async () => ({ profileId: CREATOR, email }),
      log: () => {},
    };
    return { d, fetched: () => fetched, storeCalls: () => storeCalls };
  }

  it("install and callback answer 403 for a demo account before any store or GitHub call", async () => {
    const { store } = await setupStore();
    const r = routeDeps(store, "Judge.Creator@demo.test");
    const install = await handleGithubInstall(new Request(`${SITE}/api/connectors/github/install?handover=${HANDOVER}`), r.d);
    assert.equal(install.status, 403);
    const cb = await handleGithubCallback(new Request(`${SITE}/api/connectors/github/callback?code=abc&installation_id=777001&setup_action=install&state=x`), r.d);
    assert.equal(cb.status, 403);
    assert.equal(r.storeCalls(), 0);
    assert.equal(r.fetched(), 0);
  });

  it("an ordinary account still gets the GitHub install redirect", async () => {
    const { store } = await setupStore();
    const r = routeDeps(store, "someone@example.test");
    const install = await handleGithubInstall(new Request(`${SITE}/api/connectors/github/install?handover=${HANDOVER}`), r.d);
    assert.equal(install.status, 303);
    assert.match(install.headers.get("location") ?? "", /^https:\/\/github\.com\/apps\//);
  });
});
