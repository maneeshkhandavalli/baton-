// Decision timeline (docs/product/decision-timeline-plan.md, audit amendments 4-6, 11): the pure model behind
// components/timeline/handover-timeline.tsx. The server-render smoke lives in
// tests/integration/r3-render-determinism.test.ts (test:ui does not transpile .tsx).
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { formatMonthYear, monthKey } from "@/components/handover/format";
import type { PublishedEvidenceItem, PublishedHandover, PublishedPointContent } from "@/lib/contracts/dto";
import type { PointCategory } from "@/lib/contracts/enums";

import { buildTimeline, filterTimeline } from "../build-timeline";

let seq = 0;
function quote(sentAt: string | null, stance: "supports" | "contradicts" = "supports", kind: "source_quote" | "testimony" = "source_quote"): PublishedEvidenceItem {
  seq += 1;
  return { evidenceId: `e${seq}`, redacted: false, kind, quote: `quote ${seq}`, authorLabel: "[PERSON_1]", sentAt, sourceTitle: "chat.txt", stance, authorProfileId: null };
}
const redacted = (): PublishedEvidenceItem => ({ evidenceId: `r${++seq}`, redacted: true });

function content(evidence: PublishedEvidenceItem[], over: Partial<PublishedPointContent> = {}): PublishedPointContent {
  return {
    title: "T",
    statement: "S",
    attributes: {} as PublishedPointContent["attributes"],
    evidenceStatus: "sourced",
    isPotentiallyOutdated: false,
    isKnownGap: false,
    inferredConfirmation: null,
    conflictResolution: null,
    evidence,
    evidenceRedacted: evidence.some((e) => e.redacted),
    ...over,
  };
}

function handover(points: Array<{ id: string; category: PointCategory; content: PublishedPointContent }>): PublishedHandover {
  const categories = [...new Set(points.map((p) => p.category))];
  return {
    handoverId: "h1",
    title: "Handover",
    teamName: "Team",
    roleTitle: null,
    publicationId: "pub1",
    version: 1,
    publishedAt: "2026-04-30T10:00:00Z",
    publishedByLabel: "Priya",
    summary: null,
    sections: categories.map((category) => ({ category, points: points.filter((p) => p.category === category).map(({ id, content }) => ({ id, content })) })),
    viewerAcknowledgedAt: null,
  };
}

const ids = (h: PublishedHandover) => buildTimeline(h).groups.map((g) => [g.key, g.entries.map((e) => e.id)] as const);

describe("format: month helpers in India time", () => {
  it("monthKey and formatMonthYear follow Asia/Kolkata, not UTC or the host", () => {
    // 20:00Z on 31 Mar is 01:30 on 1 Apr in India.
    assert.equal(monthKey("2026-03-31T20:00:00Z"), "2026-04");
    assert.equal(formatMonthYear("2026-03-31T20:00:00Z"), "April 2026");
    assert.equal(monthKey("2026-03-31T18:29:00Z"), "2026-03");
    assert.equal(formatMonthYear("2026-09-02T11:00:00Z"), "September 2026");
    assert.equal(monthKey(null), null);
    assert.equal(monthKey("not a date"), null);
  });
});

describe("buildTimeline", () => {
  it("orders by anchor date, then section order, then point id (stable ties)", () => {
    const t = "2026-03-10T05:00:00Z";
    const h = handover([
      { id: "b", category: "decision", content: content([quote(t)]) },
      { id: "a", category: "decision", content: content([quote(t)]) },
      { id: "risk", category: "risk", content: content([quote(t)]) },
      { id: "owner", category: "owner", content: content([quote(t)]) },
      { id: "early", category: "contact", content: content([quote("2026-03-02T05:00:00Z")]) },
    ]);
    assert.deepEqual(ids(h), [["2026-03", ["early", "a", "b", "owner", "risk"]]]);
    // Same input in another section order gives the same output.
    assert.deepEqual(ids({ ...h, sections: [...h.sections].reverse() }), ids(h));
  });

  it("anchors on the EARLIEST supporting quote (time, not string order) and keeps the latest as lastSeenAt", () => {
    const h = handover([
      // "+05:30" sorts after "Z" as a string but is earlier in time
      { id: "p", category: "decision", content: content([quote("2026-03-05T04:00:00Z"), quote("2026-03-05T09:00:00+05:30"), quote("2026-03-20T04:00:00Z", "supports", "testimony")]) },
    ]);
    const [entry] = buildTimeline(h).groups[0].entries;
    assert.equal(entry.anchorAt, "2026-03-05T09:00:00+05:30");
    assert.equal(entry.lastSeenAt, "2026-03-20T04:00:00Z");
  });

  it("puts points without a dated supporting quote in Undated, never inventing a date", () => {
    const h = handover([
      { id: "doc", category: "decision", content: content([quote(null)]) },
      { id: "none", category: "owner", content: content([]) },
      { id: "dated", category: "risk", content: content([quote("2026-05-01T05:00:00Z")]) },
    ]);
    const groups = buildTimeline(h).groups;
    assert.deepEqual(groups.map((g) => g.key), ["2026-05", "undated"]);
    assert.deepEqual(groups[1].entries.map((e) => [e.id, e.anchorAt]), [["doc", null], ["none", null]]);
  });

  it("ignores redacted evidence for dates and never exposes it", () => {
    const h = handover([{ id: "p", category: "decision", content: content([quote("2026-06-01T05:00:00Z"), redacted(), redacted()]) }]);
    const [g] = buildTimeline(h).groups;
    const [e] = g.entries;
    assert.equal(e.anchorAt, "2026-06-01T05:00:00Z");
    assert.equal(e.redactedCount, 2);
    assert.ok(e.evidence.every((x) => x.redacted === false));
    // All evidence redacted: undated, with the count kept for the removal note.
    const all = buildTimeline(handover([{ id: "q", category: "decision", content: content([redacted()]) }]));
    assert.deepEqual(all.groups.map((x) => x.key), ["undated"]);
    assert.deepEqual(all.groups[0].entries[0].evidence, []);
  });

  it("passes textRedacted content through unchanged (the privacy SQL already replaced the text)", () => {
    const h = handover([{ id: "p", category: "decision", content: content([quote("2026-06-01T05:00:00Z")], { textRedacted: true, title: "[REDACTED]", statement: "[REDACTED]" }) }]);
    const [e] = buildTimeline(h).groups[0].entries;
    assert.equal(e.content.textRedacted, true);
    assert.equal(e.content.title, "[REDACTED]");
  });

  it("marks conflicts with both stances' dates; contradicting dates never anchor", () => {
    const h = handover([
      { id: "c", category: "decision", content: content([quote("2026-04-02T05:00:00Z", "contradicts"), quote("2026-03-03T05:00:00Z")], { evidenceStatus: "conflicting" }) },
      { id: "only-contra", category: "decision", content: content([quote("2026-01-01T05:00:00Z", "contradicts")]) },
      { id: "calm", category: "decision", content: content([quote("2026-03-04T05:00:00Z")]) },
      { id: "status-only", category: "risk", content: content([quote("2026-03-05T05:00:00Z")], { evidenceStatus: "conflicting" }) },
    ]);
    const m = buildTimeline(h);
    assert.deepEqual(m.groups.map((g) => [g.key, g.entries.map((e) => e.id)]), [
      ["2026-03", ["c", "calm", "status-only"]],
      ["undated", ["only-contra"]],
    ]);
    const c = m.groups[0].entries[0];
    assert.equal(c.anchorAt, "2026-03-03T05:00:00Z");
    assert.deepEqual(c.conflict, { supportsAt: ["2026-03-03T05:00:00Z"], contradictsAt: ["2026-04-02T05:00:00Z"] });
    assert.equal(m.groups[0].entries[1].conflict, null);
    assert.deepEqual(m.groups[0].entries[2].conflict, { supportsAt: ["2026-03-05T05:00:00Z"], contradictsAt: [] });
    assert.deepEqual(m.groups[1].entries[0].conflict, { supportsAt: [], contradictsAt: ["2026-01-01T05:00:00Z"] });
  });

  it("never orders by dueDate (a label only)", () => {
    const h = handover([
      { id: "late-due", category: "open_task", content: content([quote("2026-03-01T05:00:00Z")], { attributes: { assigneeLabel: null, dueDate: "2026-12-31", progressNote: null } }) },
      { id: "early-due", category: "open_task", content: content([quote("2026-03-02T05:00:00Z")], { attributes: { assigneeLabel: null, dueDate: "2026-01-01", progressNote: null } }) },
    ]);
    assert.deepEqual(ids(h), [["2026-03", ["late-due", "early-due"]]]);
  });

  it("groups by India-time month across a year boundary, then Open questions, then Undated", () => {
    const h = handover([
      { id: "jan", category: "decision", content: content([quote("2026-01-03T05:00:00Z")]) },
      { id: "nye-ist", category: "decision", content: content([quote("2025-12-31T19:00:00Z")]) }, // 00:30 on 1 Jan 2026 IST
      { id: "dec", category: "decision", content: content([quote("2025-12-31T18:00:00Z")]) }, // 23:30 on 31 Dec 2025 IST
      { id: "gap", category: "owner", content: content([], { isKnownGap: true, evidenceStatus: "missing" }) },
      { id: "dated-gap", category: "risk", content: content([quote("2025-11-01T05:00:00Z")], { isKnownGap: true }) },
      { id: "undated", category: "contact", content: content([]) },
    ]);
    const m = buildTimeline(h);
    assert.deepEqual(m.groups.map((g) => [g.key, g.label, g.entries.map((e) => e.id)]), [
      ["2025-12", "December 2025", ["dec"]],
      ["2026-01", "January 2026", ["nye-ist", "jan"]],
      ["open-questions", "Open questions", ["dated-gap", "gap"]],
      ["undated", "Undated", ["undated"]],
    ]);
    assert.equal(m.total, 6);
  });

  it("handles empty sections and an empty publication", () => {
    const empty = buildTimeline(handover([]));
    assert.deepEqual(empty, { groups: [], total: 0, sections: [] });
    const withEmpty = { ...handover([{ id: "p", category: "risk", content: content([quote("2026-03-01T05:00:00Z")]) }]) };
    withEmpty.sections.push({ category: "decision", points: [] });
    assert.deepEqual(buildTimeline(withEmpty).sections, [{ id: "risks", label: "Risks & dependencies", count: 1 }]);
  });

  it("filters by HANDOVER_SECTIONS group and drops groups left empty", () => {
    const h = handover([
      { id: "d", category: "decision", content: content([quote("2026-03-01T05:00:00Z")]) },
      { id: "t", category: "open_task", content: content([quote("2026-04-01T05:00:00Z")]) },
      { id: "n", category: "next_action", content: content([]) },
    ]);
    const m = buildTimeline(h);
    assert.deepEqual(m.sections.map((s) => [s.id, s.count]), [["decisions", 1], ["open_work", 2]]);
    assert.deepEqual(filterTimeline(m, "all"), m.groups);
    assert.deepEqual(filterTimeline(m, "open_work").map((g) => [g.key, g.entries.map((e) => e.id)]), [["2026-04", ["t"]], ["undated", ["n"]]]);
    assert.deepEqual(filterTimeline(m, "contacts"), []);
  });
});

describe("Round 4 audit C5: accepted testimony on the first publication", () => {
  it("an inferred point whose only evidence is a dated testimony is dated, not Undated", () => {
    const h = handover([
      { id: "gap", category: "blocker", content: content([quote("2026-11-20T09:00:00Z", "supports", "testimony")], { evidenceStatus: "inferred" }) },
      { id: "old", category: "decision", content: content([quote("2026-09-05T09:00:00Z")]) },
    ]);
    assert.deepEqual(ids(h), [
      ["2026-09", ["old"]],
      ["2026-11", ["gap"]],
    ]);
  });
});
