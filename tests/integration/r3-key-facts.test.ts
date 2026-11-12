// Round 3 UI review (Agent 1, 0117f91): components/shared/key-facts.ts renders date facts for review cards and
// the published handover. `decidedAt` is free text (lib/contracts/schemas.ts: optionalText) written by the
// extractor or by a reviewer's edit, so any string can arrive. QA-R3-12 (P2, owner Agent 1): a value shaped
// like an ISO day but not a real date ("2026-13-45") makes Intl.DateTimeFormat#format throw RangeError,
// which takes down the review card and the incoming member's published view (route error boundary); an
// impossible day ("2026-02-31") is silently shown as 3 Mar. PENDING until fixed; prints NOW HOLDS then.
import assert from "node:assert/strict";
import { describe, it, type TestContext } from "node:test";

import { keyFacts } from "../../components/shared/key-facts";

function pendingUntilFixed(t: TestContext, finding: string, check: () => void): void {
  try {
    check();
    t.diagnostic(`NOW HOLDS ${finding}: make this a hard assertion (tests/integration/r3-key-facts.test.ts)`);
  } catch (error) {
    t.todo(`open ${finding}: ${error instanceof Error ? error.message.split("\n")[0] : String(error)}`);
  }
}

describe("key facts never break a page on odd attribute values", () => {
  it("valid dates and free text render (control, hard)", () => {
    const facts = keyFacts("decision", { decidedAt: "2026-03-31", decidedByLabel: "Asha" });
    assert.deepEqual(facts.map((f) => f.value), ["31 Mar 2026", "Asha"]);
    assert.equal(keyFacts("decision", { decidedAt: "end of March" })[0].value, "end of March");
    assert.doesNotThrow(() => keyFacts("open_task", { dueDate: "not a date" }));
    assert.doesNotThrow(() => keyFacts("risk", null));
  });

  for (const decidedAt of ["2026-13-45", "2026-00-10", "0000-99-99"]) {
    it(`QA-R3-12 (pending): decidedAt ${JSON.stringify(decidedAt)} does not throw`, (t) => {
      pendingUntilFixed(t, "QA-R3-12", () => assert.doesNotThrow(() => keyFacts("decision", { decidedAt })));
    });
  }

  it("QA-R3-12 (pending): an impossible day is not silently shown as another date", (t) => {
    pendingUntilFixed(t, "QA-R3-12", () => {
      const value = keyFacts("decision", { decidedAt: "2026-02-31" })[0]?.value;
      assert.ok(value === "2026-02-31" || !/Mar/.test(value ?? ""), `shown as ${value}`);
    });
  });
});
