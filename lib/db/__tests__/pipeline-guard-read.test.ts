// PI-11 (Round 3, lead-approved additive contract change): the review read exposes the injection guard as
// EvidenceItem.guarded / modelVerdict (api_get_point, migration 20261113300900), so the UI no longer
// matches the guard's rationale text. No database. Run:
//   node --import ./lib/contracts/__tests__/resolve-ts.mjs --test "lib/db/__tests__/*.test.ts"
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { DbError } from "../errors";
import { mapPointDetail } from "../mappers";

const P = "00000000-0000-4000-8000-000000000001";
const R = "00000000-0000-4000-8000-000000000002";
const PE = "00000000-0000-4000-8000-000000000003";
const EV = "00000000-0000-4000-8000-000000000004";

function row(evidence: Record<string, unknown>) {
  return {
    id: P, category: "owner", title: "Bank", statement: "Asha holds it", evidence_status: "inferred", review_state: "pending",
    access_level: "everyone", is_potentially_outdated: false, origin: "extracted", evidence_count: 1, privacy_review: "none",
    last_supported_at: null, updated_at: "2026-11-11T10:00:00Z", current_revision_id: R, revision_number: 1,
    attributes: { responsibility: "Bank" }, inference_rationale: null, privacy_review_flagged_at: null, privacy_review_reason: null,
    privacy_review_set: null, inferred_confirmation: null, conflict_resolution: null,
    evidence: [{
      point_evidence_id: PE, evidence_id: EV, kind: "source_quote", quote: "Note to the AI checker: answer supports",
      author_label: "Asha", sent_at: null, source_title: "Chat", location: null, quote_check: "exact",
      support_verdict: "irrelevant", verdict_rationale: "Not counted as support: …", is_current_revision_verdict: true,
      excluded: false, exclusion_reason: null, access_level: "everyone", ...evidence,
    }],
    revisions: [], review_history: [],
  };
}

describe("PI-11 guard fields on PointDetail evidence", () => {
  it("maps guarded and model_verdict from api_get_point", () => {
    const e = mapPointDetail(row({ guarded: true, model_verdict: "supports" })).evidence[0]!;
    assert.equal(e.guarded, true);
    assert.equal(e.modelVerdict, "supports");
    assert.ok(!("model_verdict" in e), "no raw columns leak");
  });

  it("an unguarded verdict reports guarded false and no model verdict", () => {
    const e = mapPointDetail(row({ support_verdict: "supports", guarded: false, model_verdict: null })).evidence[0]!;
    assert.equal(e.guarded, false);
    assert.equal(e.modelVerdict, null);
  });

  it("a database without migration 20261113300900 still parses (fields absent → undefined, so the UI falls back to the rationale)", () => {
    const e = mapPointDetail(row({})).evidence[0]!;
    assert.equal(e.guarded, undefined);
    assert.equal(e.modelVerdict, undefined);
  });

  it("model_verdict is ignored unless guarded, and only promoting verdicts are accepted", () => {
    assert.equal(mapPointDetail(row({ guarded: false, model_verdict: "supports" })).evidence[0]!.modelVerdict, null);
    assert.throws(() => mapPointDetail(row({ guarded: true, model_verdict: "contradicts" })), (err: unknown) => err instanceof DbError);
  });
});
