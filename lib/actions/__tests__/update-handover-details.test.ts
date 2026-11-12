// R3 C1 (Agent 2): the updateHandoverDetails action (draft metadata editing). No database, no Next.js;
// synthetic data only.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { Result } from "../../contracts/api";
import type { HandoverSummary } from "../../contracts/dto";
import * as handovers from "../core/handovers";
import { ACTOR_ID, H, OTHER_ID, SYNTHETIC_EMAIL, SYNTHETIC_PHONE, allStrings, fakeDeps, type RpcHandler } from "./helpers";

const UPDATED_AT = "2026-11-12T10:00:00.123Z";

const summary = (over: Partial<HandoverSummary> = {}): HandoverSummary => ({
  id: H,
  title: "Treasurer handover",
  teamName: "Robotics Club",
  roleTitle: null,
  description: null,
  state: "draft",
  viewerRole: "outgoing",
  viewerIsCreator: true,
  viewerClearance: "reviewer_only",
  currentPublicationId: null,
  pendingCreatorTransfer: null,
  createdAt: "2026-11-12T09:00:00.000Z",
  updatedAt: "2026-11-12T10:00:05.456Z",
  ...over,
});

const okResult = <T>(data: T) => async (): Promise<Result<T>> => ({ ok: true, data });
const dbError = (code: string): RpcHandler => ({ error: { code, message: `raw SQL detail for ${code}` } });
const containsRawPii = (value: unknown) => allStrings(value).some((s) => s.includes("99999") || s.includes(SYNTHETIC_EMAIL));

const validEdit = { handoverId: H, title: "Treasurer handover", teamName: "Robotics Club", expectedUpdatedAt: UPDATED_AT };

describe("updateHandoverDetails (R3 C1)", () => {
  it("invalid input is validation_failed before the actor or the database", async () => {
    for (const bad of [
      { ...validEdit, expectedUpdatedAt: undefined },
      { ...validEdit, title: "ab" },
      { ...validEdit, teamName: "" },
      { ...validEdit, handoverId: "not-a-uuid" },
      { ...validEdit, expectedUpdatedAt: "yesterday" },
      { ...validEdit, description: "x".repeat(2001) },
    ]) {
      const f = fakeDeps();
      const r = await handovers.updateHandoverDetails(f.deps, bad as never);
      assert.equal(!r.ok && r.error.code, "validation_failed", JSON.stringify(bad).slice(0, 80));
      assert.equal(f.actorLookups, 0);
      assert.deepEqual(f.calls, []);
    }
  });

  it("no verified session is unauthenticated with zero database calls", async () => {
    const f = fakeDeps({ actor: null });
    const r = await handovers.updateHandoverDetails(f.deps, validEdit);
    assert.equal(!r.ok && r.error.code, "unauthenticated");
    assert.deepEqual(f.calls, []);
    assert.deepEqual(f.queryCalls, []);
  });

  it("D35 order: one admin RPC with the session actor, then the RLS re-read, then one refresh", async () => {
    const f = fakeDeps({ rpc: { update_handover_details: { data: "2026-11-12T10:00:05.456789+00:00" } }, queries: { getHandover: okResult(summary()) } });
    const smuggled = { ...validEdit, p_actor_profile_id: OTHER_ID, createdBy: OTHER_ID, creatorRole: "reviewer", state: "approved" };
    const r = await handovers.updateHandoverDetails(f.deps, smuggled as never);
    assert.deepEqual(r, { ok: true, data: summary() });
    assert.equal(f.calls.length, 1);
    assert.equal(f.calls[0].fn, "update_handover_details");
    assert.equal(f.calls[0].client, "admin");
    assert.deepEqual(f.calls[0].args, {
      p_actor_profile_id: ACTOR_ID,
      p_handover_id: H,
      p_expected_updated_at: UPDATED_AT,
      p_title: "Treasurer handover",
      p_team_name: "Robotics Club",
      p_role_title: null, // omitted → keep the stored value
      p_description: null,
    });
    assert.ok(!allStrings(f.calls[0].args).includes(OTHER_ID), "identity never comes from the input");
    assert.deepEqual(f.queryCalls, [{ name: "getHandover", args: [H] }]);
    assert.equal(f.refreshes, 1);
  });

  it("an empty optional field is sent as an empty string (clear), not as null (keep)", async () => {
    const f = fakeDeps({ rpc: { update_handover_details: { data: UPDATED_AT } }, queries: { getHandover: okResult(summary()) } });
    await handovers.updateHandoverDetails(f.deps, { ...validEdit, roleTitle: "", description: "  " });
    assert.equal(f.calls[0].args?.p_role_title, "");
    assert.equal(f.calls[0].args?.p_description, "");
  });

  it("masks title, team name, role title and description with one masker before the database", async () => {
    const f = fakeDeps({ rpc: { update_handover_details: { data: UPDATED_AT } }, queries: { getHandover: okResult(summary()) } });
    await handovers.updateHandoverDetails(f.deps, {
      ...validEdit,
      title: `Call ${SYNTHETIC_PHONE}`,
      teamName: `Team ${SYNTHETIC_EMAIL}`,
      roleTitle: `Role ${SYNTHETIC_PHONE}`,
      description: `Reach ${SYNTHETIC_PHONE} or ${SYNTHETIC_EMAIL}`,
    });
    const args = f.calls[0].args!;
    assert.ok(!containsRawPii(args), "no raw phone or email reaches update_handover_details");
    assert.match(String(args.p_title), /\[PHONE_1\]/);
    assert.match(String(args.p_team_name), /\[EMAIL_1\]/);
    assert.match(String(args.p_role_title), /\[PHONE_1\]/, "same value, same token across fields");
    assert.match(String(args.p_description), /\[PHONE_1\].*\[EMAIL_1\]/);
  });

  it("re-validates after masking: a masked value that breaks the schema is validation_failed, no write", async () => {
    const f = fakeDeps();
    // 118 chars ending in a short email: its token is longer than the address, so the title exceeds 120.
    const title = `${"ab ".repeat(37)} a@b.io`;
    assert.equal(title.length, 118);
    const r = await handovers.updateHandoverDetails(f.deps, { ...validEdit, title });
    assert.equal(!r.ok && r.error.code, "validation_failed");
    assert.equal(f.actorLookups, 1, "masking runs after the actor check (D35)");
    assert.deepEqual(f.calls, []);
  });

  it("a stale token is conflict with reason stale_draft and a reload message; no re-read, no refresh", async () => {
    const f = fakeDeps({ rpc: { update_handover_details: dbError("BTCF0") } });
    const r = await handovers.updateHandoverDetails(f.deps, validEdit);
    assert.ok(!r.ok);
    assert.equal(r.error.code, "conflict");
    assert.equal(r.error.details?.reason, handovers.STALE_DRAFT_REASON);
    assert.equal(r.error.message, handovers.STALE_DRAFT_MESSAGE);
    assert.equal(r.error.retryable, false);
    assert.ok(!r.error.message.includes("raw SQL"));
    assert.deepEqual(f.queryCalls, []);
    assert.equal(f.refreshes, 0);
  });

  it("a retryable lock conflict stays a generic retryable conflict (not stale_draft)", async () => {
    const f = fakeDeps({ rpc: { update_handover_details: dbError("40001") } });
    const r = await handovers.updateHandoverDetails(f.deps, validEdit);
    assert.ok(!r.ok);
    assert.equal(r.error.code, "conflict");
    assert.equal(r.error.retryable, true);
    assert.equal(r.error.details, undefined);
  });

  for (const [state, code] of [
    ["BTNF0", "not_found"],
    ["BTFB0", "forbidden"],
    ["BTIT0", "invalid_transition"],
    ["BTVF0", "validation_failed"],
    ["BTUA0", "unauthenticated"],
  ] as const) {
    it(`database ${state} is ${code} with a safe message and nothing re-read`, async () => {
      const f = fakeDeps({ rpc: { update_handover_details: dbError(state) } });
      const r = await handovers.updateHandoverDetails(f.deps, validEdit);
      assert.equal(!r.ok && r.error.code, code);
      assert.ok(!r.ok && !r.error.message.includes("raw SQL"));
      assert.deepEqual(f.queryCalls, []);
      assert.equal(f.refreshes, 0);
    });
  }

  it("a hidden handover after the write (RLS re-read) is not_found, never someone else's data", async () => {
    const f = fakeDeps({ rpc: { update_handover_details: { data: UPDATED_AT } } }); // getHandover → not_found by default
    const r = await handovers.updateHandoverDetails(f.deps, validEdit);
    assert.equal(!r.ok && r.error.code, "not_found");
  });
});
