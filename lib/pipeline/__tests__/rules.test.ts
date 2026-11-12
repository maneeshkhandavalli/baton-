// Backoff, log hygiene and run-outcome rules.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { nextAttemptAt, retryDelayMs } from "../backoff";
import { mapAiFailure } from "../ai";
import { decideRunOutcome } from "../finish";
import { DROPPED, toLogRecord } from "../log";
import { IDS, runJob } from "./fakes";

describe("backoff (§9.3)", () => {
  it("is 30 s, 2 min, 8 min and capped", () => {
    assert.deepEqual([1, 2, 3, 4, 0, Number.NaN].map(retryDelayMs), [30_000, 120_000, 480_000, 480_000, 30_000, 30_000]);
    assert.equal(nextAttemptAt(Date.UTC(2026, 0, 1), 2), "2026-01-01T00:02:00.000Z");
  });
});

describe("pipeline logs carry ids, counts and reason tokens only (§12.7)", () => {
  it("drops free text, keeps uuids, tokens, numbers and booleans", () => {
    const r = toLogRecord("info", "source_parsed", {
      jobId: IDS.job,
      reason: "parser:corrupt_file",
      messages: 12,
      ok: true,
      body: "Asha: the UPI pin is 1234",
      label: "Ravi Kumar",
      fileName: "chat export.txt",
    });
    assert.equal(r.jobId, IDS.job);
    assert.equal(r.reason, "parser:corrupt_file");
    assert.equal(r.messages, 12);
    assert.equal(r.ok, true);
    assert.equal(r.body, DROPPED);
    assert.equal(r.label, DROPPED);
    assert.equal(r.fileName, DROPPED);
    assert.ok(!JSON.stringify(r).includes("Asha"));
  });

  it("drops a non-token event name and cannot overwrite reserved keys", () => {
    const r = toLogRecord("warn", "Event With Text", { scope: "other", level: "debug" });
    assert.equal(r.event, DROPPED);
    assert.equal(r.scope, "pipeline");
    assert.equal(r.level, "warn");
  });
});

describe("mapAiFailure (I1 reasons)", () => {
  it("keeps known reason tokens; configuration failures are never retryable", () => {
    const e = (reason: string, retryable: boolean) => ({ code: "precondition_failed" as const, message: "m", retryable, details: { reason } });
    assert.deepEqual(mapAiFailure(e("ai_config_changed", true)), { code: "precondition_failed", reason: "ai_config_changed", retryable: false });
    assert.deepEqual(mapAiFailure(e("provider_not_configured", false)), { code: "precondition_failed", reason: "provider_not_configured", retryable: false });
    assert.deepEqual(mapAiFailure({ ...e("ai_timed_out", true), code: "processing_failed" }), { code: "processing_failed", reason: "ai_timed_out", retryable: true });
    assert.deepEqual(mapAiFailure({ ...e("ai_request_invalid", false), code: "validation_failed" }), { code: "validation_failed", reason: "ai_request_invalid", retryable: false });
    assert.deepEqual(mapAiFailure({ code: "processing_failed", message: "m", retryable: true, details: { reason: "Some Free Text" } }), {
      code: "processing_failed",
      reason: "ai_transient",
      retryable: true,
    });
  });
});

describe("decideRunOutcome (§9.3, W0 I2.7)", () => {
  const ok = [
    runJob("parse", "succeeded", null, IDS.source),
    runJob("extract", "succeeded", null, IDS.source),
    runJob("verify_quotes", "succeeded", null, IDS.source),
    runJob("verify_support", "succeeded"),
    runJob("analyze", "succeeded"),
  ];

  it("waits while any job is open", () => {
    assert.deepEqual(decideRunOutcome([...ok, runJob("prepare_review", "queued")]), { kind: "wait" });
    assert.deepEqual(decideRunOutcome([...ok, runJob("prepare_review", "running")]), { kind: "wait" });
  });

  it("QA-R3-01: a run without any job is closed as failed (no_jobs) instead of waiting forever", () => {
    assert.deepEqual(decideRunOutcome([]), { kind: "finish", status: "failed", errorCode: "processing_failed", errorMessage: "no_jobs" });
  });

  it("a missing pipeline schema (db_schema_outdated) fails the run at once, even with jobs still open", () => {
    assert.deepEqual(decideRunOutcome([runJob("extract", "failed", "db_schema_outdated"), runJob("extract", "queued")]), {
      kind: "finish",
      status: "failed",
      errorCode: "precondition_failed",
      errorMessage: "db_schema_outdated",
    });
  });

  it("succeeds when everything is terminal and at least one extract succeeded", () => {
    assert.deepEqual(decideRunOutcome([...ok, runJob("prepare_review", "succeeded")]), { kind: "finish", status: "succeeded" });
    const partial = [
      runJob("parse", "failed", "parser:corrupt_file", IDS.source2),
      { ...runJob("extract", "cancelled", "upstream_failed", IDS.source2), id: "x2" },
      ...ok,
      runJob("prepare_review", "succeeded"),
    ];
    assert.deepEqual(decideRunOutcome(partial), { kind: "finish", status: "succeeded" });
  });

  it("fails at once on provider_not_configured or ai_config_changed, even with open jobs", () => {
    for (const reason of ["provider_not_configured", "ai_config_changed"]) {
      const d = decideRunOutcome([runJob("extract", "failed", reason, IDS.source), runJob("verify_support", "queued")]);
      assert.deepEqual(d, { kind: "finish", status: "failed", errorCode: "precondition_failed", errorMessage: reason });
    }
  });

  it("fails when a handover-level stage failed", () => {
    for (const stage of ["verify_support", "analyze", "prepare_review"] as const) {
      const d = decideRunOutcome([runJob("extract", "succeeded", null, IDS.source), runJob(stage, "failed", "db_transient")]);
      assert.deepEqual(d, { kind: "finish", status: "failed", errorCode: "processing_failed", errorMessage: `${stage}_failed` });
    }
  });

  it("fails when every extract failed or was skipped", () => {
    const d = decideRunOutcome([
      runJob("parse", "failed", "parser:corrupt_file", IDS.source),
      runJob("extract", "cancelled", "upstream_failed", IDS.source),
      runJob("verify_quotes", "cancelled", "upstream_failed", IDS.source),
      runJob("verify_support", "succeeded"),
      runJob("analyze", "succeeded"),
      runJob("prepare_review", "succeeded"),
    ]);
    assert.deepEqual(d, { kind: "finish", status: "failed", errorCode: "processing_failed", errorMessage: "no_source_succeeded" });
  });

  it("every failure message is a reason token", () => {
    const d = decideRunOutcome([runJob("prepare_review", "failed", "internal"), runJob("extract", "succeeded")]);
    assert.ok(d.kind === "finish" && d.status === "failed" && /^[a-z0-9_:]{1,64}$/.test(d.errorMessage));
  });
});
