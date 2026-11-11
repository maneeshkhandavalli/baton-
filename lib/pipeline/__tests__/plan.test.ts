// node --import ./lib/contracts/__tests__/resolve-ts.mjs --test "lib/pipeline/__tests__/*.test.ts"
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { canonicalJson, PIPELINE_VERSION, planProcessingRun, type AiRunConfig, type PlanSource } from "../plan";
import { IDS } from "./fakes";

const AI: AiRunConfig = {
  provider: "fake",
  adapterVersion: "fake@1",
  extract: { model: "fake-extract", promptVersion: "extract@1", schemaVersion: "extract-schema@1" },
  verify: { model: "fake-verify", promptVersion: "support@1", schemaVersion: "support-schema@1" },
};

const S1 = IDS.source;
const S2 = IDS.source2;
const S3 = "e4b3b5c6-f708-412a-b3b4-c5d6e7f8091a";

function plan(sources: PlanSource[], aiConfig: AiRunConfig = AI) {
  const r = planProcessingRun({ handoverId: IDS.handover, sources, aiConfig });
  assert.ok(r.ok, "plan should succeed");
  return r.data;
}

describe("planProcessingRun", () => {
  it("plans parse only for unparsed sources, then per-source extract and verify_quotes, then handover stages", () => {
    const p = plan([
      { id: S1, state: "parsed", rawAvailable: false },
      { id: S2, state: "uploaded", rawAvailable: true },
    ]);
    assert.equal(p.pipelineVersion, PIPELINE_VERSION);
    assert.deepEqual(
      p.jobs.map((j) => `${j.stage}:${j.sourceId ?? "-"}`),
      [`extract:${S1}`, `verify_quotes:${S1}`, `parse:${S2}`, `extract:${S2}`, `verify_quotes:${S2}`, "verify_support:-", "analyze:-", "prepare_review:-"],
    );
    for (const j of p.jobs) assert.match(j.inputHashHex, /^[0-9a-f]{64}$/);
  });

  it("includes exactly the sources start_processing includes", () => {
    const p = plan([
      { id: S1, state: "failed", rawAvailable: true },
      { id: S2, state: "failed", rawAvailable: false },
      { id: S3, state: "pending_upload", rawAvailable: false },
    ]);
    assert.deepEqual([...new Set(p.jobs.map((j) => j.sourceId).filter(Boolean))], [S1]);
  });

  it("fails precondition_failed when no source is ready", () => {
    const r = planProcessingRun({ handoverId: IDS.handover, sources: [{ id: S1, state: "uploaded", rawAvailable: false }], aiConfig: AI });
    assert.equal(r.ok, false);
    if (!r.ok) {
      assert.equal(r.error.code, "precondition_failed");
      assert.equal(r.error.details?.reason, "no_source_ready");
    }
  });

  it("validates its input", () => {
    const bad = [
      { handoverId: "not-a-uuid", sources: [], aiConfig: AI },
      { handoverId: IDS.handover, sources: [{ id: S1, state: "parsed", rawAvailable: false }, { id: S1, state: "parsed", rawAvailable: false }], aiConfig: AI },
      { handoverId: IDS.handover, sources: [{ id: S1, state: "parsed", rawAvailable: false }], aiConfig: { ...AI, extract: { ...AI.extract, model: "" } } },
    ];
    for (const input of bad) {
      const r = planProcessingRun(input as Parameters<typeof planProcessingRun>[0]);
      assert.equal(r.ok, false);
      if (!r.ok) assert.equal(r.error.code, "validation_failed");
    }
  });

  it("hashes are deterministic; an extract model or prompt change re-runs extract only", () => {
    const sources: PlanSource[] = [{ id: S1, state: "parsed", rawAvailable: false }];
    const a = plan(sources);
    const b = plan(sources);
    assert.deepEqual(a.jobs, b.jobs);
    const c = plan(sources, { ...AI, extract: { ...AI.extract, promptVersion: "extract@2" } });
    const byStage = (p: typeof a, stage: string) => p.jobs.find((j) => j.stage === stage)?.inputHashHex;
    assert.notEqual(byStage(a, "extract"), byStage(c, "extract"));
    for (const stage of ["verify_quotes", "verify_support", "analyze", "prepare_review"]) assert.equal(byStage(a, stage), byStage(c, stage));
    const d = plan(sources, { ...AI, verify: { ...AI.verify, model: "fake-verify-2" } });
    assert.notEqual(byStage(a, "verify_support"), byStage(d, "verify_support"));
    assert.equal(byStage(a, "extract"), byStage(d, "extract"));
  });

  it("handover-level hashes do not depend on source order or id case", () => {
    const x = plan([{ id: S1, state: "parsed", rawAvailable: false }, { id: S2, state: "parsed", rawAvailable: false }]);
    const y = plan([{ id: S2.toUpperCase(), state: "parsed", rawAvailable: false }, { id: S1, state: "parsed", rawAvailable: false }]);
    const h = (p: typeof x) => p.jobs.filter((j) => j.sourceId === null).map((j) => j.inputHashHex);
    assert.deepEqual(h(x), h(y));
  });

  it("returns a copy of the AI config limited to AiRunConfig fields", () => {
    const p = plan([{ id: S1, state: "parsed", rawAvailable: false }], { ...AI, secret: "x" } as unknown as AiRunConfig);
    assert.deepEqual(p.aiConfig, AI);
  });

  it("canonicalJson sorts keys", () => {
    assert.equal(canonicalJson({ b: 1, a: [{ d: 2, c: 3 }] }), '{"a":[{"c":3,"d":2}],"b":1}');
  });
});
