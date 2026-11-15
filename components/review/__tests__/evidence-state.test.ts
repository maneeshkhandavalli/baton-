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
