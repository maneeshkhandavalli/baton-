import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ACCESS_TOKEN_STATUSES } from "../../../lib/contracts/enums";
import { tokenStatusDetail, tokenStatusMeta } from "../../handover/labels";
import { tokenStatus } from "../../../lib/mocks/exclusions";
import type { MockToken } from "../../../lib/mocks/types";

const fmt = (iso: string | null) => iso ?? "—";
const NOW = Date.parse("2026-11-12T00:00:00Z");
const future = "2026-12-01T00:00:00.000Z";
const past = "2026-11-01T00:00:00.000Z";

function token(over: Partial<MockToken>): MockToken {
  return {
    id: "t",
    token: "x",
    purpose: "member_invite",
    handoverId: "h",
    questionIds: [],
    maxAccessLevel: "everyone",
    grantRole: "incoming",
    recipientEmail: "a@example.edu",
    sessionProfileId: null,
    redeemedAt: null,
    expiresAt: future,
    revokedAt: null,
    maxUses: 1,
    useCount: 0,
    createdBy: "p",
    createdAt: past,
    ...over,
  };
}

describe("access-token status (§11.6 ACCESS_TOKEN_STATUSES)", () => {
  it("derives with precedence revoked → expired → exhausted → active", () => {
    assert.equal(tokenStatus(token({ revokedAt: past, expiresAt: past, useCount: 1 }), NOW), "revoked");
    assert.equal(tokenStatus(token({ expiresAt: past, useCount: 1 }), NOW), "expired");
    assert.equal(tokenStatus(token({ useCount: 1 }), NOW), "exhausted");
    assert.equal(tokenStatus(token({ purpose: "gap_interview", maxUses: 20, useCount: 20 }), NOW), "exhausted");
    assert.equal(tokenStatus(token({ purpose: "gap_interview", maxUses: 20, useCount: 19 }), NOW), "active");
    assert.equal(tokenStatus(token({}), NOW), "active");
  });

  it("labels exactly the canonical statuses, with no 'accepted'", () => {
    assert.deepEqual(Object.keys(tokenStatusMeta).sort(), [...ACCESS_TOKEN_STATUSES].sort());
    for (const s of ACCESS_TOKEN_STATUSES) {
      assert.doesNotMatch(tokenStatusMeta[s].label, /accept/i);
    }
    assert.equal(tokenStatusMeta.exhausted.label, "Exhausted");
  });

  it("never describes an exhausted or expired invitation as accepted", () => {
    const base = { expiresAt: future, revokedAt: null, useCount: 1, maxUses: 1 };
    assert.equal(tokenStatusDetail({ ...base, status: "exhausted" }, fmt), "all 1 use taken");
    assert.equal(tokenStatusDetail({ ...base, expiresAt: past, status: "expired" }, fmt), `expired ${past}`);
    assert.equal(tokenStatusDetail({ ...base, revokedAt: past, status: "revoked" }, fmt), `revoked ${past}`);
    assert.equal(tokenStatusDetail({ ...base, useCount: 0, status: "active" }, fmt), `expires ${future} · 0 of 1 use`);
    for (const status of ACCESS_TOKEN_STATUSES) {
      assert.doesNotMatch(tokenStatusDetail({ ...base, status }, fmt), /accept/i);
    }
  });
});
