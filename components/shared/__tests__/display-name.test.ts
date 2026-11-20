import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

import { checkDisplayName } from "../../account/display-name";

// Round 4 audit D1: optional display names (mirrors set_own_display_name, 20261121300200).
describe("display name", () => {
  it("normalises spaces and accepts ordinary names", () => {
    assert.deepEqual(checkDisplayName("  Ananya   Rao "), { ok: true, name: "Ananya Rao" });
    assert.deepEqual(checkDisplayName("Rohan V."), { ok: true, name: "Rohan V." });
  });
  it("refuses empty, too long, bracketed (token-like), control characters and the reserved name", () => {
    for (const bad of ["", "   ", "x".repeat(61), "[PERSON_1]", "a\u0007b", "Former Member", 42]) {
      assert.equal(checkDisplayName(bad).ok, false, JSON.stringify(bad));
    }
  });
  it("the action refuses demo accounts before any database call", () => {
    const action = readFileSync(join(process.cwd(), "app/(workspace)/account/display-name-actions.ts"), "utf8");
    assert.ok(action.indexOf("isDemoAccountEmail(actor.email)") < action.indexOf('callRpc(serverDb(), "set_own_display_name"'));
  });
});
