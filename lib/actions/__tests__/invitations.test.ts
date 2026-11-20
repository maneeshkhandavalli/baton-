// R3 Task 06: invitation Server Functions (lib/actions/core/invitations.ts) and inviteMember's delivery, with fakes.
// Run: node --import ./lib/contracts/__tests__/resolve-ts.mjs --test "lib/actions/__tests__/*.test.ts"
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { describe, it } from "node:test";

import type { VerifiedActor } from "../../db/actor-rules";
import type { EmailSendResult, EmailTransport } from "../../email/core";
import * as invitations from "../core/invitations";
import * as members from "../core/members";
import { ACTOR_ID, H, NEW_ID, ORIGIN, P, allStrings, fakeDeps, type RpcHandler } from "./helpers";

const TOKEN = randomBytes(32).toString("base64url");
const HASH = `\\x${createHash("sha256").update(TOKEN).digest("hex")}`;
const dbError = (code: string): RpcHandler => ({ error: { code, message: `raw SQL detail for ${code}` } });
const UNCONFIRMED = Object.freeze({ profileId: ACTOR_ID, email: "member@example.test", emailConfirmed: false }) as VerifiedActor;

const PENDING = {
  state: "pending",
  handover_title: "Robotics <Club> & co",
  inviter_name: "Asha",
  role: "incoming",
  expires_at: "2026-11-25T10:00:00+00:00",
  recipient_email_masked: "m***@example.test",
  viewer: null,
  member_handover_id: null,
  member_role: null,
};

function transport(result: EmailSendResult | "throw" = { ok: true, ref: "msg_1" }): EmailTransport {
  return {
    configured: true,
    send: async () => {
      if (result === "throw") throw new Error("network down");
      return result;
    },
  };
}

describe("getInvitation", () => {
  it("a malformed token is token_invalid/invalid without any call", async () => {
    for (const token of ["", "short", `${TOKEN}x`, 42, null]) {
      const f = fakeDeps();
      const r = await invitations.getInvitation(f.deps, { token });
      assert.equal(!r.ok && r.error.code, "token_invalid");
      assert.equal(!r.ok && r.error.details?.reason, "invalid");
      assert.deepEqual(f.calls, []);
      assert.equal(f.actorLookups, 0);
    }
  });

  it("consumes the view limits first, sends only the hash and the verified viewer, never redeems", async () => {
    const f = fakeDeps({ rpc: { get_member_invite_details: { data: { ...PENDING, viewer: { email_matches: true, email_confirmed: true, already_member: false } } } } });
    const r = await invitations.getInvitation(f.deps, { token: TOKEN });
    assert.ok(r.ok && r.data.state === "pending");
    assert.deepEqual(f.fns(), ["consume_rate_limit", "consume_rate_limit", "get_member_invite_details"]);
    assert.deepEqual(f.calls.map((c) => c.args?.p_scope).slice(0, 2), ["invite_view_client", "invite_view_token"]);
    const details = f.calls[2].args!;
    assert.equal(details.p_token_hash, HASH);
    assert.equal(details.p_viewer_profile_id, ACTOR_ID);
    assert.ok(!allStrings(f.calls.map((c) => c.args)).some((s) => s.includes(TOKEN)), "the raw token never reaches the database");
    assert.ok(!f.fns().includes("redeem_member_invite"));
    assert.deepEqual(r.data, {
      state: "pending",
      handoverTitle: "Robotics <Club> & co",
      inviterName: "Asha",
      role: "incoming",
      expiresAt: "2026-11-25T10:00:00.000Z",
      recipientEmailMasked: "m***@example.test",
      viewer: { emailMatches: true, emailConfirmed: true, alreadyMember: false },
    });
  });

  it("works signed out (viewer null) and gives an existing member their link", async () => {
    const out = fakeDeps({ actor: null, rpc: { get_member_invite_details: { data: PENDING } } });
    const r = await invitations.getInvitation(out.deps, { token: TOKEN });
    assert.ok(r.ok && r.data.state === "pending" && r.data.viewer === null);
    assert.equal(out.calls[2].args?.p_viewer_profile_id, null);

    const member = fakeDeps({
      rpc: { get_member_invite_details: { data: { ...PENDING, viewer: { email_matches: false, email_confirmed: true, already_member: true }, member_handover_id: H, member_role: "reviewer" } } },
    });
    const m = await invitations.getInvitation(member.deps, { token: TOKEN });
    assert.ok(m.ok && m.data.state === "pending");
    assert.equal(m.ok && m.data.state === "pending" && m.data.memberHref, `/handover/${H}/review`);
  });

  it("accepted → memberHref for the role; every other state → its reason", async () => {
    const acc = fakeDeps({ rpc: { get_member_invite_details: { data: { state: "accepted", handover_id: H, role: "incoming" } } } });
    const r = await invitations.getInvitation(acc.deps, { token: TOKEN });
    assert.deepEqual(r, { ok: true, data: { state: "accepted", handoverId: H, memberHref: `/handover/${H}/published` } });
    for (const state of ["expired", "revoked", "used", "unavailable"]) {
      const f = fakeDeps({ rpc: { get_member_invite_details: { data: { state } } } });
      const x = await invitations.getInvitation(f.deps, { token: TOKEN });
      assert.equal(!x.ok && x.error.code, "token_invalid", state);
      assert.equal(!x.ok && x.error.details?.reason, state);
      assert.ok(!x.ok && !x.error.message.includes("raw SQL"));
    }
    const unknown = fakeDeps({ rpc: { get_member_invite_details: dbError("BTTI0") } });
    const u = await invitations.getInvitation(unknown.deps, { token: TOKEN });
    assert.equal(!u.ok && u.error.details?.reason, "invalid");
  });

  it("rate limited before the database is asked anything else; a malformed row is internal", async () => {
    const f = fakeDeps({ rpc: { consume_rate_limit: { data: false } } });
    const r = await invitations.getInvitation(f.deps, { token: TOKEN });
    assert.equal(!r.ok && r.error.code, "rate_limited");
    assert.ok(!f.fns().includes("get_member_invite_details"));
    const bad = fakeDeps({ rpc: { get_member_invite_details: { data: { state: "pending" } } } });
    const b = await invitations.getInvitation(bad.deps, { token: TOKEN });
    assert.equal(!b.ok && b.error.code, "internal");
  });
});

describe("acceptInvitation", () => {
  const REDEEMED = { data: { handover_id: H, role: "reviewer", member_id: P, replayed: false } };

  it("needs a session and a well-formed token; nothing is called otherwise", async () => {
    const out = fakeDeps({ actor: null });
    assert.equal(((await invitations.acceptInvitation(out.deps, { token: TOKEN })) as { error: { code: string } }).error.code, "unauthenticated");
    assert.deepEqual(out.calls, []);
    const bad = fakeDeps();
    const r = await invitations.acceptInvitation(bad.deps, { token: "nope" });
    assert.equal(!r.ok && r.error.details?.reason, "invalid");
    assert.deepEqual(bad.calls, []);
  });

  it("redeems with the verified profile id and the hash; review roles go to review, lead/incoming to the publication", async () => {
    const f = fakeDeps({ rpc: { redeem_member_invite: REDEEMED } });
    const r = await invitations.acceptInvitation(f.deps, { token: TOKEN });
    assert.deepEqual(r, { ok: true, data: { handoverId: H, role: "reviewer", redirectTo: `/handover/${H}/review`, replayed: false } });
    const redeem = f.calls.find((c) => c.fn === "redeem_member_invite")!;
    assert.deepEqual(Object.keys(redeem.args!).sort(), ["p_profile_id", "p_token_hash"]);
    assert.equal(redeem.args!.p_profile_id, ACTOR_ID);
    assert.equal(redeem.args!.p_token_hash, HASH);
    assert.deepEqual(f.fns().slice(0, 2), ["consume_rate_limit", "consume_rate_limit"], "redeem limits first");

    const replay = fakeDeps({ rpc: { redeem_member_invite: { data: { handover_id: H, role: "incoming", member_id: P, replayed: true } } } });
    const x = await invitations.acceptInvitation(replay.deps, { token: TOKEN });
    assert.deepEqual(x, { ok: true, data: { handoverId: H, role: "incoming", redirectTo: `/handover/${H}/published`, replayed: true } });
  });

  it("explains a refusal from the invitation's state and the viewer", async () => {
    const cases: Array<[unknown, string]> = [
      [{ ...PENDING, viewer: { email_matches: false, email_confirmed: true, already_member: false } }, "email_mismatch"],
      [{ ...PENDING, viewer: { email_matches: true, email_confirmed: false, already_member: false } }, "email_unconfirmed"],
      [{ ...PENDING, viewer: { email_matches: true, email_confirmed: true, already_member: false } }, "invalid"],
      [{ state: "expired" }, "expired"],
      [{ state: "revoked" }, "revoked"],
      [{ state: "used" }, "used"],
      [{ state: "unavailable" }, "unavailable"],
    ];
    for (const [row, reason] of cases) {
      const f = fakeDeps({ rpc: { redeem_member_invite: dbError("BTTI0"), get_member_invite_details: { data: row } } });
      const r = await invitations.acceptInvitation(f.deps, { token: TOKEN });
      assert.equal(!r.ok && r.error.code, "token_invalid", reason);
      assert.equal(!r.ok && r.error.details?.reason, reason);
      assert.ok(!r.ok && !r.error.message.includes("raw SQL"));
      const classify = f.calls.filter((c) => c.fn === "consume_rate_limit").length;
      assert.equal(classify, 2, "classifying a refusal consumes no extra limit");
    }
    const gone = fakeDeps({ rpc: { redeem_member_invite: dbError("BTTI0"), get_member_invite_details: dbError("BTTI0") } });
    const g = await invitations.acceptInvitation(gone.deps, { token: TOKEN });
    assert.equal(!g.ok && g.error.details?.reason, "invalid");
  });

  it("an unconfirmed address is refused before redemption and explained", async () => {
    const f = fakeDeps({ actor: UNCONFIRMED, rpc: { get_member_invite_details: { data: { ...PENDING, viewer: { email_matches: true, email_confirmed: false, already_member: false } } } } });
    const r = await invitations.acceptInvitation(f.deps, { token: TOKEN });
    assert.equal(!r.ok && r.error.details?.reason, "email_unconfirmed");
    assert.ok(!f.fns().includes("redeem_member_invite"), "the database is never asked to redeem for an unconfirmed address");
  });

  it("a concurrent winner by the same user is a replay; already a member → conflict/already_member with the link", async () => {
    const race = fakeDeps({ rpc: { redeem_member_invite: dbError("BTTI0"), get_member_invite_details: { data: { state: "accepted", handover_id: H, role: "lead" } } } });
    const r = await invitations.acceptInvitation(race.deps, { token: TOKEN });
    assert.deepEqual(r, { ok: true, data: { handoverId: H, role: "lead", redirectTo: `/handover/${H}/published`, replayed: true } });

    const member = fakeDeps({
      rpc: {
        redeem_member_invite: dbError("BTCF0"),
        get_member_invite_details: { data: { ...PENDING, viewer: { email_matches: true, email_confirmed: true, already_member: true }, member_handover_id: H, member_role: "incoming" } },
      },
    });
    const m = await invitations.acceptInvitation(member.deps, { token: TOKEN });
    assert.equal(!m.ok && m.error.code, "conflict");
    assert.deepEqual(!m.ok && m.error.details, { reason: "already_member", handoverId: H, memberHref: `/handover/${H}/published` });

    const busy = fakeDeps({ rpc: { redeem_member_invite: dbError("40001") } });
    const b = await invitations.acceptInvitation(busy.deps, { token: TOKEN });
    assert.ok(!b.ok && b.error.code === "conflict" && b.error.retryable && b.error.details === undefined, "a retryable conflict stays generic");

    const limited = fakeDeps({ rpc: { consume_rate_limit: { data: false } } });
    const l = await invitations.acceptInvitation(limited.deps, { token: TOKEN });
    assert.equal(!l.ok && l.error.code, "rate_limited");
    assert.ok(!limited.fns().includes("redeem_member_invite"));
  });
});

describe("inviteMember: send limits and delivery", () => {
  const base = { invite_member: { data: NEW_ID }, get_member_invite_details: { data: PENDING }, record_invitation_delivery: { data: P } } as const;
  const input = { handoverId: H, email: "new.person@example.test", role: "incoming" as const };

  it("without an email transport: not_sent/email_not_configured, recorded; the creator still gets the link", async () => {
    const f = fakeDeps({ rpc: { ...base } });
    const r = await members.inviteMember(f.deps, input);
    assert.ok(r.ok);
    assert.deepEqual(r.data.delivery, { status: "not_sent", reason: "email_not_configured" });
    assert.ok(r.data.url.startsWith(`${ORIGIN}/h/`));
    assert.deepEqual(f.fns(), ["consume_rate_limit", "consume_rate_limit", "invite_member", "record_invitation_delivery"]);
    assert.deepEqual(f.calls.slice(0, 2).map((c) => c.args?.p_scope), ["invite_send_actor", "invite_send_recipient"]);
    assert.ok(!allStrings(f.calls.slice(0, 2).map((c) => c.args)).some((s) => s.includes("new.person") || s.includes(ACTOR_ID)), "limit subjects are hashed");
    const rec = f.calls.find((c) => c.fn === "record_invitation_delivery")!.args!;
    assert.deepEqual({ s: rec.p_status, r: rec.p_reason, ref: rec.p_provider_ref, t: rec.p_token_id }, { s: "not_sent", r: "email_not_configured", ref: null, t: NEW_ID });
    assert.deepEqual(f.emails, []);
  });

  it("with a transport: emails the invited address with the escaped title and the link; records sent", async () => {
    const f = fakeDeps({ rpc: { ...base }, email: transport() });
    const r = await members.inviteMember(f.deps, input);
    assert.ok(r.ok);
    assert.deepEqual(r.data.delivery, { status: "sent" });
    assert.equal(f.emails.length, 1);
    const [m] = f.emails;
    assert.equal(m.to, "new.person@example.test");
    assert.ok(m.text.includes(r.data.url) && m.html.includes(r.data.url.replace(/&/g, "&amp;")));
    assert.ok(m.html.includes("Robotics &lt;Club&gt; &amp; co") && !m.html.includes("<Club>"), "user-controlled text is escaped");
    assert.match(m.subject, /^Asha invited you to a Baton handover$/);
    const rec = f.calls.find((c) => c.fn === "record_invitation_delivery")!.args!;
    assert.deepEqual([rec.p_status, rec.p_reason, rec.p_provider_ref], ["sent", null, "msg_1"]);
    const raw = decodeURIComponent(r.data.url.slice(`${ORIGIN}/h/`.length));
    assert.ok(!allStrings(f.calls.map((c) => c.args)).some((s) => s.includes(raw)), "the raw token never reaches the database");
  });

  it("a provider failure never fails the invitation and logs no token, address or link", async () => {
    for (const result of [{ ok: false, kind: "failed" } as const, { ok: false, kind: "rate_limited" } as const, "throw" as const]) {
      const f = fakeDeps({ rpc: { ...base }, email: transport(result) });
      const r = await members.inviteMember(f.deps, input);
      assert.ok(r.ok);
      assert.deepEqual(r.data.delivery, { status: "not_sent", reason: "provider_failed" });
      const rec = f.calls.find((c) => c.fn === "record_invitation_delivery")!.args!;
      assert.equal(rec.p_status, "failed");
      assert.equal(rec.p_reason, result !== "throw" && result.kind === "rate_limited" ? "rate_limited" : "provider_failed");
      const logged = JSON.stringify(f.issues);
      assert.ok(!logged.includes("new.person") && !logged.includes("/h/"), logged);
    }
  });

  it("a failed delivery record is logged by id only and the invitation still succeeds", async () => {
    const f = fakeDeps({ rpc: { ...base, record_invitation_delivery: dbError("XX000") }, email: transport() });
    const r = await members.inviteMember(f.deps, input);
    assert.ok(r.ok && r.data.delivery.status === "sent");
    assert.deepEqual(f.issues, [{ event: "invitation_delivery_not_recorded", details: { tokenId: NEW_ID, status: "sent" } }]);
  });

  it("over the send limit: rate_limited (invite_send), no invitation, no email", async () => {
    let n = 0;
    const f = fakeDeps({ rpc: { ...base, consume_rate_limit: () => ({ data: ++n === 1 }) }, email: transport() });
    const r = await members.inviteMember(f.deps, input);
    assert.equal(!r.ok && r.error.code, "rate_limited");
    assert.equal(!r.ok && r.error.details?.reason, "invite_send");
    assert.ok(!f.fns().includes("invite_member"));
    assert.deepEqual(f.emails, []);
  });
});

describe("reissueInvitation", () => {
  it("creator only: address → send limits → atomic reissue → email; returns the new link", async () => {
    const f = fakeDeps({
      rpc: {
        member_invite_recipient: { data: "new.person@example.test" },
        reissue_member_invite: { data: { token_id: NEW_ID, recipient_email: "new.person@example.test" } },
        get_member_invite_details: { data: PENDING },
        record_invitation_delivery: { data: P },
      },
      email: transport(),
    });
    const r = await invitations.reissueInvitation(f.deps, { tokenId: P });
    assert.ok(r.ok);
    assert.equal(r.data.tokenId, NEW_ID);
    assert.deepEqual(r.data.delivery, { status: "sent" });
    assert.deepEqual(f.fns(), ["member_invite_recipient", "consume_rate_limit", "consume_rate_limit", "reissue_member_invite", "get_member_invite_details", "record_invitation_delivery"]);
    assert.equal(f.calls[0].args?.p_actor_profile_id, ACTOR_ID);
    assert.equal(f.emails[0].to, "new.person@example.test");
  });

  it("refusals pass through: not found, forbidden, already accepted; the site URL is checked first", async () => {
    for (const [fn, state, code] of [["member_invite_recipient", "BTNF0", "not_found"], ["reissue_member_invite", "BTFB0", "forbidden"], ["reissue_member_invite", "BTIT0", "invalid_transition"]] as const) {
      const f = fakeDeps({ rpc: { member_invite_recipient: { data: "x@example.test" }, [fn]: dbError(state) } });
      const r = await invitations.reissueInvitation(f.deps, { tokenId: P });
      assert.equal(!r.ok && r.error.code, code);
      assert.ok(!f.fns().includes("record_invitation_delivery"));
    }
    const bad = fakeDeps({ siteOrigin: () => { throw new Error("unset"); } });
    const b = await invitations.reissueInvitation(bad.deps, { tokenId: P });
    assert.equal(!b.ok && b.error.code, "internal");
    assert.deepEqual(bad.calls, []);
  });
});

describe("requestInvitationSignInLink", () => {
  it("always { sent: true }; sends only for a well-formed token", async () => {
    const sent: string[] = [];
    const send = async (t: string) => void sent.push(t);
    assert.deepEqual(await invitations.requestInvitationSignInLink(send, { token: TOKEN }), { ok: true, data: { sent: true } });
    assert.deepEqual(await invitations.requestInvitationSignInLink(send, { token: "bad" }), { ok: true, data: { sent: true } });
    assert.deepEqual(await invitations.requestInvitationSignInLink(async () => { throw new Error("x"); }, { token: TOKEN }), { ok: true, data: { sent: true } });
    assert.deepEqual(sent, [TOKEN]);
  });
});

// Browser verification (bug C): re-inviting an address that has an open invitation must not create a second usable link.
// The database refuses it (20261121400200, BTCF0 with hint 'invite_pending'); the action explains it.
describe("inviteMember: one open invitation per address (bug C)", () => {
  const input = { handoverId: H, email: "x@local.test", role: "incoming" as const };
  const refused = (hint: string | null): RpcHandler => ({ error: { code: "BTCF0", message: "raw SQL detail", hint } });

  it("an open invitation: conflict/invite_pending with a pointer to Send a new link; no link, no email, no delivery record", async () => {
    const f = fakeDeps({ rpc: { invite_member: refused("invite_pending") }, email: transport() });
    const r = await members.inviteMember(f.deps, input);
    assert.equal(!r.ok && r.error.code, "conflict");
    assert.equal(!r.ok && r.error.details?.reason, "invite_pending");
    assert.equal(!r.ok && r.error.message, members.INVITE_PENDING_MESSAGE);
    assert.match(members.INVITE_PENDING_MESSAGE, /Send a new link/);
    assert.ok(!/[–—]/.test(members.INVITE_PENDING_MESSAGE), "plain copy, no dashes");
    assert.deepEqual(f.fns(), ["consume_rate_limit", "consume_rate_limit", "invite_member"]);
    assert.deepEqual(f.emails, []);
  });

  it("already a member: conflict/already_member", async () => {
    const f = fakeDeps({ rpc: { invite_member: refused("already_member") } });
    const r = await members.inviteMember(f.deps, input);
    assert.equal(!r.ok && r.error.code, "conflict");
    assert.equal(!r.ok && r.error.details?.reason, "already_member");
    assert.equal(!r.ok && r.error.message, "This person is already a member.");
  });

  it("a conflict without a reason (or with a non-token hint) stays the generic conflict and leaks nothing", async () => {
    for (const hint of [null, "You might need to add explicit type casts."]) {
      const f = fakeDeps({ rpc: { invite_member: refused(hint) } });
      const r = await members.inviteMember(f.deps, input);
      assert.equal(!r.ok && r.error.code, "conflict");
      assert.equal(!r.ok && r.error.details, undefined);
      assert.ok(!JSON.stringify(r).includes("raw SQL") && !JSON.stringify(r).includes("casts"));
    }
  });

  it("the first invitation is created and emailed exactly once", async () => {
    const f = fakeDeps({
      rpc: { invite_member: { data: NEW_ID }, get_member_invite_details: { data: PENDING }, record_invitation_delivery: { data: P } },
      email: transport(),
    });
    const r = await members.inviteMember(f.deps, input);
    assert.ok(r.ok);
    assert.equal(f.emails.length, 1);
    assert.equal(f.fns().filter((n) => n === "invite_member").length, 1);
  });
});
