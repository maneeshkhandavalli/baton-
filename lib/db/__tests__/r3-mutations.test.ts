// R3 (Agent 2): lib/db wrapper for update_handover_details (C1). No database: a fake DbClient records calls.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { VerifiedActor } from "../actor-rules";
import type { DbClient } from "../client";
import { DbError } from "../errors";
import { updateHandoverDetails } from "../mutations";

const USER = "44444444-4444-4444-8444-444444444444";
const H = "11111111-1111-4111-8111-111111111111";
const TOKEN = "2026-11-12T10:00:00.123Z";

function fakeDb(response: { data?: unknown; error?: { code?: string; message: string } }) {
  const calls: Array<{ fn: string; args?: Record<string, unknown> }> = [];
  const db: DbClient = {
    rpc: async (fn, args) => {
      calls.push({ fn, args });
      return { data: response.data ?? null, error: response.error ?? null };
    },
  };
  return { db, calls };
}

// Tests may mint actors directly (lib/db/__tests__/boundaries.test.ts checks non-test modules).
const actor = { profileId: USER, email: "a@example.test", emailConfirmed: true } as VerifiedActor;
const input = { handoverId: H, title: "Treasurer handover", teamName: "Robotics Club", expectedUpdatedAt: TOKEN };

describe("updateHandoverDetails (R3 C1)", () => {
  it("passes the verified actor, the token and null for omitted optional fields (keep)", async () => {
    const { db, calls } = fakeDb({ data: "2026-11-12T10:00:05.456789+00:00" });
    assert.equal(await updateHandoverDetails(db, actor, input), "2026-11-12T10:00:05.456789+00:00");
    assert.deepEqual(calls, [{
      fn: "update_handover_details",
      args: {
        p_actor_profile_id: USER,
        p_handover_id: H,
        p_expected_updated_at: TOKEN,
        p_title: "Treasurer handover",
        p_team_name: "Robotics Club",
        p_role_title: null,
        p_description: null,
      },
    }]);
  });

  it("passes empty strings through (clear)", async () => {
    const { db, calls } = fakeDb({ data: TOKEN });
    await updateHandoverDetails(db, actor, { ...input, roleTitle: "", description: "" });
    assert.equal(calls[0].args?.p_role_title, "");
    assert.equal(calls[0].args?.p_description, "");
  });

  it("maps BTCF0 to a non-retryable conflict and an unexpected result to internal", async () => {
    await assert.rejects(updateHandoverDetails(fakeDb({ error: { code: "BTCF0", message: "stale" } }).db, actor, input),
      (e: unknown) => e instanceof DbError && e.code === "conflict" && !e.retryable);
    await assert.rejects(updateHandoverDetails(fakeDb({ data: 42 }).db, actor, input),
      (e: unknown) => e instanceof DbError && e.code === "internal");
  });
});

describe("mapHandoverSummary description (R3)", () => {
  const row = {
    id: H, title: "Treasurer", team_name: "Robotics", role_title: null, state: "draft", viewer_role: "outgoing",
    viewer_is_creator: true, viewer_clearance: "reviewer_only", current_publication_id: null,
    created_at: "2026-11-11T10:00:00.123456+00:00", updated_at: "2026-11-11T10:00:00+05:30",
  };

  it("maps description, and an absent or null description to null", async () => {
    const { mapHandoverSummary } = await import("../mappers");
    assert.equal(mapHandoverSummary({ ...row, description: "Bank and dues" }).description, "Bank and dues");
    assert.equal(mapHandoverSummary({ ...row, description: null }).description, null);
    assert.equal(mapHandoverSummary(row).description, null);
    assert.throws(() => mapHandoverSummary({ ...row, description: 42 }), (e: unknown) => e instanceof DbError && e.code === "internal");
  });
});
