// R3 Task 06: /h/[token] screens from the frozen contract §4.1 / §4.2 (components/invitations/invitation-view.ts).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import type { AppError, Result } from "@/lib/contracts/api";
import type { InvitationDetails } from "@/lib/contracts/dto";

import {
  acceptFailureQuery,
  invitationCopy,
  invitationViewFromDetails,
  invitationViewFromError,
  invitationViewFromQuery,
  safeInternalPath,
  type InvitationScreen,
} from "../invitation-view";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

const pending = (viewer: Extract<InvitationDetails, { state: "pending" }>["viewer"]): Result<InvitationDetails> => ({
  ok: true,
  data: {
    state: "pending",
    handoverTitle: "Treasurer handover",
    inviterName: "Priya",
    role: "incoming",
    expiresAt: "2026-11-25T10:00:00.000Z",
    recipientEmailMasked: "n***@example.com",
    viewer,
  },
});
const fail = (code: AppError["code"], reason?: string): Result<InvitationDetails> => ({
  ok: false,
  error: { code, message: "x", retryable: false, details: reason ? { reason } : undefined },
});
const screen = (r: Result<InvitationDetails>) => invitationViewFromDetails(r).screen;
const viewer = (over: Partial<{ emailMatches: boolean; emailConfirmed: boolean; alreadyMember: boolean }> = {}) => ({
  emailMatches: true,
  emailConfirmed: true,
  alreadyMember: false,
  ...over,
});

describe("getInvitation → screen (§4.1)", () => {
  it("pending: signed out, ready, wrong account, unconfirmed, already member", () => {
    assert.equal(screen(pending(null)), "sign_in_required");
    assert.equal(screen(pending(viewer())), "ready_to_accept");
    assert.equal(screen(pending(viewer({ emailMatches: false }))), "wrong_account");
    assert.equal(screen(pending(viewer({ emailConfirmed: false }))), "email_unconfirmed");
    assert.equal(screen(pending(viewer({ alreadyMember: true }))), "already_member");
    // a mismatched address is reported before an unconfirmed one
    assert.equal(screen(pending(viewer({ emailMatches: false, emailConfirmed: false }))), "wrong_account");
  });

  it("pending shows only title, inviter, role, expiry and the masked address", () => {
    const v = invitationViewFromDetails(pending(null));
    assert.deepEqual(Object.keys(v.summary ?? {}).sort(), ["expiresAt", "handoverTitle", "inviterName", "recipientEmailMasked", "role"]);
  });

  it("accepted: link to the member page, internal paths only", () => {
    const ok = invitationViewFromDetails({ ok: true, data: { state: "accepted", handoverId: "h", memberHref: "/handover/h/published" } });
    assert.deepEqual([ok.screen, ok.memberHref, ok.summary], ["already_accepted", "/handover/h/published", null]);
    const evil = invitationViewFromDetails({ ok: true, data: { state: "accepted", handoverId: "h", memberHref: "https://evil.example/x" } });
    assert.equal(evil.memberHref, null);
  });

  it("every token_invalid reason has its own screen; failures never carry handover details", () => {
    const table: Record<string, InvitationScreen> = { invalid: "invalid_link", expired: "expired", revoked: "revoked", used: "used", unavailable: "unavailable" };
    for (const [reason, s] of Object.entries(table)) {
      const v = invitationViewFromDetails(fail("token_invalid", reason));
      assert.equal(v.screen, s, reason);
      assert.equal(v.summary, null, reason);
    }
  });

  it("A5: an unknown reason renders the generic state for its code; unknown codes the generic error", () => {
    assert.equal(screen(fail("token_invalid", "brand_new_reason")), "invalid_link");
    assert.equal(screen(fail("token_invalid")), "invalid_link");
    assert.equal(screen(fail("rate_limited")), "too_many_attempts");
    assert.equal(screen(fail("internal")), "error");
    assert.equal(screen(fail("conflict", "something_else")), "error");
    assert.equal(invitationViewFromError({ code: "made_up" as AppError["code"] }).screen, "error");
    assert.equal(screen({ ok: true, data: { state: "future_state" } as unknown as InvitationDetails }), "error");
  });
});

describe("acceptInvitation failure → screen (§4.2)", () => {
  it("maps every documented outcome", () => {
    assert.equal(invitationViewFromError({ code: "unauthenticated" }).screen, "sign_in_required");
    assert.equal(invitationViewFromError({ code: "token_invalid", details: { reason: "email_mismatch" } }).screen, "wrong_account");
    assert.equal(invitationViewFromError({ code: "token_invalid", details: { reason: "email_unconfirmed" } }).screen, "email_unconfirmed");
    assert.equal(invitationViewFromError({ code: "conflict", details: { reason: "already_member", handoverId: "h" } }).screen, "already_member");
    assert.equal(invitationViewFromError({ code: "token_invalid", details: { reason: "expired" } }).screen, "expired");
  });

  it("round-trips through the query string with tokens only", () => {
    const q = acceptFailureQuery({ code: "token_invalid", details: { reason: "email_mismatch" } });
    assert.equal(q, "error=token_invalid&reason=email_mismatch");
    const back = invitationViewFromQuery(Object.fromEntries(new URLSearchParams(q)));
    assert.equal(back?.screen, "wrong_account");
    // a reason that isn't a plain token is dropped, never echoed
    assert.equal(acceptFailureQuery({ code: "token_invalid", details: { reason: "<script>" } }), "error=token_invalid");
  });

  it("already_member keeps the server's member page (same origin only), on both paths", () => {
    const d = pending(viewer({ alreadyMember: true }));
    if (d.ok && d.data.state === "pending") d.data.memberHref = "/handover/h/published";
    assert.equal(invitationViewFromDetails(d).memberHref, "/handover/h/published");
    const err = { code: "conflict" as const, details: { reason: "already_member", handoverId: "h", memberHref: "/handover/h/review" } };
    assert.equal(invitationViewFromError(err).memberHref, "/handover/h/review");
    const q = acceptFailureQuery(err);
    assert.equal(invitationViewFromQuery(Object.fromEntries(new URLSearchParams(q)))?.memberHref, "/handover/h/review");
    assert.equal(invitationViewFromQuery({ error: "conflict", reason: "already_member", member: "//evil.example" })?.memberHref, null);
    assert.doesNotMatch(acceptFailureQuery({ code: "conflict", details: { reason: "already_member", memberHref: "https://evil.example" } }), /member=/);
  });

  it("malformed query parameters become the generic error; no error parameter means no override", () => {
    assert.equal(invitationViewFromQuery({}), null);
    assert.equal(invitationViewFromQuery({ error: "<b>" })?.screen, "error");
    assert.equal(invitationViewFromQuery({ error: ["a", "b"] })?.screen, "error");
    assert.equal(invitationViewFromQuery({ error: "token_invalid", reason: "javascript:alert(1)" })?.screen, "invalid_link");
  });
});

describe("safeInternalPath", () => {
  it("keeps same-origin paths only", () => {
    assert.equal(safeInternalPath("/handover/x/review"), "/handover/x/review");
    for (const bad of ["//evil.example", "https://evil.example", "/\\evil", "handover", "", null, 5, "/a\nb"]) assert.equal(safeInternalPath(bad), null, String(bad));
  });
});

describe("copy", () => {
  it("every screen has a title and description; pending copy names the masked address, never a full one", () => {
    const screens: InvitationScreen[] = [
      "sign_in_required", "ready_to_accept", "wrong_account", "email_unconfirmed", "already_member", "already_accepted",
      "invalid_link", "expired", "revoked", "used", "unavailable", "too_many_attempts", "error",
    ];
    for (const s of screens) {
      const c = invitationCopy({ screen: s, summary: null, memberHref: null }, (r) => r);
      assert.ok(c.title && c.description, s);
    }
    const c = invitationCopy(invitationViewFromDetails(pending(viewer({ emailMatches: false }))), (r) => r);
    assert.match(c.description, /n\*\*\*@example\.com/);
  });

  it("A4: the page accepts only through a form submit, and getInvitation is the only call made while rendering", () => {
    const page = readFileSync(path.join(ROOT, "app/(token)/h/[token]/page.tsx"), "utf8");
    assert.match(page, /<form action=\{acceptInvitationFromForm\.bind\(null, token\)\}>/);
    assert.doesNotMatch(page, /await acceptInvitation|acceptInvitation\(\{/);
    const actions = readFileSync(path.join(ROOT, "app/(token)/h/[token]/actions.ts"), "utf8");
    assert.match(actions, /^"use server";/);
  });
});
