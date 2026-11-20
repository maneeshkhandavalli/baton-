// Main (Round 4 integration finding): with no connector provider configured on the server, the Connected channels
// panel reads a "not configured" view without touching the connector store (no error before the migration).
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { CONNECTOR_CAPTURE_CONSENT_VERSION } from "../../connectors/consent";
import { linkChannel, listHandoverConnectors, recordCaptureConsent, type ConnectorDeps } from "../core/connectors";
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

// PR #7 review, finding 1: Telegram has no history import, so its consent can never carry history days (which would
// back-date the first capture window). Real memory store + the real provider adapters; nothing is written on refusal.
describe("recordCaptureConsent: history days only for providers that can import history", () => {
  async function setup(provider: "telegram" | "slack") {
    const { MemoryConnectorStore } = await import("../../connectors/store-memory");
    const T0 = Date.parse("2026-11-20T09:00:00Z");
    const store = new MemoryConnectorStore(() => T0);
    store.handovers.set(H, { id: H, creatorProfileId: ACTOR.profileId, state: "in_review" });
    const user = { kind: "user", profileId: ACTOR.profileId } as const;
    const inst = await store.upsertInstallation(user, { provider, externalAccountId: provider === "telegram" ? "-1009" : "T0X", accountLabel: "QA", scopes: [], credentials: null });
    const link = await store.linkChannel(user, { installationId: inst.id, handoverId: H, externalChannelId: provider === "telegram" ? "-1009" : "C0X", channelLabel: "QA" });
    const { telegramAdapter } = await import("../../connectors/providers/telegram/server");
    const { slackAdapter } = await import("../../connectors/providers/slack/server");
    let historyCalls = 0;
    const adapter = provider === "telegram"
      ? { ...telegramAdapter, announceCapture: async () => {} }
      : { ...slackAdapter, announceCapture: async () => {}, fetchHistory: async () => (historyCalls++, []) };
    const c: ConnectorDeps = { ...connectorDeps({}), store: () => store, adapter: async () => adapter as never, now: () => T0 };
    return { store, link, c, T0, history: () => historyCalls };
  }

  it("Telegram: historyDays > 0 is refused BEFORE anything is written (no settings, no consent, no window)", async () => {
    const { deps } = fakeDeps();
    const { store, link, c } = await setup("telegram");
    const r = await recordCaptureConsent(deps, c, { linkId: link.id, consentVersion: CONNECTOR_CAPTURE_CONSENT_VERSION, historyDays: 7 });
    assert.equal(r.ok, false);
    assert.equal(!r.ok && r.error.code, "validation_failed");
    const after = await store.getLink(link.id);
    assert.equal(after?.state, "pending_consent");
    assert.deepEqual(after?.settings ?? {}, {}, "historyDays was not persisted");
    assert.equal(after?.consentedAt, null);
  });

  it("Telegram: the store refuses a back-dating setting saved by any other path (mirrors the database trigger)", async () => {
    const { store, link } = await setup("telegram");
    const user = { kind: "user", profileId: ACTOR.profileId } as const;
    await store.updateLinkSettings(user, link.id, { historyDays: 7 });
    await assert.rejects(store.recordCaptureConsent(user, link.id, "v1"), /validation_failed/);
    assert.equal((await store.getLink(link.id))?.state, "pending_consent");
  });

  it("Telegram: consent with historyDays 0 opens the window exactly at consent", async () => {
    const { deps } = fakeDeps();
    const { store, link, c } = await setup("telegram");
    const r = await recordCaptureConsent(deps, c, { linkId: link.id, consentVersion: CONNECTOR_CAPTURE_CONSENT_VERSION, historyDays: 0 });
    assert.ok(r.ok, JSON.stringify(!r.ok && r.error));
    const before = new Date(Date.parse("2026-11-20T08:59:59Z")).toISOString();
    const r2 = await store.bufferMessages(link.id, [{ providerMessageId: "old", sentAt: before, authorLabel: "Asha", kind: "text", text: "sent before consent" }]);
    assert.equal(r2.outsideWindow, 1, "a message from one second before consent is outside the window");
  });

  it("Slack (history import): historyDays is kept, history is fetched and the first window is back-dated", async () => {
    const { deps } = fakeDeps();
    const { store, link, c, T0, history } = await setup("slack");
    const r = await recordCaptureConsent(deps, c, { linkId: link.id, consentVersion: CONNECTOR_CAPTURE_CONSENT_VERSION, historyDays: 7 });
    assert.ok(r.ok, JSON.stringify(!r.ok && r.error));
    assert.equal(history(), 1);
    assert.equal((await store.getLink(link.id))?.settings.historyDays, 7);
    const sixDaysAgo = new Date(T0 - 6 * 86_400_000).toISOString();
    const r2 = await store.bufferMessages(link.id, [{ providerMessageId: "h1", sentAt: sixDaysAgo, authorLabel: "Asha", kind: "text", text: "inside consented history" }]);
    assert.equal(r2.inserted, 1);
  });

  it("the history capability list matches the adapters that implement fetchHistory", async () => {
    const { CONNECTOR_HISTORY_PROVIDERS, CONNECTOR_PROVIDERS } = await import("../../connectors/types");
    const adapters = {
      github: (await import("../../connectors/providers/github/server")).githubAdapter,
      discord: (await import("../../connectors/providers/discord/server")).discordAdapter,
      slack: (await import("../../connectors/providers/slack/server")).slackAdapter,
      telegram: (await import("../../connectors/providers/telegram/server")).telegramAdapter,
    };
    const withHistory = CONNECTOR_PROVIDERS.filter((p) => typeof adapters[p].fetchHistory === "function");
    assert.deepEqual([...withHistory].sort(), [...CONNECTOR_HISTORY_PROVIDERS].sort());
  });
});
