import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { describeSave, formatSavedAgo, type SaveState } from "../save-state";
import { stepState, stepSummary } from "../steps";
import { UPLOAD_PIPELINE, phaseForError, uploadPhaseMeta, uploadProgress, type UploadPhase } from "../upload-status";

const NOW = new Date("2026-11-12T10:00:00Z");

describe("save state (autosave indicator)", () => {
  it("says 'just now' for a fresh save and minutes after that", () => {
    assert.equal(formatSavedAgo(new Date(NOW.getTime() - 10_000), NOW), "just now");
    assert.equal(formatSavedAgo(new Date(NOW.getTime() - 4 * 60_000), NOW), "4 min ago");
    assert.equal(formatSavedAgo(NOW.toISOString(), NOW), "just now");
  });

  it("never reports a future save as negative time", () => {
    assert.equal(formatSavedAgo(new Date(NOW.getTime() + 60_000), NOW), "just now");
  });

  it("describes every state with a non-empty label", () => {
    const states: SaveState[] = [
      { kind: "unsaved" },
      { kind: "dirty" },
      { kind: "saving" },
      { kind: "saved", at: NOW },
      { kind: "error" },
      { kind: "conflict" },
    ];
    for (const s of states) assert.ok(describeSave(s, NOW).label.length > 0, s.kind);
  });

  it("makes only errors and conflicts urgent, and only errors retryable", () => {
    assert.equal(describeSave({ kind: "error" }, NOW).urgent, true);
    assert.equal(describeSave({ kind: "error" }, NOW).retry, true);
    assert.equal(describeSave({ kind: "conflict" }, NOW).urgent, true);
    assert.equal(describeSave({ kind: "conflict" }, NOW).retry, false);
    assert.equal(describeSave({ kind: "saved", at: NOW }, NOW).urgent, false);
    assert.equal(describeSave({ kind: "saving" }, NOW).urgent, false);
  });

  it("keeps a specific error message from the server", () => {
    assert.equal(describeSave({ kind: "error", message: "Title is too short." }, NOW).detail, "Title is too short.");
  });
});

describe("upload status (per-file states)", () => {
  it("classifies size problems before any server code", () => {
    assert.equal(phaseForError({ sizeBytes: 30, maxBytes: 25, code: "conflict", reason: "duplicate_source" }), "too_large");
    assert.equal(phaseForError({ sizeBytes: 0, code: "internal" }), "empty");
    assert.equal(phaseForError({ code: "payload_too_large" }), "too_large");
  });

  it("maps a duplicate upload (conflict) and parser outcomes", () => {
    assert.equal(phaseForError({ code: "conflict", reason: "duplicate_source" }), "duplicate");
    assert.equal(phaseForError({ code: "conflict" }), "failed");
    assert.equal(phaseForError({ code: "parse_failed", parserCode: "date_format_ambiguous" }), "needs_input");
    assert.equal(phaseForError({ code: "unsupported_file_type" }), "unsupported");
    assert.equal(phaseForError({ code: "parse_failed", parserCode: "unsupported_format" }), "unsupported");
    assert.equal(phaseForError({ code: "internal" }), "failed");
    assert.equal(phaseForError({}), "failed");
  });

  it("only offers retry for transient failures", () => {
    const retryable = (Object.keys(uploadPhaseMeta) as UploadPhase[]).filter((p) => uploadPhaseMeta[p].retryable);
    assert.deepEqual(retryable, ["failed"]);
  });

  it("marks exactly the working phases busy", () => {
    for (const p of UPLOAD_PIPELINE) assert.equal(uploadPhaseMeta[p].busy, true, p);
    for (const p of ["ready", "failed", "duplicate", "too_large", "empty", "unsupported", "needs_input"] as const) {
      assert.equal(uploadPhaseMeta[p].busy, false, p);
    }
  });

  it("reports pipeline progress for working phases only", () => {
    assert.deepEqual(uploadProgress("hashing"), { step: 1, total: 5 });
    assert.deepEqual(uploadProgress("previewing"), { step: 5, total: 5 });
    assert.equal(uploadProgress("ready"), null);
    assert.equal(uploadProgress("failed"), null);
  });
});

describe("steps", () => {
  it("derives complete / current / upcoming", () => {
    assert.deepEqual([0, 1, 2, 3].map((i) => stepState(i, 2)), ["complete", "complete", "current", "upcoming"]);
    assert.deepEqual([0, 1].map((i) => stepState(i, 2)), ["complete", "complete"]);
  });

  it("summarises the step and clamps out-of-range values", () => {
    assert.equal(stepSummary(0, 4), "Step 1 of 4");
    assert.equal(stepSummary(3, 4), "Step 4 of 4");
    assert.equal(stepSummary(9, 4), "Step 4 of 4");
    assert.equal(stepSummary(-1, 4), "Step 1 of 4");
  });
});
