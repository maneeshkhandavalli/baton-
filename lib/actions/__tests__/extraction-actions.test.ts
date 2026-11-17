// R3 Task 03: the publish gate for partial extraction (EXT-3) and the signal / flag review actions.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { Result } from "../../contracts/api";
import { buildExtractionReport } from "../../contracts/extraction";
import * as extraction from "../core/extraction";
import * as gapsCore from "../core/gaps";
import * as handovers from "../core/handovers";
import { ACTOR_ID, H, NEW_ID, OTHER_ID, SYNTHETIC_PHONE, fakeDeps } from "./helpers";

const ok = <T>(data: T) => async (): Promise<Result<T>> => ({ ok: true, data });
const partialReport = buildExtractionReport({
  available: true,
  sources: [
    { sourceId: OTHER_ID, jobStatus: "succeeded", chunksDone: 1, chunksTotal: 1, coverageRecorded: true },
    { sourceId: NEW_ID, jobStatus: "failed", chunksDone: 2, chunksTotal: 5, coverageRecorded: true, jobError: "ai_quota_exhausted" },
  ],
});

describe("publishHandover: extraction gaps (EXT-3)", () => {
  it("refuses while a source was only partly analysed and the reviewer has not acknowledged it", async () => {
    const f = fakeDeps({ rpc: { publish_handover: { data: NEW_ID } }, queries: { getExtractionReport: ok(partialReport) } });
    const r = await handovers.publishHandover(f.deps, { handoverId: H });
    assert.equal(r.ok, false);
    assert.equal(!r.ok && r.error.code, "precondition_failed");
    assert.equal(!r.ok && r.error.details?.reason, "extraction_incomplete");
    assert.equal(f.calls.filter((c) => c.fn === "publish_handover").length, 0, "nothing was published");
  });

  it("publishes once the gap is acknowledged", async () => {
    const f = fakeDeps({ rpc: { publish_handover: { data: NEW_ID } }, queries: { getExtractionReport: ok(partialReport) } });
    await handovers.publishHandover(f.deps, { handoverId: H, acknowledgeExtractionGaps: true });
    assert.equal(f.calls.filter((c) => c.fn === "publish_handover").length, 1);
  });

  it("advisory issues (discards, unreviewed signals) never block publishing", async () => {
    const advisory = buildExtractionReport({
      available: true,
      sources: [{ sourceId: OTHER_ID, jobStatus: "succeeded", chunksDone: 1, chunksTotal: 1, coverageRecorded: true, signalMessagesUnreviewed: 4, discarded: { fabricated: 2 } }],
    });
    const f = fakeDeps({ rpc: { publish_handover: { data: NEW_ID } }, queries: { getExtractionReport: ok(advisory) } });
    await handovers.publishHandover(f.deps, { handoverId: H });
    assert.equal(f.calls.filter((c) => c.fn === "publish_handover").length, 1);
  });

  it("an unavailable report (older database) does not block; an internal read error fails closed", async () => {
    const f = fakeDeps({ rpc: { publish_handover: { data: NEW_ID } }, queries: { getExtractionReport: ok(buildExtractionReport({ available: false })) } });
    await handovers.publishHandover(f.deps, { handoverId: H });
    assert.equal(f.calls.filter((c) => c.fn === "publish_handover").length, 1);

    const g = fakeDeps({
      rpc: { publish_handover: { data: NEW_ID } },
      queries: { getExtractionReport: async () => ({ ok: false, error: { code: "internal", message: "x", retryable: true } }) },
    });
    const r = await handovers.publishHandover(g.deps, { handoverId: H });
    assert.equal(r.ok, false);
    assert.equal(g.calls.filter((c) => c.fn === "publish_handover").length, 0);
  });
});

describe("signal and flag review actions", () => {
  it("reviewSignalMessage passes the verified actor and validated ids", async () => {
    const f = fakeDeps({ rpc: { review_extraction_signals: { data: 3 } } });
    const r = await extraction.reviewSignalMessage(f.deps, { handoverId: H, messageId: NEW_ID, state: "dismissed" });
    assert.deepEqual(r, { ok: true, data: { signals: 3 } });
    assert.deepEqual(f.calls[0].args, { p_actor_profile_id: ACTOR_ID, p_handover_id: H, p_message_id: NEW_ID, p_state: "dismissed" });
  });

  it("refuses bad input before any call", async () => {
    const f = fakeDeps();
    const r = await extraction.reviewSignalMessage(f.deps, { handoverId: H, messageId: "nope", state: "dismissed" });
    assert.equal(r.ok, false);
    const g = await extraction.reviewPointFlag(f.deps, { flagId: NEW_ID, state: "deleted" as never });
    assert.equal(g.ok, false);
    assert.equal(f.calls.length, 0);
  });

  it("reviewPointFlag requires a signed-in actor", async () => {
    const f = fakeDeps({ actor: null });
    const r = await extraction.reviewPointFlag(f.deps, { flagId: NEW_ID, state: "dismissed" });
    assert.equal(!r.ok && r.error.code, "unauthenticated");
  });
});

// R3 Task 04: accepting a Gap Interview answer that would create an owner, contact or account point.

describe("reviewGapAnswer: required point detail (R3 Task 04)", () => {
  it("passes a masked reviewer-supplied detail to the 5-argument overload", async () => {
    const f = fakeDeps({ rpc: { review_gap_answer: { data: null } } });
    const r = await gapsCore.reviewGapAnswer(f.deps, { answerId: NEW_ID, decision: "accept", pointDetail: `Merch stall ${SYNTHETIC_PHONE}` });
    assert.ok(r.ok);
    const args = f.calls.find((c) => c.fn === "review_gap_answer")!.args!;
    assert.equal(args.p_actor_profile_id, ACTOR_ID);
    assert.ok(typeof args.p_point_detail === "string" && (args.p_point_detail as string).startsWith("Merch stall"));
    assert.ok(!(args.p_point_detail as string).includes(SYNTHETIC_PHONE), "masked like any reviewer text");
  });

  it("without a detail the 4-argument call is unchanged", async () => {
    const f = fakeDeps({ rpc: { review_gap_answer: { data: null } } });
    await gapsCore.reviewGapAnswer(f.deps, { answerId: NEW_ID, decision: "accept" });
    assert.ok(!("p_point_detail" in f.calls.find((c) => c.fn === "review_gap_answer")!.args!));
  });

  it("a database refusal for a missing detail becomes gap_answer_needs_details", async () => {
    const f = fakeDeps({ rpc: { review_gap_answer: { error: { code: "BTVF0", message: "gap_answer_needs_details" } } } });
    const r = await gapsCore.reviewGapAnswer(f.deps, { answerId: NEW_ID, decision: "accept" });
    assert.equal(!r.ok && r.error.code, "validation_failed");
    assert.equal(!r.ok && r.error.details?.reason, "gap_answer_needs_details");
  });

  it("rejects an empty or over-long detail before any call", async () => {
    const f = fakeDeps();
    assert.equal((await gapsCore.reviewGapAnswer(f.deps, { answerId: NEW_ID, decision: "accept", pointDetail: "   " })).ok, false);
    assert.equal((await gapsCore.reviewGapAnswer(f.deps, { answerId: NEW_ID, decision: "accept", pointDetail: "x".repeat(201) })).ok, false);
    assert.equal(f.calls.length, 0);
  });
});

describe("publishHandover: database-recorded acknowledgement (R3 Task 04)", () => {
  const FP = `cov1:${"c".repeat(32)}`;
  const gated = buildExtractionReport({
    available: true,
    sources: [
      { sourceId: OTHER_ID, jobStatus: "succeeded", chunksDone: 1, chunksTotal: 1, coverageRecorded: true, gapState: "complete" },
      { sourceId: NEW_ID, jobStatus: "failed", chunksDone: 2, chunksTotal: 5, coverageRecorded: true, gapState: "partial", coverageFingerprint: FP },
    ],
  });

  it("without the reviewer's acknowledgement nothing is sent to the database", async () => {
    const f = fakeDeps({ rpc: { publish_handover: { data: NEW_ID } }, queries: { getExtractionReport: ok(gated) } });
    const r = await handovers.publishHandover(f.deps, { handoverId: H });
    assert.equal(!r.ok && r.error.details?.reason, "extraction_incomplete");
    assert.equal(f.calls.filter((c) => c.fn === "publish_handover").length, 0);
  });

  it("with it, the exact (source, fingerprint) the reviewer saw is sent with the verified actor, in the publish call itself", async () => {
    const f = fakeDeps({ rpc: { publish_handover: { data: NEW_ID } }, queries: { getExtractionReport: ok(gated) } });
    await handovers.publishHandover(f.deps, { handoverId: H, acknowledgeExtractionGaps: true });
    const call = f.calls.find((c) => c.fn === "publish_handover")!;
    assert.equal(call.args?.p_actor_profile_id, ACTOR_ID);
    assert.deepEqual(call.args?.p_acknowledgements, [{ sourceId: NEW_ID, fingerprint: FP }]);
  });

  it("no gaps: the unchanged 3-argument publish (no acknowledgements parameter)", async () => {
    const clean = buildExtractionReport({ available: true, sources: [{ sourceId: OTHER_ID, jobStatus: "succeeded", chunksDone: 1, chunksTotal: 1, gapState: "complete" }] });
    const f = fakeDeps({ rpc: { publish_handover: { data: NEW_ID } }, queries: { getExtractionReport: ok(clean) } });
    await handovers.publishHandover(f.deps, { handoverId: H, acknowledgeExtractionGaps: true });
    assert.ok(!("p_acknowledgements" in (f.calls.find((c) => c.fn === "publish_handover")!.args ?? {})));
  });

  it("a coverage change between viewing and publishing surfaces as a conflict from the database", async () => {
    const f = fakeDeps({ rpc: { publish_handover: { error: { code: "BTCF0", message: "the coverage of a source changed" } } }, queries: { getExtractionReport: ok(gated) } });
    const r = await handovers.publishHandover(f.deps, { handoverId: H, acknowledgeExtractionGaps: true });
    assert.equal(!r.ok && r.error.code, "conflict");
  });
});
