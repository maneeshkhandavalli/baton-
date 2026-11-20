// R3 Task 06: the invitation email transport (lib/email/core.ts). No network: fetch is a fake.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { NOT_CONFIGURED_TRANSPORT, RESEND_ENDPOINT, emailTransportFor, renderInvitationEmail, resolveEmailConfig } from "../../email/core";

const KEY = "re_synthetic_test_key_not_real";
const FROM = "Baton <invites@example.test>";
const MSG = { to: "someone@example.test", subject: "Hello", text: "t", html: "<p>t</p>" };

type Call = { url: string; init: RequestInit };
function fakeFetch(response: { status: number; body?: unknown } | "throw") {
  const calls: Call[] = [];
  const fn = async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    if (response === "throw") throw new Error("offline");
    return { status: response.status, ok: response.status >= 200 && response.status < 300, json: async () => response.body ?? {} };
  };
  return { fn, calls };
}

describe("email configuration (D5): both server-only variables, or nothing is sent", () => {
  it("needs RESEND_API_KEY and BATON_EMAIL_FROM; malformed values fail closed", () => {
    assert.deepEqual(resolveEmailConfig({ RESEND_API_KEY: KEY, BATON_EMAIL_FROM: FROM }), { apiKey: KEY, from: FROM });
    assert.ok(resolveEmailConfig({ RESEND_API_KEY: KEY, BATON_EMAIL_FROM: "invites@example.test" }));
    for (const env of [
      {},
      { RESEND_API_KEY: KEY },
      { BATON_EMAIL_FROM: FROM },
      { RESEND_API_KEY: "short", BATON_EMAIL_FROM: FROM },
      { RESEND_API_KEY: "re_has space inside", BATON_EMAIL_FROM: FROM },
      { RESEND_API_KEY: KEY, BATON_EMAIL_FROM: "Baton <invites@example.test>\r\nBcc: x@example.test" },
      { RESEND_API_KEY: KEY, BATON_EMAIL_FROM: "not an address" },
      { NEXT_PUBLIC_RESEND_API_KEY: KEY, NEXT_PUBLIC_BATON_EMAIL_FROM: FROM },
    ]) {
      assert.equal(resolveEmailConfig(env), null, JSON.stringify(env));
      assert.equal(emailTransportFor(env), NOT_CONFIGURED_TRANSPORT);
    }
  });

  it("the not-configured transport never calls anything", async () => {
    assert.equal(NOT_CONFIGURED_TRANSPORT.configured, false);
    assert.deepEqual(await NOT_CONFIGURED_TRANSPORT.send(MSG), { ok: false, kind: "failed" });
  });

  it("only server modules read the variables; nothing is NEXT_PUBLIC", () => {
    const root = fileURLToPath(new URL("../../../", import.meta.url));
    const index = readFileSync(`${root}lib/email/index.ts`, "utf8");
    const core = readFileSync(`${root}lib/email/core.ts`, "utf8");
    assert.match(index, /^import "server-only";/);
    assert.doesNotMatch(core, /process\.env/);
    assert.doesNotMatch(index + core, /process.env.NEXT_PUBLIC|env.NEXT_PUBLIC/);
    assert.doesNotMatch(core, /console\./, "the transport never logs (a message contains the raw token)");
  });
});

describe("Resend transport", () => {
  it("POSTs one JSON message with the bearer key to the fixed endpoint; returns the message id", async () => {
    const f = fakeFetch({ status: 200, body: { id: "4ef9a417-02e9-4d39-ad75-9611e0fcc33c" } });
    const t = emailTransportFor({ RESEND_API_KEY: KEY, BATON_EMAIL_FROM: FROM }, f.fn);
    assert.equal(t.configured, true);
    assert.deepEqual(await t.send(MSG), { ok: true, ref: "4ef9a417-02e9-4d39-ad75-9611e0fcc33c" });
    assert.equal(f.calls.length, 1);
    assert.equal(f.calls[0].url, RESEND_ENDPOINT);
    assert.equal(f.calls[0].init.method, "POST");
    assert.equal((f.calls[0].init.headers as Record<string, string>).Authorization, `Bearer ${KEY}`);
    assert.equal(f.calls[0].init.redirect, "error");
    assert.deepEqual(JSON.parse(String(f.calls[0].init.body)), { from: FROM, to: [MSG.to], subject: MSG.subject, text: MSG.text, html: MSG.html });
  });

  it("maps failures without provider text: 429 → rate_limited, others and network errors → failed; odd ids are dropped", async () => {
    const send = async (r: { status: number; body?: unknown } | "throw") => emailTransportFor({ RESEND_API_KEY: KEY, BATON_EMAIL_FROM: FROM }, fakeFetch(r).fn).send(MSG);
    assert.deepEqual(await send({ status: 429 }), { ok: false, kind: "rate_limited" });
    assert.deepEqual(await send({ status: 422, body: { message: "provider detail" } }), { ok: false, kind: "failed" });
    assert.deepEqual(await send({ status: 500 }), { ok: false, kind: "failed" });
    assert.deepEqual(await send("throw"), { ok: false, kind: "failed" });
    assert.deepEqual(await send({ status: 200, body: { id: "<script>" } }), { ok: true, ref: null });
  });

  it("refuses header injection in the recipient or subject without calling the provider", async () => {
    const f = fakeFetch({ status: 200 });
    const t = emailTransportFor({ RESEND_API_KEY: KEY, BATON_EMAIL_FROM: FROM }, f.fn);
    assert.deepEqual(await t.send({ ...MSG, to: "a@example.test\r\nBcc: b@example.test" }), { ok: false, kind: "failed" });
    assert.deepEqual(await t.send({ ...MSG, subject: "x\ny" }), { ok: false, kind: "failed" });
    assert.equal(f.calls.length, 0);
  });
});

describe("invitation email content", () => {
  it("escapes every user-controlled value and keeps the subject to one line", () => {
    const m = renderInvitationEmail({
      to: "n@example.test",
      handoverTitle: '<img src=x onerror="alert(1)"> Club',
      inviterName: "Eve\r\nBcc: x@example.test",
      role: "incoming",
      url: "https://baton.example.test/h/abc?x=1&y=2",
      expiresAt: "2026-11-25T10:00:00.000Z",
    });
    assert.ok(!m.html.includes("<img"), m.html);
    assert.ok(m.html.includes("&lt;img src=x onerror=&quot;alert(1)&quot;&gt; Club"));
    assert.ok(m.html.includes('href="https://baton.example.test/h/abc?x=1&amp;y=2"'));
    assert.doesNotMatch(m.subject, /[\r\n]/);
    assert.equal(m.subject, "Eve Bcc: x@example.test invited you to a Baton handover");
    assert.ok(m.text.includes("https://baton.example.test/h/abc?x=1&y=2"));
    assert.doesNotMatch(m.html, /<img|<script|https?:\/\/(?!baton\.example\.test)/, "no images or external resources");
  });
});
