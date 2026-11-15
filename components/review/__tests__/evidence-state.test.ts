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
