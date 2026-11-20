import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { isStaleEvidence } from "../evidence-state";

describe("isStaleEvidence (QA-UI3-H2)", () => {
  const e = (over: Partial<Parameters<typeof isStaleEvidence>[0]>) => ({ excluded: false, isCurrentRevisionVerdict: false, supportVerdict: "supports" as const, ...over });
  it("a verdict for an earlier revision is stale", () => assert.equal(isStaleEvidence(e({})), true));
  it("a never-checked quote is not stale (nothing is re-verifying)", () => assert.equal(isStaleEvidence(e({ supportVerdict: "unchecked" })), false));
  it("a verdict for the current revision, an excluded or an irrelevant quote is not stale", () => {
    assert.equal(isStaleEvidence(e({ isCurrentRevisionVerdict: true })), false);
    assert.equal(isStaleEvidence(e({ excluded: true })), false);
    assert.equal(isStaleEvidence(e({ supportVerdict: "irrelevant" })), false);
  });
});

import { directApproveInput } from "../evidence-state";

describe("directApproveInput (QA-UI3-H4)", () => {
  const p = (over: Partial<Parameters<typeof directApproveInput>[0]>) => ({ id: "p1", currentRevisionId: "r1", evidenceStatus: "sourced", inferredConfirmation: null, conflictResolution: null, ...over });
  it("a sourced point approves directly", () => assert.deepEqual(directApproveInput(p({})), { action: "approve", pointId: "p1", expectedRevisionId: "r1" }));
  it("a resolved conflict carries its saved note (approve_point requires one)", () =>
    assert.deepEqual(directApproveInput(p({ evidenceStatus: "conflicting", conflictResolution: { note: " Free since 12 Sep. " } })), { action: "approve", pointId: "p1", expectedRevisionId: "r1", resolutionNote: "Free since 12 Sep." }));
  it("a confirmed inference carries the confirmation", () =>
    assert.deepEqual(directApproveInput(p({ evidenceStatus: "inferred", inferredConfirmation: { by: "x" } })), { action: "approve", pointId: "p1", expectedRevisionId: "r1", confirmInferred: true }));
  it("unresolved conflicts, unconfirmed inferences and missing points need the dialog", () => {
    assert.equal(directApproveInput(p({ evidenceStatus: "conflicting" })), null);
    assert.equal(directApproveInput(p({ evidenceStatus: "inferred" })), null);
    assert.equal(directApproveInput(p({ evidenceStatus: "missing" })), null);
  });
});

import { staleEvidenceNote } from "../evidence-state";

describe("edited points (Round 4 audit C1)", () => {
  it("never claims a re-verification is running", () => {
    for (const reviewState of ["pending", "approved", "rejected"] as const) {
      assert.doesNotMatch(staleEvidenceNote({ reviewState }), /Re-verifying|…/);
    }
    assert.match(staleEvidenceNote({ reviewState: "pending" }), /Confirm it yourself before approving/);
    assert.equal(staleEvidenceNote({ reviewState: "approved" }), "Edited after its quotes were checked. Approved by a reviewer; the quotes are not re-checked.");
  });

  it("an edited inferred point with an older confirmation is not approved in one click: the reviewer confirms the new wording", () => {
    const point = {
      id: "p1",
      currentRevisionId: "r2",
      evidenceStatus: "inferred",
      inferredConfirmation: { by: "x" },
      conflictResolution: null,
      evidence: [{ excluded: false, isCurrentRevisionVerdict: false, supportVerdict: "supports" as const }],
    };
    assert.equal(directApproveInput(point), null);
    assert.deepEqual(directApproveInput({ ...point, evidence: [] }), { action: "approve", pointId: "p1", expectedRevisionId: "r2", confirmInferred: true });
  });
});

import { canConfirmTestimony } from "../evidence-state";

describe("Confirm answer & approve (Round 4, B's confirm_testimony_and_approve)", () => {
  const t = { kind: "testimony" as const, excluded: false };
  const q = { kind: "source_quote" as const, excluded: false };
  it("is offered for a pending Missing or Inferred point with its own active testimony", () => {
    assert.equal(canConfirmTestimony({ reviewState: "pending", evidenceStatus: "missing", evidence: [t] }), true);
    assert.equal(canConfirmTestimony({ reviewState: "pending", evidenceStatus: "inferred", evidence: [q, t] }), true);
  });
  it("is not offered without testimony, for excluded testimony, other statuses or decided points", () => {
    assert.equal(canConfirmTestimony({ reviewState: "pending", evidenceStatus: "missing", evidence: [q] }), false);
    assert.equal(canConfirmTestimony({ reviewState: "pending", evidenceStatus: "missing", evidence: [{ ...t, excluded: true }] }), false);
    assert.equal(canConfirmTestimony({ reviewState: "pending", evidenceStatus: "sourced", evidence: [t] }), false);
    assert.equal(canConfirmTestimony({ reviewState: "pending", evidenceStatus: "conflicting", evidence: [t] }), false);
    assert.equal(canConfirmTestimony({ reviewState: "approved", evidenceStatus: "missing", evidence: [t] }), false);
  });
});
