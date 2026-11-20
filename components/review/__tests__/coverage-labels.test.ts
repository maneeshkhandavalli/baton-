import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { coverageHeadline, coverageIncomplete, showCoverageCounts, sourceCoverageOk, sourceStateText } from "../coverage-labels";

// Audit 4.8: "Fully analysed · 0 messages inspected" must never be shown for a source without recorded coverage.
describe("source coverage labels", () => {
  it("a complete source without recorded coverage is not 'Fully analysed' and shows no zero counts", () => {
    const s = { state: "complete" as const, coverageRecorded: false };
    assert.equal(sourceStateText(s), "Analysed, coverage not recorded");
    assert.equal(sourceCoverageOk(s), false);
    assert.equal(showCoverageCounts(s), false);
  });
  it("a complete source with recorded coverage is fully analysed with its counts", () => {
    const s = { state: "complete" as const, coverageRecorded: true };
    assert.equal(sourceStateText(s), "Fully analysed");
    assert.equal(sourceCoverageOk(s), true);
    assert.equal(showCoverageCounts(s), true);
  });
  it("a running source keeps its live counts", () => assert.equal(showCoverageCounts({ state: "in_progress", coverageRecorded: false }), true));
  it("'unrecorded' has its own headline and counts as incomplete", () => {
    assert.equal(coverageHeadline("unrecorded", 0), "Analysis finished, but coverage was not recorded for every source.");
    assert.equal(coverageIncomplete("unrecorded", 0), true);
    assert.equal(coverageIncomplete("complete", 0), false);
    assert.equal(coverageHeadline("complete", 0), "Every source was fully analysed.");
    assert.equal(coverageHeadline("none", 0), null);
  });
});
