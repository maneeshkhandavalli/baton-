// R3 Task 05C: scoped processing of a source update, and the publication block for unsettled updates.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { Result } from "../../contracts/api";
import type { SourceSummary } from "../../contracts/dto";
import { blockingSourceUpdates, buildExtractionReport, sourceUpdateBlockText } from "../../contracts/extraction";
import { mapSourceSummary } from "../../db/mappers";
import { planProcessingRun } from "../../pipeline/plan";
import * as handovers from "../core/handovers";
import { FAKE_RUN_CONFIG, H, NEW_ID, OTHER_ID, P, S, fakeDeps } from "./helpers";

const ok = <T>(data: T) => async (): Promise<Result<T>> => ({ ok: true, data });
const row = (id: string, state: string, version: Record<string, unknown>) =>
  mapSourceSummary({
    id, handover_id: H, kind: "whatsapp_export", title: `Chat ${id.slice(0, 4)}`, state, access_level: "everyone", size_bytes: 10,
    consent_recorded_at: "2026-11-17T00:00:00Z", raw_deleted_at: state === "parsed" ? "2026-11-17T00:00:00Z" : null,
    first_message_at: null, last_message_at: null, message_count: null, masking_counts: null, error_code: null, version,
  });
const v = (lineage: string, n: number | null, extra: Record<string, unknown> = {}) => ({
  lineage_id: lineage, version_number: n, supersedes_source_id: n === 1 ? null : lineage, superseded_at: null, superseded_by_source_id: null, ...extra,
});
// S: version 1 superseded by NEW_ID (version 2, pending update); P: an untouched current source
const SOURCES: SourceSummary[] = [
  row(S, "parsed", v(S, 1, { superseded_at: "2026-11-17T00:00:00Z", superseded_by_source_id: NEW_ID })),
  row(NEW_ID, "uploaded", v(S, 2, { update_state: "awaiting_processing", update_error: null })),
  row(P, "parsed", v(P, 1)),
];

function deps(scope: unknown, extra: Parameters<typeof fakeDeps>[0] = {}) {
  return fakeDeps({
    queries: { listSources: ok(SOURCES) },
    aiRunConfig: () => ({ ok: true, data: FAKE_RUN_CONFIG }),
    planProcessingRun: (input) => planProcessingRun(input), // the real planner
    rpc: { source_update_processing_scope: { data: scope }, start_source_update_processing: { data: OTHER_ID }, start_processing: { data: OTHER_ID } },
    ...extra,
  });
}

describe("startProcessing: a source update is processed on its own", () => {
  it("scoped: source-specific jobs only for the new version; every handover-wide stage still runs", async () => {
    const f = deps({ mode: "scoped", sourceIds: [NEW_ID] });
    const r = await handovers.startProcessing(f.deps, { handoverId: H });
    assert.deepEqual(r, { ok: true, data: { runId: OTHER_ID } });
    // (the read-only "anything left to read?" check of the new chat version may read it in between; best effort)
    assert.deepEqual(f.events.filter((e) => e !== "source_preview_target").slice(0, 2), ["source_update_processing_scope", "start_source_update_processing"]);
    assert.equal(f.calls.filter((c) => c.fn === "start_processing").length, 0, "no full run");
    const jobs = f.calls.find((c) => c.fn === "start_source_update_processing")!.args!.p_jobs as Array<{ stage: string; sourceId: string | null }>;
    assert.deepEqual(jobs.map((j) => `${j.stage}:${j.sourceId ?? "-"}`), [
      `parse:${NEW_ID}`, `extract:${NEW_ID}`, `verify_quotes:${NEW_ID}`, "verify_support:-", "analyze:-", "prepare_review:-",
    ]);
    assert.ok(!jobs.some((j) => j.sourceId === P), "the untouched source is not parsed or extracted again");
    assert.ok(!jobs.some((j) => j.sourceId === S), "the superseded version is never processed");
    assert.deepEqual(f.planInputs[0].scopeSourceIds, [NEW_ID], "the scope comes from the database");
    assert.ok(f.events.includes("scheduleDrain"), "the existing worker drains it");
  });

  it("full: an ordinary handover keeps the unchanged full run", async () => {
    const f = deps({ mode: "full", sourceIds: [] });
    await handovers.startProcessing(f.deps, { handoverId: H });
    assert.equal(f.calls.filter((c) => c.fn === "start_source_update_processing").length, 0);
    const jobs = f.calls.find((c) => c.fn === "start_processing")!.args!.p_jobs as Array<{ stage: string; sourceId: string | null }>;
    assert.ok(jobs.some((j) => j.sourceId === P && j.stage === "extract") && jobs.some((j) => j.sourceId === NEW_ID && j.stage === "extract"));
    assert.equal(f.planInputs[0].scopeSourceIds, undefined);
  });

  it("an older database without the scope function gets the full run; other refusals are not swallowed", async () => {
    const f = deps(null);
    await handovers.startProcessing(f.deps, { handoverId: H });
    assert.equal(f.calls.filter((c) => c.fn === "start_processing").length, 1);
    const g = deps(null, {
      queries: { listSources: ok(SOURCES) },
      rpc: { source_update_processing_scope: { error: { code: "BTFB0", message: "x" } } },
    });
    const r = await handovers.startProcessing(g.deps, { handoverId: H });
    assert.equal(!r.ok && r.error.code, "forbidden");
    assert.equal(g.calls.filter((c) => c.fn.startsWith("start_")).length, 0);
  });

  it("a second request while a run is active is a conflict and schedules nothing", async () => {
    const f = deps({ mode: "scoped", sourceIds: [NEW_ID] }, {
      queries: { listSources: ok(SOURCES) },
      rpc: {
        source_update_processing_scope: { data: { mode: "scoped", sourceIds: [NEW_ID] } },
        start_source_update_processing: { error: { code: "BTCF0", message: "a run is already active" } },
      },
    });
    const r = await handovers.startProcessing(f.deps, { handoverId: H });
    assert.equal(!r.ok && r.error.code, "conflict");
    assert.ok(!f.events.includes("scheduleDrain"));
  });

  it("the planner refuses a scope outside the included current sources", () => {
    const base = { handoverId: H, aiConfig: FAKE_RUN_CONFIG, sources: [{ id: P, state: "parsed" as const, rawAvailable: false }] };
    assert.equal(planProcessingRun({ ...base, scopeSourceIds: [S] }).ok, false);
    assert.equal(planProcessingRun({ ...base, scopeSourceIds: [] }).ok, false);
    assert.equal(planProcessingRun({ ...base, scopeSourceIds: [P, P] }).ok, false);
  });

  it("a scoped run's handover-wide hashes differ from a full run's; a full run's are unchanged", () => {
    const base = {
      handoverId: H, aiConfig: FAKE_RUN_CONFIG,
      sources: [{ id: P, state: "parsed" as const, rawAvailable: false }, { id: NEW_ID, state: "uploaded" as const, rawAvailable: true }],
    };
    const full = planProcessingRun(base);
    const again = planProcessingRun(base);
    const scoped = planProcessingRun({ ...base, scopeSourceIds: [NEW_ID] });
    assert.ok(full.ok && again.ok && scoped.ok);
    const wide = (p: typeof full) => (p.ok ? p.data.jobs.filter((j) => j.sourceId === null).map((j) => j.inputHashHex) : []);
    assert.deepEqual(wide(full), wide(again));
    assert.notDeepEqual(wide(full), wide(scoped));
  });
});

describe("publishHandover: an unsettled source update blocks publication", () => {
  const report = (state: string, errorCode: string | null, blocks: boolean) =>
    buildExtractionReport({
      available: true,
      sources: [{ sourceId: NEW_ID, jobStatus: "succeeded", chunksDone: 1, chunksTotal: 1, coverageRecorded: true }],
      sourceUpdates: [{ sourceId: NEW_ID, previousSourceId: S, title: "Chat", fromVersion: 1, toVersion: 2, state, errorCode, blocksPublication: blocks }],
    });

  for (const state of ["awaiting_processing", "processing", "awaiting_detection"]) {
    it(`${state}: refused before any write, with an explanation; no acknowledgement lifts it`, async () => {
      const f = fakeDeps({ rpc: { publish_handover: { data: NEW_ID } }, queries: { getExtractionReport: ok(report(state, null, true)) } });
      const r = await handovers.publishHandover(f.deps, { handoverId: H, acknowledgeExtractionGaps: true });
      assert.equal(!r.ok && r.error.code, "precondition_failed");
      assert.equal(!r.ok && r.error.details?.reason, "source_update_pending");
      assert.ok(!r.ok && r.error.message.includes("Version 2 of Chat"));
      assert.equal(f.calls.filter((c) => c.fn === "publish_handover").length, 0);
    });
  }

  it("a failed update with an extraction gap goes through the acknowledgement path (not blocked here)", async () => {
    const f = fakeDeps({ rpc: { publish_handover: { data: NEW_ID } }, queries: { getExtractionReport: ok(report("failed", "extraction_failed", false)) } });
    await handovers.publishHandover(f.deps, { handoverId: H });
    assert.equal(f.calls.filter((c) => c.fn === "publish_handover").length, 1);
  });

  it("the report fails closed: an update without an explicit `false` blocks", () => {
    const r = buildExtractionReport({
      available: true,
      sourceUpdates: [{ sourceId: NEW_ID, previousSourceId: S, fromVersion: 1, toVersion: 2, state: "failed", errorCode: "run_failed" }],
    });
    assert.equal(blockingSourceUpdates(r).length, 1);
    assert.match(sourceUpdateBlockText(r.sourceUpdates[0]), /didn.t finish/);
    assert.deepEqual(buildExtractionReport({ available: true }).sourceUpdates, [], "an older database lists none");
    assert.deepEqual(blockingSourceUpdates(buildExtractionReport({ available: false, sourceUpdates: r.sourceUpdates as never })), []);
  });

  it("maps a source's update state", () => {
    assert.equal(SOURCES[1].version?.updateState, "awaiting_processing");
    assert.equal(SOURCES[2].version?.updateState, undefined, "a first version has no update");
  });
});
