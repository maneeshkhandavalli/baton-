// Round 4 (Agent E): Gmail delivery through the real invitation actions (inviteMember, reissueInvitation) with fakes.
// The Gmail transport is the real one (lib/email/gmail-core.ts) over a fake fetch; the database is the fake RPC
// client from lib/actions/__tests__/helpers.ts. Synthetic values only.
// Run: node --import ./lib/contracts/__tests__/resolve-ts.mjs --test "lib/email/__tests__/*.test.ts"
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";

import { ACTOR, ACTOR_ID, H, NEW_ID, ORIGIN, P, allStrings, fakeDeps } from "../../actions/__tests__/helpers";
import * as invitations from "../../actions/core/invitations";
import * as members from "../../actions/core/members";
import type { VerifiedActor } from "../../db/actor-rules";
import { NOT_CONFIGURED_TRANSPORT, RESEND_ENDPOINT, createResendTransport, withNotConnectedFallback } from "../core";
import { GMAIL_SEND_SCOPE, GMAIL_SEND_URL, GOOGLE_TOKEN_URL, createGmailTransport, resolveGmailConfig, type GmailConfig } from "../gmail-core";

const CONFIG = resolveGmailConfig({
  GMAIL_CLIENT_ID: "1234567890-synthetic.apps.googleusercontent.com",
  GMAIL_CLIENT_SECRET: "synthetic-client-secret-0123",
  GMAIL_REDIRECT_URI: "https://baton.example.test/api/email/google/callback",
  GMAIL_SENDER_EMAIL: "baton.sender@example.test",
}) as GmailConfig;
const REFRESH = "1//synthetic-refresh-token-not-real-0123456789";
const ACCESS = "ya29.synthetic-access-token-0123456789";
const INVITEE = "new.person@example.test";

const PENDING = {
  state: "pending",
  handover_title: "Robotics Club",
  inviter_name: "Asha",
  role: "incoming",
  expires_at: "2026-11-28T10:00:00+00:00",
  recipient_email_masked: "n***@example.test",
  viewer: null,
  member_handover_id: null,
  member_role: null,
};
const base = { invite_member: { data: NEW_ID }, get_member_invite_details: { data: PENDING }, record_invitation_delivery: { data: P } } as const;
const input = { handoverId: H, email: INVITEE, role: "incoming" as const };

type Reply = { status: number; body?: unknown } | "throw";
function gmail(send: Reply, token: Reply = { status: 200, body: { access_token: ACCESS, expires_in: 3600, scope: GMAIL_SEND_SCOPE } }, refresh: string | null = REFRESH) {
  const urls: string[] = [];
  const fetchFn = async (url: string) => {
    urls.push(url);
    const r = url === GOOGLE_TOKEN_URL ? token : url === GMAIL_SEND_URL ? send : "throw";
    if (r === "throw") throw new Error("network down");
    return { status: r.status, ok: r.status >= 200 && r.status < 300, json: async () => r.body ?? {} };
  };
  const transport = createGmailTransport(CONFIG, async () => refresh, { fetchFn });
  return { transport, sends: () => urls.filter((u) => u === GMAIL_SEND_URL).length, urls };
}

const TOKEN_MUTATING_RPCS = ["invite_member", "reissue_member_invite", "revoke_access_token", "revoke_member_invite"];

describe("inviteMember with the Gmail transport", () => {
  it("success: one invitation, one Gmail send, recorded sent with the Gmail message id; the link is still returned", async () => {
    const g = gmail({ status: 200, body: { id: "18c0ffee" } });
    const f = fakeDeps({ rpc: { ...base }, email: g.transport });
    const r = await members.inviteMember(f.deps, input);
    assert.ok(r.ok);
    assert.deepEqual(r.data.delivery, { status: "sent" });
    assert.ok(r.data.url.startsWith(`${ORIGIN}/h/`), "Copy link stays available");
    assert.equal(g.sends(), 1);
    assert.equal(f.fns().filter((fn) => fn === "invite_member").length, 1);
    const rec = f.calls.find((c) => c.fn === "record_invitation_delivery")!.args!;
    assert.deepEqual([rec.p_status, rec.p_reason, rec.p_provider_ref], ["sent", null, "gmail:18c0ffee"]);
  });

  it("a failed send creates no second invitation, revokes nothing, retries nothing and keeps the link", async () => {
    for (const reply of [{ status: 500 }, { status: 400 }, "throw"] as const) {
      const g = gmail(reply);
      const f = fakeDeps({ rpc: { ...base }, email: g.transport });
      const r = await members.inviteMember(f.deps, input);
      assert.ok(r.ok, JSON.stringify(reply));
      assert.deepEqual(r.data.delivery, { status: "not_sent", reason: "provider_failed" });
      assert.ok(r.data.url.startsWith(`${ORIGIN}/h/`));
      assert.equal(r.data.tokenId, NEW_ID, "the same token the creator copies");
      assert.equal(g.sends(), 1, "exactly one Gmail call: an ambiguous failure is never retried");
      const mutating = f.fns().filter((fn) => TOKEN_MUTATING_RPCS.includes(fn));
      assert.deepEqual(mutating, ["invite_member"], "one token created; none revoked or reissued");
      const rec = f.calls.find((c) => c.fn === "record_invitation_delivery")!.args!;
      assert.deepEqual([rec.p_status, rec.p_reason], ["failed", "provider_failed"]);
      const logged = JSON.stringify(f.issues);
      const raw = decodeURIComponent(r.data.url.slice(`${ORIGIN}/h/`.length));
      for (const secret of [INVITEE, raw, REFRESH, ACCESS, "/h/"]) assert.ok(!logged.includes(secret), `log leaks ${secret}`);
    }
  });

  it("rate limited by Gmail: recorded rate_limited, still one invitation", async () => {
    const g = gmail({ status: 429 });
    const f = fakeDeps({ rpc: { ...base }, email: g.transport });
    const r = await members.inviteMember(f.deps, input);
    assert.ok(r.ok);
    assert.deepEqual(r.data.delivery, { status: "not_sent", reason: "provider_failed" });
    assert.equal(f.calls.find((c) => c.fn === "record_invitation_delivery")!.args!.p_reason, "rate_limited");
  });

  it("Gmail not connected (no token, or the 7-day Testing expiry): not_sent/email_not_configured, the link still works", async () => {
    for (const g of [gmail({ status: 200 }, undefined, null), gmail({ status: 200 }, { status: 400, body: { error: "invalid_grant" } })]) {
      const f = fakeDeps({ rpc: { ...base }, email: g.transport });
      const r = await members.inviteMember(f.deps, input);
      assert.ok(r.ok);
      assert.deepEqual(r.data.delivery, { status: "not_sent", reason: "email_not_configured" });
      assert.equal(g.sends(), 0);
      const rec = f.calls.find((c) => c.fn === "record_invitation_delivery")!.args!;
      assert.deepEqual([rec.p_status, rec.p_reason], ["not_sent", "email_not_configured"]);
      assert.deepEqual(f.issues, [{ event: "invitation_email_failed", details: { tokenId: NEW_ID, kind: "not_connected" } }]);
    }
  });

  it("the email content and the database calls never carry the raw token outside the link", async () => {
    const g = gmail({ status: 200, body: { id: "x1" } });
    const f = fakeDeps({ rpc: { ...base }, email: g.transport });
    const r = await members.inviteMember(f.deps, input);
    assert.ok(r.ok);
    const raw = decodeURIComponent(r.data.url.slice(`${ORIGIN}/h/`.length));
    assert.ok(!allStrings(f.calls.map((c) => c.args)).some((s) => s.includes(raw)), "the raw token never reaches the database");
    assert.equal(f.emails.length, 1);
    assert.ok(f.emails[0].text.includes(r.data.url));
    assert.match(f.emails[0].text, /expires on \d{1,2} [A-Z][a-z]+ \d{4} at \d\d:\d\d UTC\./, "the expiry is in the email");
  });
});

describe("reissueInvitation with Gmail: a failed send keeps the new link", () => {
  it("one reissue, one send attempt, link returned", async () => {
    const g = gmail({ status: 500 });
    const f = fakeDeps({
      rpc: {
        member_invite_recipient: { data: INVITEE },
        reissue_member_invite: { data: { token_id: NEW_ID, recipient_email: INVITEE } },
        get_member_invite_details: { data: PENDING },
        record_invitation_delivery: { data: P },
      },
      email: g.transport,
    });
    const r = await invitations.reissueInvitation(f.deps, { tokenId: P });
    assert.ok(r.ok);
    assert.deepEqual(r.data.delivery, { status: "not_sent", reason: "provider_failed" });
    assert.equal(f.fns().filter((fn) => fn === "reissue_member_invite").length, 1);
    assert.equal(g.sends(), 1);
  });
});

describe("demo accounts never send email (F3)", () => {
  const DEMO = Object.freeze({ profileId: ACTOR_ID, email: "demo.creator@example.test", emailConfirmed: true }) as VerifiedActor;
  let saved: string | undefined;
  beforeEach(() => {
    saved = process.env.BATON_DEMO_EMAILS;
    process.env.BATON_DEMO_EMAILS = "demo.creator@example.test";
  });
  afterEach(() => {
    if (saved === undefined) delete process.env.BATON_DEMO_EMAILS;
    else process.env.BATON_DEMO_EMAILS = saved;
  });

  it("the invitation is created and the link returned for copying; no Gmail call at all; delivery is demo", async () => {
    const g = gmail({ status: 200, body: { id: "never" } });
    const f = fakeDeps({ actor: DEMO, rpc: { ...base }, email: g.transport });
    const r = await members.inviteMember(f.deps, input);
    assert.ok(r.ok);
    assert.deepEqual(r.data.delivery, { status: "not_sent", reason: "demo" });
    assert.ok(r.data.url.startsWith(`${ORIGIN}/h/`));
    assert.deepEqual(g.urls, [], "no token refresh and no send");
    assert.deepEqual(f.emails, []);
    assert.ok(f.fns().includes("invite_member"));
    const rec = f.calls.find((c) => c.fn === "record_invitation_delivery")!.args!;
    assert.deepEqual([rec.p_status, rec.p_reason], ["not_sent", null]);
  });

  it("a non-demo account is unaffected by the demo list", async () => {
    const g = gmail({ status: 200, body: { id: "ok1" } });
    const f = fakeDeps({ actor: ACTOR, rpc: { ...base }, email: g.transport });
    const r = await members.inviteMember(f.deps, input);
    assert.ok(r.ok && r.data.delivery.status === "sent");
    assert.equal(g.sends(), 1);
  });
});

// Audit fix: with the GMAIL_* variables set but Gmail not connected yet, Resend (when configured) must still deliver.
// lib/email/index.ts wraps the Gmail transport with withNotConnectedFallback; the transports here are the real
// Gmail and Resend ones over fake fetches. Nothing is sent anywhere.
describe("Gmail not connected: falls back to Resend, and only then", () => {
  function resend(reply: Reply = { status: 200, body: { id: "re_synthetic_1" } }) {
    const urls: string[] = [];
    const fetchFn = async (url: string) => {
      urls.push(url);
      if (reply === "throw") throw new Error("network down");
      return { status: reply.status, ok: reply.status >= 200 && reply.status < 300, json: async () => reply.body ?? {} };
    };
    const transport = createResendTransport({ apiKey: "re_synthetic_key_0123456789", from: "Baton <invites@example.test>" }, fetchFn);
    return { transport, sends: () => urls.filter((u) => u === RESEND_ENDPOINT).length };
  }

  it("no refresh token, or a revoked one: one Resend send, recorded sent with the Resend id; no Gmail send", async () => {
    for (const g of [gmail({ status: 200 }, undefined, null), gmail({ status: 200 }, { status: 400, body: { error: "invalid_grant" } })]) {
      const rs = resend();
      const f = fakeDeps({ rpc: { ...base }, email: withNotConnectedFallback(g.transport, rs.transport) });
      const r = await members.inviteMember(f.deps, input);
      assert.ok(r.ok);
      assert.deepEqual(r.data.delivery, { status: "sent" });
      assert.equal(g.sends(), 0);
      assert.equal(rs.sends(), 1);
      assert.equal(f.emails.length, 1, "one send per invitation");
      const rec = f.calls.find((c) => c.fn === "record_invitation_delivery")!.args!;
      assert.deepEqual([rec.p_status, rec.p_reason, rec.p_provider_ref], ["sent", null, "re_synthetic_1"]);
      assert.deepEqual(f.issues, [], "nothing extra logged");
    }
  });

  it("Gmail refuses the token twice (401): nothing went out, so Resend sends once", async () => {
    const g = gmail({ status: 401 });
    const rs = resend();
    const f = fakeDeps({ rpc: { ...base }, email: withNotConnectedFallback(g.transport, rs.transport) });
    const r = await members.inviteMember(f.deps, input);
    assert.ok(r.ok && r.data.delivery.status === "sent");
    assert.equal(rs.sends(), 1);
  });

  it("a Gmail failure other than not_connected never reaches Resend (no duplicate send)", async () => {
    for (const reply of [{ status: 500 }, { status: 400 }, { status: 429 }, "throw"] as const) {
      const g = gmail(reply);
      const rs = resend();
      const f = fakeDeps({ rpc: { ...base }, email: withNotConnectedFallback(g.transport, rs.transport) });
      const r = await members.inviteMember(f.deps, input);
      assert.ok(r.ok, JSON.stringify(reply));
      assert.deepEqual(r.data.delivery, { status: "not_sent", reason: "provider_failed" });
      assert.equal(g.sends(), 1);
      assert.equal(rs.sends(), 0, `Resend not tried after ${JSON.stringify(reply)}`);
    }
    const ok = gmail({ status: 200, body: { id: "g1" } });
    const rs = resend();
    const f = fakeDeps({ rpc: { ...base }, email: withNotConnectedFallback(ok.transport, rs.transport) });
    assert.ok((await members.inviteMember(f.deps, input)).ok);
    assert.equal(rs.sends(), 0, "Gmail connected: Resend never used");
  });

  it("the choice is not frozen: once Gmail is connected, the same transport sends through Gmail", async () => {
    let refresh: string | null = null;
    const urls: string[] = [];
    const fetchFn = async (url: string) => {
      urls.push(url);
      const body = url === GOOGLE_TOKEN_URL ? { access_token: ACCESS, expires_in: 3600, scope: GMAIL_SEND_SCOPE } : { id: "g2" };
      return { status: 200, ok: true, json: async () => body };
    };
    const rs = resend();
    const transport = withNotConnectedFallback(createGmailTransport(CONFIG, async () => refresh, { fetchFn }), rs.transport);
    const before = await transport.send({ to: INVITEE, subject: "s", text: "t", html: "<p>t</p>" });
    assert.deepEqual(before, { ok: true, ref: "re_synthetic_1" });
    refresh = REFRESH; // the owner connects Gmail
    const after = await transport.send({ to: INVITEE, subject: "s", text: "t", html: "<p>t</p>" });
    assert.deepEqual(after, { ok: true, ref: "gmail:g2" });
    assert.equal(rs.sends(), 1);
    assert.equal(urls.filter((u) => u === GMAIL_SEND_URL).length, 1);
  });

  it("without Resend configured, not_connected is unchanged (the creator copies the link)", async () => {
    const g = gmail({ status: 200 }, undefined, null);
    assert.equal(withNotConnectedFallback(g.transport, NOT_CONFIGURED_TRANSPORT), g.transport);
    const rs = resend();
    const f = fakeDeps({ rpc: { ...base }, email: withNotConnectedFallback(g.transport, NOT_CONFIGURED_TRANSPORT) });
    const r = await members.inviteMember(f.deps, input);
    assert.ok(r.ok);
    assert.deepEqual(r.data.delivery, { status: "not_sent", reason: "email_not_configured" });
    assert.equal(rs.sends(), 0);
  });

  it("demo accounts still never send, through either provider", async () => {
    const saved = process.env.BATON_DEMO_EMAILS;
    process.env.BATON_DEMO_EMAILS = "demo.creator@example.test";
    try {
      const g = gmail({ status: 200 }, undefined, null);
      const rs = resend();
      const DEMO = Object.freeze({ profileId: ACTOR_ID, email: "demo.creator@example.test", emailConfirmed: true }) as VerifiedActor;
      const f = fakeDeps({ actor: DEMO, rpc: { ...base }, email: withNotConnectedFallback(g.transport, rs.transport) });
      const r = await members.inviteMember(f.deps, input);
      assert.ok(r.ok);
      assert.deepEqual(r.data.delivery, { status: "not_sent", reason: "demo" });
      assert.deepEqual(g.urls, []);
      assert.equal(rs.sends(), 0);
    } finally {
      if (saved === undefined) delete process.env.BATON_DEMO_EMAILS;
      else process.env.BATON_DEMO_EMAILS = saved;
    }
  });

  it("lib/email/index.ts wraps the Gmail transport with the fallback", () => {
    const src = readFileSync(join(process.cwd(), "lib/email/index.ts"), "utf8");
    assert.match(src, /withNotConnectedFallback\(gmail, resend\)/);
  });
});
