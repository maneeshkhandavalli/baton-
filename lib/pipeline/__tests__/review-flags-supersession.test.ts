// Round 4 (audit SECTION-B 4.12, B's check in lib/signals/contradictions.ts): buildReviewFlags passes each point's
// category, so a LATER decision on the same subject becomes a possible_contradiction on the earlier decision.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { PipelinePoint } from "../../db/pipeline";
import type { RetrievalMessage } from "../../signals/contradictions";
import { buildReviewFlags } from "../review-flags";

const msg = (id: string, sentAt: string, authorLabel: string, body: string): RetrievalMessage => ({ id, sourceId: "s1", seq: Number(id.slice(1)), sentAt, authorLabel, body });
const messages: RetrievalMessage[] = [
  msg("m1", "2026-09-05T10:00:00Z", "[PERSON_1]", "We decided the robotics expo is in the main hall."),
  msg("m2", "2026-10-02T10:00:00Z", "[PERSON_2]", "Final: the robotics expo will be in the seminar hall."),
  msg("m3", "2026-10-03T10:00:00Z", "[PERSON_2]", "Lunch for volunteers is sorted."),
];

const point = (over: Partial<PipelinePoint>): PipelinePoint => ({
  pointId: "A",
  category: "decision",
  origin: "manual", // keeps the attribution checks out of this test
  extractionRunId: null,
  extractionAccessLevel: null,
  accessLevel: "everyone",
  evidenceStatus: "sourced",
  reviewState: "pending",
  privacyReview: "none",
  currentRevisionId: "rev-A",
  title: "Robotics expo venue",
  statement: "The robotics expo is in the main hall.",
  attributes: null,
  redacted: false,
  newestEvidenceAt: null,
  lastSupportedAt: null,
  citedMessageIds: ["m1"],
  ...over,
});

describe("buildReviewFlags: decision supersession (4.12)", () => {
  const earlier = point({});
  const later = point({ pointId: "B", currentRevisionId: "rev-B", statement: "The robotics expo will be in the seminar hall.", citedMessageIds: ["m2"] });

  it("flags the earlier decision with the later decision's message, on the earlier point's current revision", () => {
    const flags = buildReviewFlags([earlier, later], messages).filter((f) => f.kind === "possible_contradiction");
    const onA = flags.filter((f) => f.pointId === "A");
    assert.equal(onA.length, 1);
    assert.equal(onA[0].messageId, "m2");
    assert.equal(onA[0].revisionId, "rev-A");
    assert.ok(!flags.some((f) => f.pointId === "B" && f.messageId === "m1"), "an older message never flags the later decision");
  });

  it("a non-decision point with the same wording is not compared as a decision", () => {
    const flags = buildReviewFlags([point({ category: "open_task" }), point({ ...later, category: "open_task" })], messages);
    const strong = flags.filter((f) => f.kind === "possible_contradiction" && f.pointId === "A" && (f.detail as { score: number }).score >= 7);
    assert.equal(strong.length, 0);
  });

  it("an approved earlier decision is not flagged (only pending points are checked)", () => {
    const flags = buildReviewFlags([point({ reviewState: "approved" }), later], messages);
    assert.equal(flags.filter((f) => f.pointId === "A").length, 0);
  });
});
