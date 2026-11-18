// R3 Task 06: progressive disclosure on review cards (components/review/card-evidence.ts).
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { statementRepeatsTitle, verificationNeedsAttention, type CardEvidenceInput } from "../card-evidence";

const e = (over: Partial<CardEvidenceInput> = {}): CardEvidenceInput => ({
  kind: "source_quote",
  quoteCheck: "exact",
  supportVerdict: "supports",
  isCurrentRevisionVerdict: true,
  ...over,
});

describe("verificationNeedsAttention", () => {
  it("the routine case (exact quote, AI judged supportive for the current wording) stays in the evidence panel", () => {
    assert.equal(verificationNeedsAttention(e()), false);
    assert.equal(verificationNeedsAttention(e({ kind: "testimony", quoteCheck: "pending" })), false);
  });

  it("anything a reviewer must notice stays on the card", () => {
    const cases: Partial<CardEvidenceInput>[] = [
      { quoteCheck: "normalized" },
      { quoteCheck: "not_found" },
      { quoteCheck: "pending" },
      { supportVerdict: "partial" },
      { supportVerdict: "contradicts" },
      { supportVerdict: "irrelevant" },
      { supportVerdict: "unchecked" },
      { isCurrentRevisionVerdict: false },
      { guarded: true },
    ];
    for (const over of cases) assert.equal(verificationNeedsAttention(e(over)), true, JSON.stringify(over));
  });
});

describe("statementRepeatsTitle", () => {
  it("hides a statement the title already contains", () => {
    assert.equal(statementRepeatsTitle("Open task: domain renews on 12 dec.", "domain renews on 12 dec"), true);
    assert.equal(statementRepeatsTitle("Decision: Fees", "  "), true);
  });
  it("keeps a statement that adds information", () => {
    assert.equal(statementRepeatsTitle("Workshop fees", "Workshops are free for everyone from this semester."), false);
  });
});
