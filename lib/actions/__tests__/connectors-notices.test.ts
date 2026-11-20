// Connector actions, 2026-11-21 fixes:
//  - start, pause and stop notice failures never block the action but are now logged (code only, no token, content or
//    ids), and so are provider-side and local revocation failures on disconnect;
//  - a GitHub App misconfigured with the Client ID (or an unreadable key) gets a specific, safe message instead of the
//    generic "isn't set up on this server yet";
//  - F3: shared demo accounts can't link, consent, change capture settings, bring in messages or link from an intent.
// Real MemoryConnectorStore; adapters are synthetic. No network.
import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";

import type { VerifiedActor } from "../../db/actor-rules";
import { CONNECTOR_CAPTURE_CONSENT_VERSION } from "../../connectors/consent";
import { ProviderConfigError, ProviderError } from "../../connectors/providers/adapter";
import { MemoryConnectorStore } from "../../connectors/store-memory";
import {
  disconnectInstallation,
  linkChannel,
  linkFromIntent,
  listInstallationChannels,
  recordCaptureConsent,
  setCapturePaused,
  syncLinkNow,
  unlinkChannel,
  updateConnectorLinkSettings,
  type ConnectorActionLogEntry,
  type ConnectorDeps,
} from "../core/connectors";
import { ACTOR, ACTOR_ID, H, fakeDeps } from "./helpers";
import { DEMO_ACCOUNTS_FULL_ACCESS } from "../../demo-accounts";

const SKIP_F3 = DEMO_ACCOUNTS_FULL_ACCESS ? "judges have full access (owner decision 21 Nov); restores with DEMO_ACCOUNTS_FULL_ACCESS = false" : false;

const TOKEN = "xoxb-synthetic-never-logged";
const T0 = Date.parse("2026-11-21T00:30:00Z");

async function setup(opts: { notice?: "ok" | "fail"; revoke?: "ok" | "fail" } = {}) {
  const store = new MemoryConnectorStore(() => T0);
  store.handovers.set(H, { id: H, creatorProfileId: ACTOR_ID, state: "in_review" });
  const user = { kind: "user", profileId: ACTOR_ID } as const;
  const inst = await store.upsertInstallation(user, { provider: "slack", externalAccountId: "T0X", accountLabel: "QA", scopes: [], credentials: null });
  const link = await store.linkChannel(user, { installationId: inst.id, handoverId: H, externalChannelId: "C0X", channelLabel: "#qa" });
  const notices: string[] = [];
  const adapter = {
    provider: "slack",
    listChannels: async () => [],
    describeChannel: async () => ({ id: "C0X", label: "#qa", blockedReason: null }),
    announceCapture: async (_c: unknown, _i: unknown, _l: unknown, change: string) => {
      notices.push(change);
      if (opts.notice === "fail") throw new Error(`chat.postMessage failed for token ${TOKEN} in C0X: "message text"`);
    },
    revokeAtProvider: async () => {
      if (opts.revoke === "fail") throw new ProviderError("unavailable");
    },
  };
  const logs: ConnectorActionLogEntry[] = [];
  const c: ConnectorDeps = {
    store: () => store,
    adapter: async () => adapter as never,
    adapterContext: () => ({}) as never,
    writer: () => ({ write: async () => ({ ok: false, refusal: "internal" }) }) as never,
    env: {},
    now: () => T0,
    creatorHandovers: async () => [],
    displayName: async () => "Asha",
    log: (e) => logs.push(e),
  };
  return { store, inst, link, c, logs, notices };
}

function assertSafe(logs: ConnectorActionLogEntry[]) {
  const text = JSON.stringify(logs);
  for (const bad of [TOKEN, "C0X", "T0X", "message text", "Asha", ACTOR_ID]) assert.ok(!text.includes(bad), `log leaked ${bad}`);
  for (const l of logs) assert.deepEqual(Object.keys(l).sort(), ["code", "event", "provider", "scope"]);
}

describe("capture notices: failures are observable, never blocking", () => {
  it("consent succeeds when the start notice fails, and the failure is logged as notice_started", async () => {
    const { deps } = fakeDeps();
    const { c, link, logs, store } = await setup({ notice: "fail" });
    const r = await recordCaptureConsent(deps, c, { linkId: link.id, consentVersion: CONNECTOR_CAPTURE_CONSENT_VERSION, historyDays: 0 });
    assert.ok(r.ok, JSON.stringify(!r.ok && r.error));
    assert.equal((await store.getLink(link.id))?.state, "capturing");
    assert.deepEqual(logs, [{ scope: "connector", provider: "slack", event: "notice_started", code: "error" }]);
    assertSafe(logs);
  });

  it("pause, resume and stop: each failed notice is logged with its change; the state change still happens", async () => {
    const { deps } = fakeDeps();
    const { c, link, logs, store } = await setup({ notice: "fail" });
    await store.recordCaptureConsent({ kind: "user", profileId: ACTOR_ID }, link.id, "v1");
    assert.ok((await setCapturePaused(deps, c, { linkId: link.id, paused: true })).ok);
    assert.equal((await store.getLink(link.id))?.state, "paused");
    assert.ok((await setCapturePaused(deps, c, { linkId: link.id, paused: false })).ok);
    assert.ok((await unlinkChannel(deps, c, { linkId: link.id })).ok);
    assert.equal((await store.getLink(link.id))?.state, "revoked");
    assert.deepEqual(logs.map((l) => l.event), ["notice_paused", "notice_started", "notice_stopped"]);
    assertSafe(logs);
  });

  it("a ProviderError notice failure is logged with its code (e.g. forbidden: the bot was removed)", async () => {
    const { deps } = fakeDeps();
    const s = await setup();
    const forbidden = { ...(await s.c.adapter("slack")), announceCapture: async () => { throw new ProviderError("forbidden"); } };
    const c = { ...s.c, adapter: async () => forbidden as never };
    await s.store.recordCaptureConsent({ kind: "user", profileId: ACTOR_ID }, s.link.id, "v1");
    assert.ok((await setCapturePaused(deps, c, { linkId: s.link.id, paused: true })).ok);
    assert.deepEqual(s.logs, [{ scope: "connector", provider: "slack", event: "notice_paused", code: "forbidden" }]);
  });

  it("successful notices log nothing", async () => {
    const { deps } = fakeDeps();
    const { c, link, logs, notices } = await setup();
    assert.ok((await recordCaptureConsent(deps, c, { linkId: link.id, consentVersion: CONNECTOR_CAPTURE_CONSENT_VERSION, historyDays: 0 })).ok);
    assert.deepEqual(notices, ["started"]);
    assert.deepEqual(logs, []);
  });
});

describe("disconnect: revocation failures are logged safely", () => {
  it("provider-side revocation failure: local revocation still happens, credentials and links are gone, failure logged", async () => {
    const { deps } = fakeDeps();
    const { c, inst, link, logs, store } = await setup({ revoke: "fail" });
    const r = await disconnectInstallation(deps, c, { installationId: inst.id });
    assert.ok(r.ok, JSON.stringify(!r.ok && r.error));
    assert.equal((await store.getInstallation(inst.id))?.status, "revoked");
    assert.equal((await store.getLink(link.id))?.state, "revoked");
    assert.equal(await store.getInstallationCredentials(inst.id), null);
    assert.deepEqual(logs, [{ scope: "connector", provider: "slack", event: "revoke_at_provider", code: "unavailable" }]);
  });

  it("a local revocation failure is logged (code only) and reported, never silently ignored", async () => {
    const { deps } = fakeDeps();
    const s = await setup();
    const broken = Object.create(s.store) as MemoryConnectorStore;
    broken.revokeInstallation = async () => {
      throw new Error(`db down ${TOKEN}`);
    };
    const c = { ...s.c, store: () => broken };
    const r = await disconnectInstallation(deps, c, { installationId: s.inst.id });
    assert.equal(r.ok, false);
    assert.deepEqual(s.logs, [{ scope: "connector", provider: "slack", event: "revoke_local", code: "error" }]);
    assertSafe(s.logs);
  });

  it("someone else's installation is not found and nothing is revoked or logged", async () => {
    const { deps } = fakeDeps({ actor: { ...ACTOR, profileId: "55555555-5555-4555-8555-555555555555" } as VerifiedActor });
    const { c, inst, logs, store } = await setup({ revoke: "fail" });
    const r = await disconnectInstallation(deps, c, { installationId: inst.id });
    assert.equal(!r.ok && r.error.code, "not_found");
    assert.equal((await store.getInstallation(inst.id))?.status, "active");
    assert.deepEqual(logs, []);
  });
});

describe("GitHub App misconfiguration diagnostic", () => {
  it("App ID holding the Client ID: a specific, safe message and a config code (not the generic 'not set up')", async () => {
    const { deps } = fakeDeps();
    const s = await setup();
    const github = { provider: "github", listChannels: async () => { throw new ProviderConfigError("github_app_id_is_client_id"); }, describeChannel: async () => null };
    const c = { ...s.c, adapter: async () => github as never };
    const r = await listInstallationChannels(deps, c, { installationId: s.inst.id, handoverId: H });
    assert.equal(r.ok, false);
    if (!r.ok) {
      assert.equal(r.error.code, "precondition_failed");
      assert.match(r.error.message, /numeric App ID/);
      assert.match(r.error.message, /Client ID/);
      assert.doesNotMatch(r.error.message, /isn't set up on this server yet/);
      assert.doesNotMatch(r.error.message, /[–—]/);
      assert.deepEqual(r.error.details, { reason: "provider_not_configured", config: "github_app_id_is_client_id" });
    }
    assert.deepEqual(s.logs, [{ scope: "connector", provider: "github", event: "provider_config", code: "github_app_id_is_client_id" }]);
  });

  it("an unreadable private key is told apart from the App ID problem", async () => {
    const { deps } = fakeDeps();
    const s = await setup();
    const github = { provider: "github", listChannels: async () => { throw new ProviderConfigError("github_private_key_unparsable"); }, describeChannel: async () => null };
    const r = await listInstallationChannels(deps, { ...s.c, adapter: async () => github as never }, { installationId: s.inst.id, handoverId: H });
    assert.equal(r.ok, false);
    assert.match(!r.ok ? r.error.message : "", /private key can't be read/);
  });

  it("a plain not_configured ProviderError keeps the generic message", async () => {
    const { deps } = fakeDeps();
    const s = await setup();
    const other = { provider: "slack", listChannels: async () => { throw new ProviderError("not_configured"); }, describeChannel: async () => null };
    const r = await listInstallationChannels(deps, { ...s.c, adapter: async () => other as never }, { installationId: s.inst.id, handoverId: H });
    assert.match(!r.ok ? r.error.message : "", /isn't set up on this server yet/);
  });
});

describe("F3: shared demo accounts can't connect channels or bring in content", { skip: SKIP_F3 }, () => {
  const KEYS = ["BATON_DEMO_EMAILS", "NEXT_PUBLIC_BATON_DEMO_CREATOR_EMAIL", "NEXT_PUBLIC_BATON_DEMO_INCOMING_EMAIL"] as const;
  let saved: Record<string, string | undefined> = {};
  beforeEach(() => {
    saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
    process.env.BATON_DEMO_EMAILS = "judge.creator@demo.test";
    process.env.NEXT_PUBLIC_BATON_DEMO_INCOMING_EMAIL = "incoming@demo.test";
    delete process.env.NEXT_PUBLIC_BATON_DEMO_CREATOR_EMAIL;
  });
  afterEach(() => {
    for (const k of KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });
  const DEMO = Object.freeze({ profileId: ACTOR_ID, email: "Judge.Creator@Demo.test", emailConfirmed: true }) as VerifiedActor;
  const PUBLIC_DEMO = Object.freeze({ profileId: ACTOR_ID, email: "incoming@demo.test", emailConfirmed: true }) as VerifiedActor;
  const L = "77777777-7777-4777-8777-777777777777";
  const I = "88888888-8888-4888-8888-888888888888";
  const GUARDED: Array<[string, (d: ReturnType<typeof fakeDeps>["deps"], c: ConnectorDeps) => Promise<{ ok: boolean; error?: { code: string; details?: Record<string, unknown> } }>]> = [
    ["linkChannel", (d, c) => linkChannel(d, c, { installationId: I, handoverId: H, externalChannelId: "C0X" })],
    ["recordCaptureConsent", (d, c) => recordCaptureConsent(d, c, { linkId: L, consentVersion: CONNECTOR_CAPTURE_CONSENT_VERSION, historyDays: 0 })],
    ["updateConnectorLinkSettings", (d, c) => updateConnectorLinkSettings(d, c, { linkId: L, settings: {} })],
    ["syncLinkNow", (d, c) => syncLinkNow(d, c, { linkId: L })],
    ["linkFromIntent", (d, c) => linkFromIntent(d, c, { intent: "x".repeat(20), handoverId: H })],
  ];

  function counting() {
    let touched = 0;
    const store = new Proxy({}, { get: () => () => { touched++; throw new Error("store must not be used"); } });
    const c: ConnectorDeps = {
      store: () => store as never,
      adapter: async () => { touched++; throw new Error("no adapter"); },
      adapterContext: () => { touched++; return {} as never; },
      writer: () => { touched++; return {} as never; },
      env: {},
      now: () => T0,
      creatorHandovers: async () => { touched++; return []; },
      log: () => {},
    };
    return { c, touched: () => touched };
  }

  for (const [name, call] of GUARDED) {
    it(`${name} refuses both demo accounts before any store, adapter or provider call`, async () => {
      for (const actor of [DEMO, PUBLIC_DEMO]) {
        const f = fakeDeps({ actor });
        const k = counting();
        const r = await call(f.deps, k.c);
        assert.equal(r.ok, false);
        assert.equal(r.error?.code, "forbidden");
        assert.equal(r.error?.details?.reason, "demo_account_content");
        assert.equal(k.touched(), 0, `${name} touched the connector store or a provider for a demo account`);
        assert.deepEqual(f.calls, []);
      }
    });

    it(`${name} is not refused for an ordinary account`, async () => {
      const f = fakeDeps({ actor: ACTOR });
      const k = counting();
      const r = await call(f.deps, k.c);
      assert.notEqual(r.error?.details?.reason, "demo_account_content");
    });
  }

  it("pause, stop and disconnect stay open to every account (they only reduce capture)", async () => {
    const { deps } = fakeDeps({ actor: DEMO });
    const { c, inst } = await setup();
    const r = await disconnectInstallation(deps, c, { installationId: inst.id });
    assert.notEqual(!r.ok && r.error.details?.reason, "demo_account_content");
  });

  it("the bot install routes refuse a demo account with 403 before any store call", async () => {
    const { handleDiscordInstall } = await import("../../connectors/providers/discord/routes");
    const { handleSlackInstall } = await import("../../connectors/providers/slack/routes");
    const { DEMO_CONNECT_REFUSAL } = await import("../../connectors/providers/bots/shared");
    const { SYNTHETIC_ENV, makeDeps } = await import("../../connectors/providers/bots/testing");
    for (const handle of [handleDiscordInstall, handleSlackInstall]) {
      const { deps: d } = makeDeps({ env: { ...SYNTHETIC_ENV } });
      let storeCalls = 0;
      const store = d.store;
      d.store = new Proxy(store, { get: (t, p) => { const v = Reflect.get(t, p); return typeof v === "function" ? (...a: unknown[]) => { storeCalls++; return v.apply(t, a); } : v; } });
      d.getActor = async () => ({ profileId: ACTOR_ID, email: "judge.creator@demo.test" });
      const res = await handle(new Request(`https://baton.example.test/api/connectors/x/install?handover=${H}`), d);
      assert.equal(res.status, 403);
      assert.equal(await res.text(), DEMO_CONNECT_REFUSAL);
      assert.equal(storeCalls, 0);
      d.getActor = async () => ({ profileId: ACTOR_ID, email: "someone@example.test" });
      assert.notEqual((await handle(new Request(`https://baton.example.test/api/connectors/x/install`), d)).status, 403);
    }
  });
});
