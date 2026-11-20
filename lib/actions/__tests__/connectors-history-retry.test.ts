// PR #7 history-retry follow-up (2026-11-20). A partial history import is retried by confirming consent again while
// the link is already capturing. That retry must (1) keep the original consent time, (2) fetch the ORIGINAL consented
// interval, not "now − N days" at retry time, (3) use delivery ids that skip only unchanged completed batches,
// (4) open no second window, and (5) leave Discord's initial cursor where it was.
// The clock MOVES between attempts and the fake adapter really filters by `since`, so the old rolling-lookback bug
// (and index-only batch ids) would fail these tests.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { CONNECTOR_CAPTURE_CONSENT_VERSION } from "../../connectors/consent";
import { historyBatches, historyDeliveryId } from "../../connectors/ingest";
import { initialCursor } from "../../connectors/providers/discord/server";
import { MemoryConnectorStore } from "../../connectors/store-memory";
import type { ConnectorMessage } from "../../connectors/types";
import { recordCaptureConsent, type ConnectorDeps } from "../core/connectors";
import { ACTOR, fakeDeps, H } from "./helpers";

const DAY = 86_400_000;
const T0 = Date.parse("2026-11-20T09:00:00Z");
const DAYS = 7;
const iso = (ms: number) => new Date(ms).toISOString();

/** 250 messages inside the consented 7-day interval, oldest first: 1 h after its start, then every 20 minutes. */
const ORIGINAL: ConnectorMessage[] = Array.from({ length: 250 }, (_, i) => ({
  providerMessageId: `h${String(i).padStart(4, "0")}`,
  sentAt: iso(T0 - DAYS * DAY + 3_600_000 + i * 20 * 60_000),
  authorLabel: "Asha",
  kind: "text",
  text: `history message ${i}`,
}));
/** Messages that arrive AFTER consent (between the two attempts). */
const LATER: ConnectorMessage[] = [1, 2, 3].map((h) => ({
  providerMessageId: `n${h}`, sentAt: iso(T0 + h * 3_600_000), authorLabel: "Ravi", kind: "text", text: `later message ${h}`,
}));

async function setup(o: { provider?: "slack" | "discord"; deleteOnRetry?: string } = {}) {
  let clock = T0;
  const store = new MemoryConnectorStore(() => clock);
  store.handovers.set(H, { id: H, creatorProfileId: ACTOR.profileId, state: "in_review" });
  const owner = { kind: "user", profileId: ACTOR.profileId } as const;
  const provider = o.provider ?? "slack";
  const inst = await store.upsertInstallation(owner, { provider, externalAccountId: "A1", accountLabel: "QA", scopes: [], credentials: null });
  const link = await store.linkChannel(owner, { installationId: inst.id, handoverId: H, externalChannelId: "C1", channelLabel: "#qa" });

  const sinces: string[] = [];
  let deleted = new Set<string>();
  const adapter = {
    provider,
    // a provider-like history endpoint: everything sent since `since` that exists NOW, oldest first, capped at `limit`
    async fetchHistory(_ctx: unknown, _inst: unknown, _link: unknown, since: string, limit: number) {
      sinces.push(since);
      return [...ORIGINAL, ...LATER]
        .filter((m) => Date.parse(m.sentAt) >= Date.parse(since) && Date.parse(m.sentAt) <= clock && !deleted.has(m.providerMessageId))
        .slice(0, limit);
    },
    async announceCapture() {},
  };
  const c: ConnectorDeps = {
    store: () => store,
    adapter: async () => adapter as never,
    adapterContext: () => ({}) as never,
    writer: () => ({ write: async () => ({ ok: false, refusal: "internal" }) }),
    env: {},
    now: () => clock,
    creatorHandovers: async () => [],
  };
  // the middle batch (h0100…h0199) fails on the first attempt (both the try and its immediate retry)
  const real = store.bufferMessages.bind(store);
  let failMiddle = true;
  store.bufferMessages = async (id, m) => {
    if (failMiddle && m.some((x) => x.providerMessageId === "h0100") && m[0]?.providerMessageId === "h0100") throw new Error("transient");
    return real(id, m);
  };
  const windows = () => (store as unknown as { captureWindows: Map<string, unknown[]> }).captureWindows.get(link.id)?.length ?? 0;
  return {
    store, link, c, sinces, windows,
    advance: (ms: number) => void (clock += ms),
    heal: () => void (failMiddle = false),
    deleteAtProvider: (id: string) => void (deleted = new Set([...deleted, id])),
    consent: () => ({ linkId: link.id, consentVersion: CONNECTOR_CAPTURE_CONSENT_VERSION, historyDays: DAYS }) as const,
  };
}

describe("history retry: same interval, same consent time, correct batch ids", () => {
  it("a retry two days later still imports all 250 original messages (+ newly arrived ones), with no duplicates", async () => {
    const { deps } = fakeDeps();
    const s = await setup();

    const first = await recordCaptureConsent(deps, s.c, s.consent());
    assert.equal(first.ok, false);
    assert.equal(!first.ok && first.error.details?.reason, "history_import_incomplete");
    const afterFirst = await s.store.getLink(s.link.id);
    const consentedAt = afterFirst?.consentedAt as string;
    assert.equal(consentedAt, iso(T0));
    assert.equal(s.store.bufferedFor(s.link.id).length, 150, "batches 0 and 2 buffered, the middle one failed");
    const prefix = `history:${s.link.id}:${consentedAt}`;
    const firstIds = historyBatches(ORIGINAL).map((b, i) => historyDeliveryId(prefix, i, b));
    assert.equal(s.store.events.find((e) => e.deliveryId === firstIds[1])?.status, "failed");

    s.advance(2 * DAY); // the retry happens much later; new messages have arrived meanwhile
    s.heal();
    const retry = await recordCaptureConsent(deps, s.c, s.consent());
    assert.ok(retry.ok, JSON.stringify(!retry.ok && retry.error));

    // the ORIGINAL interval was fetched again (not now − 7 days)
    assert.deepEqual(s.sinces, [iso(T0 - DAYS * DAY), iso(T0 - DAYS * DAY)]);
    // every original message is buffered, plus the three that arrived after consent; nothing twice
    const buffered = s.store.bufferedFor(s.link.id).map((m) => m.providerMessageId);
    assert.equal(buffered.length, 253);
    assert.equal(new Set(buffered).size, 253);
    for (const m of ORIGINAL) assert.ok(buffered.includes(m.providerMessageId), `${m.providerMessageId} buffered`);

    // consent time unchanged, no second window, the setting unchanged
    const afterRetry = await s.store.getLink(s.link.id);
    assert.equal(afterRetry?.consentedAt, consentedAt);
    assert.equal(afterRetry?.settings.historyDays, DAYS);
    assert.equal(s.windows(), 1);

    // ids: same prefix; batch 0 unchanged → a duplicate (processed once); batch 1 (same content) reprocessed; batch 2
    // now also holds the newly arrived messages → a NEW id, processed
    const retryIds = historyBatches([...ORIGINAL, ...LATER]).map((b, i) => historyDeliveryId(prefix, i, b));
    assert.equal(retryIds[0], firstIds[0]);
    assert.equal(retryIds[1], firstIds[1]);
    assert.notEqual(retryIds[2], firstIds[2]);
    const row = (id: string) => s.store.events.find((e) => e.deliveryId === id);
    assert.equal(row(firstIds[0])?.status, "processed");
    assert.equal(row(firstIds[0])?.attempts, 1, "never reprocessed: the retry got a duplicate answer");
    assert.equal(s.store.events.filter((e) => e.deliveryId === firstIds[0]).length, 1, "one ledger row per batch id");
    assert.equal(row(firstIds[1])?.attempts, 3, "the failed batch: two tries on the first attempt, reclaimed once on retry");
    assert.equal(row(firstIds[1])?.status, "processed", "the failed batch was reprocessed");
    assert.equal(row(retryIds[2])?.status, "processed");
  });

  it("a provider-side deletion that shifts batch boundaries never silently skips an older message", async () => {
    const { deps } = fakeDeps();
    const s = await setup();
    await recordCaptureConsent(deps, s.c, s.consent()); // batch 1 (h0100…h0199) fails
    s.advance(DAY);
    s.heal();
    s.deleteAtProvider("h0010"); // batch 0 now ends with h0100: with index-only ids it would be skipped as a duplicate
    const retry = await recordCaptureConsent(deps, s.c, s.consent());
    assert.ok(retry.ok, JSON.stringify(!retry.ok && retry.error));
    const buffered = new Set(s.store.bufferedFor(s.link.id).map((m) => m.providerMessageId));
    for (const m of ORIGINAL) assert.ok(buffered.has(m.providerMessageId), `${m.providerMessageId} buffered`);
    assert.equal(buffered.size, 253);
  });

  it("Discord: a partial-history retry does not move the initial pull cursor (derived from the consent time)", async () => {
    const { deps } = fakeDeps();
    const s = await setup({ provider: "discord" });
    await recordCaptureConsent(deps, s.c, s.consent());
    const before = await s.store.getLink(s.link.id);
    assert.equal(before?.pullCursor ?? null, null, "no cursor yet: the initial cursor comes from consentedAt");
    const cursorBefore = initialCursor(before!, T0);
    s.advance(3 * DAY);
    s.heal();
    assert.ok((await recordCaptureConsent(deps, s.c, s.consent())).ok);
    const after = await s.store.getLink(s.link.id);
    assert.equal(initialCursor(after!, T0 + 3 * DAY), cursorBefore);
  });

  it("store semantics: confirm while capturing keeps the consent time; consent after a pause records a new one and a new window", async () => {
    let clock = T0;
    const store = new MemoryConnectorStore(() => clock);
    store.handovers.set(H, { id: H, creatorProfileId: ACTOR.profileId, state: "in_review" });
    const owner = { kind: "user", profileId: ACTOR.profileId } as const;
    const inst = await store.upsertInstallation(owner, { provider: "slack", externalAccountId: "A2", accountLabel: "QA", scopes: [], credentials: null });
    const link = await store.linkChannel(owner, { installationId: inst.id, handoverId: H, externalChannelId: "C2", channelLabel: "#qa" });
    const windows = () => (store as unknown as { captureWindows: Map<string, unknown[]> }).captureWindows.get(link.id)?.length ?? 0;
    await store.recordCaptureConsent(owner, link.id, "v1");
    clock += 60_000;
    const again = await store.recordCaptureConsent(owner, link.id, "v2");
    assert.equal(again.consentedAt, iso(T0), "already capturing: consent time kept");
    assert.equal(again.consentVersion, "v2", "the newer consent version is still recorded");
    assert.equal(windows(), 1);
    clock += 60_000;
    await store.setLinkState(owner, link.id, "paused");
    clock += 60_000;
    const resumed = await store.recordCaptureConsent(owner, link.id, "v2");
    assert.equal(resumed.consentedAt, iso(T0 + 180_000), "consent after a pause: a new consent time");
    assert.equal(windows(), 2, "and a new window");
  });
});
