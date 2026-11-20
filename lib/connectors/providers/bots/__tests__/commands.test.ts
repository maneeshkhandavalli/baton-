// Extra bot commands (2026-11-21): help, status and pause per provider, behind the same permission rules as
// /handover. Status shows counts and dates only; pause only stops capture (provider actor) and needs a channel admin;
// nothing answers questions about a handover. Synthetic data only; no network.
import assert from "node:assert/strict";
import { createHmac, sign } from "node:crypto";
import { describe, it } from "node:test";

import { handleDiscordWebhook } from "../../discord/routes";
import { handleSlackWebhook } from "../../slack/routes";
import { handleTelegramWebhook } from "../../telegram/routes";
import { isOurCommand, ourCommandAction, parseTelegramUpdate } from "../../telegram/server";
import { discordMemberIsChannelAdmin, helpText, parseCommandAction, pauseChannel, statusText } from "../commands";
import { CREATOR, HANDOVER, NOW, SITE, SYNTHETIC_ENV, discordKeys, fakeFetch, makeDeps } from "../testing";

type Deps = ReturnType<typeof makeDeps>;
const user = { kind: "user", profileId: CREATOR } as const;

async function capturingLink(store: Deps["store"], provider: "telegram" | "discord" | "slack", account: string, channel: string, consent = true) {
  const inst = await store.upsertInstallation(user, { provider, externalAccountId: account, accountLabel: "QA", scopes: [], credentials: null });
  const link = await store.linkChannel(user, { installationId: inst.id, handoverId: HANDOVER, externalChannelId: channel, channelLabel: "QA" });
  if (consent) await store.recordCaptureConsent(user, link.id, "v1");
  return { inst, link };
}

describe("shared command helpers", () => {
  it("parses actions: empty and connect mean connect; unknown words are null, never guessed", () => {
    assert.equal(parseCommandAction(""), "connect");
    assert.equal(parseCommandAction(null), "connect");
    assert.equal(parseCommandAction(" Status please"), "status");
    assert.equal(parseCommandAction("PAUSE"), "pause");
    assert.equal(parseCommandAction("help"), "help");
    assert.equal(parseCommandAction("what was decided about the budget?"), null);
  });

  it("help lists only the provider's commands, says Baton doesn't answer questions, and has no dashes", () => {
    for (const p of ["telegram", "discord", "slack"] as const) {
      const h = helpText(p);
      assert.match(h, /doesn't answer questions/);
      assert.doesNotMatch(h, /[–—]/);
    }
    assert.match(helpText("telegram"), /\/pause/);
    assert.doesNotMatch(helpText("slack"), /pause/, "Slack offers no pause command");
  });

  it("status: counts and dates only, never a handover title, person or message", async () => {
    const { store } = makeDeps();
    assert.match(await statusText(store, "telegram", "-100", "-100"), /isn't saving messages/);
    const { link } = await capturingLink(store, "telegram", "-100", "-100");
    await store.bufferMessages(link.id, [{ providerMessageId: "1", sentAt: new Date(NOW - 60_000).toISOString(), authorLabel: "Asha", kind: "text", text: "secret budget line" }]);
    const s = await statusText(store, "telegram", "-100", "-100");
    assert.match(s, /saving messages in this channel for a handover/);
    assert.match(s, /1 message is waiting/);
    assert.doesNotMatch(s, /Asha|budget|QA|33333333/);
  });

  it("status answers neutrally when the store is down", async () => {
    const broken = { capturingLinks: async () => { throw new Error("db down: postgres://user:pw@host"); } };
    const s = await statusText(broken as never, "discord", "g", "c");
    assert.match(s, /can't check/);
    assert.doesNotMatch(s, /postgres|pw@/);
  });

  it("pause stops capture as the provider actor; the store refuses a provider resume", async () => {
    const { store } = makeDeps();
    const { link } = await capturingLink(store, "discord", "800000000000000001", "800000000000000002");
    const r = await pauseChannel(store, "discord", "800000000000000001", "800000000000000002");
    assert.equal(r.paused, 1);
    assert.match(r.text, /paused saving messages in this channel \(paused by a channel admin\)/);
    assert.equal((await store.getLink(link.id))?.state, "paused");
    await assert.rejects(store.setLinkState({ kind: "provider" }, link.id, "capturing"), /forbidden/);
    const again = await pauseChannel(store, "discord", "800000000000000001", "800000000000000002");
    assert.equal(again.paused, 0);
    assert.match(again.text, /nothing to pause/);
  });

  it("Discord channel admin bits: Administrator, Manage Channels or Manage Server; anything else is not an admin", () => {
    assert.equal(discordMemberIsChannelAdmin(String(1 << 3)), true);
    assert.equal(discordMemberIsChannelAdmin(String(1 << 4)), true);
    assert.equal(discordMemberIsChannelAdmin(String(1 << 5)), true);
    assert.equal(discordMemberIsChannelAdmin("68608"), false); // view + send + read history
    assert.equal(discordMemberIsChannelAdmin(undefined), false);
    assert.equal(discordMemberIsChannelAdmin("8; drop"), false);
    assert.equal(discordMemberIsChannelAdmin(8), false, "a number is not Discord's string bitfield");
  });
});

// ── Telegram ────────────────────────────────────────────────────────────────

const CHAT = "-1001234567890";
const TG_API = `https://api.telegram.org/bot${SYNTHETIC_ENV.TELEGRAM_BOT_TOKEN}`;
const tgMessage = (text: string, from: Record<string, unknown> = { id: 42, is_bot: false, first_name: "Asha" }) => ({
  message_id: 9, date: Math.floor(NOW / 1000), chat: { id: Number(CHAT), type: "supergroup", title: "Robotics core" }, from, text,
});
function tgPost(update: unknown): Request {
  return new Request(`${SITE}/api/connectors/telegram/webhook`, { method: "POST", headers: { "content-type": "application/json", "x-telegram-bot-api-secret-token": SYNTHETIC_ENV.TELEGRAM_WEBHOOK_SECRET }, body: JSON.stringify(update) });
}
const tgAdmin = (status: string) => fakeFetch([[`POST ${TG_API}/getChatMember`, { json: { ok: true, result: { status } } }]]);

describe("telegram commands", () => {
  it("recognises /status, /pause, /help and /handover <action>, addressed to no bot or to ours only", () => {
    assert.equal(ourCommandAction("/status", "BatonHandoverBot"), "status");
    assert.equal(ourCommandAction("/pause@BatonHandoverBot", "BatonHandoverBot"), "pause");
    assert.equal(ourCommandAction("/help@OtherBot", "BatonHandoverBot"), undefined);
    assert.equal(ourCommandAction("/handover status", "BatonHandoverBot"), "status");
    assert.equal(ourCommandAction("/handover what did we decide?", "BatonHandoverBot"), null);
    assert.equal(ourCommandAction("/start", "BatonHandoverBot"), "connect");
    assert.equal(ourCommandAction("/statuses", "BatonHandoverBot"), undefined);
    assert.equal(isOurCommand("/helpme", "BatonHandoverBot"), false);
    const p = parseTelegramUpdate({ update_id: 5, message: tgMessage("/status") }, SYNTHETIC_ENV);
    assert.ok(p.kind === "command" && p.action === "status");
  });

  it("/help answers anyone with static text; nothing is stored", async () => {
    const { deps, store } = makeDeps();
    const body = (await (await handleTelegramWebhook(tgPost({ update_id: 1, message: tgMessage("/help") }), deps)).json()) as { method: string; text: string };
    assert.equal(body.method, "sendMessage");
    assert.match(body.text, /doesn't answer questions/);
    assert.equal(store.events.length, 0);
  });

  it("/status: group admins only (the /handover rule); counts only", async () => {
    const member = makeDeps({ fetch: tgAdmin("member").fetch });
    await capturingLink(member.store, "telegram", CHAT, CHAT);
    const refused = (await (await handleTelegramWebhook(tgPost({ update_id: 2, message: tgMessage("/status") }), member.deps)).json()) as { text: string };
    assert.match(refused.text, /Only a group admin/);

    const admin = makeDeps({ fetch: tgAdmin("administrator").fetch });
    await capturingLink(admin.store, "telegram", CHAT, CHAT);
    const ok = (await (await handleTelegramWebhook(tgPost({ update_id: 3, message: tgMessage("/status") }), admin.deps)).json()) as { text: string };
    assert.match(ok.text, /Baton is saving messages in this channel for a handover/);
  });

  it("/pause: a member is refused and nothing changes; an admin pauses every capturing link publicly", async () => {
    const member = makeDeps({ fetch: tgAdmin("member").fetch });
    const m = await capturingLink(member.store, "telegram", CHAT, CHAT);
    const refused = (await (await handleTelegramWebhook(tgPost({ update_id: 4, message: tgMessage("/pause") }), member.deps)).json()) as { text: string };
    assert.match(refused.text, /Only a group admin can pause/);
    assert.equal((await member.store.getLink(m.link.id))?.state, "capturing");

    const admin = makeDeps({ fetch: tgAdmin("creator").fetch });
    const a = await capturingLink(admin.store, "telegram", CHAT, CHAT);
    const r = (await (await handleTelegramWebhook(tgPost({ update_id: 5, message: tgMessage("/pause") }), admin.deps)).json()) as { chat_id: string; text: string };
    assert.equal(r.chat_id, CHAT, "the pause notice goes to the group");
    assert.match(r.text, /paused saving messages/);
    assert.equal((await admin.store.getLink(a.link.id))?.state, "paused");
    assert.deepEqual(admin.logs.map((l) => l.code), ["paused_by_channel_admin"]);
  });

  it("/pause from an anonymous admin works (Telegram marks it with sender_chat = the group)", async () => {
    const { deps, store } = makeDeps();
    const { link } = await capturingLink(store, "telegram", CHAT, CHAT);
    const msg = { ...tgMessage("/pause"), from: { id: 1087968824, is_bot: true, first_name: "Group" }, sender_chat: { id: Number(CHAT), type: "supergroup", title: "Robotics core" } };
    await handleTelegramWebhook(tgPost({ update_id: 6, message: msg }), deps);
    assert.equal((await store.getLink(link.id))?.state, "paused");
  });

  it("an unknown /handover argument is answered, not guessed or captured as a question", async () => {
    const { deps, store } = makeDeps({ fetch: tgAdmin("administrator").fetch });
    await capturingLink(store, "telegram", CHAT, CHAT);
    const r = (await (await handleTelegramWebhook(tgPost({ update_id: 7, message: tgMessage("/handover what did we decide?") }), deps)).json()) as { text: string };
    assert.match(r.text, /doesn't know that command/);
    assert.equal(store.events.length, 0);
  });
});

// ── Discord ─────────────────────────────────────────────────────────────────

const GUILD = "800000000000000001";
const CHANNEL = "800000000000000002";
function discordPost(body: unknown): Request {
  const raw = JSON.stringify(body);
  const ts = String(Math.floor(NOW / 1000));
  const sig = sign(null, Buffer.from(ts + raw), discordKeys.privateKey).toString("hex");
  return new Request(`${SITE}/api/connectors/discord/webhook`, { method: "POST", headers: { "content-type": "application/json", "x-signature-ed25519": sig, "x-signature-timestamp": ts }, body: raw });
}
const interaction = (action: string | null, permissions = "0") => ({
  id: "700000000000000009", type: 2, guild_id: GUILD, channel_id: CHANNEL, channel: { id: CHANNEL, name: "core-team" },
  data: { name: "handover", ...(action === null ? {} : { options: [{ name: "action", type: 3, value: action }] }) },
  member: { user: { id: "1", username: "asha" }, permissions },
});
type DiscordReply = { type: number; data: { content: string; flags?: number } };
const EPHEMERAL = 1 << 6;

describe("discord commands", () => {
  it("action:help and action:status are ephemeral; status shows counts only", async () => {
    const { deps, store } = makeDeps();
    await capturingLink(store, "discord", GUILD, CHANNEL);
    const help = (await (await handleDiscordWebhook(discordPost(interaction("help")), deps)).json()) as DiscordReply;
    assert.equal(help.data.flags, EPHEMERAL);
    assert.match(help.data.content, /action:status/);
    const status = (await (await handleDiscordWebhook(discordPost(interaction("status")), deps)).json()) as DiscordReply;
    assert.equal(status.data.flags, EPHEMERAL);
    assert.match(status.data.content, /saving messages in this channel for a handover/);
  });

  it("no option still means connect (the original /handover behaviour)", async () => {
    const { deps } = makeDeps();
    const r = (await (await handleDiscordWebhook(discordPost(interaction(null)), deps)).json()) as DiscordReply;
    assert.match(r.data.content, /intent=/);
    assert.equal(r.data.flags, EPHEMERAL);
  });

  it("action:pause: a member without Manage Channels is refused privately; an admin's pause is public", async () => {
    const { deps, store, logs } = makeDeps();
    const { link } = await capturingLink(store, "discord", GUILD, CHANNEL);
    const refused = (await (await handleDiscordWebhook(discordPost(interaction("pause", "68608")), deps)).json()) as DiscordReply;
    assert.equal(refused.data.flags, EPHEMERAL);
    assert.match(refused.data.content, /Only a channel admin/);
    assert.equal((await store.getLink(link.id))?.state, "capturing");

    const done = (await (await handleDiscordWebhook(discordPost(interaction("pause", String(1 << 4))), deps)).json()) as DiscordReply;
    assert.equal(done.data.flags, undefined, "the pause notice is visible to the channel");
    assert.match(done.data.content, /paused saving messages/);
    assert.equal((await store.getLink(link.id))?.state, "paused");
    assert.deepEqual(logs.map((l) => l.code), ["paused_by_channel_admin"]);
  });

  it("an unknown action value is refused ephemerally", async () => {
    const { deps } = makeDeps();
    const r = (await (await handleDiscordWebhook(discordPost(interaction("summarise")), deps)).json()) as DiscordReply;
    assert.equal(r.data.flags, EPHEMERAL);
    assert.match(r.data.content, /doesn't know that command/);
  });
});

// ── Slack ───────────────────────────────────────────────────────────────────

const TEAM = "T0SYNTH";
const CH = "C0CORE";
function slackForm(text: string): Request {
  const body = new URLSearchParams({ command: "/handover", team_id: TEAM, team_domain: "codecell", channel_id: CH, channel_name: "core", user_name: "asha", text }).toString();
  const ts = String(Math.floor(NOW / 1000));
  const sig = "v0=" + createHmac("sha256", SYNTHETIC_ENV.SLACK_SIGNING_SECRET).update(`v0:${ts}:${body}`).digest("hex");
  return new Request(`${SITE}/api/connectors/slack/webhook`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", "x-slack-request-timestamp": ts, "x-slack-signature": sig }, body });
}

describe("slack commands (only with SLACK_SLASH_COMMAND on)", () => {
  it("with the flag off, help and status get the same 'not turned on' pointer as /handover", async () => {
    const { deps, store } = makeDeps();
    await capturingLink(store, "slack", TEAM, CH);
    for (const text of ["help", "status", "pause"]) {
      const r = (await (await handleSlackWebhook(slackForm(text), deps)).json()) as { response_type: string; text: string };
      assert.equal(r.response_type, "ephemeral");
      assert.match(r.text, /isn't turned on/);
    }
  });

  it("with the flag on: help and status are ephemeral; pause is not offered and changes nothing", async () => {
    const { deps, store } = makeDeps({ env: { ...SYNTHETIC_ENV, SLACK_SLASH_COMMAND: "1" } });
    const { link } = await capturingLink(store, "slack", TEAM, CH);
    const help = (await (await handleSlackWebhook(slackForm("help"), deps)).json()) as { response_type: string; text: string };
    assert.equal(help.response_type, "ephemeral");
    assert.match(help.text, /\/handover status/);
    const status = (await (await handleSlackWebhook(slackForm("status"), deps)).json()) as { response_type: string; text: string };
    assert.equal(status.response_type, "ephemeral");
    assert.match(status.text, /saving messages in this channel/);
    const pause = (await (await handleSlackWebhook(slackForm("pause"), deps)).json()) as { response_type: string; text: string };
    assert.equal(pause.response_type, "ephemeral");
    assert.match(pause.text, /isn't available/);
    assert.equal((await store.getLink(link.id))?.state, "capturing");
  });
});
