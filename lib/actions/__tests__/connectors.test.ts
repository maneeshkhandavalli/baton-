// Main (Round 4 integration finding): with no connector provider configured on the server, the Connected channels
// panel reads a "not configured" view without touching the connector store (no error before the migration).
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { linkChannel, listHandoverConnectors, type ConnectorDeps } from "../core/connectors";
import { ACTOR, fakeDeps, H } from "./helpers";

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

  it("reports Slack's optional capabilities (both off by default) when Slack is configured", async () => {
    const { deps } = fakeDeps();
    const env = { BATON_SITE_URL: "https://baton.test", CONNECTOR_STATE_SECRET: "s".repeat(43), CONNECTOR_SECRET_KEY: "k".repeat(43), SLACK_CLIENT_ID: "1", SLACK_CLIENT_SECRET: "2", SLACK_SIGNING_SECRET: "3" };
    const store = { listLinksForHandover: async () => [], listInstallationsForProfile: async () => [], getInstallation: async () => null };
    const run = async (extra: Record<string, string>) => {
      const r = await listHandoverConnectors(deps, { ...connectorDeps({ ...env, ...extra }), store: () => store as never }, { handoverId: H });
      assert.ok(r.ok, JSON.stringify(!r.ok && r.error));
      return r.data.providers.find((p) => p.provider === "slack");
    };
    assert.deepEqual(await run({}), { provider: "slack", configured: true, installPath: `/api/connectors/slack/install?handover=${H}`, slashCommand: false, privateChannels: false });
    const on = await run({ SLACK_PRIVATE_CHANNELS: "1", SLACK_SLASH_COMMAND: "1" });
    assert.equal(on?.slashCommand, true);
    assert.equal(on?.privateChannels, true);
  });

  it("still requires a signed-in user", async () => {
    const { deps } = fakeDeps({ actor: null });
    const r = await listHandoverConnectors(deps, connectorDeps({}), { handoverId: H });
    assert.equal(r.ok, false);
  });
});

describe("linkChannel with Slack private channels off", () => {
  it("refuses a channel the adapter marks private_channel before anything is stored", async () => {
    const { deps } = fakeDeps();
    let linked = 0;
    const inst = { id: "00000000-0000-4000-8000-0000000000a1", provider: "slack", status: "active", accountLabel: "CodeCell", installedByProfileId: ACTOR.profileId };
    const store = { getInstallation: async () => inst, linkChannel: async () => { linked++; throw new Error("must not link"); } };
    const adapter = { provider: "slack", describeChannel: async () => ({ id: "C7", label: "#leads", blockedReason: "private_channel" }) };
    const r = await linkChannel(deps, { ...connectorDeps({}), store: () => store as never, adapter: async () => adapter as never }, { installationId: inst.id, handoverId: H, externalChannelId: "C7" });
    assert.equal(r.ok, false);
    assert.equal(!r.ok && r.error.code, "forbidden");
    assert.match(!r.ok ? r.error.message : "", /Private channels aren't turned on/);
    assert.equal(linked, 0);
  });
});
