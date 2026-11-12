// Round 3 UI review (Agent 1, 0117f91): components/shared/key-facts.ts renders date facts for review cards and
// the published handover. `decidedAt` is free text (lib/contracts/schemas.ts: optionalText) written by the
// extractor or by a reviewer's edit, so any string can arrive. QA-R3-12 (fixed by Agent 1 in 8057e21): a
// value shaped like an ISO day but not a real date ("2026-13-45") used to make Intl.DateTimeFormat#format
// throw RangeError (review card and published view fell into the error boundary), and "2026-02-31" was
// silently shown as 3 Mar. HARD since the fix.
import assert from "node:assert/strict";
import { describe, it, type TestContext } from "node:test";

import { buildFirstWeek } from "../../components/published/first-week";
import { keyFacts } from "../../components/shared/key-facts";
import type { PublishedHandover } from "../../lib/contracts/dto";

describe("key facts never break a page on odd attribute values", () => {
  it("valid dates and free text render (control)", () => {
    const facts = keyFacts("decision", { decidedAt: "2026-03-31", decidedByLabel: "Asha" });
    assert.deepEqual(facts.map((f) => f.value), ["31 Mar 2026", "Asha"]);
    assert.equal(keyFacts("decision", { decidedAt: "end of March" })[0].value, "end of March");
    assert.doesNotThrow(() => keyFacts("open_task", { dueDate: "not a date" }));
    assert.doesNotThrow(() => keyFacts("risk", null));
  });

  for (const decidedAt of ["2026-13-45", "2026-00-10", "0000-99-99"]) {
    it(`QA-R3-12: decidedAt ${JSON.stringify(decidedAt)} does not throw`, () => {
      assert.doesNotThrow(() => keyFacts("decision", { decidedAt }));
    });
  }

  it("QA-R3-12: an impossible day is not silently shown as another date", () => {
    const value = keyFacts("decision", { decidedAt: "2026-02-31" })[0]?.value;
    assert.ok(value === "2026-02-31" || !/Mar/.test(value ?? ""), `shown as ${value}`);
  });

  it("QA-R3-12: an invalid due date on a task does not throw either", () => {
    assert.doesNotThrow(() => keyFacts("open_task", { dueDate: "2026-02-30", assigneeLabel: "Ravi" }));
  });
});

// QA-R3-12-R1 (P3, Agent 1, defence in depth): the first-week checklist formats a task's due date with
// components/handover/format.ts#formatDate, which lets V8 roll an impossible day over ("2026-02-30" → 2 Mar)
// and reads bare words as dates in 2001 ("March 5" → 5 Mar 2001). dueDate is z.iso.date() when written, but
// published attributes are not re-validated on read (lib/db/mappers.ts mapPublishedHandover). Use
// formatDayOrRaw there. PENDING until fixed; prints NOW HOLDS then.
function pendingUntilFixed(t: TestContext, finding: string, check: () => void): void {
  try {
    check();
    t.diagnostic(`NOW HOLDS ${finding}: make this a hard assertion (tests/integration/r3-key-facts.test.ts)`);
  } catch (error) {
    t.todo(`open ${finding}: ${error instanceof Error ? error.message.split("\n")[0] : String(error)}`);
  }
}

describe("first-week checklist due dates", () => {
  const handoverWithDue = (dueDate: string) =>
    ({
      sections: [{ category: "open_task", points: [{ id: "p1", content: { title: "Renew domain", statement: "", attributes: { dueDate, assigneeLabel: "Ravi" }, isKnownGap: false } }] }],
    }) as unknown as PublishedHandover;
  const detail = (dueDate: string) => buildFirstWeek(handoverWithDue(dueDate)).flatMap((d) => d.items)[0]?.detail ?? "";

  it("a valid due date is shown as a day (control)", () => {
    assert.equal(detail("2026-11-30"), "Due 30 Nov 2026");
  });

  for (const [dueDate, wrong] of [["2026-02-30", /Mar/], ["March 5", /2001/]] as const) {
    it(`QA-R3-12-R1 (pending): due date ${JSON.stringify(dueDate)} is not shown as another date`, (t) => {
      pendingUntilFixed(t, "QA-R3-12-R1", () => assert.doesNotMatch(detail(dueDate), wrong, `shown as "${detail(dueDate)}"`));
    });
  }
});
