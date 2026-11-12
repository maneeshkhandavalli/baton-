import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { runReasonText, stageStatusMeta } from "../run-status";

describe("stage status", () => {
  it("partial has its own warning tone and an explicit label", () => {
    assert.deepEqual(stageStatusMeta("partial"), { label: "Partly done: some sources were skipped or failed", tone: "warning" });
    assert.equal(stageStatusMeta("failed").tone, "danger");
    assert.equal(stageStatusMeta("queued").tone, "idle");
  });
});

describe("run reason copy", () => {
  it("maps known tokens to plain language and keeps the token as a reference", () => {
    const r = runReasonText("db_schema_outdated");
    assert.match(r.text, /database needs an update/);
    assert.equal(r.reference, "db_schema_outdated");
    assert.match(runReasonText("no_jobs").text, /nothing to process/);
  });
  it("never shows an unknown raw token as the sentence", () => {
    assert.deepEqual(runReasonText("parser:corrupt_file"), { text: "Processing stopped before it finished.", reference: "parser:corrupt_file" });
  });
  it("passes human messages through", () => {
    assert.deepEqual(runReasonText("The source was removed."), { text: "The source was removed.", reference: null });
    assert.equal(runReasonText(null).reference, null);
  });
});
