// PR #7 second review (2026-11-20).
// Fix 2: with history requested, the provider is contacted only after the creator/installer and lifecycle checks, and
// BEFORE anything is written, so a failed fetch leaves the link exactly as it was.
// Fix 1: the fetched history is buffered in ≤ 100-message batches (sanitizeMessages keeps at most 100 per event).
// Real MemoryConnectorStore state transitions; a fake history adapter counts fetches and announcements.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { CONNECTOR_CAPTURE_CONSENT_VERSION } from "../../connectors/consent";
import { ProviderError } from "../../connectors/providers/adapter";
import { MemoryConnectorStore } from "../../connectors/store-memory";
import type { ConnectorMessage } from "../../connectors/types";
import { recordCaptureConsent, type ConnectorDeps } from "../core/connectors";
import { ACTOR, fakeDeps, H } from "./helpers";

const T0 = Date.parse("2026-11-20T09:00:00Z");
const OTHER_ID = "55555555-5555-4555-8555-555555555555";

const hist = (n: number): ConnectorMessage[] =>
  Array.from({ length: n }, (_, i) => ({
    providerMessageId: `h${String(i).padStart(4, "0")}`,
    sentAt: new Date(T0 - 3 * 86_400_000 + i * 1000).toISOString(),
    authorLabel: "Asha",
    kind: "text",
    text: `history message ${i}`,
  }));

async function setup(o: { fetchFails?: boolean; history?: number; creator?: string; installer?: string; paused?: boolean } = {}) {
  const store = new MemoryConnectorStore(() => T0);
  store.handovers.set(H, { id: H, creatorProfileId: o.creator ?? ACTOR.profileId, state: "in_review" });
  const owner = { kind: "user", profileId: o.creator ?? ACTOR.profileId } as const;
  const inst = await store.upsertInstallation(owner, { provider: "slack", externalAccountId: "T0X", accountLabel: "QA", scopes: [], credentials: null });
  const link = await store.linkChannel(owner, { installationId: inst.id, handoverId: H, externalChannelId: "C0X", channelLabel: "#qa" });
  if (o.paused) {
    await store.recordCaptureConsent(owner, link.id, CONNECTOR_CAPTURE_CONSENT_VERSION);
    await store.setLinkState(owner, link.id, "paused");
  }
  if (o.installer) {
    (store as unknown as { installations: Map<string, { installedByProfileId: string }> }).installations.get(inst.id)!.installedByProfileId = o.installer;
  }
  const calls = { fetch: 0, announce: 0 };
  const adapter = {
    provider: "slack",
    async fetchHistory() {
      calls.fetch += 1;
      if (o.fetchFails) throw new ProviderError("unavailable");
      return hist(o.history ?? 250);
    },
    async announceCapture() {
      calls.announce += 1;
    },
  };
  const c: ConnectorDeps = {
    store: () => store,
    adapter: async () => adapter as never,
    adapterContext: () => ({}) as never,
    writer: () => ({ write: async () => ({ ok: false, refusal: "internal" }) }),
    env: {},
    now: () => T0,
    creatorHandovers: async () => [],
  };
  const windows = () => (store as unknown as { captureWindows: Map<string, unknown[]> }).captureWindows.get(link.id)?.length ?? 0;
  const consent = (historyDays: number) => ({ linkId: link.id, consentVersion: CONNECTOR_CAPTURE_CONSENT_VERSION, historyDays }) as const;
  return { store, link, c, calls, windows, consent };
}

describe("recordCaptureConsent with history: fetch first, batched import, failures leave no state behind", () => {
  it("a provider history-fetch failure leaves a PENDING link pending: no settings, consent, window or announcement", async () => {
    const { deps } = fakeDeps();
    const s = await setup({ fetchFails: true });
    const r = await recordCaptureConsent(deps, s.c, s.consent(7));
    assert.equal(r.ok, false);
    assert.equal(!r.ok && r.error.details?.reason, "provider_unavailable");
    assert.equal(s.calls.fetch, 1);
    const after = await s.store.getLink(s.link.id);
    assert.equal(after?.state, "pending_consent");
    assert.deepEqual(after?.settings ?? {}, {});
    assert.equal(after?.consentedAt, null);
    assert.equal(after?.consentVersion, null);
    assert.equal(s.windows(), 0);
    assert.equal(s.calls.announce, 0);
    assert.equal(s.store.bufferedFor(s.link.id).length, 0);
  });

  it("a provider history-fetch failure on a PAUSED link leaves it paused, with no new window and no announcement", async () => {
    const { deps } = fakeDeps();
    const s = await setup({ fetchFails: true, paused: true });
    const before = await s.store.getLink(s.link.id);
    const windowsBefore = s.windows();
    const r = await recordCaptureConsent(deps, s.c, s.consent(7));
    assert.equal(r.ok, false);
    const after = await s.store.getLink(s.link.id);
    assert.equal(after?.state, "paused");
    assert.deepEqual(after?.settings, before?.settings);
    assert.equal(after?.consentedAt, before?.consentedAt);
    assert.equal(after?.consentVersion, before?.consentVersion);
    assert.equal(s.windows(), windowsBefore);
    assert.equal(s.calls.announce, 0);
  });

  it("success: historyDays saved, first window back-dated, ALL 250 messages imported (not 100), announced once", async () => {
    const { deps } = fakeDeps();
    const s = await setup({ history: 250 });
    const r = await recordCaptureConsent(deps, s.c, s.consent(7));
    assert.ok(r.ok, JSON.stringify(!r.ok && r.error));
    const after = await s.store.getLink(s.link.id);
    assert.equal(after?.state, "capturing");
    assert.equal(after?.settings.historyDays, 7);
    assert.equal(s.windows(), 1);
    assert.equal(s.store.bufferedFor(s.link.id).length, 250, "messages 3 days old are inside the back-dated window");
    assert.equal(s.calls.announce, 1);
    const ids = s.store.events.filter((e) => e.deliveryId.startsWith(`history:${s.link.id}:`)).map((e) => e.deliveryId);
    assert.equal(ids.length, 3, "three ≤ 100-message batches");
    assert.equal(new Set(ids).size, 3);
  });

  it("≤ 100 history messages still import in one batch", async () => {
    const { deps } = fakeDeps();
    const s = await setup({ history: 40 });
    assert.ok((await recordCaptureConsent(deps, s.c, s.consent(7))).ok);
    assert.equal(s.store.bufferedFor(s.link.id).length, 40);
    assert.equal(s.store.events.filter((e) => e.deliveryId.startsWith(`history:${s.link.id}:`)).length, 1);
  });

  it("unauthorised callers never trigger a provider history fetch (not the creator; creator but not the installer)", async () => {
    const { deps } = fakeDeps();
    const notCreator = await setup({ creator: OTHER_ID });
    const r1 = await recordCaptureConsent(deps, notCreator.c, notCreator.consent(7));
    assert.equal(r1.ok, false);
    assert.equal(!r1.ok && r1.error.code, "forbidden");
    assert.equal(notCreator.calls.fetch, 0);
    assert.equal((await notCreator.store.getLink(notCreator.link.id))?.state, "pending_consent");

    const notInstaller = await setup({ installer: OTHER_ID });
    const r2 = await recordCaptureConsent(deps, notInstaller.c, notInstaller.consent(7));
    assert.equal(r2.ok, false);
    assert.equal(!r2.ok && r2.error.code, "forbidden");
    assert.equal(notInstaller.calls.fetch, 0);
    assert.equal((await notInstaller.store.getLink(notInstaller.link.id))?.state, "pending_consent");
    assert.deepEqual((await notInstaller.store.getLink(notInstaller.link.id))?.settings ?? {}, {});
  });

  it("a partial history-ingestion failure is surfaced (consent recorded, said so) and a retry completes it without duplicates", async () => {
    const { deps } = fakeDeps();
    const s = await setup({ history: 250 });
    const real = s.store.bufferMessages.bind(s.store);
    let failing = true;
    s.store.bufferMessages = async (id, m) => {
      if (failing && m[0]?.providerMessageId === "h0100") throw new Error("transient store failure");
      return real(id, m);
    };
    const r = await recordCaptureConsent(deps, s.c, s.consent(7));
    assert.equal(r.ok, false);
    assert.equal(!r.ok && r.error.code, "precondition_failed");
    assert.equal(!r.ok && r.error.details?.reason, "history_import_incomplete");
    assert.equal(!r.ok && r.error.details?.consentRecorded, true);
    assert.match(!r.ok ? r.error.message : "", /started saving new messages/);
    assert.equal((await s.store.getLink(s.link.id))?.state, "capturing");
    assert.equal(s.store.bufferedFor(s.link.id).length, 150, "the batches that succeeded are kept");
    assert.equal(s.calls.announce, 1, "capture did start, so it is announced");

    failing = false; // the user confirms again with the same choice
    const retry = await recordCaptureConsent(deps, s.c, s.consent(7));
    assert.ok(retry.ok, JSON.stringify(!retry.ok && retry.error));
    assert.equal(s.store.bufferedFor(s.link.id).length, 250);
    assert.equal(new Set(s.store.bufferedFor(s.link.id).map((b) => b.providerMessageId)).size, 250, "no duplicates");
    assert.equal(s.windows(), 1, "no extra capture window");
    assert.equal(s.calls.announce, 1, "an already capturing link is not announced again");
  });

  it("historyDays 0 keeps the previous path: no fetch, consent recorded, announced", async () => {
    const { deps } = fakeDeps();
    const s = await setup();
    const r = await recordCaptureConsent(deps, s.c, s.consent(0));
    assert.ok(r.ok);
    assert.equal(s.calls.fetch, 0);
    assert.equal(s.calls.announce, 1);
    assert.equal((await s.store.getLink(s.link.id))?.state, "capturing");
  });
});
