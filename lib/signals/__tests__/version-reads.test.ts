// Round 4 B (audit E2): the version-history read helpers (lib/actions/core/revisions.ts), with a fake RLS client.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { getPublicationVersion, listPublicationVersions, mapPublicationVersions, parseVersionParam } from "../../actions/core/revisions";
import type { DbClient } from "../../db/client";

const H = "11111111-1111-4111-8111-111111111111";

function fakeDb(responses: Record<string, unknown>, calls: Array<{ fn: string; args: unknown }> = []): DbClient {
  return {
    rpc: async (fn: string, args: unknown) => {
      calls.push({ fn, args });
      return { data: responses[fn] ?? null, error: null };
    },
  } as unknown as DbClient;
}

describe("version history reads", () => {
  it("parses only positive integer versions", () => {
    assert.equal(parseVersionParam("2"), 2);
    assert.equal(parseVersionParam(["3", "4"]), 3);
    for (const bad of [undefined, "", "0", "-1", "1.5", "abc", "1e3", "01", "9999999"]) assert.equal(parseVersionParam(bad), null, String(bad));
  });

  it("maps the version list and rejects malformed rows", () => {
    const rows = [
      { publication_id: "p2", version: 2, published_at: "2026-11-20T10:00:00Z", published_by_label: "Ann", is_current: true, visible_points: 24, viewer_acknowledged_at: null },
      { publication_id: "p1", version: 1, published_at: "2026-11-10T10:00:00Z", published_by_label: "Ann", is_current: false, visible_points: 22, viewer_acknowledged_at: "2026-11-11T10:00:00Z" },
    ];
    const v = mapPublicationVersions(rows);
    assert.deepEqual(v.map((x) => [x.version, x.isCurrent, x.visiblePoints]), [[2, true, 24], [1, false, 22]]);
    assert.throws(() => mapPublicationVersions([{ ...rows[0], version: "2" }]));
  });

  it("reads through the user's client with the RPC names of migration 20261121200100", async () => {
    const calls: Array<{ fn: string; args: unknown }> = [];
    const db = fakeDb({ api_list_publication_versions: [] }, calls);
    const r = await listPublicationVersions(db, H);
    assert.ok(r.ok);
    assert.deepEqual(calls, [{ fn: "api_list_publication_versions", args: { p_handover_id: H } }]);
  });

  it("an unknown or invisible version is not found; a bad id never reaches the database", async () => {
    const calls: Array<{ fn: string; args: unknown }> = [];
    const db = fakeDb({}, calls);
    const missing = await getPublicationVersion(db, H, 9);
    assert.equal(missing.ok, false);
    if (!missing.ok) assert.equal(missing.error.code, "not_found");
    const bad = await getPublicationVersion(db, "not-a-uuid", 1);
    assert.equal(bad.ok, false);
    assert.equal(calls.length, 1, "only the valid request was sent");
  });
});
