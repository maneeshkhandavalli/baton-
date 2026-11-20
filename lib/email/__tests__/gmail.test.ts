// Round 4 (Agent E): Gmail API delivery (lib/email/gmail-core.ts, gmail-store.ts, gmail-routes.ts). No network: every
// Google endpoint is a fake `fetch`. Synthetic values only.
// Run: node --import ./lib/contracts/__tests__/resolve-ts.mjs --test "lib/email/__tests__/*.test.ts"
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { parseConnectorSecretKey } from "../../connectors/secrets";
import { renderInvitationEmail } from "../core";
import {
  GMAIL_CSRF_COOKIE,
  GMAIL_SEND_SCOPE,
  GMAIL_SEND_URL,
  GOOGLE_AUTHORIZE_URL,
  GOOGLE_TOKEN_URL,
  buildMimeMessage,
  createGmailTransport,
  envRefreshToken,
  exchangeGmailCode,
  gmailAuthorizeUrl,
  missingGmailVariables,
  refreshGmailAccessToken,
  refreshTokenSource,
  resolveGmailConfig,
  signGmailState,
  verifyGmailState,
  type GmailConfig,
  type GmailTokenStore,
} from "../gmail-core";
import { handleGmailCallback, handleGmailStart, type GmailRouteDeps } from "../gmail-routes";
import { createDbGmailTokenStore, openGmailRefreshToken, sealGmailRefreshToken } from "../gmail-store";

const SENDER = "baton.sender@example.test";
const CLIENT_SECRET = "synthetic-client-secret-0123";
const REFRESH = "1//synthetic-refresh-token-not-real-0123456789";
const ACCESS = "ya29.synthetic-access-token-0123456789";
const STATE_SECRET = "state-secret-synthetic-0123456789abcdef";
const SEAL_KEY_RAW = randomBytes(32).toString("base64url");
const OWNER_ID = "44444444-4444-4444-8444-444444444444";
const OTHER_ID = "55555555-5555-4555-8555-555555555555";
const OWNER_EMAIL = "owner@example.test";
const INVITEE = "invitee.person@example.test";

const ENV = Object.freeze({
  GMAIL_CLIENT_ID: "1234567890-synthetic.apps.googleusercontent.com",
  GMAIL_CLIENT_SECRET: CLIENT_SECRET,
  GMAIL_REDIRECT_URI: "https://baton.example.test/api/email/google/callback",
  GMAIL_SENDER_EMAIL: SENDER,
  CONNECTOR_STATE_SECRET: STATE_SECRET,
  CONNECTOR_SECRET_KEY: SEAL_KEY_RAW,
  BATON_OWNER_EMAILS: OWNER_EMAIL,
});
const CONFIG = resolveGmailConfig(ENV) as GmailConfig;
const SEAL_KEY = (() => {
  const k = parseConnectorSecretKey(SEAL_KEY_RAW, undefined);
  if (!k.ok) throw new Error("test key");
  return k.key;
})();

type Call = { url: string; init: RequestInit };
type Reply = { status: number; body?: unknown } | "throw";

/** A fake fetch answering per endpoint from a queue (the last reply repeats). */
function fakeFetch(replies: { token?: Reply[]; send?: Reply[] }) {
  const calls: Call[] = [];
  const queues = { token: [...(replies.token ?? [{ status: 200, body: { access_token: ACCESS, expires_in: 3600, scope: GMAIL_SEND_SCOPE } }])], send: [...(replies.send ?? [{ status: 200, body: { id: "18c0ffee1234", threadId: "t1" } }])] };
  const fn = async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const q = url === GOOGLE_TOKEN_URL ? queues.token : url === GMAIL_SEND_URL ? queues.send : null;
    if (!q) throw new Error(`unexpected url ${url}`);
    const r = q.length > 1 ? q.shift()! : q[0];
    if (r === "throw") throw new Error("network down");
    return { status: r.status, ok: r.status >= 200 && r.status < 300, json: async () => r.body ?? {} };
  };
  return { fn, calls, tokenCalls: () => calls.filter((c) => c.url === GOOGLE_TOKEN_URL), sendCalls: () => calls.filter((c) => c.url === GMAIL_SEND_URL) };
}

const MSG = renderInvitationEmail({
  to: INVITEE,
  handoverTitle: "Robotics <Club> handover",
  inviterName: "Asha Rao",
  role: "incoming",
  url: "https://baton.example.test/h/tok123?x=1&y=2",
  expiresAt: "2026-11-28T10:00:00.000Z",
});

function decodeRaw(call: Call): string {
  const raw = (JSON.parse(String(call.init.body)) as { raw: string }).raw;
  assert.match(raw, /^[A-Za-z0-9_-]+$/, "raw is base64url without padding");
  return Buffer.from(raw, "base64url").toString("utf8");
}

function partBodies(mime: string): string[] {
  return [...mime.matchAll(/Content-Transfer-Encoding: base64\r\n\r\n([A-Za-z0-9+/=\r\n]+?)\r\n--/g)].map((m) => Buffer.from(m[1].replace(/\r\n/g, ""), "base64").toString("utf8"));
}

// ── configuration ───────────────────────────────────────────────────────────────────────────────────────

describe("Gmail configuration", () => {
  it("needs all four GMAIL_* variables; malformed values fail closed; names only are reported", () => {
    assert.ok(CONFIG);
    assert.equal(CONFIG.senderEmail, SENDER);
    for (const name of ["GMAIL_CLIENT_ID", "GMAIL_CLIENT_SECRET", "GMAIL_REDIRECT_URI", "GMAIL_SENDER_EMAIL"] as const) {
      const env = { ...ENV, [name]: "" };
      assert.equal(resolveGmailConfig(env), null, name);
      assert.deepEqual(missingGmailVariables(env), [name]);
    }
    assert.deepEqual(missingGmailVariables(ENV), []);
    const missing = missingGmailVariables({ ...ENV, GMAIL_CLIENT_SECRET: "has space inside it" });
    assert.ok(!JSON.stringify(missing).includes("space"), "values never appear");
  });

  it("the redirect URI must be the callback path over https, or http only on localhost", () => {
    const ok = (u: string) => resolveGmailConfig({ ...ENV, GMAIL_REDIRECT_URI: u }) !== null;
    assert.ok(ok("https://baton-seven-alpha.vercel.app/api/email/google/callback"));
    assert.ok(ok("http://localhost:3110/api/email/google/callback"));
    assert.ok(!ok("http://baton.example.test/api/email/google/callback"), "plain http off localhost");
    assert.ok(!ok("https://baton.example.test/api/email/google/other"));
    assert.ok(!ok("https://baton.example.test/api/email/google/callback?x=1"));
    assert.ok(!ok("javascript:alert(1)"));
  });

  it("GMAIL_REFRESH_TOKEN is used only when well formed", () => {
    assert.equal(envRefreshToken({ GMAIL_REFRESH_TOKEN: REFRESH }), REFRESH);
    assert.equal(envRefreshToken({ GMAIL_REFRESH_TOKEN: "short" }), null);
    assert.equal(envRefreshToken({ GMAIL_REFRESH_TOKEN: "has a space in it 0123456789" }), null);
    assert.equal(envRefreshToken({}), null);
  });

  it("the modules never read process.env, never log, and nothing is NEXT_PUBLIC", () => {
    const root = fileURLToPath(new URL("../../../", import.meta.url));
    for (const f of ["lib/email/gmail-core.ts", "lib/email/gmail-store.ts", "lib/email/gmail-routes.ts"]) {
      const src = readFileSync(`${root}${f}`, "utf8");
      assert.doesNotMatch(src, /process\.env/, f);
      assert.doesNotMatch(src, /console\./, f);
      assert.doesNotMatch(src, /NEXT_PUBLIC/, f);
    }
    const server = readFileSync(`${root}lib/email/gmail-server.ts`, "utf8");
    assert.match(server, /^import "server-only";/);
    assert.doesNotMatch(server, /NEXT_PUBLIC/);
  });
});

// ── OAuth state and the consent URL ─────────────────────────────────────────────────────────────────────

describe("OAuth state (CSRF)", () => {
  const now = Date.UTC(2026, 10, 21, 0, 0, 0);
  const payload = { v: 1 as const, profileId: OWNER_ID, nonce: "n".repeat(32), exp: Math.floor(now / 1000) + 600 };

  it("round-trips and refuses tampering, another secret, expiry and junk", () => {
    const s = signGmailState(STATE_SECRET, payload);
    const ok = verifyGmailState(STATE_SECRET, s, now);
    assert.ok(ok.ok && ok.payload.profileId === OWNER_ID);
    const [body, sig] = s.split(".");
    const forged = Buffer.from(JSON.stringify({ ...payload, profileId: OTHER_ID })).toString("base64url");
    assert.deepEqual(verifyGmailState(STATE_SECRET, `${forged}.${sig}`, now), { ok: false, reason: "bad_signature" });
    assert.deepEqual(verifyGmailState(`${STATE_SECRET}x`, s, now), { ok: false, reason: "bad_signature" });
    assert.deepEqual(verifyGmailState(STATE_SECRET, s, now + 601_000), { ok: false, reason: "expired" });
    for (const junk of [null, "", "abc", `${body}.${sig}.x`, "x".repeat(5000)]) assert.equal(verifyGmailState(STATE_SECRET, junk, now).ok, false);
    assert.throws(() => signGmailState("short", payload));
  });

  it("the consent URL asks for gmail.send only, offline access and forced consent", () => {
    const url = new URL(gmailAuthorizeUrl(CONFIG, "STATE"));
    assert.equal(`${url.origin}${url.pathname}`, GOOGLE_AUTHORIZE_URL);
    const q = url.searchParams;
    assert.equal(q.get("scope"), GMAIL_SEND_SCOPE);
    assert.equal(q.get("access_type"), "offline");
    assert.equal(q.get("prompt"), "consent");
    assert.equal(q.get("response_type"), "code");
    assert.equal(q.get("include_granted_scopes"), "false");
    assert.equal(q.get("state"), "STATE");
    assert.equal(q.get("redirect_uri"), ENV.GMAIL_REDIRECT_URI);
    assert.equal(q.get("client_id"), ENV.GMAIL_CLIENT_ID);
    assert.ok(!url.toString().includes(CLIENT_SECRET), "the client secret never leaves the server");
  });
});

// ── routes ──────────────────────────────────────────────────────────────────────────────────────────────

type Actor = { profileId: string; email: string | null; emailConfirmed: boolean } | null;
const OWNER: Actor = { profileId: OWNER_ID, email: OWNER_EMAIL, emailConfirmed: true };
const NOW = Date.UTC(2026, 10, 21, 0, 0, 0);
const NONCE = "csrf-nonce-synthetic-0123456789abcd";

function routeDeps(o: { actor?: Actor; env?: Record<string, string | undefined>; fetch?: ReturnType<typeof fakeFetch>; putFails?: boolean } = {}) {
  const logs: Array<{ event: string; details?: Record<string, string> }> = [];
  const puts: Parameters<GmailTokenStore["put"]>[0][] = [];
  const f = o.fetch ?? fakeFetch({ token: [{ status: 200, body: { access_token: ACCESS, refresh_token: REFRESH, expires_in: 3600, scope: GMAIL_SEND_SCOPE } }] });
  const deps: GmailRouteDeps = {
    env: o.env ?? ENV,
    getActor: async () => (o.actor === undefined ? OWNER : o.actor),
    store: () => ({
      get: async () => null,
      put: async (row) => {
        if (o.putFails) throw new Error("db down");
        puts.push(row);
      },
    }),
    fetch: f.fn,
    now: () => NOW,
    log: (event, details) => logs.push({ event, details }),
    nonce: () => NONCE,
  };
  return { deps, logs, puts, f };
}

function callbackRequest(params: Record<string, string>, cookie: string | null = `${GMAIL_CSRF_COOKIE}=${NONCE}`) {
  const url = `https://baton.example.test/api/email/google/callback?${new URLSearchParams(params)}`;
  return new Request(url, { headers: cookie ? { cookie } : {} });
}
const validState = (profileId = OWNER_ID, exp = Math.floor(NOW / 1000) + 600, nonce = NONCE) => signGmailState(STATE_SECRET, { v: 1, profileId, nonce, exp });

describe("GET /api/email/google/start (owner only)", () => {
  const req = new Request("https://baton.example.test/api/email/google/start");

  it("is a 404 for everyone who is not the owner, and sets nothing", async () => {
    for (const actor of [
      null,
      { profileId: OTHER_ID, email: "someone@example.test", emailConfirmed: true },
      { profileId: OWNER_ID, email: OWNER_EMAIL, emailConfirmed: false },
    ]) {
      const r = await handleGmailStart(req, routeDeps({ actor }).deps);
      assert.equal(r.status, 404);
      assert.equal(r.headers.get("set-cookie"), null);
    }
    const noList = await handleGmailStart(req, routeDeps({ env: { ...ENV, BATON_OWNER_EMAILS: "" } }).deps);
    assert.equal(noList.status, 404, "an empty owner list means nobody");
  });

  it("the owner without configuration gets the missing variable NAMES only", async () => {
    const { deps } = routeDeps({ env: { ...ENV, GMAIL_CLIENT_ID: "", CONNECTOR_SECRET_KEY: "" } });
    const r = await handleGmailStart(req, deps);
    assert.equal(r.status, 503);
    const html = await r.text();
    assert.ok(html.includes("GMAIL_CLIENT_ID") && html.includes("CONNECTOR_SECRET_KEY"));
    assert.ok(!html.includes(CLIENT_SECRET) && !html.includes(STATE_SECRET) && !html.includes(SENDER));
  });

  it("the owner is redirected to Google with a signed state and an httpOnly CSRF cookie holding the same nonce", async () => {
    const r = await handleGmailStart(req, routeDeps().deps);
    assert.equal(r.status, 302);
    assert.equal(r.headers.get("cache-control"), "no-store");
    const loc = new URL(r.headers.get("location")!);
    assert.equal(loc.searchParams.get("scope"), GMAIL_SEND_SCOPE);
    const check = verifyGmailState(STATE_SECRET, loc.searchParams.get("state"), NOW);
    assert.ok(check.ok && check.payload.profileId === OWNER_ID && check.payload.nonce === NONCE);
    const cookie = r.headers.get("set-cookie")!;
    assert.match(cookie, new RegExp(`^${GMAIL_CSRF_COOKIE}=${NONCE};`));
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /SameSite=Lax/);
    assert.match(cookie, /Secure/);
    assert.match(cookie, /Path=\/api\/email\/google/);
  });
});

describe("GET /api/email/google/callback", () => {
  it("is a 404 for non-owners and never exchanges a code", async () => {
    const t = routeDeps({ actor: { profileId: OTHER_ID, email: "someone@example.test", emailConfirmed: true } });
    const r = await handleGmailCallback(callbackRequest({ state: validState(), code: "4/code" }), t.deps);
    assert.equal(r.status, 404);
    assert.equal(t.f.calls.length, 0);
  });

  it("refuses a bad, expired or foreign state and a missing or different CSRF cookie, without any exchange", async () => {
    const cases: Array<[Request, number]> = [
      [callbackRequest({ state: "junk", code: "4/code" }), 400],
      [callbackRequest({ state: validState(OWNER_ID, Math.floor(NOW / 1000) - 1), code: "4/code" }), 400],
      [callbackRequest({ state: validState(OTHER_ID), code: "4/code" }), 403],
      [callbackRequest({ state: validState(), code: "4/code" }, null), 400],
      [callbackRequest({ state: validState(), code: "4/code" }, `${GMAIL_CSRF_COOKIE}=another-nonce-0123456789abcdef`), 400],
      [callbackRequest({ state: validState(), error: "access_denied" }), 400],
      [callbackRequest({ state: validState() }), 400],
    ];
    for (const [req, status] of cases) {
      const t = routeDeps();
      const r = await handleGmailCallback(req, t.deps);
      assert.equal(r.status, status, req.url);
      assert.equal(t.f.calls.length, 0, "no code exchange");
      assert.equal(t.puts.length, 0, "nothing stored");
      assert.match(r.headers.get("set-cookie") ?? "", /Max-Age=0/, "the CSRF cookie is cleared");
    }
  });

  it("exchanges the code server side, seals the refresh token for the sender and logs no secret", async () => {
    const t = routeDeps();
    const r = await handleGmailCallback(callbackRequest({ state: validState(), code: "4/synthetic-auth-code" }), t.deps);
    assert.equal(r.status, 200);
    assert.equal(t.f.calls.length, 1);
    const body = new URLSearchParams(String(t.f.calls[0].init.body));
    assert.equal(t.f.calls[0].url, GOOGLE_TOKEN_URL);
    assert.equal(body.get("grant_type"), "authorization_code");
    assert.equal(body.get("code"), "4/synthetic-auth-code");
    assert.equal(body.get("redirect_uri"), ENV.GMAIL_REDIRECT_URI);
    assert.equal(t.puts.length, 1);
    const [row] = t.puts;
    assert.equal(row.senderEmail, SENDER);
    assert.deepEqual(row.scopes, [GMAIL_SEND_SCOPE]);
    assert.equal(row.connectedBy, OWNER_ID);
    assert.ok(!row.sealedRefreshToken.includes(REFRESH), "never stored in clear");
    assert.equal(openGmailRefreshToken(SEAL_KEY, SENDER, row.sealedRefreshToken), REFRESH);
    assert.equal(openGmailRefreshToken(SEAL_KEY, "other@example.test", row.sealedRefreshToken), null, "bound to the sender");
    const page = await r.text();
    assert.match(page, /7 days/, "the Testing-mode expiry is stated, not hidden");
    const logged = JSON.stringify(t.logs);
    for (const secret of [REFRESH, ACCESS, "4/synthetic-auth-code", SENDER, OWNER_EMAIL, CLIENT_SECRET]) assert.ok(!logged.includes(secret) && !page.includes(secret), secret);
  });

  it("stores nothing when Google grants no refresh token, a broader scope, or no send scope", async () => {
    for (const [tokenBody, reason] of [
      [{ access_token: ACCESS, scope: GMAIL_SEND_SCOPE }, "no_refresh_token"],
      [{ access_token: ACCESS, refresh_token: REFRESH, scope: `${GMAIL_SEND_SCOPE} https://www.googleapis.com/auth/gmail.readonly` }, "unexpected_scope"],
      [{ access_token: ACCESS, refresh_token: REFRESH, scope: "openid" }, "missing_permissions"],
    ] as const) {
      const t = routeDeps({ fetch: fakeFetch({ token: [{ status: 200, body: tokenBody }] }) });
      const r = await handleGmailCallback(callbackRequest({ state: validState(), code: "4/c" }), t.deps);
      assert.equal(r.status, 400);
      assert.equal(t.puts.length, 0);
      assert.deepEqual(t.logs.at(-1), { event: "gmail_callback_refused", details: { reason } });
    }
    const failed = routeDeps({ fetch: fakeFetch({ token: [{ status: 400, body: { error: "invalid_grant" } }] }) });
    assert.equal((await handleGmailCallback(callbackRequest({ state: validState(), code: "4/c" }), failed.deps)).status, 400);
    const storeDown = routeDeps({ putFails: true });
    assert.equal((await handleGmailCallback(callbackRequest({ state: validState(), code: "4/c" }), storeDown.deps)).status, 500);
  });
});

// ── access-token refresh ────────────────────────────────────────────────────────────────────────────────

describe("access-token refresh", () => {
  it("posts the refresh token to Google's token endpoint and returns an expiring access token", async () => {
    const f = fakeFetch({});
    const t = await refreshGmailAccessToken(CONFIG, REFRESH, f.fn, 1000);
    assert.deepEqual(t, { ok: true, accessToken: ACCESS, expiresAtMs: 1000 + 3600 * 1000 });
    const body = new URLSearchParams(String(f.calls[0].init.body));
    assert.equal(body.get("grant_type"), "refresh_token");
    assert.equal(body.get("refresh_token"), REFRESH);
    assert.equal(f.calls[0].init.redirect, "error");
  });

  it("invalid_grant (revoked, or expired after 7 days in Testing) is not_connected; 429 rate_limited; others failed", async () => {
    const run = (r: Reply) => refreshGmailAccessToken(CONFIG, REFRESH, fakeFetch({ token: [r] }).fn, 0);
    assert.deepEqual(await run({ status: 400, body: { error: "invalid_grant" } }), { ok: false, kind: "not_connected" });
    assert.deepEqual(await run({ status: 429 }), { ok: false, kind: "rate_limited" });
    assert.deepEqual(await run({ status: 500 }), { ok: false, kind: "failed" });
    assert.deepEqual(await run("throw"), { ok: false, kind: "failed" });
    assert.deepEqual(await run({ status: 200, body: { access_token: "<bad token>" } }), { ok: false, kind: "failed" });
    assert.deepEqual(await run({ status: 200, body: { access_token: ACCESS, scope: "openid" } }), { ok: false, kind: "not_connected" });
  });

  it("exchangeGmailCode never returns provider text", async () => {
    const r = await exchangeGmailCode(CONFIG, "4/c", fakeFetch({ token: [{ status: 400, body: { error: "invalid_grant", error_description: "provider detail" } }] }).fn);
    assert.deepEqual(r, { ok: false, reason: "failed" });
  });
});

// ── the MIME message ────────────────────────────────────────────────────────────────────────────────────

describe("RFC 2822 message", () => {
  const date = new Date(Date.UTC(2026, 10, 21, 4, 5, 6));

  it("is multipart/alternative with a plain-text part first, CRLF endings and base64 bodies", () => {
    const mime = buildMimeMessage({ fromName: "Baton", fromEmail: SENDER, message: MSG, date, boundary: "bnd0123456789" })!;
    assert.ok(mime);
    assert.match(mime, /^From: "Baton" <baton\.sender@example\.test>\r\nTo: <invitee\.person@example\.test>\r\nSubject: Asha Rao invited you to a Baton handover\r\n/);
    assert.match(mime, /\r\nDate: Sat, 21 Nov 2026 04:05:06 \+0000\r\n/);
    assert.match(mime, /\r\nMIME-Version: 1\.0\r\n/);
    assert.match(mime, /Content-Type: multipart\/alternative; boundary="bnd0123456789"/);
    assert.ok(mime.indexOf("text/plain") < mime.indexOf("text/html"));
    assert.ok(!/[^\r]\n/.test(mime), "every line ends with CRLF");
    const [text, html] = partBodies(mime);
    assert.equal(text, MSG.text);
    assert.equal(html, MSG.html);
    assert.ok(mime.trimEnd().endsWith("--bnd0123456789--"));
  });

  it("encodes a non-ASCII subject (RFC 2047) and refuses header injection", () => {
    const mime = buildMimeMessage({ fromName: "Baton", fromEmail: SENDER, message: { ...MSG, subject: "Priya Śarma invited you" }, date, boundary: "bnd0123456789" })!;
    const subject = mime.split("\r\n").find((l) => l.startsWith("Subject:"))!;
    assert.match(subject, /^Subject: =\?UTF-8\?B\?[A-Za-z0-9+/=]+\?=/);
    for (const bad of [{ to: `${INVITEE}\r\nBcc: x@example.test` }, { subject: "x\ny" }, { to: "not an address" }]) {
      assert.equal(buildMimeMessage({ fromName: "Baton", fromEmail: SENDER, message: { ...MSG, ...bad }, date, boundary: "bnd0123456789" }), null);
    }
  });
});

// ── the transport ───────────────────────────────────────────────────────────────────────────────────────

describe("Gmail transport", () => {
  const transport = (f: ReturnType<typeof fakeFetch>, refresh: string | null = REFRESH, now = () => NOW) =>
    createGmailTransport(CONFIG, async () => refresh, { fetchFn: f.fn, now, boundary: () => "bnd0123456789" });

  it("refreshes, then sends one base64url raw message with the bearer token; reuses the cached access token", async () => {
    const f = fakeFetch({});
    const t = transport(f);
    assert.equal(t.configured, true);
    assert.deepEqual(await t.send(MSG), { ok: true, ref: "gmail:18c0ffee1234" });
    assert.equal(f.tokenCalls().length, 1);
    assert.equal(f.sendCalls().length, 1);
    const send = f.sendCalls()[0];
    assert.equal((send.init.headers as Record<string, string>).Authorization, `Bearer ${ACCESS}`);
    assert.equal(send.init.method, "POST");
    assert.equal(send.init.redirect, "error");
    const mime = decodeRaw(send);
    assert.match(mime, /\r\nTo: <invitee\.person@example\.test>\r\n/);
    assert.equal(partBodies(mime)[0], MSG.text);
    await t.send(MSG);
    assert.equal(f.tokenCalls().length, 1, "the access token is cached until shortly before it expires");
    assert.equal(f.sendCalls().length, 2);
  });

  it("refreshes again when the cached token is about to expire", async () => {
    const f = fakeFetch({});
    let now = NOW;
    const t = transport(f, REFRESH, () => now);
    await t.send(MSG);
    now += 3600 * 1000 - 30_000;
    await t.send(MSG);
    assert.equal(f.tokenCalls().length, 2);
  });

  it("a 401 from Gmail refreshes once and retries once (nothing was sent); a second 401 is not_connected", async () => {
    const ok = fakeFetch({ send: [{ status: 401 }, { status: 200, body: { id: "abc" } }] });
    assert.deepEqual(await transport(ok).send(MSG), { ok: true, ref: "gmail:abc" });
    assert.equal(ok.tokenCalls().length, 2);
    assert.equal(ok.sendCalls().length, 2);
    const twice = fakeFetch({ send: [{ status: 401 }] });
    assert.deepEqual(await transport(twice).send(MSG), { ok: false, kind: "not_connected" });
    assert.equal(twice.sendCalls().length, 2);
  });

  it("server errors, timeouts and network failures are NOT retried (no duplicate email)", async () => {
    for (const reply of [{ status: 500 }, { status: 503 }, "throw"] as const) {
      const f = fakeFetch({ send: [reply] });
      assert.deepEqual(await transport(f).send(MSG), { ok: false, kind: "failed" });
      assert.equal(f.sendCalls().length, 1, JSON.stringify(reply));
    }
  });

  it("maps rate limits; never returns provider text; drops odd message ids", async () => {
    const run = async (reply: Reply) => transport(fakeFetch({ send: [reply] })).send(MSG);
    assert.deepEqual(await run({ status: 429 }), { ok: false, kind: "rate_limited" });
    assert.deepEqual(await run({ status: 403, body: { error: { errors: [{ reason: "userRateLimitExceeded" }] } } }), { ok: false, kind: "rate_limited" });
    assert.deepEqual(await run({ status: 403, body: { error: { message: "provider detail" } } }), { ok: false, kind: "failed" });
    assert.deepEqual(await run({ status: 200, body: { id: "<script>" } }), { ok: true, ref: null });
  });

  it("without a refresh token: not_connected, no network call; an expired grant: not_connected, no send", async () => {
    const none = fakeFetch({});
    assert.deepEqual(await transport(none, null).send(MSG), { ok: false, kind: "not_connected" });
    assert.equal(none.calls.length, 0);
    const expired = fakeFetch({ token: [{ status: 400, body: { error: "invalid_grant" } }] });
    assert.deepEqual(await transport(expired).send(MSG), { ok: false, kind: "not_connected" });
    assert.equal(expired.sendCalls().length, 0);
  });

  it("refuses header injection without calling Google", async () => {
    const f = fakeFetch({});
    assert.deepEqual(await transport(f).send({ ...MSG, to: `${INVITEE}\r\nBcc: x@example.test` }), { ok: false, kind: "failed" });
    assert.equal(f.calls.length, 0);
  });
});

// ── where the refresh token comes from ──────────────────────────────────────────────────────────────────

describe("refresh token source and the sealed store", () => {
  const open = (sender: string, sealed: string) => openGmailRefreshToken(SEAL_KEY, sender, sealed);
  const store = (row: { senderEmail: string; sealedRefreshToken: string } | null | "throw"): GmailTokenStore => ({
    get: async () => {
      if (row === "throw") throw new Error("db down");
      return row;
    },
    put: async () => {},
  });

  it("prefers the sealed row for this sender, else GMAIL_REFRESH_TOKEN, else nothing", async () => {
    const sealed = sealGmailRefreshToken(SEAL_KEY, SENDER, REFRESH);
    assert.equal(await refreshTokenSource({ config: CONFIG, store: store({ senderEmail: SENDER, sealedRefreshToken: sealed }), open, envToken: "env-token-0123456789abcdef" })(), REFRESH);
    assert.equal(await refreshTokenSource({ config: CONFIG, store: store({ senderEmail: "other@example.test", sealedRefreshToken: sealed }), open, envToken: "env-token-0123456789abcdef" })(), "env-token-0123456789abcdef", "a row for another sender is ignored");
    assert.equal(await refreshTokenSource({ config: CONFIG, store: store("throw"), open, envToken: "env-token-0123456789abcdef" })(), "env-token-0123456789abcdef");
    assert.equal(await refreshTokenSource({ config: CONFIG, store: store({ senderEmail: SENDER, sealedRefreshToken: "c1.bad.bad.bad" }), open, envToken: null })(), null);
    assert.equal(await refreshTokenSource({ config: CONFIG, store: null, open: null, envToken: null })(), null);
  });

  it("the database store calls only the two service-role functions and never sends the token in clear", async () => {
    const calls: Array<{ fn: string; args: Record<string, unknown> }> = [];
    const db = { rpc: async (fn: string, args: Record<string, unknown>) => { calls.push({ fn, args }); return { data: [{ sender_email: SENDER, sealed_refresh_token: "c1.a.b.c" }], error: null }; } };
    const s = createDbGmailTokenStore(() => db);
    assert.deepEqual(await s.get(), { senderEmail: SENDER, sealedRefreshToken: "c1.a.b.c" });
    const sealed = sealGmailRefreshToken(SEAL_KEY, SENDER, REFRESH);
    await s.put({ senderEmail: SENDER, sealedRefreshToken: sealed, scopes: [GMAIL_SEND_SCOPE], connectedBy: OWNER_ID });
    assert.deepEqual(calls.map((c) => c.fn), ["email_sender_credentials_get", "email_sender_credentials_put"]);
    assert.ok(!JSON.stringify(calls).includes(REFRESH));
    const failing = createDbGmailTokenStore(() => ({ rpc: async () => ({ data: null, error: { message: "raw SQL detail" } }) }));
    await assert.rejects(failing.get(), (e: Error) => !e.message.includes("raw SQL detail"));
  });
});

// ── the invitation template ─────────────────────────────────────────────────────────────────────────────

describe("invitation template", () => {
  it("names the inviter, the handover, the expiry and the link, in HTML and a plain-text alternative, with no dashes", () => {
    for (const part of [MSG.text, MSG.html]) {
      assert.ok(part.includes("Asha Rao"));
      assert.ok(part.includes("28 November 2026 at 10:00 UTC"));
      assert.ok(part.includes("can be used once"));
    }
    assert.ok(MSG.text.includes('"Robotics <Club> handover"'));
    assert.ok(MSG.text.includes("https://baton.example.test/h/tok123?x=1&y=2"));
    assert.ok(MSG.html.includes("Robotics &lt;Club&gt; handover"));
    assert.ok(MSG.html.includes('href="https://baton.example.test/h/tok123?x=1&amp;y=2"'));
    assert.doesNotMatch(MSG.text + MSG.html + MSG.subject, new RegExp("[\u2013\u2014]"), "no en or em dashes");
    assert.doesNotMatch(MSG.html, /<img|<script|<link|url\(|https?:\/\/(?!baton\.example\.test)/, "no images, scripts or external resources");
    assert.doesNotMatch(MSG.text, /<(?:p|a|div|strong|br)[\s>]/i, "the plain-text part has no template markup");
  });
});
