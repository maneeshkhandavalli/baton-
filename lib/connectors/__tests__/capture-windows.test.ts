// Capture windows (2026-11-20 consent-boundary fix): a message is stored only when its ORIGINAL send time lies in an
// authorised capture window and, for an edit, its edit time lies in the SAME window. Exercised end to end through the
// real Telegram webhook route (signed secret header) with the in-memory store, which mirrors
// public.connector_buffer_messages (supabase/tests/sql/99_connectors_r4.sql §9 covers the database itself).
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { MemoryConnectorStore } from "../store-memory";
import { CREATOR, HANDOVER, SYNTHETIC_ENV, makeDeps } from "../providers/bots/testing";
import { handleTelegramWebhook } from "../providers/telegram/routes";

const SITE = SYNTHETIC_ENV.BATON_SITE_URL;
const CHAT = "-1001234567890";
const T = (iso: string) => Date.parse(iso);
const sec = (iso: string) => Math.floor(T(iso) / 1000);

function harness() {
  let clock = T("2026-11-20T08:00:00Z");
  const store = new MemoryConnectorStore(() => clock);
  const { deps } = makeDeps({ store });
  const user = { kind: "user", profileId: CREATOR } as const;
  const at = (iso: string) => {
    clock = T(iso);
  };
  let updateId = 1000;
  const send = (body: unknown) =>
    handleTelegramWebhook(
      new Request(`${SITE}/api/connectors/telegram/webhook`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-telegram-bot-api-secret-token": SYNTHETIC_ENV.TELEGRAM_WEBHOOK_SECRET },
        body: JSON.stringify(body),
      }),
      deps,
    );
  const chat = { id: Number(CHAT), type: "supergroup", title: "Window QA" };
  const from = { id: 42, is_bot: false, first_name: "Asha" };
  /** A new message (sent at `sentIso`). */
  const message = (id: number, sentIso: string, text: string, update_id = ++updateId) => send({ update_id, message: { message_id: id, date: sec(sentIso), chat, from, text } });
  /** An edit of message `id` (originally sent at `sentIso`), edited at `editIso`. */
  const edit = (id: number, sentIso: string, editIso: string, text: string) =>
    send({ update_id: ++updateId, edited_message: { message_id: id, date: sec(sentIso), edit_date: sec(editIso), chat, from, text } });
  return { store, user, at, message, edit, async setup() {
    const inst = await store.upsertInstallation(user, { provider: "telegram", externalAccountId: CHAT, accountLabel: "Window QA", scopes: [], credentials: null });
    const link = await store.linkChannel(user, { installationId: inst.id, handoverId: HANDOVER, externalChannelId: CHAT, channelLabel: "Window QA" });
    return link;
  } };
}

const texts = (store: MemoryConnectorStore, linkId: string) => store.bufferedFor(linkId).map((m) => [m.providerMessageId, m.text]);
const lastDetail = (store: MemoryConnectorStore) => store.events[store.events.length - 1]?.detail ?? null;

describe("capture windows: consent boundary", () => {
  it("1. a message sent before consent and edited after consent is rejected (and nothing is stored)", async () => {
    const h = harness();
    const link = await h.setup();
    h.at("2026-11-20T09:00:00Z");
    await h.store.recordCaptureConsent(h.user, link.id, "v1");
    await h.edit(7, "2026-11-20T08:30:00Z", "2026-11-20T09:10:00Z", "edited after consent");
    assert.deepEqual(texts(h.store, link.id), []);
    assert.equal(lastDetail(h.store), "outside_capture_window");
  });

  it("2. a message sent and edited inside the same window is updated", async () => {
    const h = harness();
    const link = await h.setup();
    h.at("2026-11-20T09:00:00Z");
    await h.store.recordCaptureConsent(h.user, link.id, "v1");
    await h.message(7, "2026-11-20T09:05:00Z", "due Friday");
    await h.edit(7, "2026-11-20T09:05:00Z", "2026-11-20T09:06:00Z", "due Monday");
    assert.deepEqual(texts(h.store, link.id), [["7", "due Monday"]]);
  });

  it("3. a message sent during a pause and edited after resuming is rejected", async () => {
    const h = harness();
    const link = await h.setup();
    h.at("2026-11-20T09:00:00Z");
    await h.store.recordCaptureConsent(h.user, link.id, "v1");
    h.at("2026-11-20T10:00:00Z");
    await h.store.setLinkState(h.user, link.id, "paused");
    h.at("2026-11-20T11:00:00Z");
    await h.store.setLinkState(h.user, link.id, "capturing");
    await h.edit(8, "2026-11-20T10:30:00Z", "2026-11-20T11:10:00Z", "sent while paused");
    assert.deepEqual(texts(h.store, link.id), []);
  });

  it("4 + 8. an edit made during a pause never replaces the valid buffered version (even when delivered after resuming)", async () => {
    const h = harness();
    const link = await h.setup();
    h.at("2026-11-20T09:00:00Z");
    await h.store.recordCaptureConsent(h.user, link.id, "v1");
    await h.message(9, "2026-11-20T09:30:00Z", "valid original");
    h.at("2026-11-20T10:00:00Z");
    await h.store.setLinkState(h.user, link.id, "paused");
    h.at("2026-11-20T11:00:00Z");
    await h.store.setLinkState(h.user, link.id, "capturing");
    await h.edit(9, "2026-11-20T09:30:00Z", "2026-11-20T10:30:00Z", "edited while paused");
    await h.edit(9, "2026-11-20T09:30:00Z", "2026-11-20T11:05:00Z", "edited in a later window");
    assert.deepEqual(texts(h.store, link.id), [["9", "valid original"]]);
  });

  it("5. a delayed webhook for a message from an earlier valid window is still accepted after resuming", async () => {
    const h = harness();
    const link = await h.setup();
    h.at("2026-11-20T09:00:00Z");
    await h.store.recordCaptureConsent(h.user, link.id, "v1");
    h.at("2026-11-20T10:00:00Z");
    await h.store.setLinkState(h.user, link.id, "paused");
    h.at("2026-11-20T11:00:00Z");
    await h.store.setLinkState(h.user, link.id, "capturing");
    await h.message(10, "2026-11-20T09:45:00Z", "late delivery from window 1");
    assert.deepEqual(texts(h.store, link.id), [["10", "late delivery from window 1"]]);
  });

  it("6. several pause/resume cycles keep each boundary; an edit crossing windows is refused", async () => {
    const h = harness();
    const link = await h.setup();
    h.at("2026-11-20T08:00:00Z");
    await h.store.recordCaptureConsent(h.user, link.id, "v1"); // window A [08:00, 09:00)
    h.at("2026-11-20T09:00:00Z");
    await h.store.setLinkState(h.user, link.id, "paused");
    h.at("2026-11-20T10:00:00Z");
    await h.store.setLinkState(h.user, link.id, "capturing"); // window B [10:00, 11:00)
    h.at("2026-11-20T11:00:00Z");
    await h.store.setLinkState(h.user, link.id, "paused");
    h.at("2026-11-20T12:00:00Z");
    await h.store.setLinkState(h.user, link.id, "capturing"); // window C [12:00, …)
    await h.message(1, "2026-11-20T08:30:00Z", "A");
    await h.message(2, "2026-11-20T09:30:00Z", "pause 1");
    await h.message(3, "2026-11-20T10:30:00Z", "B");
    await h.message(4, "2026-11-20T11:30:00Z", "pause 2");
    await h.message(5, "2026-11-20T12:30:00Z", "C");
    await h.edit(1, "2026-11-20T08:30:00Z", "2026-11-20T10:15:00Z", "A edited in B");
    assert.deepEqual(texts(h.store, link.id), [["1", "A"], ["3", "B"], ["5", "C"]]);
  });

  it("boundaries are [opened, closed) at second precision", async () => {
    const h = harness();
    const link = await h.setup();
    h.at("2026-11-20T09:00:00.600Z");
    await h.store.recordCaptureConsent(h.user, link.id, "v1");
    h.at("2026-11-20T10:00:00.400Z");
    await h.store.setLinkState(h.user, link.id, "paused");
    await h.store.setLinkState(h.user, link.id, "capturing"); // reopen at 10:00:00.400 → window [10:00:00, …)
    h.at("2026-11-20T10:00:01Z");
    await h.store.setLinkState(h.user, link.id, "paused"); // close the second window again
    await h.message(1, "2026-11-20T08:59:59Z", "one second before consent"); // Telegram reports whole seconds
    await h.message(2, "2026-11-20T09:00:00Z", "same second as consent");
    // paused now: nothing is buffered at all, whatever the times
    assert.deepEqual(texts(h.store, link.id), []);
    h.at("2026-11-20T10:00:02Z");
    await h.store.setLinkState(h.user, link.id, "capturing");
    await h.message(1, "2026-11-20T08:59:59Z", "one second before consent", 5001);
    await h.message(2, "2026-11-20T09:00:00Z", "same second as consent", 5002);
    await h.message(3, "2026-11-20T09:59:59Z", "last second before the pause", 5003);
    assert.deepEqual(texts(h.store, link.id), [["2", "same second as consent"], ["3", "last second before the pause"]]);
  });

  it("7. a duplicate Telegram delivery id stays idempotent", async () => {
    const h = harness();
    const link = await h.setup();
    h.at("2026-11-20T09:00:00Z");
    await h.store.recordCaptureConsent(h.user, link.id, "v1");
    await h.message(11, "2026-11-20T09:01:00Z", "once", 7777);
    await h.message(11, "2026-11-20T09:01:00Z", "once", 7777);
    assert.deepEqual(texts(h.store, link.id), [["11", "once"]]);
    assert.equal(h.store.events.filter((e) => e.deliveryId === "tg:7777").length, 1);
  });

  it("Telegram (no history import): consent with history days is refused and nothing is back-dated (PR #7 finding 1)", async () => {
    const h = harness();
    const link = await h.setup();
    h.at("2026-11-20T09:00:00Z");
    await h.store.updateLinkSettings(h.user, link.id, { historyDays: 7 });
    await assert.rejects(h.store.recordCaptureConsent(h.user, link.id, "v1"), /validation_failed/);
    await h.message(12, "2026-11-17T12:00:00Z", "3 days earlier");
    assert.deepEqual(texts(h.store, link.id), []);
  });

  it("history providers: consented history days back-date only the FIRST window; re-consent after a pause is not", async () => {
    let clock = T("2026-11-20T09:00:00Z");
    const store = new MemoryConnectorStore(() => clock);
    store.handovers.set(HANDOVER, { id: HANDOVER, creatorProfileId: CREATOR, state: "draft" });
    const user = { kind: "user", profileId: CREATOR } as const;
    const inst = await store.upsertInstallation(user, { provider: "slack", externalAccountId: "T0H", accountLabel: "QA", scopes: [], credentials: null });
    const link = await store.linkChannel(user, { installationId: inst.id, handoverId: HANDOVER, externalChannelId: "C0H", channelLabel: "#qa" });
    await store.updateLinkSettings(user, link.id, { historyDays: 7 });
    await store.recordCaptureConsent(user, link.id, "v1");
    const m = (id: string, at: string) => ({ providerMessageId: id, sentAt: at, authorLabel: "Asha", kind: "text" as const, text: id });
    clock = T("2026-11-20T10:00:00Z");
    await store.setLinkState(user, link.id, "paused");
    clock = T("2026-11-20T11:00:00Z");
    await store.recordCaptureConsent(user, link.id, "v1"); // re-consent = new window at 11:00, no back-dating
    const r = await store.bufferMessages(link.id, [
      m("12", "2026-11-17T12:00:00.000Z"), // 3 days before the first consent: inside consented history
      m("13", "2026-11-10T12:00:00.000Z"), // 10 days before: outside
      m("14", "2026-11-20T10:30:00.000Z"), // during the pause
    ]);
    assert.deepEqual([r.inserted, r.outsideWindow], [1, 2]);
    assert.deepEqual(store.bufferedFor(link.id).map((b) => b.providerMessageId), ["12"]);
  });

  it("malformed times are outside every window (store level)", async () => {
    const h = harness();
    const link = await h.setup();
    h.at("2026-11-20T09:00:00Z");
    await h.store.recordCaptureConsent(h.user, link.id, "v1");
    const base = { sentAt: "2026-11-20T09:01:00.000Z", authorLabel: "Asha", kind: "text" as const, text: "x" };
    const r = await h.store.bufferMessages(link.id, [
      { ...base, providerMessageId: "a", sentAt: "not-a-date" },
      { ...base, providerMessageId: "b", editedAt: "yesterday-ish" },
      { ...base, providerMessageId: "c" },
    ]);
    assert.deepEqual([r.inserted, r.updated, r.outsideWindow], [1, 0, 2]);
  });

  it("10. Discord-style pull after resume: a message dated during the pause is never stored", async () => {
    const h = harness();
    const link = await h.setup();
    h.at("2026-11-20T09:00:00Z");
    await h.store.recordCaptureConsent(h.user, link.id, "v1");
    h.at("2026-11-20T10:00:00Z");
    await h.store.setLinkState(h.user, link.id, "paused");
    h.at("2026-11-20T11:00:00Z");
    await h.store.setLinkState(h.user, link.id, "capturing");
    const r = await h.store.bufferMessages(link.id, [
      { providerMessageId: "p", sentAt: "2026-11-20T10:30:00.000Z", authorLabel: "b", kind: "text", text: "during pause" },
      { providerMessageId: "q", sentAt: "2026-11-20T11:30:00.000Z", authorLabel: "b", kind: "text", text: "after resume" },
    ]);
    assert.deepEqual([r.inserted, r.outsideWindow], [1, 1]);
    assert.deepEqual(texts(h.store, link.id), [["q", "after resume"]]);
  });

  it("disconnect closes the window: nothing is buffered afterwards", async () => {
    const h = harness();
    const link = await h.setup();
    h.at("2026-11-20T09:00:00Z");
    await h.store.recordCaptureConsent(h.user, link.id, "v1");
    h.at("2026-11-20T09:30:00Z");
    await h.store.revokeLink(h.user, link.id);
    await h.message(15, "2026-11-20T09:10:00Z", "sent in the window, delivered after disconnect");
    assert.deepEqual(texts(h.store, link.id), []);
  });
});
