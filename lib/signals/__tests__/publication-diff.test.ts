// Round 4 B (audit E2): "What changed since vN" between two published snapshots.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { PublishedHandover, PublishedPointContent } from "../../contracts/dto";
import type { EvidenceStatus, PointCategory } from "../../contracts/enums";
import { diffPublications, hasChanges } from "../publication-diff";

const content = (title: string, over: Partial<PublishedPointContent> = {}): PublishedPointContent => ({
  title,
  statement: `${title} statement`,
  attributes: {} as PublishedPointContent["attributes"],
  evidenceStatus: "sourced" as EvidenceStatus,
  isPotentiallyOutdated: false,
  isKnownGap: false,
  inferredConfirmation: null,
  conflictResolution: null,
  evidence: [],
  evidenceRedacted: false,
  ...over,
});

function pub(version: number, points: Array<{ id: string; category: PointCategory; content: PublishedPointContent }>): PublishedHandover {
  const cats = [...new Set(points.map((p) => p.category))];
  return {
    handoverId: "h",
    title: "T",
    teamName: "Team",
    roleTitle: null,
    publicationId: `pub-${version}`,
    version,
    publishedAt: `2026-11-${10 + version}T10:00:00Z`,
    publishedByLabel: "Ann",
    summary: null,
    sections: cats.map((category) => ({ category, points: points.filter((p) => p.category === category).map(({ id, content }) => ({ id, content })) })),
    viewerAcknowledgedAt: null,
  };
}

describe("diffPublications", () => {
  const v1 = pub(1, [
    { id: "a", category: "decision", content: content("Expo in the main hall") },
    { id: "b", category: "contact", content: content("[PERSON_2] runs the Dean office", { evidenceStatus: "inferred" }) },
    { id: "c", category: "risk", content: content("Sponsor emails") },
    { id: "d", category: "owner", content: content("Reserve kept at 5000") },
  ]);

  it("reports added, removed, reworded and status changes, and counts unchanged points", () => {
    const v2 = pub(2, [
      { id: "a", category: "decision", content: content("Expo in the seminar hall") },
      { id: "b", category: "contact", content: content("[PERSON_2] runs the Dean office", { evidenceStatus: "sourced" }) },
      { id: "c", category: "risk", content: content("Sponsor emails") },
      { id: "e", category: "open_task", content: content("Book the bus") },
    ]);
    const d = diffPublications(v1, v2);
    assert.equal(d.fromVersion, 1);
    assert.equal(d.toVersion, 2);
    assert.deepEqual(d.added.map((x) => x.pointId), ["e"]);
    assert.deepEqual(d.removed.map((x) => x.pointId), ["d"]);
    const a = d.changed.find((x) => x.pointId === "a")!;
    assert.deepEqual(a.kinds, ["reworded"]);
    assert.equal(a.previousTitle, "Expo in the main hall");
    const b = d.changed.find((x) => x.pointId === "b")!;
    assert.deepEqual(b.kinds, ["status"]);
    assert.equal(b.fromStatus, "inferred");
    assert.equal(b.toStatus, "sourced");
    assert.equal(d.unchangedCount, 1);
    assert.equal(hasChanges(d), true);
  });

  it("flags a fact that became an open question (the F4 symptom) and one that was answered", () => {
    const v2 = pub(2, [
      { id: "a", category: "decision", content: content("Expo in the main hall", { isKnownGap: true, evidenceStatus: "missing" }) },
      { id: "b", category: "contact", content: content("[PERSON_2] runs the Dean office", { evidenceStatus: "inferred" }) },
      { id: "c", category: "risk", content: content("Sponsor emails") },
      { id: "d", category: "owner", content: content("Reserve kept at 5000") },
    ]);
    const d = diffPublications(v1, v2);
    assert.deepEqual(d.changed.map((x) => [x.pointId, x.kinds]), [["a", ["became_gap"]]]);
    const back = diffPublications(v2, { ...v1, version: 3 });
    assert.deepEqual(back.changed.map((x) => [x.pointId, x.kinds]), [["a", ["gap_answered"]]]);
  });

  it("an identical republication has no changes; attribute key order does not matter", () => {
    const withAttrs = (o: Record<string, unknown>) => content("Owner", { attributes: o as PublishedPointContent["attributes"] });
    const x = pub(1, [{ id: "o", category: "owner", content: withAttrs({ responsibility: "Bank", personLabel: "Asha" }) }]);
    const y = pub(2, [{ id: "o", category: "owner", content: withAttrs({ personLabel: "Asha", responsibility: "Bank" }) }]);
    const d = diffPublications(x, y);
    assert.equal(hasChanges(d), false);
    assert.equal(d.unchangedCount, 1);
  });

  it("keeps masked titles masked (the UI renders them with MaskedText)", () => {
    const v2 = pub(2, [...v1.sections.flatMap((s) => s.points.map((p) => ({ ...p, category: s.category }))), { id: "z", category: "contact", content: content("[PERSON_4] handles sponsors") }]);
    const d = diffPublications(v1, v2);
    assert.equal(d.added[0].title, "[PERSON_4] handles sponsors");
  });
});
