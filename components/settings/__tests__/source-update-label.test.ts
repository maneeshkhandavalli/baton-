import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

import { sourceUpdateStateLabel } from "@/lib/contracts/source-versions";

// Round 4 audit B2 / F8: Settings said "nothing left to decide" while the Processing page said "6 changes need a
// decision", because it never passed the open-review count. Static wiring check (the settings view is .tsx).
describe("Settings source update label", () => {
  it("passes the version's open-review count, like the Processing page", () => {
    const view = readFileSync(join(process.cwd(), "components/settings/handover-settings.tsx"), "utf8");
    assert.match(view, /sourceUpdateStateLabel\(s\.version\.updateState, s\.version\.updateError \?\? null, s\.version\.openReviews \?\? 0\)/);
  });

  it("says how many changes still need a decision", () => {
    assert.equal(sourceUpdateStateLabel("ready", null, 6), "processed and checked; 6 changes need a decision");
    assert.equal(sourceUpdateStateLabel("ready", null, 0), "processed and checked; nothing left to decide");
  });
});
