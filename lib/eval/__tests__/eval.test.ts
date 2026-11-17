// R3 Task 03: the offline evaluation is repeatable. The deterministic run (signal pass, contradiction
// retrieval, fake adapter through the real lib/ai code) must reproduce the committed baseline exactly; a change
// to the detector, prompts, schemas or lib/ai checks shows up here and the baseline must be re-recorded on
// purpose (`npm run eval:extraction -- --write-baseline`). Synthetic data only.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

import { createFakeProvider, fakeRunConfig } from "../../ai/providers/fake";
import { evalUuid, loadDatasets, parseDataset, relevantMessages } from "../dataset";
import { runEvaluation } from "../run";

const BASELINE = join(process.cwd(), "fixtures", "eval", "baselines", "fake-baseline.json");

describe("evaluation datasets", () => {
  const datasets = loadDatasets();

  it("cover every label kind and contain only pseudonymised authors", () => {
    const kinds = new Set(datasets.flatMap((d) => d.labels.map((l) => l.kind)));
    for (const k of ["decision", "deadline", "responsibility", "financial_commitment", "dependency", "contradiction", "reversed_decision", "unresolved_question"]) {
      assert.ok(kinds.has(k as never), k);
    }
    for (const d of datasets) for (const m of d.messages) assert.ok(m.authorLabel === null || /^\[PERSON_\d+\]$/.test(m.authorLabel), `${d.id}/${m.localId}`);
  });

  it("have stable UUIDs and a non-empty relevant set", () => {
    assert.equal(evalUuid("ds01-x", "m01"), evalUuid("ds01-x", "m01"));
    assert.notEqual(evalUuid("ds01-x", "m01"), evalUuid("ds02-x", "m01"));
    for (const d of datasets) assert.ok(relevantMessages(d).size > 0);
  });

  it("refuse an inconsistent label or support pair", () => {
    const base = JSON.parse(readFileSync(join(process.cwd(), "fixtures", "eval", "handover-reliability", "ds01-techfest-treasurer.json"), "utf8"));
    assert.throws(() => parseDataset({ ...base, labels: [{ ...base.labels[0], messageIds: ["m99"] }] }), /unknown message/);
    assert.throws(() => parseDataset({ ...base, supportPairs: [{ ...base.supportPairs[0], quote: "not in the message" }] }), /quote/);
  });
});

describe("evaluation run", () => {
  it("reproduces the committed deterministic baseline exactly", async () => {
    const report = await runEvaluation(loadDatasets(), createFakeProvider(), fakeRunConfig(), "fake adapter (deterministic plumbing baseline; NOT a model)");
    const baseline = JSON.parse(readFileSync(BASELINE, "utf8"));
    assert.deepEqual(JSON.parse(JSON.stringify(report)), baseline);
  });

  it("every ratio carries its numerator and denominator", async () => {
    const report = JSON.parse(readFileSync(BASELINE, "utf8"));
    for (const r of Object.values(report.totals) as Array<{ num: number; den: number; value: number | null }>) {
      assert.ok(Number.isInteger(r.num) && Number.isInteger(r.den) && r.num <= r.den);
      assert.equal(r.value, r.den === 0 ? null : Math.round((r.num / r.den) * 10_000) / 10_000);
    }
    assert.equal(report.provider, "fake", "the committed baseline is never presented as a model result");
  });
});
