// R3 Task 05E: the change-review decision action (validation, masking, error mapping) and its contract. The database
// rules themselves are tested in supabase/tests/sql/99_change_review_decisions.sql and the Tier E suite.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { decideChangeReviewInput, decisionProblems, mapChangeReviewItems, type ChangeReviewItem } from "../../contracts/change-review";
import * as core from "../core/change-reviews";
import { H, P, fakeDeps } from "./helpers";

const ITEM = "44444444-4444-4444-8444-444444444444";
const REV = "55555555-5555-4555-8555-555555555555";
const MSG = "66666666-6666-4666-8666-666666666666";

function item(kind: ChangeReviewItem["kind"], extra: Partial<ChangeReviewItem> = {}): ChangeReviewItem {
  return {
    id: ITEM, changeId: ITEM, kind, state: "open", staleReason: null, detail: {}, createdAt: "2026-11-18T00:00:00Z", decidedAt: null,
    sourceId: ITEM, previousSourceId: ITEM, sourceTitle: "Chat", fromVersion: 1, toVersion: 2, updateState: "ready", basePublicationId: null,
    point: { id: P, category: "decision", reviewState: "approved", evidenceStatus: "sourced", currentRevisionId: REV, title: "T", statement: "S", attributes: {} },
    base: null, oldEvidence: null,
    newMessage: { id: MSG, body: "Actually the bank mandate moved to [PERSON_2] in April", sentAt: null, authorLabel: null, quoteStart: null, quoteEnd: null },
    newEvidence: null, decisions: [], ...extra,
  };
}
const deps = (it: ChangeReviewItem, rpc: Record<string, unknown> = {}) =>
  fakeDeps({ queries: { getChangeReviews: async () => ({ ok: true, data: [it] }) }, rpc: rpc as never });
const base = { handoverId: H, itemId: ITEM, expectedState: "open" as const, expectedPointRevisionId: REV };

describe("decideChangeReview (action)", () => {
  it("investigate and reject need a note; nothing reaches the database without one", async () => {
    for (const decision of ["investigate", "reject"] as const) {
      const f = deps(item("evidence_missing"));
      const r = await core.decideChangeReview(f.deps, { ...base, decision });
      assert.ok(!r.ok && r.error.code === "validation_failed" && r.error.fieldErrors?.note, decision);
      assert.equal(f.calls.filter((c) => c.fn === "decide_change_review_item").length, 0);
    }
  });

  it("re-attesting missing evidence needs an explanation of at least 20 characters", async () => {
    const f = deps(item("evidence_missing"));
    const r = await core.decideChangeReview(f.deps, { ...base, decision: "accept", note: "fine" });
    assert.ok(!r.ok && r.error.code === "validation_failed");
  });

  it("a correction needs a real quotation from the new message (the app's quote minimum)", async () => {
    const f = deps(item("possible_contradiction"));
    const correction = { title: "Bank mandate", statement: "It moved in April", attributes: {}, evidenceStart: 0, evidenceEnd: 8 };
    const r = await core.decideChangeReview(f.deps, { ...base, decision: "accept", note: "Corrected.", correction });
    assert.ok(!r.ok && r.error.code === "validation_failed" && /12 characters/.test(r.error.message));
    const noCorrection = await core.decideChangeReview(f.deps, { ...base, decision: "accept", note: "Corrected." });
    assert.ok(!noCorrection.ok && noCorrection.error.fieldErrors?.correction);
    assert.equal(f.calls.filter((c) => c.fn === "decide_change_review_item").length, 0);
  });

  it("sends a valid correction with masked text and the server-read item's kind", async () => {
    const f = deps(item("possible_contradiction"), { decide_change_review_item: { data: { outcome: "decided", itemId: ITEM, state: "accepted" } } });
    const r = await core.decideChangeReview(f.deps, {
      ...base, decision: "accept", note: "Call +91 98765 43210 to confirm",
      correction: { title: "Bank mandate", statement: "Moved; call +91 98765 43210", attributes: {}, evidenceStart: 0, evidenceEnd: 30 },
    });
    assert.ok(r.ok, JSON.stringify(r));
    const call = f.calls.find((c) => c.fn === "decide_change_review_item")!;
    assert.equal(call.client, "admin");
    assert.equal(call.args?.p_decision, "accept");
    assert.doesNotMatch(JSON.stringify(call.args), /98765/, "free text is masked before it is stored");
    assert.deepEqual([(call.args?.p_payload as Record<string, unknown>).evidenceStart, (call.args?.p_payload as Record<string, unknown>).evidenceEnd], [0, 30]);
  });

  it("an item the viewer cannot see is not found; a stale item says so", async () => {
    const hidden = fakeDeps({ queries: { getChangeReviews: async () => ({ ok: true, data: [] }) } });
    const r1 = await core.decideChangeReview(hidden.deps, { ...base, decision: "investigate", note: "x" });
    assert.ok(!r1.ok && r1.error.code === "not_found");
    const stale = deps(item("evidence_moved", { state: "stale", staleReason: "superseded" }));
    const r2 = await core.decideChangeReview(stale.deps, { ...base, decision: "reject", note: "x" });
    assert.ok(!r2.ok && r2.error.details?.reason === "change_review_stale");
  });

  it("maps a database conflict (another reviewer, a changed point) to a clear, safe message", async () => {
    const f = deps(item("evidence_moved"), { decide_change_review_item: { error: { code: "BTCF0", message: "this change was decided or updated by someone else" } } });
    const r = await core.decideChangeReview(f.deps, { ...base, decision: "accept" });
    assert.ok(!r.ok && r.error.code === "conflict" && r.error.details?.reason === "change_review_conflict");
    assert.doesNotMatch(r.error.message, /decided or updated by someone else/, "the Postgres message is not echoed");
  });
});

describe("change-review contract", () => {
  it("decision rules per kind", () => {
    const v = (x: object) => decideChangeReviewInput.parse({ ...base, ...x });
    assert.equal(decisionProblems("evidence_moved", v({ decision: "accept" })), null, "accepting a move needs no note");
    assert.ok(decisionProblems("support_changed", v({ decision: "accept", note: "short" })));
    assert.equal(decisionProblems("new_information", v({ decision: "accept" })), null);
    assert.ok(decisionProblems("possible_contradiction", v({ decision: "accept", note: "why" })));
  });

  it("the mapper drops malformed rows (fail closed) and keeps well-formed ones", () => {
    const good = { id: ITEM, changeId: ITEM, kind: "evidence_missing", state: "open", decisions: [{ decision: "investigate", note: "n" }] };
    const out = mapChangeReviewItems([good, { id: ITEM, changeId: ITEM, kind: "made_up", state: "open" }, { kind: "evidence_missing" }, null]);
    assert.equal(out.length, 1);
    assert.equal(out[0].decisions.length, 1);
    assert.deepEqual(mapChangeReviewItems(null), []);
  });
});
