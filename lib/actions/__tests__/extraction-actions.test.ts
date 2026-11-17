// R3 Task 03: the publish gate for partial extraction (EXT-3) and the signal / flag review actions.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { Result } from "../../contracts/api";
import { buildExtractionReport } from "../../contracts/extraction";
import * as extraction from "../core/extraction";
import * as handovers from "../core/handovers";
import { ACTOR_ID, H, NEW_ID, OTHER_ID, fakeDeps } from "./helpers";

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
