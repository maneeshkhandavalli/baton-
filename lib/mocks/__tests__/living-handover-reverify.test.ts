// Round 4 B (audit F4): mock parity for the re-verification scope and "Confirm & approve"
// (database: migration 20261121200100, SQL test 99_living_handover_reverify_scope.sql).
import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";

import { confirmTestimonyAndApprove } from "../testimony";
import { CODECELL_ID } from "../fixtures/codecell";
import { PROFILES } from "../fixtures/profiles";
import { currentRevision, pointStatus, settleReverification } from "../derive";
import { getStore } from "../store";
import type { MockLink, MockPoint } from "../types";
import { expectError, expectOk, resetStore, signInAs } from "./helpers";

function codecellPoint(): MockPoint {
  const p = getStore().points.find((x) => x.handoverId === CODECELL_ID && x.links.some((l) => l.kind === "source_quote" && !l.excluded));
  assert.ok(p, "fixture: a Codecell point with a source quote");
  return p;
}

function testimony(p: MockPoint, over: Partial<MockLink> = {}): MockLink {
  const l: MockLink = {
    pointEvidenceId: `pe-${p.links.length}`,
    evidenceId: `ev-${p.links.length}`,
    kind: "testimony",
    quote: "I spoke to the Dean office myself last week.",
    authorLabel: "Priya",
    sentAt: null,
    sourceId: null,
    location: null,
    quoteCheck: "exact",
    supportVerdict: "irrelevant",
    verdictRationale: "Test adapter: 13% word overlap",
    verifiedRevisionId: currentRevision(p).id,
    excluded: false,
    exclusionReason: null,
    accessLevel: "everyone",
    ...over,
  };
  return l;
}

describe("mock re-verification scope (F4)", () => {
  beforeEach(() => {
    resetStore();
    signInAs(PROFILES.priya.id);
  });

  it("an approved, edited point is not re-verified after approval; a pending one is", () => {
    const p = codecellPoint();
    const oldRev = currentRevision(p).id;
    p.links.forEach((l) => (l.verifiedRevisionId = oldRev));
    p.revisions.push({ ...currentRevision(p), id: "rev-edited", number: currentRevision(p).number + 1, title: "Edited" });
    p.reverifyAt = 0;
    p.reviewState = "approved";
    settleReverification(p, 1);
    assert.ok(p.links.every((l) => l.kind !== "source_quote" || l.verifiedRevisionId === oldRev), "approved: verdicts stay on the earlier wording");
    p.reverifyAt = 0;
    p.reviewState = "pending";
    settleReverification(p, 1);
    assert.ok(p.links.some((l) => l.verifiedRevisionId === "rev-edited"), "pending: re-checked against the new wording");
  });
});

describe("mock confirmTestimonyAndApprove (F4)", () => {
  beforeEach(() => {
    resetStore();
    signInAs(PROFILES.priya.id);
  });

  it("turns a rejected statement into reviewer-confirmed support and approves the point as Sourced", async () => {
    const p = codecellPoint();
    p.links = [testimony(p)];
    p.reviewState = "pending";
    p.privacyReview = "none" as MockPoint["privacyReview"];
    assert.equal(pointStatus(p), "missing", "setup: the F4 state");
    const d = expectOk(await confirmTestimonyAndApprove({ pointId: p.id, expectedRevisionId: currentRevision(p).id, note: "I was there." }));
    assert.equal(d.reviewState, "approved");
    assert.equal(pointStatus(p), "sourced");
    assert.equal(p.approvedAsKnownGap, false);
    assert.equal(p.links[0].verdictRationale, "Confirmed by a reviewer.");
  });

  it("refuses a stale revision, an approved point, a point without testimony, and a conflict (nothing changes)", async () => {
    const p = codecellPoint();
    p.reviewState = "pending";
    p.privacyReview = "none" as MockPoint["privacyReview"];
    const rev = currentRevision(p).id;
    expectError(await confirmTestimonyAndApprove({ pointId: p.id, expectedRevisionId: "nope" }), "conflict");
    const onlySource = p.links.filter((l) => l.kind === "source_quote");
    p.links = onlySource;
    expectError(await confirmTestimonyAndApprove({ pointId: p.id, expectedRevisionId: rev }), "precondition_failed");
    p.links = [...onlySource.map((l) => ({ ...l, supportVerdict: "contradicts" as const, verifiedRevisionId: rev })), testimony(p)];
    expectError(await confirmTestimonyAndApprove({ pointId: p.id, expectedRevisionId: rev }), "precondition_failed");
    assert.equal(p.links[p.links.length - 1].supportVerdict, "irrelevant", "a refused confirmation is rolled back");
    assert.equal(p.reviewState, "pending");
    p.reviewState = "approved";
    expectError(await confirmTestimonyAndApprove({ pointId: p.id, expectedRevisionId: rev }), "invalid_transition");
  });
});
