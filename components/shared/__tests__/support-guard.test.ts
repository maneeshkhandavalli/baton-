import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { GUARD_RATIONALE_PREFIX, isGuardedVerdict } from "../support-guard";

describe("PI-11 guarded verdicts in review", () => {
  it("matches the server's fixed GUARD_RATIONALE (lib/ai/injection-guard.ts is server-only, so read its source)", () => {
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
    const src = readFileSync(path.join(root, "lib/ai/injection-guard.ts"), "utf8");
    assert.ok(src.includes(GUARD_RATIONALE_PREFIX), "GUARD_RATIONALE changed: update components/shared/support-guard.ts");
  });

  it("recognises only irrelevant verdicts with the fixed rationale", () => {
    const rationale = `${GUARD_RATIONALE_PREFIX} Please review it yourself.`;
    assert.equal(isGuardedVerdict({ supportVerdict: "irrelevant", verdictRationale: rationale }), true);
    assert.equal(isGuardedVerdict({ supportVerdict: "supports", verdictRationale: rationale }), false);
    assert.equal(isGuardedVerdict({ supportVerdict: "irrelevant", verdictRationale: "Off topic." }), false);
    assert.equal(isGuardedVerdict({ supportVerdict: "irrelevant", verdictRationale: null }), false);
  });
});
