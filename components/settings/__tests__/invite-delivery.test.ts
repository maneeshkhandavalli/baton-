// R3 Task 06: invitation delivery messaging (contract §4.3, A6) (components/settings/invite-delivery.ts).
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { InvitationDelivery } from "@/lib/contracts/dto";

import { canReissue, deliveryMessage, deliveryStatusLabel, inviteErrorMessage } from "../invite-delivery";

describe("deliveryMessage", () => {
  it("sent: success, the link is secondary", () => {
    const m = deliveryMessage({ status: "sent" }, "neha@example.com");
    assert.deepEqual([m.tone, m.linkPrimary], ["success", false]);
    assert.match(m.title, /emailed to neha@example\.com/);
  });

  it("A6: not sent says so plainly and makes the link primary", () => {
    const nc = deliveryMessage({ status: "not_sent", reason: "email_not_configured" }, "a@b.c");
    assert.equal(nc.linkPrimary, true);
    assert.match(nc.title, /No email was sent/);
    assert.match(nc.body, /Email isn't set up on this server; send the link yourself/);
    const pf = deliveryMessage({ status: "not_sent", reason: "provider_failed" }, null);
    assert.equal(pf.linkPrimary, true);
    assert.match(pf.title, /couldn't email/);
    const demo = deliveryMessage({ status: "not_sent", reason: "demo" }, null);
    assert.match(demo.title, /Demo/);
  });

  it("an unknown or missing delivery is never reported as sent", () => {
    for (const d of [null, undefined, { status: "queued" } as unknown as InvitationDelivery, { status: "not_sent", reason: "new_reason" } as unknown as InvitationDelivery]) {
      const m = deliveryMessage(d, "a@b.c");
      assert.equal(m.tone, "warning");
      assert.equal(m.linkPrimary, true);
    }
  });
});

describe("inviteErrorMessage (§4.3)", () => {
  const e = (code: Parameters<typeof inviteErrorMessage>[0]["code"], reason?: string) => ({ code, message: "server message", details: reason ? { reason } : undefined });
  it("documented outcomes", () => {
    assert.equal(inviteErrorMessage(e("forbidden")), "Only the creator can invite members.");
    assert.equal(inviteErrorMessage(e("conflict", "already_member")), "This person is already a member.");
    assert.equal(inviteErrorMessage(e("invalid_transition", "invite_used")), "This invitation was already accepted.");
    assert.equal(inviteErrorMessage(e("rate_limited", "invite_send")), "You've sent a lot of invitations. Try again in an hour.");
    assert.match(inviteErrorMessage(e("not_found")), /no longer exists/);
  });
  it("A5: unknown reasons fall back to the server's safe message", () => {
    assert.equal(inviteErrorMessage(e("conflict", "other")), "server message");
    assert.equal(inviteErrorMessage(e("internal")), "server message");
  });
});

describe("reissue and delivery labels", () => {
  it("reissue only for active or expired invitations", () => {
    assert.equal(canReissue({ purpose: "member_invite", status: "active" }), true);
    assert.equal(canReissue({ purpose: "member_invite", status: "expired" }), true);
    assert.equal(canReissue({ purpose: "member_invite", status: "exhausted" }), false);
    assert.equal(canReissue({ purpose: "member_invite", status: "revoked" }), false);
    assert.equal(canReissue({ purpose: "gap_interview", status: "active" }), false);
  });
  it("delivery status labels", () => {
    assert.equal(deliveryStatusLabel("sent"), "emailed");
    assert.match(deliveryStatusLabel("not_sent") ?? "", /not emailed/);
    assert.equal(deliveryStatusLabel("failed"), "email failed");
    assert.equal(deliveryStatusLabel(null), null);
    assert.equal(deliveryStatusLabel(undefined), null);
  });
});
