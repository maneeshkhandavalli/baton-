// Round 4 B (audit SECTION-B 4.12): a later decision that supersedes an earlier one is flagged as a possible
// contradiction, conservatively. Deterministic and lexical only: this is not a model, and recall stays limited.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { findContradictionCandidates, type RetrievalMessage, type RetrievalPoint } from "../contradictions";
import { detectMessageSignals } from "../detect";

const msg = (id: string, sentAt: string, authorLabel: string, body: string): RetrievalMessage => ({ id, sourceId: "s1", seq: Number(id.slice(1)), sentAt, authorLabel, body });

const messages: RetrievalMessage[] = [
  msg("m1", "2026-09-05T10:00:00Z", "Rohan", "We decided the robotics expo is in the main hall."),
  msg("m2", "2026-10-02T10:00:00Z", "Sana", "Final: the robotics expo will be in the seminar hall."),
  msg("m3", "2026-10-03T10:00:00Z", "Sana", "Lunch for volunteers is sorted."),
];

const pointA: RetrievalPoint = {
  pointId: "A",
  category: "decision",
  title: "Robotics expo venue",
  statement: "The robotics expo is in the main hall.",
  attributes: null,
  citedMessageIds: ["m1"],
};
const pointB: RetrievalPoint = {
  pointId: "B",
  category: "decision",
  title: "Robotics expo venue",
  statement: "The robotics expo will be in the seminar hall.",
  attributes: null,
  citedMessageIds: ["m2"],
};

describe("decision supersession (4.12)", () => {
  it("flags the earlier decision with the later decision's message", () => {
    const c = findContradictionCandidates([pointA, pointB], messages);
    const a = c.filter((x) => x.pointId === "A");
    assert.equal(a.length, 1);
    assert.equal(a[0].messageId, "m2");
    assert.ok(a[0].reasons.includes("decision_marker"));
    assert.ok(a[0].reasons.includes("shared_topic"));
    assert.ok(!c.some((x) => x.pointId === "B" && x.messageId === "m1"), "the later decision is never flagged by an older message");
  });

  it("without a category (old callers) the result is unchanged", () => {
    const strip = (p: RetrievalPoint): RetrievalPoint => ({ ...p, category: undefined });
    const withCat = findContradictionCandidates([strip(pointA), strip(pointB)], messages);
    assert.ok(!withCat.some((x) => x.pointId === "A" && x.messageId === "m2" && x.reasons.includes("decision_marker") && x.score >= 7));
  });

  it("does not flag decisions on different subjects (one shared word)", () => {
    const budget: RetrievalPoint = { ...pointB, pointId: "C", title: "Catering budget", statement: "Final catering budget for the expo stays with Sana.", citedMessageIds: ["m2"] };
    const c = findContradictionCandidates([pointA, budget], messages);
    assert.ok(!c.some((x) => x.pointId === "A" && x.messageId === "m2" && x.reasons.includes("shared_topic") && x.score >= 6));
  });

  it("does not flag a later message without a decision or reversal marker or a changed date or amount", () => {
    const plain: RetrievalMessage[] = [messages[0], msg("m2", "2026-10-02T10:00:00Z", "Sana", "The robotics expo seminar hall looks nice."), messages[2]];
    const c = findContradictionCandidates([pointA, { ...pointB, statement: "The robotics expo seminar hall looks nice." }], plain);
    assert.equal(c.filter((x) => x.pointId === "A").length, 0);
  });

  it("does not treat a duplicate of the same claim as a change", () => {
    const dup: RetrievalPoint = { ...pointA, pointId: "D", citedMessageIds: ["m2"] };
    const c = findContradictionCandidates([pointA, dup], messages);
    assert.ok(!c.some((x) => x.pointId === "A" && x.reasons.includes("decision_marker") && x.score >= 7));
  });

  it("flags a changed amount between two decisions", () => {
    const ms = [
      msg("m1", "2026-09-05T10:00:00Z", "Rohan", "We decided to keep the reserve fund at Rs 5000."),
      msg("m2", "2026-10-02T10:00:00Z", "Sana", "Reserve fund is now Rs 8000 for the season."),
    ];
    const p1: RetrievalPoint = { pointId: "R1", category: "decision", title: "Reserve fund", statement: "The reserve fund is kept at Rs 5000.", attributes: null, citedMessageIds: ["m1"] };
    const p2: RetrievalPoint = { pointId: "R2", category: "decision", title: "Reserve fund", statement: "The reserve fund is Rs 8000.", attributes: null, citedMessageIds: ["m2"] };
    const c = findContradictionCandidates([p1, p2], ms);
    assert.ok(c.some((x) => x.pointId === "R1" && x.messageId === "m2" && x.reasons.includes("changed_amount")));
  });
});

describe("reversal phrases (4.12)", () => {
  it("detects 'moves to', 'shifted to', 'replaced by' and 'from now on'", () => {
    for (const body of ["The expo moves to the seminar hall.", "Venue shifted to block C.", "Arjun is replaced by Sana for sponsor emails.", "From now on Sana handles it."]) {
      assert.ok(detectMessageSignals({ id: "x", body }).some((s) => s.kind === "reversal"), body);
    }
  });
});

// Browser verification (Living Handover, notes.md v2): a budget update that mentions "sponsor" once was flagged as a
// possible contradiction of an unrelated owner point. One shared topic word plus a reversal marker is not a subject match.
describe("one shared topic word is not the same subject (regression)", () => {
  const doc = (id: string, seq: number, body: string): RetrievalMessage => ({ id, sourceId: "cmp", seq, sentAt: null, authorLabel: null, body });
  const ownerAnchor = doc("d1", 0, "The sponsorship lead handles the renewal call with the local bookshop sponsor.");
  const budgetAnchor = doc("d2", 1, "The approved fest budget is 50000 rupees.");
  const update = doc("d3", 2, "Update: the approved budget is now 60000 rupees for the fest, replaced by the new sponsor money.");
  const owner: RetrievalPoint = {
    pointId: "OWNER",
    category: "owner",
    title: "Sponsorship renewal call",
    statement: "The sponsorship lead handles the renewal call with the local bookshop sponsor.",
    attributes: { ownerLabel: "The sponsorship lead", responsibility: "Renewal call with the local bookshop sponsor" },
    citedMessageIds: ["d1"],
  };
  const budget: RetrievalPoint = {
    pointId: "BUDGET",
    category: "decision",
    title: "Fest budget",
    statement: "The fest budget is 50000 rupees.",
    attributes: null,
    citedMessageIds: ["d2"],
  };

  it("does not flag the owner point with the budget update", () => {
    assert.ok(detectMessageSignals({ id: "d3", body: update.body }).some((s) => s.kind === "reversal"), "the update has a reversal marker");
    const c = findContradictionCandidates([owner, budget], [ownerAnchor, budgetAnchor, update]);
    assert.deepEqual(c.filter((x) => x.pointId === "OWNER"), []);
  });

  it("still flags the budget point the update really changes", () => {
    const c = findContradictionCandidates([owner, budget], [ownerAnchor, budgetAnchor, update]);
    const b = c.filter((x) => x.pointId === "BUDGET" && x.messageId === "d3");
    assert.equal(b.length, 1);
    assert.ok(b[0].reasons.includes("changed_amount"));
    assert.ok(b[0].reasons.includes("reversal_marker"));
  });

  it("a single shared word with a shared concrete fact (the same amount) can still be a candidate", () => {
    const fee: RetrievalPoint = { ...owner, pointId: "FEE", title: "Sponsor fee", statement: "The sponsor fee is 60000 rupees.", attributes: null, citedMessageIds: ["d1"] };
    const later = doc("d4", 3, "From now on the 60000 rupees go to the bank.");
    const c = findContradictionCandidates([fee], [ownerAnchor, later]);
    assert.ok(c.some((x) => x.pointId === "FEE" && x.messageId === "d4" && x.reasons.includes("shared_amount")));
  });
});
