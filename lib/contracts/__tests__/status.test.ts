import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { EvidenceStatus, QuoteCheck, SupportVerdict } from "../enums";
import { deriveEvidenceStatus, derivePotentiallyOutdated, type StatusEvidenceLink } from "../status";

const R = "rev-current";
const OLD = "rev-previous";

function link(
  supportVerdict: SupportVerdict,
  quoteCheck: QuoteCheck,
  currentRevision: boolean,
  excluded = false,
): StatusEvidenceLink {
  return { supportVerdict, quoteCheck, verifiedRevisionId: currentRevision ? R : OLD, excluded };
}

describe("deriveEvidenceStatus: §4.5 test vectors", () => {
  const vectors: Array<{
    n: number;
    links: StatusEvidenceLink[];
    rationale: string | null;
    expected: EvidenceStatus;
  }> = [
    { n: 1, links: [link("supports", "exact", true)], rationale: null, expected: "sourced" },
    { n: 2, links: [link("supports", "exact", false)], rationale: null, expected: "inferred" },
    { n: 3, links: [link("partial", "exact", true)], rationale: null, expected: "inferred" },
    { n: 4, links: [], rationale: "implied by meeting cadence", expected: "inferred" },
    {
      n: 5,
      links: [link("supports", "exact", true), link("contradicts", "normalized", true)],
      rationale: null,
      expected: "conflicting",
    },
    { n: 6, links: [link("contradicts", "exact", true)], rationale: null, expected: "conflicting" },
    { n: 7, links: [link("supports", "not_found", true)], rationale: null, expected: "missing" },
    { n: 8, links: [link("irrelevant", "exact", true)], rationale: null, expected: "missing" },
    {
      n: 9,
      links: [link("supports", "exact", true), link("contradicts", "normalized", true, true)],
      rationale: null,
      expected: "sourced",
    },
    { n: 10, links: [], rationale: null, expected: "missing" },
  ];

  for (const v of vectors) {
    it(`vector ${v.n} → ${v.expected}`, () => {
      assert.equal(
        deriveEvidenceStatus({ currentRevisionId: R, inferenceRationale: v.rationale, links: v.links }),
        v.expected,
      );
    });
  }
});

describe("deriveEvidenceStatus: further rules from §4.2", () => {
  it("never counts an unverified verdict towards conflicting or sourced", () => {
    // Contradicting verdict on a stale revision is not verified; it only makes the point inferred.
    const status = deriveEvidenceStatus({
      currentRevisionId: R,
      inferenceRationale: null,
      links: [link("contradicts", "exact", false)],
    });
    assert.equal(status, "inferred");
  });

  it("never treats support as sourced until quote existence is verified", () => {
    // Per the §4.2 formula, a "supports" verdict on the current revision with a pending quote check is
    // in neither S (unverified) nor I (not partial/unchecked/stale), so it derives "missing". The
    // pipeline runs verify_quotes before verify_support, so this state should not occur in practice.
    const status = deriveEvidenceStatus({
      currentRevisionId: R,
      inferenceRationale: null,
      links: [link("supports", "pending", true)],
    });
    assert.notEqual(status, "sourced");
    assert.equal(status, "missing");
  });

  it("treats an unchecked verdict on a pending quote as inferred", () => {
    const status = deriveEvidenceStatus({
      currentRevisionId: R,
      inferenceRationale: null,
      links: [{ supportVerdict: "unchecked", quoteCheck: "pending", verifiedRevisionId: null, excluded: false }],
    });
    assert.equal(status, "inferred");
  });

  it("ignores excluded links entirely", () => {
    const status = deriveEvidenceStatus({
      currentRevisionId: R,
      inferenceRationale: null,
      links: [link("supports", "exact", true, true), link("partial", "exact", true, true)],
    });
    assert.equal(status, "missing");
  });

  it("does not treat a stale irrelevant verdict as inference", () => {
    const status = deriveEvidenceStatus({
      currentRevisionId: R,
      inferenceRationale: null,
      links: [link("irrelevant", "exact", false)],
    });
    assert.equal(status, "missing");
  });

  it("treats a whitespace-only rationale as absent", () => {
    const status = deriveEvidenceStatus({ currentRevisionId: R, inferenceRationale: "   ", links: [] });
    assert.equal(status, "missing");
  });

  it("puts conflicting ahead of sourced regardless of link order", () => {
    const status = deriveEvidenceStatus({
      currentRevisionId: R,
      inferenceRationale: "anything",
      links: [link("contradicts", "exact", true), link("supports", "exact", true)],
    });
    assert.equal(status, "conflicting");
  });
});

describe("derivePotentiallyOutdated (§4.4)", () => {
  const asOf = "2026-06-30T00:00:00Z";

  it("flags a sourced point last supported more than 30 days before evidence_as_of", () => {
    assert.equal(
      derivePotentiallyOutdated({ evidenceStatus: "sourced", lastSupportedAt: "2026-05-30T00:00:00Z", evidenceAsOf: asOf }),
      true,
    );
  });

  it("does not flag support exactly 30 days before", () => {
    assert.equal(
      derivePotentiallyOutdated({ evidenceStatus: "sourced", lastSupportedAt: "2026-05-31T00:00:00Z", evidenceAsOf: asOf }),
      false,
    );
  });

  it("only applies to sourced points", () => {
    assert.equal(
      derivePotentiallyOutdated({ evidenceStatus: "inferred", lastSupportedAt: "2026-01-01T00:00:00Z", evidenceAsOf: asOf }),
      false,
    );
  });

  it("never flags undated evidence", () => {
    assert.equal(derivePotentiallyOutdated({ evidenceStatus: "sourced", lastSupportedAt: null, evidenceAsOf: asOf }), false);
  });
});
