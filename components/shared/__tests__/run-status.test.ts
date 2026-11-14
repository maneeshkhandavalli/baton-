import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { RUN_SURFACED_AI_REASONS } from "@/lib/pipeline/finish";

import { CONSENT_REQUIRED_REASON, runReasonText, sourcesNeedingConsent, stageStatusMeta } from "../run-status";

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
  it("maps every run reason the pipeline can write (structural and AI) to plain language", () => {
    const tokens = [
      "no_source_succeeded",
      "verify_support_failed",
      "analyze_failed",
      "prepare_review_failed",
      "provider_not_configured",
      "ai_config_changed",
      // every AI reason lib/pipeline/finish.ts can write as the run reason
      ...RUN_SURFACED_AI_REASONS,
    ];
    for (const token of tokens) {
      const r = runReasonText(token);
      assert.notEqual(r.text, "Processing stopped before it finished.", token);
      assert.equal(r.reference, token);
    }
    assert.match(runReasonText("ai_provider_error").text, /free-tier limit/);
  });
  it("never shows an unknown raw token as the sentence", () => {
    assert.deepEqual(runReasonText("parser:corrupt_file"), { text: "Processing stopped before it finished.", reference: "parser:corrupt_file" });
  });
  it("passes human messages through", () => {
    assert.deepEqual(runReasonText("The source was removed."), { text: "The source was removed.", reference: null });
    assert.equal(runReasonText(null).reference, null);
  });
});

describe("consent before (re)starting processing", () => {
  const sources = [
    { id: "a", consentRecordedAt: null },
    { id: "b", consentRecordedAt: "2026-11-14T10:00:00.000Z" },
  ];
  it("normally asks only for sources without consent", () => {
    assert.deepEqual(sourcesNeedingConsent(sources, false).map((s) => s.id), ["a"]);
  });
  it("after a consent_required refusal (consent for another provider) asks again for every source", () => {
    assert.deepEqual(sourcesNeedingConsent(sources, true).map((s) => s.id), ["a", "b"]);
    assert.equal(CONSENT_REQUIRED_REASON, "consent_required", "same literal as lib/actions/core/handovers.ts");
  });
});
