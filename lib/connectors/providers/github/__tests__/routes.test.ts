// GitHub routes (webhook, install, callback) through their exported handlers with constructed Requests, the
// MemoryConnectorStore and a fake fetch. Synthetic secrets only; deterministic clock.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { signConnectorState, verifyConnectorState } from "../../../state";
import type { ConnectorStore } from "../../../types";
import { handleGithubCallback, handleGithubInstall, handleGithubWebhook, type GithubRouteDeps } from "../routes";
import {
  basePayload,
  CREATOR,
  ENV,
  fakeFetch,
  HANDOVER,
  INSTALLATION,
  issue,
  jsonResponse,
  NOW,
  OTHER,
  REPO_ID,
  SECRETS,
  setupStore,
  sign,
  TEST_PRIVATE_PEM,
} from "./helpers";

const SITE = ENV.BATON_SITE_URL;

function webhookRequest(event: string, payload: unknown, opts: { delivery?: string; signature?: string | null; raw?: string } = {}) {
  const raw = opts.raw ?? JSON.stringify(payload);
  const headers: Record<string, string> = { "content-type": "application/json", "x-github-event": event, "x-github-delivery": opts.delivery ?? "11111111-aaaa-4bbb-8ccc-000000000001" };
  const sig = opts.signature === undefined ? sign(raw) : opts.signature;
  if (sig !== null) headers["x-hub-signature-256"] = sig;
  return new Request(`${SITE}/api/connectors/github/webhook`, { method: "POST", headers, body: raw });
}

function logs() {
  const lines: string[] = [];
  return { lines, log: (l: Record<string, unknown>) => lines.push(JSON.stringify(l)) };
}

const ALL_SECRETS = [...Object.values(SECRETS), TEST_PRIVATE_PEM.split("\n")[1], ENV.GITHUB_APP_PRIVATE_KEY.slice(40, 80)];
function assertNoSecrets(text: string) {
  for (const s of ALL_SECRETS) assert.ok(!text.includes(s), `secret leaked: ${s.slice(0, 6)}…`);
}

describe("github webhook route", () => {
  async function deps(opts: Parameters<typeof setupStore>[0] = {}) {
    const s = await setupStore(opts);
    const l = logs();
    return { ...s, ...l, deps: { env: ENV, now: () => NOW, store: () => s.store as ConnectorStore, log: l.log } };
  }
  const opened = basePayload({ action: "opened", issue: issue() });

  it("404 when GitHub is not configured", async () => {
    const { deps: d } = await deps();
    const res = await handleGithubWebhook(webhookRequest("issues", opened), { ...d, env: { ...ENV, GITHUB_WEBHOOK_SECRET: "" } });
    assert.equal(res.status, 404);
  });

  it("verifies the signature first: valid → 200, invalid or missing → 401 and nothing recorded", async () => {
    const { deps: d, store, link } = await deps();
    assert.equal((await handleGithubWebhook(webhookRequest("issues", opened, { signature: sign("{}") }), d)).status, 401);
    assert.equal((await handleGithubWebhook(webhookRequest("issues", opened, { signature: null }), d)).status, 401);
    assert.equal((await handleGithubWebhook(webhookRequest("issues", opened, { signature: sign(JSON.stringify(opened), "whsec_wrong_secret") }), d)).status, 401);
    // garbage JSON with a bad signature is never parsed (401, not 400)
    assert.equal((await handleGithubWebhook(webhookRequest("issues", null, { raw: "{not json", signature: "sha256=00" }), d)).status, 401);
    assert.equal(store.events.length, 0);
    const ok = await handleGithubWebhook(webhookRequest("issues", opened), d);
    assert.equal(ok.status, 200);
    assert.deepEqual(store.bufferedFor(link.id).map((m) => m.providerMessageId), ["issue:12"]);
  });

  it("ping → 200 without touching the store; signed garbage → 400; bad headers → 400", async () => {
    const { deps: d, store } = await deps();
    assert.equal((await handleGithubWebhook(webhookRequest("ping", { zen: "Keep it logically awesome." }), d)).status, 200);
    assert.equal((await handleGithubWebhook(webhookRequest("issues", null, { raw: "{not json" }), d)).status, 400);
    assert.equal((await handleGithubWebhook(webhookRequest("issues", opened, { delivery: "bad id with spaces" }), d)).status, 400);
    assert.equal(store.events.length, 0);
  });

  it("consent gate: a linked repository captures nothing before consent", async () => {
    const { deps: d, store, link } = await deps({ consent: false });
    const res = await handleGithubWebhook(webhookRequest("issues", opened), d);
    assert.equal(res.status, 200);
    assert.equal(store.bufferedFor(link.id).length, 0);
    assert.equal(store.events[0].detail, "no_capturing_link");
  });

  it("de-duplicates redeliveries by X-GitHub-Delivery; edits replace; deletes become kind deleted", async () => {
    const { deps: d, store, link } = await deps();
    await handleGithubWebhook(webhookRequest("issues", opened, { delivery: "d-1" }), d);
    await handleGithubWebhook(webhookRequest("issues", opened, { delivery: "d-1" }), d);
    assert.equal(store.events.length, 1);
    await handleGithubWebhook(webhookRequest("issues", basePayload({ action: "edited", issue: issue({ body: "Updated body", updated_at: "2026-11-19T09:30:00Z" }) }), { delivery: "d-2" }), d);
    const comment = { id: 345, body: "Note", user: { login: "ravi", type: "User" }, created_at: "2026-11-19T09:20:00Z", updated_at: "2026-11-19T09:21:00Z" };
    await handleGithubWebhook(webhookRequest("issue_comment", basePayload({ action: "created", issue: issue(), comment }), { delivery: "d-3" }), d);
    await handleGithubWebhook(webhookRequest("issue_comment", basePayload({ action: "deleted", issue: issue(), comment }), { delivery: "d-4" }), d);
    const buffered = store.bufferedFor(link.id);
    assert.deepEqual(buffered.map((m) => [m.providerMessageId, m.kind]), [["issue:12", "text"], ["issue:12:comment:345", "deleted"]]);
    assert.match(buffered[0].text, /Updated body/);
  });

  it("bots are acknowledged and ignored", async () => {
    const { deps: d, store, link } = await deps();
    const res = await handleGithubWebhook(webhookRequest("issues", { ...opened, sender: { login: "renovate[bot]", type: "Bot" } }), d);
    assert.equal(res.status, 200);
    assert.equal(store.bufferedFor(link.id).length, 0);
  });

  it("family filtering uses the capturing link's settings", async () => {
    const { deps: d, store, link } = await deps({ settings: { families: { issues: false } } });
    await handleGithubWebhook(webhookRequest("issues", opened, { delivery: "f-1" }), d);
    assert.equal(store.bufferedFor(link.id).length, 0);
    const push = basePayload({ ref: "refs/heads/main", commits: [{ id: "e".repeat(40), message: "Add sheet", timestamp: "2026-11-19T09:00:00Z", author: { name: "Asha Rao", email: "asha@example.test" } }] });
    await handleGithubWebhook(webhookRequest("push", push, { delivery: "f-2" }), d);
    assert.deepEqual(store.bufferedFor(link.id).map((m) => m.providerMessageId), [`commit:${"e".repeat(40)}`]);
  });

  it("lifecycle: suspend → unsuspend → repository removed (link paused) → uninstall (revoked, buffer deleted)", async () => {
    const { deps: d, store, link, inst } = await deps();
    await handleGithubWebhook(webhookRequest("issues", opened, { delivery: "l-0" }), d);
    const lifecycle = (action: string, delivery: string) => handleGithubWebhook(webhookRequest("installation", { action, installation: INSTALLATION, sender: { login: "asha", type: "User" } }, { delivery }), d);
    await lifecycle("suspend", "l-1");
    assert.equal((await store.getInstallation(inst.id))?.status, "suspended");
    await handleGithubWebhook(webhookRequest("issues", basePayload({ action: "opened", issue: issue({ number: 13 }) }), { delivery: "l-1b" }), d);
    assert.equal(store.bufferedFor(link.id).length, 1); // nothing captured while suspended
    await lifecycle("unsuspend", "l-2");
    assert.equal((await store.getInstallation(inst.id))?.status, "active");

    const removed = await handleGithubWebhook(webhookRequest("installation_repositories", { action: "removed", installation: INSTALLATION, repositories_removed: [{ id: Number(REPO_ID) }, { id: 5151 }], sender: { login: "asha" } }, { delivery: "l-3" }), d);
    assert.equal(removed.status, 200);
    assert.equal((await store.getLink(link.id))?.state, "paused");
    assert.ok(store.events.some((e) => e.deliveryId === `l-3:${REPO_ID}`) && store.events.some((e) => e.deliveryId === "l-3:5151"));

    await lifecycle("deleted", "l-4");
    assert.equal((await store.getInstallation(inst.id))?.status, "revoked");
    assert.equal((await store.getLink(link.id))?.state, "revoked");
    assert.equal(store.bufferedFor(link.id).length, 0);
  });

  it("a store outage answers 503 (GitHub redelivery is safe: failed deliveries are reprocessed) and logs codes only", async () => {
    const { deps: d, store, link, lines } = await deps();
    const broken: ConnectorStore = Object.create(store);
    broken.recordEvent = async () => {
      throw new Error(`db down ${SECRETS.webhook}`);
    };
    const res = await handleGithubWebhook(webhookRequest("issues", opened, { delivery: "s-1" }), { ...d, store: () => broken });
    assert.equal(res.status, 503);
    assert.ok(lines.length > 0);
    assertNoSecrets(lines.join("\n") + (await res.text()));
    // redelivery after recovery is processed
    assert.equal((await handleGithubWebhook(webhookRequest("issues", opened, { delivery: "s-1" }), d)).status, 200);
    assert.equal(store.bufferedFor(link.id).length, 1);
  });
});

// ── install and callback ────────────────────────────────────────────────────

function routeDeps(store: ConnectorStore, opts: { actor?: string | null; fetch?: typeof fetch; env?: Record<string, string> } = {}) {
  const l = logs();
  const actor = opts.actor === undefined ? CREATOR : opts.actor;
  const deps: GithubRouteDeps = {
    env: opts.env ?? ENV,
    now: () => NOW,
    store: () => store,
    fetch: opts.fetch ?? (async () => {
      throw new Error("no network in tests");
    }),
    getActor: async () => (actor ? { profileId: actor } : null),
    log: l.log,
    nonce: () => "nonce-synthetic",
  };
  return { deps, lines: l.lines };
}

describe("github install route", () => {
  it("404 when not configured", async () => {
    const { store } = await setupStore();
    const res = await handleGithubInstall(new Request(`${SITE}/api/connectors/github/install?handover=${HANDOVER}`), routeDeps(store, { env: { ...ENV, GITHUB_APP_SLUG: "" } }).deps);
    assert.equal(res.status, 404);
  });

  it("signed out → login with a safe next path", async () => {
    const { store } = await setupStore();
    const res = await handleGithubInstall(new Request(`${SITE}/api/connectors/github/install?handover=${HANDOVER}`), routeDeps(store, { actor: null }).deps);
    assert.equal(res.status, 303);
    assert.equal(res.headers.get("location"), `${SITE}/login?next=${encodeURIComponent(`/api/connectors/github/install?handover=${HANDOVER}`)}`);
  });

  it("only the handover creator may start; others are sent back without a state", async () => {
    const { store } = await setupStore();
    const res = await handleGithubInstall(new Request(`${SITE}/api/connectors/github/install?handover=${HANDOVER}`), routeDeps(store, { actor: OTHER }).deps);
    assert.equal(res.headers.get("location"), `${SITE}/dashboard?connector=github&status=not_creator`);
    const bad = await handleGithubInstall(new Request(`${SITE}/api/connectors/github/install?handover=not-a-uuid`), routeDeps(store).deps);
    assert.match(bad.headers.get("location")!, /status=invalid_request/);
  });

  it("redirects the creator to the app's install page with a signed, user-bound, 10-minute state", async () => {
    const { store } = await setupStore();
    const res = await handleGithubInstall(new Request(`${SITE}/api/connectors/github/install?handover=${HANDOVER}`), routeDeps(store).deps);
    const loc = new URL(res.headers.get("location")!);
    assert.equal(`${loc.origin}${loc.pathname}`, "https://github.com/apps/baton-handover-test/installations/new");
    const check = verifyConnectorState(ENV.CONNECTOR_STATE_SECRET, loc.searchParams.get("state"), NOW);
    assert.ok(check.ok);
    assert.deepEqual(check.payload, { t: "oauth", p: "github", profileId: CREATOR, handoverId: HANDOVER, nonce: "nonce-synthetic", exp: NOW / 1000 + 600 });
  });
});

describe("github callback route", () => {
  const state = (over: Partial<{ profileId: string; handoverId: string | null; exp: number; p: "github" | "slack" }> = {}) =>
    signConnectorState(ENV.CONNECTOR_STATE_SECRET, { t: "oauth", p: over.p ?? "github", profileId: over.profileId ?? CREATOR, handoverId: over.handoverId === undefined ? HANDOVER : over.handoverId, nonce: "n", exp: over.exp ?? NOW / 1000 + 600 });
  const callbackUrl = (params: Record<string, string>) => `${SITE}/api/connectors/github/callback?${new URLSearchParams(params)}`;
  const settings = (status: string) => `${SITE}/handover/${HANDOVER}/settings?connector=github&status=${status}#connectors`;

  function github(opts: { installations?: unknown[]; exchange?: Response; userInstallationsStatus?: number } = {}) {
    return fakeFetch(async (method, url, call) => {
      if (url.origin === "https://github.com" && url.pathname === "/login/oauth/access_token") {
        const body = JSON.parse(call.body ?? "{}");
        assert.equal(body.client_secret, SECRETS.clientSecret);
        return opts.exchange ?? (body.code === SECRETS.code ? jsonResponse({ access_token: SECRETS.userToken, token_type: "bearer" }) : jsonResponse({ error: "bad_verification_code" }));
      }
      if (method === "GET" && url.pathname === "/user/installations") {
        assert.equal(call.headers.authorization, `Bearer ${SECRETS.userToken}`);
        if (opts.userInstallationsStatus) return jsonResponse({}, opts.userInstallationsStatus);
        return jsonResponse({ total_count: 1, installations: opts.installations ?? [{ id: 990001, app_id: 123456, account: { login: "acme", id: 1 }, permissions: { metadata: "read", issues: "read", pull_requests: "read", contents: "read" } }] });
      }
      if (method === "DELETE" && url.pathname === `/applications/${ENV.GITHUB_APP_CLIENT_ID}/token`) return new Response(null, { status: 204 });
      return jsonResponse({}, 404);
    });
  }

  async function run(params: Record<string, string>, opts: { actor?: string | null; gh?: ReturnType<typeof github> } = {}) {
    const { store } = await setupStore();
    const gh = opts.gh ?? github();
    const r = routeDeps(store, { actor: opts.actor, fetch: gh.fetch });
    const res = await handleGithubCallback(new Request(callbackUrl(params)), r.deps);
    return { res, store, gh, lines: r.lines, location: res.headers.get("location") };
  }

  it("binds the installation after proving access, discards the user token, stores no credentials", async () => {
    const { res, store, gh, lines, location } = await run({ code: SECRETS.code, installation_id: "990001", setup_action: "install", state: state() });
    assert.equal(res.status, 303);
    assert.equal(location, settings("connected"));
    assert.equal(res.headers.get("referrer-policy"), "no-referrer");
    const inst = await store.findInstallation("github", "990001");
    assert.ok(inst);
    assert.deepEqual([inst.accountLabel, inst.scopes, inst.hasCredentials, inst.installedByProfileId], ["acme", ["contents", "issues", "metadata", "pull_requests"], false, CREATOR]);
    assert.equal(await store.getInstallationCredentials(inst.id), null);
    assert.ok(gh.calls.some((c) => c.method === "DELETE" && c.url.endsWith("/token")), "user token revoked");
    assertNoSecrets(JSON.stringify(inst) + lines.join("\n") + location);
  });

  it("refuses an installation id the user cannot access (someone else's org)", async () => {
    const { store, location, lines } = await run({ code: SECRETS.code, installation_id: "555", setup_action: "install", state: state() });
    assert.equal(location, settings("installation_not_accessible"));
    assert.equal(await store.findInstallation("github", "555"), null);
    assert.ok(lines.some((l) => l.includes("installation_not_accessible")));
  });

  it("refuses an installation of a different app", async () => {
    const gh = github({ installations: [{ id: 990001, app_id: 999, account: { login: "acme" }, permissions: {} }] });
    const { store, location } = await run({ code: SECRETS.code, installation_id: "990001", setup_action: "install", state: state() }, { gh });
    assert.equal(location, settings("installation_not_accessible"));
    assert.equal(await store.findInstallation("github", "990001"), null);
  });

  it("state: wrong user, expired, tampered, other provider and missing are all refused before any GitHub call", async () => {
    const cases: Array<[string, Record<string, string>, string]> = [
      ["wrong user", { state: state({ profileId: OTHER }) }, "invalid_state"],
      ["expired", { state: state({ exp: NOW / 1000 - 1 }) }, "expired_state"],
      ["tampered", { state: state().replace(/^./, (c) => (c === "e" ? "f" : "e")) }, "invalid_state"],
      ["other provider", { state: state({ p: "slack" }) }, "invalid_state"],
      ["missing", {}, "invalid_state"],
    ];
    for (const [name, extra, status] of cases) {
      const { location, gh, store } = await run({ code: SECRETS.code, installation_id: "990001", setup_action: "install", ...extra });
      assert.equal(location, `${SITE}/dashboard?connector=github&status=${status}`, name);
      assert.equal(gh.calls.length, 0, name);
      assert.equal(await store.findInstallation("github", "990001"), null, name);
    }
  });

  it("signed out → login; setup_action=request → pending approval; update without state → nothing stored", async () => {
    assert.match((await run({ state: state() }, { actor: null })).location!, /^https:\/\/baton\.example\.test\/login\?/);
    const req = await run({ setup_action: "request", state: state() });
    assert.equal(req.location, settings("install_requested"));
    assert.equal(req.gh.calls.length, 0);
    const upd = await run({ setup_action: "update", installation_id: "990001" });
    assert.equal(upd.location, `${SITE}/dashboard?connector=github&status=updated`);
    assert.equal(await upd.store.findInstallation("github", "990001"), null);
  });

  it("without a handover, lands on the dashboard", async () => {
    const { location } = await run({ code: SECRETS.code, installation_id: "990001", setup_action: "install", state: state({ handoverId: null }) });
    assert.equal(location, `${SITE}/dashboard?connector=github&status=connected`);
  });

  it("a refused code, a rate limit, or a malformed installation id are reported without leaking", async () => {
    const refused = await run({ code: "wrongcode", installation_id: "990001", setup_action: "install", state: state() });
    assert.equal(refused.location, settings("authorization_failed"));

    const limited = await run(
      { code: SECRETS.code, installation_id: "990001", setup_action: "install", state: state() },
      { gh: github({ userInstallationsStatus: 429 }) },
    );
    assert.equal(limited.location, settings("rate_limited"));
    assert.ok(limited.gh.calls.some((c) => c.method === "DELETE"), "token revoked even when the check fails");
    assertNoSecrets(limited.lines.join("\n"));

    const malformed = await run({ code: SECRETS.code, installation_id: "99x", setup_action: "install", state: state() });
    assert.equal(malformed.location, settings("invalid_request"));
    assert.equal(malformed.gh.calls.length, 0);
  });

  // Found live on 21 Nov: the app was already installed on the account, so GitHub's page became "Configure" and
  // returned setup_action=update with the installation id and our state but NO code → "invalid_request".
  describe("app already installed on the account (no code on return)", () => {
    const withInst = (inst: string) =>
      signConnectorState(ENV.CONNECTOR_STATE_SECRET, { t: "oauth", p: "github", profileId: CREATOR, handoverId: HANDOVER, nonce: "n2", exp: NOW / 1000 + 600, inst });

    it("sends the user through GitHub's authorization step once, carrying the installation in a fresh signed state", async () => {
      const { res, store, gh, location } = await run({ setup_action: "update", installation_id: "990001", state: state() });
      assert.equal(res.status, 303);
      assert.equal(res.headers.get("referrer-policy"), "no-referrer");
      const to = new URL(location!);
      assert.equal(to.origin + to.pathname, "https://github.com/login/oauth/authorize");
      assert.equal(to.searchParams.get("client_id"), ENV.GITHUB_APP_CLIENT_ID);
      assert.equal(to.searchParams.get("redirect_uri"), `${SITE}/api/connectors/github/callback`);
      const next = verifyConnectorState(ENV.CONNECTOR_STATE_SECRET, to.searchParams.get("state"), NOW);
      assert.ok(next.ok && next.payload.t === "oauth");
      assert.deepEqual([next.payload.p, next.payload.profileId, next.payload.handoverId, next.payload.inst], ["github", CREATOR, HANDOVER, "990001"]);
      assert.equal(gh.calls.length, 0, "no GitHub API call before the user authorizes");
      assert.equal(await store.findInstallation("github", "990001"), null, "nothing stored yet");
      assert.doesNotMatch(location!, new RegExp(ENV.GITHUB_APP_CLIENT_SECRET), "client secret never in the URL");
    });

    it("on return with a code, proves access to the installation from the state and connects it", async () => {
      const { store, gh, location } = await run({ code: SECRETS.code, state: withInst("990001") });
      assert.equal(location, settings("connected"));
      const inst = await store.findInstallation("github", "990001");
      assert.ok(inst);
      assert.equal(inst.installedByProfileId, CREATOR);
      assert.ok(gh.calls.some((c) => c.method === "DELETE" && c.url.endsWith("/token")), "user token revoked");
    });

    it("the signed installation wins over a swapped query parameter, and access is still checked", async () => {
      const { store, location } = await run({ code: SECRETS.code, installation_id: "555", state: withInst("990001") });
      assert.equal(location, settings("connected"));
      assert.equal(await store.findInstallation("github", "555"), null);
      const refused = await run({ code: SECRETS.code, state: withInst("555") });
      assert.equal(refused.location, settings("installation_not_accessible"));
      assert.equal(await refused.store.findInstallation("github", "555"), null);
    });

    it("a second return without a code is refused (no redirect loop)", async () => {
      const { location, gh } = await run({ setup_action: "update", installation_id: "990001", state: withInst("990001") });
      assert.equal(location, settings("invalid_request"));
      assert.equal(gh.calls.length, 0);
    });

    it("never redirects to GitHub with an empty client id: unavailable, logged as install_misconfigured", async () => {
      // An empty client id is already a 404 (connectorConfigured)...
      const { store } = await setupStore();
      const gated = await handleGithubCallback(
        new Request(callbackUrl({ setup_action: "update", installation_id: "990001", state: state() })),
        routeDeps(store, { env: { ...ENV, GITHUB_APP_CLIENT_ID: "" } }).deps,
      );
      assert.equal(gated.status, 404);
      // ...and the authorize branch checks again. Simulated drift: the configuration gate (connectorConfigured, two
      // reads) sees a client id, the value read when building the link is blank.
      let reads = 0;
      const env = { ...ENV } as Record<string, string>;
      Object.defineProperty(env, "GITHUB_APP_CLIENT_ID", { enumerable: true, get: () => (++reads <= 2 ? ENV.GITHUB_APP_CLIENT_ID : " ") });
      const gh = github();
      const r = routeDeps(store, { env, fetch: gh.fetch });
      const res = await handleGithubCallback(new Request(callbackUrl({ setup_action: "update", installation_id: "990001", state: state() })), r.deps);
      const location = res.headers.get("location");
      assert.equal(location, settings("unavailable"));
      assert.doesNotMatch(location!, /login\/oauth\/authorize/);
      assert.equal(gh.calls.length, 0);
      assert.ok(r.lines.some((l) => l.includes("install_misconfigured") && l.includes("client_id_missing")), r.lines.join("\n"));
      assert.equal(await store.findInstallation("github", "990001"), null);
    });

    it("someone else's state, or no installation id at all, never starts the authorization step", async () => {
      const other = await run({ setup_action: "update", installation_id: "990001", state: state({ profileId: OTHER }) });
      assert.equal(other.location, `${SITE}/dashboard?connector=github&status=invalid_state`);
      const none = await run({ setup_action: "update", state: state() });
      assert.equal(none.location, settings("invalid_request"));
    });
  });

  it("404 when not configured", async () => {
    const { store } = await setupStore();
    const res = await handleGithubCallback(new Request(callbackUrl({ state: state() })), routeDeps(store, { env: { ...ENV, GITHUB_APP_CLIENT_SECRET: "" } }).deps);
    assert.equal(res.status, 404);
  });
});


describe("github callback: installation already connected by someone else", () => {
  it("answers connected_by_someone_else and keeps the first installer", async () => {
    const { store } = await setupStore();
    await store.upsertInstallation({ kind: "user", profileId: OTHER }, { provider: "github", externalAccountId: "990001", accountLabel: "acme", scopes: [], credentials: null });
    const gh = fakeFetch((method, url) => {
      if (url.pathname === "/login/oauth/access_token") return jsonResponse({ access_token: SECRETS.userToken });
      if (url.pathname === "/user/installations") return jsonResponse({ installations: [{ id: 990001, app_id: 123456, account: { login: "acme" }, permissions: { issues: "read" } }] });
      return new Response(null, { status: method === "DELETE" ? 204 : 404 });
    });
    const st = signConnectorState(ENV.CONNECTOR_STATE_SECRET, { t: "oauth", p: "github", profileId: CREATOR, handoverId: HANDOVER, nonce: "n", exp: NOW / 1000 + 600 });
    const res = await handleGithubCallback(
      new Request(`${SITE}/api/connectors/github/callback?${new URLSearchParams({ code: SECRETS.code, installation_id: "990001", setup_action: "install", state: st })}`),
      routeDeps(store, { fetch: gh.fetch }).deps,
    );
    assert.equal(res.headers.get("location"), `${SITE}/handover/${HANDOVER}/settings?connector=github&status=connected_by_someone_else#connectors`);
    assert.equal((await store.findInstallation("github", "990001"))?.installedByProfileId, OTHER);
  });
});
