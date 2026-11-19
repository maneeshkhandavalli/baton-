// Telegram connector (Worker 03): secret header, update mapping (text, captions, media, edits, service messages,
// bots), consent gate + de-duplication via MemoryConnectorStore, my_chat_member removal, /handover intent, privacy
// mode, notices and leaving. Synthetic data only; no network.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { verifyConnectorState } from "../../../state";
import { CREATOR, HANDOVER, NOW, SITE, STATE_SECRET, SYNTHETIC_ENV, fakeFetch, getRequest, makeDeps } from "../../bots/testing";
import { handleTelegramInstall, handleTelegramWebhook } from "../routes";
import { botIdFromToken, isOurCommand, parseTelegramUpdate, telegramAdapter } from "../server";

const CHAT = "-1001234567890";
const BOT_ID = "123456";
const API = `https://api.telegram.org/bot${SYNTHETIC_ENV.TELEGRAM_BOT_TOKEN}`;
const SEC = SYNTHETIC_ENV.TELEGRAM_WEBHOOK_SECRET;
const T0 = Math.floor(NOW / 1000);

const asha = { id: 42, is_bot: false, first_name: "Asha", last_name: "K", username: "asha_k" };
const message = (over: Record<string, unknown> = {}) => ({ message_id: 7, date: T0, chat: { id: Number(CHAT), type: "supergroup", title: "Robotics core" }, from: asha, text: "Battery order is due Friday", ...over });

function post(update: unknown, secret: string | null = SEC): Request {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (secret !== null) headers["x-telegram-bot-api-secret-token"] = secret;
  return new Request(`${SITE}/api/connectors/telegram/webhook`, { method: "POST", headers, body: JSON.stringify(update) });
}

async function capturing(store = makeDeps().store) {
  const user = { kind: "user", profileId: CREATOR } as const;
  const inst = await store.upsertInstallation(user, { provider: "telegram", externalAccountId: CHAT, accountLabel: "Robotics core", scopes: [], credentials: null });
  const link = await store.linkChannel(user, { installationId: inst.id, handoverId: HANDOVER, externalChannelId: CHAT, channelLabel: "Robotics core" });
  return { inst, link, user };
}

describe("telegram webhook verification", () => {
  it("404 when not configured; 401 for a missing or wrong secret, nothing recorded", async () => {
    const { deps: off } = makeDeps({ env: { ...SYNTHETIC_ENV, TELEGRAM_WEBHOOK_SECRET: "" } });
    assert.equal((await handleTelegramWebhook(post({ update_id: 1, message: message() }), off)).status, 404);
    const { deps, store, logs } = makeDeps();
    assert.equal((await handleTelegramWebhook(post({ update_id: 1, message: message() }, null), deps)).status, 401);
    assert.equal((await handleTelegramWebhook(post({ update_id: 1, message: message() }, "wrong"), deps)).status, 401);
    assert.equal(store.events.length, 0);
    assert.deepEqual(logs.map((l) => l.code), ["bad_secret", "bad_secret"]);
  });
});

describe("telegram update mapping", () => {
  const env = SYNTHETIC_ENV;
  it("maps text and captions with display names; media only → media_omitted; no phone numbers or ids", () => {
    const p = parseTelegramUpdate({ update_id: 10, message: message({ reply_to_message: { message_id: 3 } }) }, env);
    assert.ok(p.kind === "event");
    if (p.kind === "event") {
      assert.equal(p.event.deliveryId, "tg:10");
      assert.equal(p.event.externalAccountId, CHAT);
      assert.deepEqual(p.event.messages[0], { providerMessageId: "7", sentAt: new Date(NOW).toISOString(), authorLabel: "Asha K", kind: "text", text: "Battery order is due Friday", replyToId: "3", editedAt: null });
    }
    const cap = parseTelegramUpdate({ update_id: 11, message: message({ text: undefined, caption: "the wiring", photo: [{}] }) }, env);
    assert.ok(cap.kind === "event" && cap.event.messages[0].text === "the wiring");
    const contact = parseTelegramUpdate({ update_id: 12, message: message({ text: undefined, contact: { phone_number: "+15555550100", first_name: "Z" } }) }, env);
    assert.ok(contact.kind === "event" && contact.event.messages[0].kind === "media_omitted");
    assert.doesNotMatch(JSON.stringify(contact), /5555550100|"42"/);
  });

  it("edits keep the message id with editedAt", () => {
    const p = parseTelegramUpdate({ update_id: 13, edited_message: message({ text: "Battery order is due Monday", edit_date: T0 + 60 }) }, env);
    assert.ok(p.kind === "event" && p.event.eventType === "edited_message");
    if (p.kind === "event") {
      assert.equal(p.event.messages[0].providerMessageId, "7");
      assert.equal(p.event.messages[0].editedAt, new Date((T0 + 60) * 1000).toISOString());
    }
  });

  it("skips bots, service messages and private chats", () => {
    const bot = parseTelegramUpdate({ update_id: 14, message: message({ from: { id: 9, is_bot: true, first_name: "Other bot" } }) }, env);
    assert.ok(bot.kind === "event" && bot.event.messages.length === 0);
    const joined = parseTelegramUpdate({ update_id: 15, message: message({ text: undefined, new_chat_members: [asha] }) }, env);
    assert.ok(joined.kind === "event" && joined.event.messages.length === 0);
    const dm = parseTelegramUpdate({ update_id: 16, message: message({ chat: { id: 42, type: "private", first_name: "Asha" } }) }, env);
    assert.ok(dm.kind === "event" && dm.event.externalAccountId === null);
  });

  it("recognises /handover and /handover@<our bot>, not commands for other bots", () => {
    assert.equal(isOurCommand("/handover", "BatonHandoverBot"), true);
    assert.equal(isOurCommand("/handover@batonhandoverbot please", "BatonHandoverBot"), true);
    assert.equal(isOurCommand("/handover@SomeOtherBot", "BatonHandoverBot"), false);
    assert.equal(isOurCommand("/handovers", "BatonHandoverBot"), false);
    assert.equal(botIdFromToken(SYNTHETIC_ENV.TELEGRAM_BOT_TOKEN), BOT_ID);
  });

  it("bot removed (left/kicked) → uninstall lifecycle; group upgraded → links paused", () => {
    const kicked = parseTelegramUpdate({ update_id: 17, my_chat_member: { chat: { id: Number(CHAT), type: "supergroup" }, new_chat_member: { status: "kicked", user: { id: Number(BOT_ID), is_bot: true } } } }, env);
    assert.ok(kicked.kind === "event" && kicked.event.lifecycle?.kind === "uninstalled");
    const other = parseTelegramUpdate({ update_id: 18, my_chat_member: { chat: { id: Number(CHAT), type: "supergroup" }, new_chat_member: { status: "kicked", user: { id: 5, is_bot: false } } } }, env);
    assert.ok(other.kind === "event" && !other.event.lifecycle);
    const migrated = parseTelegramUpdate({ update_id: 19, message: message({ text: undefined, migrate_to_chat_id: -100999 }) }, env);
    assert.ok(migrated.kind === "event" && migrated.event.lifecycle?.kind === "channel_removed");
  });
});

describe("telegram ingest through the webhook", () => {
  it("drops messages before consent, buffers after, de-duplicates retries, replaces edits", async () => {
    const { deps, store } = makeDeps();
    const { link, user } = await capturing(store);
    let res = await handleTelegramWebhook(post({ update_id: 100, message: message() }), deps);
    assert.equal(res.status, 200);
    assert.equal(store.bufferedFor(link.id).length, 0);

    await store.recordCaptureConsent(user, link.id, "v1");
    res = await handleTelegramWebhook(post({ update_id: 101, message: message({ message_id: 8 }) }), deps);
    assert.equal(res.status, 200);
    await handleTelegramWebhook(post({ update_id: 101, message: message({ message_id: 8 }) }), deps); // retry
    await handleTelegramWebhook(post({ update_id: 102, edited_message: message({ message_id: 8, text: "edited", edit_date: T0 + 5 }) }), deps);
    assert.deepEqual(store.bufferedFor(link.id).map((m) => [m.providerMessageId, m.text]), [["8", "edited"]]);
    assert.equal(store.events.filter((e) => e.deliveryId === "tg:101").length, 1);
  });

  it("an unknown group stores nothing", async () => {
    const { deps, store } = makeDeps();
    await handleTelegramWebhook(post({ update_id: 200, message: message({ chat: { id: -100555, type: "group", title: "x" } }) }), deps);
    assert.equal(store.events[0].detail, "no_installation");
  });

  it("bot removed revokes the installation and deletes buffered messages", async () => {
    const { deps, store } = makeDeps();
    const { inst, link, user } = await capturing(store);
    await store.recordCaptureConsent(user, link.id, "v1");
    await handleTelegramWebhook(post({ update_id: 300, message: message() }), deps);
    assert.equal(store.bufferedFor(link.id).length, 1);
    await handleTelegramWebhook(post({ update_id: 301, my_chat_member: { chat: { id: Number(CHAT), type: "supergroup" }, new_chat_member: { status: "left", user: { id: Number(BOT_ID), is_bot: true } } } }), deps);
    assert.equal((await store.getInstallation(inst.id))?.status, "revoked");
    assert.equal(store.bufferedFor(link.id).length, 0);
  });
});

describe("telegram /handover command", () => {
  it("a group admin gets the signed intent in a PRIVATE message; the group only sees a pointer; nothing is linked or stored", async () => {
    const f = fakeFetch([[`POST ${API}/getChatMember`, { json: { ok: true, result: { status: "administrator" } } }], [`POST ${API}/sendMessage`, { json: { ok: true, result: { message_id: 9 } } }]]);
    const { deps, store } = makeDeps({ fetch: f.fetch });
    const res = await handleTelegramWebhook(post({ update_id: 400, message: message({ text: "/handover@BatonHandoverBot" }) }), deps);
    const body = (await res.json()) as { method: string; chat_id: string; text: string };
    assert.equal(body.method, "sendMessage");
    assert.equal(body.chat_id, CHAT);
    assert.match(body.text, /private message/);
    assert.doesNotMatch(body.text, /intent=/);
    const dm = JSON.parse(f.calls.find((c) => c.url.endsWith("/sendMessage"))?.body ?? "{}") as { chat_id: number; text: string };
    assert.equal(dm.chat_id, asha.id);
    const url = dm.text.match(/https:\/\/\S+/)?.[0] ?? "";
    const check = verifyConnectorState(STATE_SECRET, new URL(url).searchParams.get("intent"), NOW);
    assert.ok(check.ok && check.payload.t === "intent" && check.payload.p === "telegram" && check.payload.account === CHAT && check.payload.channel === CHAT);
    assert.equal(store.events.length, 0);
    assert.equal(await store.findInstallation("telegram", CHAT), null);
    assert.doesNotMatch(JSON.stringify(f.calls.map((c) => c.body)), /telegram-synthetic-token/);
  });

  it("when the bot can't message the admin privately, the group gets instructions, never the link", async () => {
    const f = fakeFetch([[`POST ${API}/getChatMember`, { json: { ok: true, result: { status: "creator" } } }], [`POST ${API}/sendMessage`, { status: 403, json: { ok: false, error_code: 403, description: "Forbidden: bot can't initiate conversation with a user" } }]]);
    const { deps } = makeDeps({ fetch: f.fetch });
    const body = (await (await handleTelegramWebhook(post({ update_id: 402, message: message({ text: "/handover" }) }), deps)).json()) as { text: string };
    assert.match(body.text, /press Start/);
    assert.doesNotMatch(body.text, /intent=/);
  });

  it("an anonymous admin is asked to turn off anonymity; no link anywhere", async () => {
    const f = fakeFetch([]);
    const { deps } = makeDeps({ fetch: f.fetch });
    const anon = message({ text: "/handover", from: { id: 1087968824, is_bot: true, first_name: "Group" }, sender_chat: { id: Number(CHAT), type: "supergroup", title: "Robotics core" } });
    const body = (await (await handleTelegramWebhook(post({ update_id: 403, message: anon }), deps)).json()) as { text: string };
    assert.match(body.text, /Remain anonymous/);
    assert.doesNotMatch(body.text, /intent=/);
    assert.equal(f.calls.length, 0);
  });

  it("a member who is not an admin is told to ask an admin", async () => {
    const f = fakeFetch([[`POST ${API}/getChatMember`, { json: { ok: true, result: { status: "member" } } }]]);
    const { deps } = makeDeps({ fetch: f.fetch });
    const body = (await (await handleTelegramWebhook(post({ update_id: 401, message: message({ text: "/handover" }) }), deps)).json()) as { text: string };
    assert.match(body.text, /Only a group admin/);
    assert.doesNotMatch(body.text, /intent=/);
  });
});

describe("telegram adapter", () => {
  it("install redirects to the add-to-group link", async () => {
    const res = await handleTelegramInstall(getRequest(`${SITE}/api/connectors/telegram/install`), makeDeps().deps);
    assert.equal(res.headers.get("location"), "https://t.me/BatonHandoverBot?startgroup=baton");
  });

  it("flags privacy mode when the bot cannot read all group messages and is not an admin", async () => {
    const { deps, store } = makeDeps();
    const { inst } = await capturing(store);
    const chat = [`POST ${API}/getChat`, { json: { ok: true, result: { id: Number(CHAT), type: "supergroup", title: "Robotics core" } } }] as [string, { json: unknown }];
    deps.fetch = fakeFetch([chat, [`POST ${API}/getMe`, { json: { ok: true, result: { id: 123456, username: "BatonHandoverBot", can_read_all_group_messages: false } } }], [`POST ${API}/getChatMember`, { json: { ok: true, result: { status: "member" } } }]]).fetch;
    assert.deepEqual(await telegramAdapter.listChannels(deps, inst), [{ id: CHAT, label: "Robotics core", blockedReason: "privacy_mode" }]);
    deps.fetch = fakeFetch([chat, [`POST ${API}/getMe`, { json: { ok: true, result: { id: 123456, can_read_all_group_messages: true } } }]]).fetch;
    assert.equal((await telegramAdapter.describeChannel(deps, inst, CHAT))?.blockedReason, null);
    assert.equal(await telegramAdapter.describeChannel(deps, inst, "-100777"), null);
  });

  it("chat not found → describeChannel null; notices and leaveChat go to the group", async () => {
    const { deps, store } = makeDeps();
    const { inst, link } = await capturing(store);
    const f = fakeFetch([
      [`POST ${API}/getChat`, { status: 400, json: { ok: false, error_code: 400, description: "Bad Request: chat not found" } }],
      [`POST ${API}/sendMessage`, { json: { ok: true, result: {} } }],
      [`POST ${API}/leaveChat`, { json: { ok: true, result: true } }],
    ]);
    deps.fetch = f.fetch;
    assert.equal(await telegramAdapter.describeChannel(deps, inst, CHAT), null);
    await telegramAdapter.announceCapture!(deps, inst, link, "paused");
    assert.match(JSON.parse(f.calls[1].body ?? "{}").text, /paused/);
    await telegramAdapter.revokeAtProvider!(deps, inst);
    assert.equal(JSON.parse(f.calls[2].body ?? "{}").chat_id, CHAT);
    assert.equal(telegramAdapter.fetchHistory, undefined);
  });
});
