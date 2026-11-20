// GitHub App auth (JWT, installation tokens), REST client (pagination, rate limits) and the adapter. Synthetic only.
import assert from "node:assert/strict";
import { verify } from "node:crypto";
import { describe, it } from "node:test";

import { ProviderError, type AdapterContext } from "../../adapter";
import { errorForResponse, githubPaginate, nextLink } from "../api";
import { createAppJwt, InstallationTokenCache, normalizePrivateKey } from "../app-auth";
import { createGithubAdapter } from "../server";
import { ENV, fakeFetch, INSTALLATION_ID, jsonResponse, NOW, REPO_ID, SECRETS, setupStore, TEST_PRIVATE_PEM, TEST_PUBLIC_KEY } from "./helpers";

const decode = (part: string) => JSON.parse(Buffer.from(part, "base64url").toString("utf8"));

describe("github app JWT", () => {
  it("is RS256 with iat 60 s in the past, exp 9 min ahead, iss = app id, and verifies with the public key", () => {
    const jwt = createAppJwt(ENV.GITHUB_APP_ID, ENV.GITHUB_APP_PRIVATE_KEY, NOW);
    const [h, p, s] = jwt.split(".");
    assert.deepEqual(decode(h), { alg: "RS256", typ: "JWT" });
    assert.deepEqual(decode(p), { iat: NOW / 1000 - 60, exp: NOW / 1000 + 540, iss: "123456" });
    assert.equal(verify("sha256", Buffer.from(`${h}.${p}`), TEST_PUBLIC_KEY, Buffer.from(s, "base64url")), true);
    assert.equal(verify("sha256", Buffer.from(`${h}.${p}x`), TEST_PUBLIC_KEY, Buffer.from(s, "base64url")), false);
  });

  it("accepts the key with real newlines, escaped \\n, quotes or CRLF; refuses garbage without echoing it", () => {
    const variants = [
      TEST_PRIVATE_PEM,
      TEST_PRIVATE_PEM.replace(/\n/g, "\\n"),
      `"${TEST_PRIVATE_PEM.trim().replace(/\n/g, "\\n")}"`,
      TEST_PRIVATE_PEM.replace(/\n/g, "\r\n"),
      // pasted into a single-line dashboard field: line breaks flattened to spaces
      TEST_PRIVATE_PEM.trim().replace(/\n/g, " "),
    ];
    for (const v of variants) assert.equal(normalizePrivateKey(v), TEST_PRIVATE_PEM.trim() + "\n");
    const bogus = "-----BEGIN RSA PRIVATE KEY-----\nnot-a-key-synthetic\n-----END RSA PRIVATE KEY-----";
    assert.throws(() => createAppJwt("123456", bogus, NOW), (e: unknown) => e instanceof ProviderError && e.code === "not_configured" && !e.message.includes("not-a-key"));
    assert.throws(() => createAppJwt("not-a-number", TEST_PRIVATE_PEM, NOW), /not_configured/);
    assert.throws(() => createAppJwt("123456", undefined, NOW), /not_configured/);
  });
});

describe("installation tokens", () => {
  function tokenServer(expiresAt: string) {
    let minted = 0;
    const f = fakeFetch((method, url) => {
      if (method === "POST" && url.pathname === `/app/installations/${INSTALLATION_ID}/access_tokens`) {
        minted += 1;
        return jsonResponse({ token: `${SECRETS.installationToken}_${minted}`, expires_at: expiresAt }, 201);
      }
      return jsonResponse({}, 404);
    });
    return { ...f, minted: () => minted };
  }

  it("mints with the app JWT, caches in memory, and re-mints within 5 minutes of expiry", async () => {
    let now = NOW;
    const srv = tokenServer("2026-11-19T11:00:00Z");
    const http = { fetch: srv.fetch, now: () => now };
    const cache = new InstallationTokenCache();
    assert.equal(await cache.get(http, ENV, INSTALLATION_ID), `${SECRETS.installationToken}_1`);
    assert.match(srv.calls[0].headers.authorization, /^Bearer [\w-]+\.[\w-]+\.[\w-]+$/);
    assert.equal(srv.calls[0].headers["x-github-api-version"], "2022-11-28");
    now = Date.parse("2026-11-19T10:54:00Z");
    assert.equal(await cache.get(http, ENV, INSTALLATION_ID), `${SECRETS.installationToken}_1`);
    assert.equal(srv.minted(), 1);
    now = Date.parse("2026-11-19T10:56:00Z"); // < 5 min left
    assert.equal(await cache.get(http, ENV, INSTALLATION_ID), `${SECRETS.installationToken}_2`);
    cache.invalidate(INSTALLATION_ID);
    assert.equal(cache.size, 0);
  });

  it("maps refusals to codes and never caches a failure", async () => {
    const cache = new InstallationTokenCache();
    const gone = fakeFetch(() => jsonResponse({ message: "Not Found" }, 404));
    await assert.rejects(cache.get({ fetch: gone.fetch, now: () => NOW }, ENV, INSTALLATION_ID), (e: unknown) => e instanceof ProviderError && e.code === "not_found");
    await assert.rejects(cache.get({ fetch: gone.fetch, now: () => NOW }, ENV, "../evil"), /not_found/);
    assert.equal(cache.size, 0);
  });
});

describe("REST client", () => {
  it("rate limits → rate_limited with retry-after or reset time", () => {
    const e1 = errorForResponse(new Response("", { status: 429, headers: { "retry-after": "30" } }), NOW);
    assert.deepEqual([e1.code, e1.retryAfterSeconds], ["rate_limited", 30]);
    const e2 = errorForResponse(new Response("", { status: 403, headers: { "x-ratelimit-remaining": "0", "x-ratelimit-reset": String(NOW / 1000 + 120) } }), NOW);
    assert.deepEqual([e2.code, e2.retryAfterSeconds], ["rate_limited", 120]);
    assert.equal(errorForResponse(new Response("", { status: 403 }), NOW).code, "forbidden");
    assert.equal(errorForResponse(new Response("", { status: 401 }), NOW).code, "unauthorized");
    assert.equal(errorForResponse(new Response("", { status: 502 }), NOW).code, "unavailable");
  });

  it("follows Link rel=next only on api.github.com, and bounds pages", async () => {
    assert.equal(nextLink('<https://api.github.com/x?page=2>; rel="next", <https://api.github.com/x?page=9>; rel="last"'), "https://api.github.com/x?page=2");
    assert.equal(nextLink('<https://evil.example.test/x?page=2>; rel="next"'), null);
    const f = fakeFetch((_m, url) => {
      const page = Number(url.searchParams.get("page") ?? "1");
      return jsonResponse([{ n: page }], 200, { link: `<https://api.github.com/items?page=${page + 1}>; rel="next"` });
    });
    const items = await githubPaginate({ fetch: f.fetch, now: () => NOW }, "/items?page=1", { kind: "none" }, (d) => d as unknown[], (i) => i as { n: number }, { maxItems: 100, maxPages: 3 });
    assert.deepEqual(items.map((i) => i.n), [1, 2, 3]);
  });

  it("errors never carry the response body", async () => {
    const f = fakeFetch(() => new Response(`secret body ${SECRETS.installationToken}`, { status: 500 }));
    const cache = new InstallationTokenCache();
    await assert.rejects(cache.get({ fetch: f.fetch, now: () => NOW }, ENV, INSTALLATION_ID), (e: unknown) => e instanceof Error && !e.message.includes("secret body") && e.message === "provider error: unavailable");
  });
});

describe("github adapter", () => {
  function api(opts: { failFirstWith401?: boolean } = {}) {
    let first401 = opts.failFirstWith401 ?? false;
    return fakeFetch((method, url, call) => {
      if (method === "POST" && url.pathname.endsWith("/access_tokens")) return jsonResponse({ token: SECRETS.installationToken, expires_at: "2026-11-19T11:00:00Z" }, 201);
      if (call.headers.authorization !== `Bearer ${SECRETS.installationToken}`) return jsonResponse({}, 401);
      if (url.pathname === "/installation/repositories") {
        if (first401) {
          first401 = false;
          return jsonResponse({}, 401);
        }
        return jsonResponse({ total_count: 2, repositories: [{ id: Number(REPO_ID), full_name: "acme/sponsors" }, { id: 5151, full_name: "acme/site" }] });
      }
      if (url.pathname === "/repos/acme/sponsors/issues") {
        return jsonResponse([
          { number: 12, title: "Track sponsor payments", body: "One sheet.", user: { login: "asha", type: "User" }, created_at: "2026-11-18T09:00:00Z", closed_at: "2026-11-18T12:00:00Z" },
          { number: 7, title: "Add sponsor tracker", body: "Adds it.", user: { login: "ravi", type: "User" }, created_at: "2026-11-01T09:00:00Z", pull_request: { merged_at: "2026-11-18T10:00:00Z" }, closed_at: "2026-11-18T10:00:00Z" },
          { number: 8, title: "Bump deps", body: "", user: { login: "dependabot[bot]", type: "Bot" }, created_at: "2026-11-18T09:00:00Z", pull_request: {} },
        ]);
      }
      if (url.pathname === "/repos/acme/sponsors/issues/comments") {
        return jsonResponse([{ id: 1, issue_url: "https://api.github.com/repos/acme/sponsors/issues/7", body: "Ship it", user: { login: "meera", type: "User" }, created_at: "2026-11-18T09:30:00Z" }]);
      }
      if (url.pathname.startsWith("/repos/acme/sponsors/pulls/")) return url.pathname !== "/repos/acme/sponsors/pulls/7/reviews" ? jsonResponse([]) : jsonResponse([{ id: 9, state: "APPROVED", body: "", user: { login: "meera", type: "User" }, submitted_at: "2026-11-18T09:40:00Z" }]);
      if (url.pathname === "/repos/acme/sponsors/commits") return jsonResponse([{ sha: "d".repeat(40), commit: { message: "Add sheet", author: { name: "Asha Rao", email: "asha@example.test", date: "2026-11-18T08:00:00Z" } }, author: { login: "asha", type: "User" } }]);
      if (url.pathname === "/repos/acme/sponsors/releases") return jsonResponse([{ id: 55, tag_name: "v1", name: "v1", body: "", author: { login: "asha", type: "User" }, published_at: "2026-11-18T13:00:00Z", draft: false }]);
      return jsonResponse({}, 404);
    });
  }

  async function ctxFor(f: ReturnType<typeof api>) {
    const { store, inst, link } = await setupStore();
    const ctx: AdapterContext = { store, env: ENV, fetch: f.fetch, now: () => NOW, secretKey: null, credentials: async () => null };
    return { ctx, inst, link, store };
  }

  it("lists repositories as owner/repo and describes one by id (verified with GitHub)", async () => {
    const f = api();
    const { ctx, inst } = await ctxFor(f);
    const adapter = createGithubAdapter(new InstallationTokenCache());
    assert.deepEqual(await adapter.listChannels(ctx, inst), [
      { id: REPO_ID, label: "acme/sponsors", blockedReason: null },
      { id: "5151", label: "acme/site", blockedReason: null },
    ]);
    assert.deepEqual(await adapter.describeChannel(ctx, inst, "5151"), { id: "5151", label: "acme/site", blockedReason: null });
    assert.equal(await adapter.describeChannel(ctx, inst, "9999"), null);
    assert.equal(await adapter.describeChannel(ctx, inst, "1;drop"), null);
  });

  it("retries once with a fresh token after a 401", async () => {
    const f = api({ failFirstWith401: true });
    const { ctx, inst } = await ctxFor(f);
    const adapter = createGithubAdapter(new InstallationTokenCache());
    assert.equal((await adapter.listChannels(ctx, inst)).length, 2);
    assert.equal(f.calls.filter((c) => c.url.endsWith("/access_tokens")).length, 2);
  });

  it("refuses inactive installations without calling GitHub", async () => {
    const f = api();
    const { ctx, inst } = await ctxFor(f);
    const adapter = createGithubAdapter(new InstallationTokenCache());
    await assert.rejects(adapter.listChannels(ctx, { ...inst, status: "suspended" }), /forbidden/);
    assert.equal(f.calls.length, 0);
  });

  it("history import: issues, PRs, comments, reviews, commits, releases since the cutoff, bots skipped, oldest first", async () => {
    const f = api();
    const { ctx, inst, link } = await ctxFor(f);
    const adapter = createGithubAdapter(new InstallationTokenCache());
    const msgs = await adapter.fetchHistory!(ctx, inst, link, "2026-11-12T10:00:00.000Z", 100);
    assert.deepEqual(msgs.map((m) => m.providerMessageId), [
      `commit:${"d".repeat(40)}`, "issue:12", "pr:7:comment:1", "pr:7:review:9", "pr:7:merged", `issue:12:closed:2026-11-18T12:00:00Z`, "release:55",
    ]);
    const merged = msgs.find((m) => m.providerMessageId === "pr:7:merged")!;
    assert.deepEqual([merged.kind, merged.authorLabel], ["system", ""]);
    assert.doesNotMatch(JSON.stringify(msgs), /@example\.test|dependabot/);
    assert.ok(f.calls.every((c) => c.url.startsWith("https://api.github.com/")));
  });

  it("history import honours disabled families and the limit", async () => {
    const f = api();
    const { ctx, inst, link } = await ctxFor(f);
    const adapter = createGithubAdapter(new InstallationTokenCache());
    const only = { ...link, settings: { families: { issues: false, pullRequests: false, reviews: false, commits: false, releases: true } } };
    assert.deepEqual((await adapter.fetchHistory!(ctx, inst, only, "2026-11-12T10:00:00.000Z", 100)).map((m) => m.providerMessageId), ["release:55"]);
    assert.equal((await adapter.fetchHistory!(ctx, inst, link, "2026-11-12T10:00:00.000Z", 2)).length, 2);
  });

  it("parseSettings normalises; revokeAtProvider calls nothing at GitHub", async () => {
    const f = api();
    const { ctx, inst } = await ctxFor(f);
    const adapter = createGithubAdapter(new InstallationTokenCache());
    assert.deepEqual(adapter.parseSettings!({ families: { commits: false } }), { families: { issues: true, pullRequests: true, reviews: true, commits: false, releases: true } });
    assert.equal(adapter.parseSettings!({ families: "all" }), null);
    await adapter.revokeAtProvider!(ctx, inst);
    assert.equal(f.calls.length, 0);
    assert.equal(adapter.pullNew, undefined);
  });
});
