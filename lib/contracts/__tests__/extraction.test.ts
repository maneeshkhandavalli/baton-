// R3 Task 03: extraction report (EXT-2, EXT-3) and evidence verification layers (VER-1).
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { blockingExtractionGaps, buildExtractionReport, sourceExtractionState, type RawSourceCoverage } from "../extraction";
import { evidenceLayers, pointLayers } from "../verification";

const S = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const src = (over: Partial<RawSourceCoverage>): RawSourceCoverage => ({
  sourceId: S(1),
  title: "Chat",
  jobStatus: "succeeded",
  chunksDone: 2,
  chunksTotal: 2,
  coverageRecorded: true,
  messagesInspected: 100,
  messagesWithSignals: 20,
  signalMessagesLinked: 12,
  signalMessagesUnreviewed: 8,
  discarded: {},
  ...over,
});

describe("sourceExtractionState", () => {
  it("never calls a source complete when chunks or messages were left out", () => {
    assert.equal(sourceExtractionState(src({})), "complete");
    assert.equal(sourceExtractionState(src({ oversizeSkipped: 2 })), "complete_with_skips");
    assert.equal(sourceExtractionState(src({ jobStatus: "failed", chunksDone: 1 })), "partial");
    assert.equal(sourceExtractionState(src({ jobStatus: "failed", chunksDone: 0 })), "failed");
    assert.equal(sourceExtractionState(src({ jobStatus: "cancelled", chunksDone: 1 })), "partial");
    assert.equal(sourceExtractionState(src({ jobStatus: "succeeded", chunksDone: 1 })), "partial", "defensive: succeeded but short");
    assert.equal(sourceExtractionState(src({ jobStatus: "running" })), "in_progress");
    assert.equal(sourceExtractionState(src({ jobStatus: null })), "not_processed");
  });
});

describe("buildExtractionReport", () => {
  it("a run with one partial source is partial and has a blocking gap", () => {
    const r = buildExtractionReport({
      available: true,
      runId: S(9),
      runStatus: "succeeded",
      sources: [src({}), src({ sourceId: S(2), jobStatus: "failed", chunksDone: 3, chunksTotal: 5, jobError: "ai_quota_exhausted" })],
    });
    assert.equal(r.runStatus, "succeeded", "the run itself still says succeeded…");
    assert.equal(r.completion, "partial", "…but the report never presents it as complete");
    assert.equal(r.sources[1].chunkCompleteness, 0.6);
    assert.equal(r.sources[1].failureReason, "ai_quota_exhausted");
    assert.deepEqual(blockingExtractionGaps(r).map((b) => [b.kind, b.sourceIds]), [["source_partially_extracted", [S(2)]]]);
  });

  it("a source that failed outright while another succeeded is a blocking gap; an all-failed run is not (it never reaches review)", () => {
    const mixed = buildExtractionReport({ available: true, sources: [src({}), src({ sourceId: S(2), jobStatus: "failed", chunksDone: 0 })] });
    assert.deepEqual(blockingExtractionGaps(mixed).map((b) => b.kind), ["source_extraction_failed"]);
    const allFailed = buildExtractionReport({ available: true, sources: [src({ jobStatus: "failed", chunksDone: 0 })] });
    assert.equal(allFailed.completion, "failed");
    assert.deepEqual(blockingExtractionGaps(allFailed), []);
  });

  it("counts discards by reason; citation-level drops are not candidate discards", () => {
    const r = buildExtractionReport({
      available: true,
      sources: [src({ discarded: { fabricated: 2, identity_dropped: 1, citations_unknown_message: 4, "Bad Key": 9, negative: -1 } })],
    });
    assert.equal(r.sources[0].candidatesDiscarded, 3);
    assert.deepEqual(r.sources[0].discardedByReason, { fabricated: 2, identity_dropped: 1, citations_unknown_message: 4 });
    const kinds = r.blockers.map((b) => [b.kind, b.severity, b.count]);
    assert.deepEqual(kinds, [
      ["candidates_discarded", "advisory", 3],
      ["unreviewed_signals", "advisory", 8],
    ]);
  });

  it("oversize skips, flags and unrecorded coverage are advisory", () => {
    const r = buildExtractionReport({
      available: true,
      sources: [src({ oversizeSkipped: 2, signalMessagesUnreviewed: 0 }), src({ sourceId: S(2), coverageRecorded: false, signalMessagesUnreviewed: 0 })],
      flags: { possibleContradictions: 2, unresolvedAttribution: 1 },
    });
    assert.equal(r.completion, "partial", "a skipped message means not fully analysed");
    assert.deepEqual(
      r.blockers.map((b) => b.kind),
      ["oversize_messages_skipped", "possible_contradictions", "unresolved_attribution", "coverage_unavailable"],
    );
    assert.deepEqual(blockingExtractionGaps(r), []);
  });

  it("unavailable (no migration) reports nothing and blocks nothing", () => {
    const r = buildExtractionReport({ available: false });
    assert.equal(r.available, false);
    assert.equal(r.completion, "none");
    assert.deepEqual(r.blockers, []);
    assert.deepEqual(blockingExtractionGaps(buildExtractionReport({ available: false, sources: [src({ jobStatus: "failed", chunksDone: 1 })] })), []);
  });
});

describe("verification layers (VER-1)", () => {
  it("keeps the quote match and the AI judgement separate", () => {
    assert.deepEqual(evidenceLayers({ kind: "source_quote", quoteCheck: "exact", supportVerdict: "irrelevant" }), { quote: "matched_exact", ai: "judged_irrelevant" });
    assert.deepEqual(evidenceLayers({ kind: "source_quote", quoteCheck: "not_found", supportVerdict: "supports" }), { quote: "not_found", ai: "judged_supportive" });
    assert.equal(evidenceLayers({ kind: "source_quote", quoteCheck: "exact", supportVerdict: "irrelevant", guarded: true }).ai, "guarded");
    assert.equal(evidenceLayers({ kind: "source_quote", quoteCheck: "exact", supportVerdict: "supports", isCurrentRevisionVerdict: false }).ai, "stale");
    assert.equal(evidenceLayers({ kind: "testimony", quoteCheck: "pending", supportVerdict: "unchecked" }).quote, "testimony");
  });

  it("an AI 'supports' on a quote that was not found never counts as supportive evidence", () => {
    const p = pointLayers({ reviewState: "pending", evidence: [{ kind: "source_quote", quoteCheck: "not_found", supportVerdict: "supports" }] });
    assert.deepEqual(p, { quoteMatched: false, aiJudgedSupportive: false, human: "not_reviewed", conflictIdentified: false });
  });

  it("human confirmation and conflicts are separate layers", () => {
    const p = pointLayers({
      reviewState: "approved",
      evidence: [
        { kind: "source_quote", quoteCheck: "exact", supportVerdict: "supports" },
        { kind: "source_quote", quoteCheck: "normalized", supportVerdict: "contradicts", excluded: true },
      ],
      openContradictionFlags: 1,
    });
    assert.deepEqual(p, { quoteMatched: true, aiJudgedSupportive: true, human: "confirmed", conflictIdentified: true });
  });
});
