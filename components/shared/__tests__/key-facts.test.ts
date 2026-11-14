import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { formatDayOrRaw, keyFacts, validIsoDay } from "../key-facts";

describe("keyFacts: decisions and action items are scannable", () => {
  it("open task: assignee, due date and status", () => {
    const f = keyFacts("open_task", { assigneeLabel: "Neha", dueDate: "2026-11-20", progressNote: "Venue booked" });
    assert.deepEqual(
      f.map((x) => [x.label, x.value, x.tone]),
      [
        ["Assignee", "Neha", "neutral"],
        ["Due", "20 Nov 2026", "neutral"],
        ["Status", "In progress", "neutral"],
      ],
    );
  });

  it("calls out unassigned, undated and overdue work", () => {
    const f = keyFacts("open_task", { assigneeLabel: null, dueDate: "2026-11-01", progressNote: null }, "2026-11-12");
    assert.equal(f[0].value, "Unassigned");
    assert.equal(f[0].tone, "warning");
    assert.equal(f[1].tone, "danger");
    assert.equal(f[2].value, "Open");
    assert.equal(keyFacts("next_action", { actorLabel: null, byWhen: null })[1].value, "No date");
  });

  it("never flags overdue without a stable 'today'", () => {
    assert.equal(keyFacts("open_task", { dueDate: "2020-01-01" })[1].tone, "neutral");
  });

  it("decision: when and by whom; empty values are skipped", () => {
    assert.deepEqual(
      keyFacts("decision", { decidedAt: "2026-09-02", decidedByLabel: "Core team", rationale: "x", alternativesConsidered: [] }).map((x) => x.label),
      ["Decided", "By"],
    );
    assert.deepEqual(keyFacts("decision", { decidedAt: null, decidedByLabel: null }), []);
  });

  it("tolerates missing attributes", () => {
    assert.deepEqual(keyFacts("dependency", null), []);
  });
});

describe("QA-R3-12: invalid date-like values never throw", () => {
  it("rejects impossible calendar days and shows the raw text", () => {
    assert.equal(validIsoDay("2026-13-45"), null);
    assert.equal(validIsoDay("2026-02-31"), null);
    assert.equal(validIsoDay("2024-02-29"), "2024-02-29");
    assert.equal(formatDayOrRaw("2026-13-45"), "2026-13-45");
    assert.equal(formatDayOrRaw("2026-02-31"), "2026-02-31");
    assert.equal(formatDayOrRaw("next Friday"), "next Friday");
    assert.equal(formatDayOrRaw(null), null);
  });
  it("key facts render raw text instead of crashing", () => {
    assert.doesNotThrow(() => keyFacts("decision", { decidedAt: "2026-13-45" }));
    assert.equal(keyFacts("decision", { decidedAt: "2026-13-45" })[0].value, "2026-13-45");
    const due = keyFacts("open_task", { dueDate: "2026-02-31" }, "2026-11-12")[1];
    assert.equal(due.value, "2026-02-31");
    assert.equal(due.tone, "warning");
  });
});
