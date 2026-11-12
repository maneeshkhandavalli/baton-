// Autosave of a draft's details (R3 A2 ↔ C1): what is sent and how each server error is handled.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { classifySaveError, detailsInput, sameDetails } from "../details-save";
import { phaseOf } from "../draft-state";

const ID = "5a2b3c4d-6e7f-4a81-9b2c-3d4e5f6a7b8c";
const AT = "2026-11-12T10:00:00.000Z";

describe("detailsInput", () => {
  it("always sends roleTitle (empty clears it) and the last seen updatedAt", () => {
    const input = detailsInput(ID, { title: "Treasurer", teamName: "CodeCell", roleTitle: "" }, AT);
    assert.equal(input.roleTitle, "");
    assert.equal(input.expectedUpdatedAt, AT);
  });
  it("omits description when the stored value isn't known, so it is kept", () => {
    assert.equal("description" in detailsInput(ID, { title: "Treasurer", teamName: "CodeCell", roleTitle: "" }, AT), false);
    assert.equal(detailsInput(ID, { title: "Treasurer", teamName: "CodeCell", roleTitle: "", description: "" }, AT).description, "");
  });
});

describe("classifySaveError", () => {
  it("a stale draft is reloaded, not retried", () => {
    assert.deepEqual(classifySaveError({ code: "conflict", message: "m", retryable: false, details: { reason: "stale_draft" } }), { kind: "stale" });
  });
  it("a handover that is no longer a draft moves on", () => {
    assert.deepEqual(classifySaveError({ code: "invalid_transition", message: "m", retryable: false }), { kind: "not_draft" });
  });
  it("field errors keep the first message per field", () => {
    const f = classifySaveError({ code: "validation_failed", message: "m", retryable: false, fieldErrors: { title: ["Too short", "x"] } });
    assert.deepEqual(f, { kind: "fields", fieldErrors: { title: "Too short" } });
  });
  it("a retryable error without a reason is retried; with a reason it is not", () => {
    assert.deepEqual(classifySaveError({ code: "conflict", message: "m", retryable: true }), { kind: "retry" });
    assert.equal(classifySaveError({ code: "conflict", message: "m", retryable: true, details: { reason: "x" } }).kind, "fail");
  });
  it("anything else shows the server's message", () => {
    assert.deepEqual(classifySaveError({ code: "forbidden", message: "Only the creator can edit.", retryable: false }), {
      kind: "fail",
      message: "Only the creator can edit.",
    });
  });
});

describe("sameDetails", () => {
  it("treats unknown and empty description differently only when one is known", () => {
    const a = { title: "T", teamName: "Team", roleTitle: "" };
    assert.equal(sameDetails(a, { ...a }), true);
    assert.equal(sameDetails(a, { ...a, description: "x" }), false);
  });
});

describe("phaseOf: per-file upload state", () => {
  it("maps working statuses directly and errors by reason", () => {
    assert.equal(phaseOf({ status: "uploading" }), "uploading");
    assert.equal(phaseOf({ status: "ready" }), "ready");
    assert.equal(phaseOf({ status: "error" }), "failed");
    assert.equal(phaseOf({ status: "error", errorPhase: "duplicate" }), "duplicate");
    assert.equal(phaseOf({ status: "error", needsDateOrder: true, errorPhase: "failed" }), "needs_input");
  });
});
