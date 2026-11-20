import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { settleSave } from "../save-state";

describe("settleSave (Round 4 audit B1)", () => {
  const now = new Date("2026-11-21T10:00:00Z");
  const savedBefore = { kind: "saved" as const, at: "2026-11-21T09:59:00Z" };
  it("a success is saved now", () => assert.deepEqual(settleSave(savedBefore, { ok: true }, now), { kind: "saved", at: now }));
  it("a rejected file keeps the draft's saved state, never 'Couldn't save'", () => {
    for (const code of ["validation_failed", "unsupported_file_type", "parse_failed", "payload_too_large", "conflict"]) {
      assert.deepEqual(settleSave(savedBefore, { ok: false, error: { code, retryable: false } }, now), savedBefore, code);
    }
    assert.deepEqual(settleSave({ kind: "saving" }, { ok: false, error: { code: "parse_failed" } }, now), { kind: "saved", at: now });
  });
  it("real failures are still errors", () => {
    for (const code of ["internal", "unauthenticated", "rate_limited"]) {
      assert.equal(settleSave(savedBefore, { ok: false, error: { code } }, now).kind, "error", code);
    }
    assert.equal(settleSave(savedBefore, { ok: false, error: { code: "conflict", retryable: true } }, now).kind, "error");
    assert.equal(settleSave(savedBefore, { ok: false }, now).kind, "error");
  });
});
