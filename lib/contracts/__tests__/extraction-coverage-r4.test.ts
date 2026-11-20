// Round 4 final fix (audit 4.8 / F5): missing coverage is never shown as full, and a run that is still active is
// never "fully analysed".
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildExtractionReport, type RawSourceCoverage } from "../extraction";

const S = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const src = (over: Partial<RawSourceCoverage>): RawSourceCoverage => ({
  sourceId: S(1),
  title: "Chat",
  jobStatus: "succeeded",
  chunksDone: 2,
  chunksTotal: 2,
  coverageRecorded: true,
  messagesInspected: 10,
  ...over,
});

describe("extraction completion (audit 4.8)", () => {
  it("the production H2 shape (succeeded 0/0, no coverage rows) is never 'complete'", () => {
    const r = buildExtractionReport({
      available: true,
      runId: S(9),
      runStatus: "succeeded",
      sources: [
        src({ chunksDone: 0, chunksTotal: 0, coverageRecorded: false, messagesInspected: null }),
        src({ sourceId: S(2), chunksDone: 0, chunksTotal: 0, coverageRecorded: false, messagesInspected: null }),
      ],
    });
    assert.equal(r.completion, "unrecorded");
    assert.notEqual(r.completion, "complete");
    assert.deepEqual(r.blockers.map((b) => [b.kind, b.count]), [["coverage_unavailable", 2]]);
  });

  it("one unrecorded source among recorded ones is still not complete", () => {
    const r = buildExtractionReport({ available: true, runStatus: "succeeded", sources: [src({}), src({ sourceId: S(2), coverageRecorded: false })] });
    assert.equal(r.completion, "unrecorded");
  });

  it("reused coverage (copied onto the new run) reads as complete", () => {
    const r = buildExtractionReport({ available: true, runStatus: "succeeded", sources: [src({}), src({ sourceId: S(2), messagesInspected: 36 })] });
    assert.equal(r.completion, "complete");
    assert.equal(r.totals.messagesInspected, 46);
  });

  it("never 'complete' while the run is queued or running, even when every extract job finished", () => {
    for (const runStatus of ["queued", "running"]) {
      const r = buildExtractionReport({ available: true, runStatus, sources: [src({}), src({ sourceId: S(2) })] });
      assert.equal(r.completion, "in_progress", runStatus);
    }
    const none = buildExtractionReport({ available: true, runStatus: "running", sources: [] });
    assert.equal(none.completion, "in_progress", "a run with no extract job yet is in progress, not 'none'");
  });

  it("partial and failed still win over unrecorded", () => {
    const partial = buildExtractionReport({
      available: true,
      runStatus: "succeeded",
      sources: [src({ coverageRecorded: false }), src({ sourceId: S(2), jobStatus: "failed", chunksDone: 1, chunksTotal: 3 })],
    });
    assert.equal(partial.completion, "partial");
    const failed = buildExtractionReport({ available: true, runStatus: "failed", sources: [src({ jobStatus: "failed", chunksDone: 0 })] });
    assert.equal(failed.completion, "failed");
  });
});
