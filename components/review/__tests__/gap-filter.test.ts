import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { gapFilterModel } from "../gap-filter";

const pt = (id: string, evidenceStatus: "sourced" | "inferred" | "conflicting" | "missing" = "sourced", reviewState: "pending" | "approved" | "rejected" = "pending") => ({ id, evidenceStatus, reviewState });
const q = (pointId: string | null, priority: "required" | "optional" = "required", status: "open" | "answered" | "waived" = "open") => ({ pointId, priority, status });

describe("gapFilterModel (Round 4 audit C3)", () => {
  it("counts points with open required gap questions, so the filter agrees with the readiness blocker", () => {
    const points = [pt("a"), pt("b", "inferred"), pt("c")];
    const questions = [q("a"), q("b")];
    const readiness = { blockers: [{ kind: "open_required_gaps" as const, count: 2, pointIds: ["a", "b"] }] };
    const m = gapFilterModel(points, questions, readiness);
    assert.deepEqual([...m.pointIds].sort(), ["a", "b"]);
    assert.equal(m.openRequired, 2);
    assert.equal(m.unattachedRequired, 0);
  });

  it("keeps points with missing evidence and leaves rejected points out", () => {
    const m = gapFilterModel([pt("a", "missing"), pt("b", "missing", "rejected"), pt("c")], [q("c", "required", "answered")], null);
    assert.deepEqual([...m.pointIds], ["a"]);
    assert.equal(m.openRequired, 0);
  });

  it("reports required questions that are not attached to any point", () => {
    const m = gapFilterModel([pt("a")], [q(null), q(null), q("a", "optional")], { blockers: [{ kind: "open_required_gaps", count: 2, pointIds: [] }] });
    assert.deepEqual([...m.pointIds], ["a"]);
    assert.equal(m.openRequired, 2);
    assert.equal(m.unattachedRequired, 2);
  });
});
