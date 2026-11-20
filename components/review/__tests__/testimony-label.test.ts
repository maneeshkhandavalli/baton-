import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { PublishedEvidenceItem } from "@/lib/contracts/dto";

import { inferredBasis, testimonyContext, testimonyLabel, withTestimonyLabels } from "../testimony-label";

const ctx = testimonyContext(
  [{ answers: [{ id: "a1", answererLabel: "Rohan V", text: "The keys are with the front desk. ", status: "accepted", privacyHeld: false, createdAt: "2026-11-20T09:00:00Z" }] }],
  "auda",
);

describe("testimonyLabel (Round 4 audit C2)", () => {
  it("labels an accepted Gap Interview answer as such", () => {
    assert.equal(testimonyLabel({ kind: "testimony", quote: "The keys are with the front desk.", authorLabel: "Rohan V" }, ctx), "Gap Interview answer");
  });
  it("labels the viewer's own statement 'Your statement', never 'Gap Interview answer'", () => {
    assert.equal(testimonyLabel({ kind: "testimony", quote: "I called the dean's office myself.", authorLabel: "auda" }, ctx), "Your statement");
  });
  it("labels another reviewer's statement 'Reviewer statement'", () => {
    assert.equal(testimonyLabel({ kind: "testimony", quote: "I called the dean's office myself.", authorLabel: "kabir" }, ctx), "Reviewer statement");
    assert.equal(testimonyLabel({ kind: "testimony", quote: "x", authorLabel: "auda" }, testimonyContext([], null)), "Reviewer statement");
  });
  it("leaves source quotes alone", () => {
    assert.equal(testimonyLabel({ kind: "source_quote", quote: "x", authorLabel: "auda" }, ctx), undefined);
    const points = [{ evidence: [{ kind: "source_quote" as const, quote: "x", authorLabel: "a" }] }];
    assert.equal(withTestimonyLabels(points as never, ctx)[0], points[0]);
  });
});

describe("inferredBasis (Round 4 audit C6)", () => {
  const t = (over: Partial<Extract<PublishedEvidenceItem, { redacted: false }>> = {}): Extract<PublishedEvidenceItem, { redacted: false }> => ({
    evidenceId: "e1", redacted: false, kind: "testimony", quote: "q", authorLabel: "Rohan V", sentAt: "2026-11-20T09:00:00Z", sourceTitle: null, stance: "supports", authorProfileId: null, ...over,
  });
  it("names the respondent and the answer date instead of 'No source states this outright'", () => {
    assert.equal(inferredBasis([t()]), "Answered by Rohan V on 20 Nov 2026, not taken from a source.");
  });
  it("keeps the old sentence when there is no supporting testimony", () => {
    assert.equal(inferredBasis([]), "No source states this outright.");
    assert.equal(inferredBasis([t({ kind: "source_quote" })]), "No source states this outright.");
    assert.equal(inferredBasis([t({ stance: "contradicts" })]), "No source states this outright.");
  });
});
