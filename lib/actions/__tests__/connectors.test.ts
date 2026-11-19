// Main (Round 4 integration finding): with no connector provider configured on the server, the Connected channels
// panel reads a "not configured" view without touching the connector store (no error before the migration).
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { listHandoverConnectors, type ConnectorDeps } from "../core/connectors";
import { fakeDeps, H } from "./helpers";

const throwingStore = new Proxy({}, { get: () => () => { throw new Error("store must not be used"); } });

function connectorDeps(env: Record<string, string | undefined>): ConnectorDeps {
  return {
    store: () => throwingStore as never,
    adapter: async () => { throw new Error("no adapter"); },
    adapterContext: () => ({}) as never,
    writer: () => ({ write: async () => ({ ok: false, refusal: "internal" }) }),
    env,
    now: () => 0,
    creatorHandovers: async () => [],
  };
}

describe("listHandoverConnectors without configured providers", () => {
  it("returns every provider as not configured and never reads the store", async () => {
    const { deps } = fakeDeps();
    const r = await listHandoverConnectors(deps, connectorDeps({}), { handoverId: H });
    assert.ok(r.ok, JSON.stringify(!r.ok && r.error));
    assert.deepEqual(r.data.providers.map((p) => [p.provider, p.configured, p.installPath]), [
      ["github", false, null], ["discord", false, null], ["slack", false, null], ["telegram", false, null],
    ]);
    assert.deepEqual(r.data.links, []);
  });

  it("still requires a signed-in user", async () => {
    const { deps } = fakeDeps({ actor: null });
    const r = await listHandoverConnectors(deps, connectorDeps({}), { handoverId: H });
    assert.equal(r.ok, false);
  });
});
