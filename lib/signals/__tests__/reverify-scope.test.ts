// Round 4 B (audit F4 / E1): the re-verification scope, mirrored from list_links_needing_support
// (migration 20261121200100; SQL test supabase/tests/sql/99_living_handover_reverify_scope.sql).
// NOTE: these are deterministic rule tests. They say nothing about what a real model would answer; the local test
// adapter (word overlap) that triggered F4 is not a real model either.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { linkInReverifyScope, linkNeedsSupportCheck, type ScopeLink } from "../reverify-scope";

const R1 = "rev-1";
const R2 = "rev-2";
const link = (over: Partial<ScopeLink> = {}): ScopeLink => ({
  evidenceKind: "source_quote",
  supportVerdict: "supports",
  quoteCheck: "exact",
  excluded: false,
  verifiedRevisionId: R1,
  ...over,
});

describe("re-verification scope (F4)", () => {
  it("unchanged sources: a verified link of a published point is never queued", () => {
    assert.equal(linkNeedsSupportCheck({ reviewState: "approved", currentRevisionId: R1 }, link()), false);
    assert.equal(linkNeedsSupportCheck({ reviewState: "pending", currentRevisionId: R1 }, link()), false);
  });

  it("changed sources: new, never-checked evidence on an approved point IS verified", () => {
    const fresh = link({ supportVerdict: "unchecked", verifiedRevisionId: null });
    assert.equal(linkNeedsSupportCheck({ reviewState: "approved", currentRevisionId: R1 }, fresh), true);
    assert.equal(linkNeedsSupportCheck({ reviewState: "pending", currentRevisionId: R1 }, fresh), true);
  });

  it("edited points: an approved edit is human evidence; a pending edit is still checked", () => {
    const stale = link({ verifiedRevisionId: R1 });
    assert.equal(linkNeedsSupportCheck({ reviewState: "approved", currentRevisionId: R2 }, stale), false);
    assert.equal(linkNeedsSupportCheck({ reviewState: "pending", currentRevisionId: R2 }, stale), true);
  });

  it("manual points: the reviewer's own statement is not re-verified once approved", () => {
    const statement = link({ evidenceKind: "testimony", supportVerdict: "unchecked", verifiedRevisionId: null });
    assert.equal(linkNeedsSupportCheck({ reviewState: "approved", currentRevisionId: R1 }, statement), false);
    assert.equal(linkNeedsSupportCheck({ reviewState: "pending", currentRevisionId: R1 }, statement), true, "before approval it is checked as before");
  });

  it("accepted testimony (Gap Interview answer) on an approved point stays human evidence", () => {
    const answer = link({ evidenceKind: "testimony", supportVerdict: "unchecked", verifiedRevisionId: null });
    assert.equal(linkInReverifyScope("approved", "testimony", "unchecked"), false);
    assert.equal(linkNeedsSupportCheck({ reviewState: "approved", currentRevisionId: R1 }, answer), false);
  });

  it("conflicting updates: a contradicting quote from the changed version is checked (and may reopen the point)", () => {
    const contra = link({ supportVerdict: "unchecked", verifiedRevisionId: null });
    assert.equal(linkNeedsSupportCheck({ reviewState: "approved", currentRevisionId: R1 }, contra), true);
  });

  it("excluded, not-found and pending-quote links are never queued", () => {
    const p = { reviewState: "pending" as const, currentRevisionId: R1 };
    assert.equal(linkNeedsSupportCheck(p, link({ supportVerdict: "unchecked", excluded: true })), false);
    assert.equal(linkNeedsSupportCheck(p, link({ supportVerdict: "unchecked", quoteCheck: "not_found" })), false);
    assert.equal(linkNeedsSupportCheck(p, link({ supportVerdict: "unchecked", quoteCheck: "pending" })), false);
  });

  it("rejected points keep the previous behaviour", () => {
    assert.equal(linkInReverifyScope("rejected", "testimony", "unchecked"), true);
  });
});

// Browser verification (bug D): an approved, edited point lost Approved after notes.md v2 changed an unrelated line.
// The re-extracted citation of its UNCHANGED sentence was queued as new evidence (migration 20261121200200).
describe("re-verification scope: quotes carried over unchanged from an earlier version (bug D)", () => {
  const carried = link({ supportVerdict: "unchecked", verifiedRevisionId: null, unchangedFromEarlierVersion: true });

  it("an approved point (edited or not) is not re-verified for an unchanged quote", () => {
    assert.equal(linkNeedsSupportCheck({ reviewState: "approved", currentRevisionId: R2 }, carried), false, "edited and approved");
    assert.equal(linkNeedsSupportCheck({ reviewState: "approved", currentRevisionId: R1 }, carried), false, "approved");
  });

  it("a changed or new passage of the new version is still verified", () => {
    const changed = link({ supportVerdict: "unchecked", verifiedRevisionId: null, unchangedFromEarlierVersion: false });
    assert.equal(linkNeedsSupportCheck({ reviewState: "approved", currentRevisionId: R2 }, changed), true);
  });

  it("pending points are verified as before, even for an unchanged quote", () => {
    assert.equal(linkNeedsSupportCheck({ reviewState: "pending", currentRevisionId: R2 }, carried), true);
  });
});
