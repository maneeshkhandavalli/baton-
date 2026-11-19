// Discord connector (Worker 03): interactions signature, PING, /handover intent, OAuth install/callback, pullNew
// cursor + rate limits, message mapping, channels, notices and revocation. Synthetic data only; no network.
import assert from "node:assert/strict";
import { sign } from "node:crypto";
import { describe, it } from "node:test";

import { ingestEvent } from "../../../ingest";
import { signConnectorState, verifyConnectorState } from "../../../state";
import { ProviderError } from "../../adapter";
import { CREATOR, HANDOVER, NOW, OTHER, SITE, STATE_SECRET, SYNTHETIC_ENV, discordKeys, fakeFetch, getRequest, makeDeps } from "../../bots/testing";
import { DISCORD_BOT_PERMISSIONS, snowflakeForTime, timeOfSnowflake } from "../api";
import { handleDiscordCallback, handleDiscordInstall, handleDiscordWebhook } from "../routes";
import { discordAdapter, initialCursor, mapDiscordMessage } from "../server";

const API = "https://discord.com/api/v10";
const GUILD = "800000000000000001";
const CHANNEL = "800000000000000002";
const TOKEN = SYNTHETIC_ENV.DISCORD_BOT_TOKEN;

function signedInteraction(body: unknown, opts: { tamper?: boolean; noSig?: boolean } = {}): Request {
  const raw = JSON.stringify(body);
  const ts = String(Math.floor(NOW / 1000));
  const sig = sign(null, Buffer.from(ts + raw), discordKeys.privateKey).toString("hex");
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (!opts.noSig) {
    headers["x-signature-ed25519"] = sig;
    headers["x-signature-timestamp"] = ts;
  }
  return new Request(`${SITE}/api/connectors/discord/webhook`, { method: "POST", headers, body: opts.tamper ? raw.replace("handover", "handoveR") : raw });
}

const command = (over: Record<string, unknown> = {}) => ({
  id: "700000000000000001", type: 2, guild_id: GUILD, channel_id: CHANNEL, channel: { id: CHANNEL, name: "core-team" },
  data: { name: "handover" }, member: { user: { id: "1", username: "asha" } }, ...over,
});

const dmsg = (id: bigint, over: Record<string, unknown> = {}) => ({
  id: id.toString(), type: 0, content: `message ${id}`, timestamp: new Date(timeOfSnowflake(id.toString())).toISOString(),
  author: { id: "500000000000000001", username: "asha_k", global_name: "Asha K" }, attachments: [], embeds: [], ...over,
});

async function installed(store = makeDeps().store) {
  const user = { kind: "user", profileId: CREATOR } as const;
  const inst = await store.upsertInstallation(user, { provider: "discord", externalAccountId: GUILD, accountLabel: "Robotics Club", scopes: ["bot"], credentials: null });
  const link = await store.linkChannel(user, { installationId: inst.id, handoverId: HANDOVER, externalChannelId: CHANNEL, channelLabel: "#core-team" });
  return { inst, link, user };
}

describe("discord interactions webhook", () => {
  it("answers 404 when Discord is not configured", async () => {
    const { deps } = makeDeps({ env: { ...SYNTHETIC_ENV, DISCORD_BOT_TOKEN: "" } });
    assert.equal((await handleDiscordWebhook(signedInteraction({ type: 1 }), deps)).status, 404);
  });

  it("rejects a missing or wrong signature with 401 before parsing, and logs only a code", async () => {
    const { deps, logs } = makeDeps();
    assert.equal((await handleDiscordWebhook(signedInteraction({ type: 1 }, { noSig: true }), deps)).status, 401);
    assert.equal((await handleDiscordWebhook(signedInteraction(command(), { tamper: true }), deps)).status, 401);
    assert.deepEqual(logs.map((l) => l.code), ["bad_signature", "bad_signature"]);
  });

  it("answers PING with PONG", async () => {
    const { deps } = makeDeps();
    const res = await handleDiscordWebhook(signedInteraction({ id: "1", type: 1 }), deps);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { type: 1 });
  });

  it("/handover in a channel that is not capturing answers ephemerally with a signed intent; nothing is linked", async () => {
    const { deps, store } = makeDeps();
    const { link } = await installed(store);
    const res = await handleDiscordWebhook(signedInteraction(command()), deps);
    const body = (await res.json()) as { type: number; data: { content: string; flags: number } };
    assert.equal(body.type, 4);
    assert.equal(body.data.flags, 64);
    const url = body.data.content.match(/https:\/\/\S+/)?.[0] ?? "";
    assert.ok(url.startsWith(`${SITE}/connect?intent=`));
    const check = verifyConnectorState(STATE_SECRET, decodeURIComponent(new URL(url).searchParams.get("intent") ?? ""), NOW);
    assert.ok(check.ok && check.payload.t === "intent");
    if (check.ok && check.payload.t === "intent") {
      assert.equal(check.payload.p, "discord");
      assert.equal(check.payload.account, GUILD);
      assert.equal(check.payload.channel, CHANNEL);
      assert.equal(check.payload.channelLabel, "#core-team");
      assert.equal(check.payload.accountLabel, "Robotics Club");
    }
    assert.equal((await store.getLink(link.id))?.state, "pending_consent");
    assert.equal(store.events.length, 0);
  });

  it("/handover in a capturing channel answers with a status, no link", async () => {
    const { deps, store } = makeDeps();
    const { link, user } = await installed(store);
    await store.recordCaptureConsent(user, link.id, "v1");
    const body = (await (await handleDiscordWebhook(signedInteraction(command()), deps)).json()) as { data: { content: string } };
    assert.match(body.data.content, /saving messages in this channel for a handover/);
    assert.doesNotMatch(body.data.content, /intent=/);
  });
});

describe("discord OAuth install and callback", () => {
  it("install redirects a signed-out visitor to login and the creator to Discord with bot scopes and signed state", async () => {
    const out = await handleDiscordInstall(getRequest(`${SITE}/api/connectors/discord/install?handover=${HANDOVER}`), makeDeps({ actor: null }).deps);
    assert.equal(out.status, 302);
    assert.ok(out.headers.get("location")?.startsWith(`${SITE}/login?next=`));

    const res = await handleDiscordInstall(getRequest(`${SITE}/api/connectors/discord/install?handover=${HANDOVER}`), makeDeps().deps);
    const loc = new URL(res.headers.get("location") ?? "");
    assert.equal(loc.origin + loc.pathname, "https://discord.com/oauth2/authorize");
    assert.equal(loc.searchParams.get("scope"), "bot applications.commands");
    assert.equal(loc.searchParams.get("permissions"), DISCORD_BOT_PERMISSIONS);
    assert.equal(DISCORD_BOT_PERMISSIONS, "68608");
    assert.equal(loc.searchParams.get("redirect_uri"), `${SITE}/api/connectors/discord/callback`);
    const st = verifyConnectorState(STATE_SECRET, loc.searchParams.get("state"), NOW);
    assert.ok(st.ok && st.payload.t === "oauth" && st.payload.profileId === CREATOR && st.payload.handoverId === HANDOVER);
  });

  it("install refuses someone who is not the handover's creator", async () => {
    const res = await handleDiscordInstall(getRequest(`${SITE}/api/connectors/discord/install?handover=${HANDOVER}`), makeDeps({ actor: OTHER }).deps);
    assert.equal(res.headers.get("location"), `${SITE}/handover/${HANDOVER}/settings?connector=discord&status=not_creator#connectors`);
  });

  const state = (over: Partial<{ profileId: string; exp: number; p: "discord" | "slack" }> = {}) =>
    signConnectorState(STATE_SECRET, { t: "oauth", p: over.p ?? "discord", profileId: over.profileId ?? CREATOR, handoverId: HANDOVER, nonce: "n", exp: over.exp ?? Math.floor(NOW / 1000) + 600 });

  it("callback refuses a wrong user, an expired, a tampered or another provider's state; no code exchange happens", async () => {
    const f = fakeFetch([]);
    const { deps, store } = makeDeps({ fetch: f.fetch });
    const cb = (s: string) => getRequest(`${SITE}/api/connectors/discord/callback?code=abc&guild_id=${GUILD}&state=${encodeURIComponent(s)}`);
    assert.equal((await handleDiscordCallback(cb(state({ profileId: OTHER })), deps)).status, 403);
    assert.equal((await handleDiscordCallback(cb(state({ exp: Math.floor(NOW / 1000) - 1 })), deps)).status, 400);
    assert.equal((await handleDiscordCallback(cb(state() + "x"), deps)).status, 400);
    assert.equal((await handleDiscordCallback(cb(state({ p: "slack" })), deps)).status, 400);
    assert.equal(f.calls.length, 0);
    assert.equal(await store.findInstallation("discord", GUILD), null);
  });

  it("callback exchanges the code server-side and takes the guild from Discord's answer, not the query string", async () => {
    const f = fakeFetch([
      ["POST https://discord.com/api/v10/oauth2/token", { json: { access_token: "user-synthetic", scope: "bot applications.commands", guild: { id: GUILD, name: "Old name" } } }],
      [`GET ${API}/guilds/${GUILD}`, { json: { id: GUILD, name: "Robotics Club" } }],
    ]);
    const { deps, store } = makeDeps({ fetch: f.fetch });
    const res = await handleDiscordCallback(getRequest(`${SITE}/api/connectors/discord/callback?code=abc&guild_id=999999999999999999&state=${encodeURIComponent(state())}`), deps);
    assert.equal(res.status, 302);
    assert.equal(res.headers.get("location"), `${SITE}/handover/${HANDOVER}/settings?connector=discord&status=connected#connectors`);
    const token = f.calls[0];
    assert.match(token.body ?? "", /code=abc/);
    assert.match(token.body ?? "", /redirect_uri=https%3A%2F%2Fbaton.example.test%2Fapi%2Fconnectors%2Fdiscord%2Fcallback/);
    assert.equal(f.calls[1].headers.authorization, `Bot ${TOKEN}`);
    const inst = await store.findInstallation("discord", GUILD);
    assert.equal(inst?.accountLabel, "Robotics Club");
    assert.equal(inst?.hasCredentials, false);
    assert.equal(await store.findInstallation("discord", "999999999999999999"), null);
  });

  it("a failed exchange redirects with a code only (no provider text)", async () => {
    const f = fakeFetch([["POST https://discord.com/api/v10/oauth2/token", { status: 400, json: { error: "invalid_grant", error_description: "secret detail" } }]]);
    const { deps, logs } = makeDeps({ fetch: f.fetch });
    const res = await handleDiscordCallback(getRequest(`${SITE}/api/connectors/discord/callback?code=abc&state=${encodeURIComponent(state())}`), deps);
    assert.match(res.headers.get("location") ?? "", /status=authorization_failed/);
    assert.doesNotMatch(JSON.stringify(logs), /secret detail|discord-synthetic/);
  });
});

describe("discord message mapping", () => {
  const APP = SYNTHETIC_ENV.DISCORD_APPLICATION_ID;
  it("maps text, replies, edits and attachments; uses display names", () => {
    const r = mapDiscordMessage(dmsg(BigInt(1) << BigInt(40), { type: 19, message_reference: { message_id: "123" }, edited_timestamp: "2026-11-19T10:05:00.000Z" }), APP);
    assert.ok("message" in r);
    if ("message" in r) {
      assert.equal(r.message.authorLabel, "Asha K");
      assert.equal(r.message.replyToId, "123");
      assert.equal(r.message.editedAt, "2026-11-19T10:05:00.000Z");
      assert.doesNotMatch(JSON.stringify(r.message), /500000000000000001/);
    }
    const media = mapDiscordMessage(dmsg(BigInt(2) << BigInt(40), { content: "", attachments: [{ id: "1", filename: "a.png" }] }), APP);
    assert.ok("message" in media && media.message.kind === "media_omitted" && media.message.text === "");
  });

  it("skips bots, the app itself, webhooks and system messages", () => {
    assert.deepEqual(mapDiscordMessage(dmsg(BigInt(3) << BigInt(40), { author: { id: "1", username: "bot", bot: true } }), APP), { skip: "bot_or_self_message" });
    assert.deepEqual(mapDiscordMessage(dmsg(BigInt(3) << BigInt(40), { author: { id: APP, username: "baton" } }), APP), { skip: "bot_or_self_message" });
    assert.deepEqual(mapDiscordMessage(dmsg(BigInt(3) << BigInt(40), { webhook_id: "9" }), APP), { skip: "bot_or_self_message" });
    assert.deepEqual(mapDiscordMessage(dmsg(BigInt(3) << BigInt(40), { type: 7 }), APP), { skip: "system" });
  });
});

describe("discord pullNew", () => {
  it("starts at the consent-time snowflake, returns oldest first and the newest id as cursor; buffers via ingest", async () => {
    const { deps, store } = makeDeps();
    const { inst, link, user } = await installed(store);
    const consented = await store.recordCaptureConsent(user, link.id, "v1");
    const start = initialCursor(consented, NOW);
    assert.equal(start, snowflakeForTime(NOW));
    const base = BigInt(start);
    const f = fakeFetch([[`GET ${API}/channels/${CHANNEL}/messages?after=${start}&limit=100`, { json: [dmsg(base + BigInt(30)), dmsg(base + BigInt(20), { author: { id: "x", username: "b", bot: true } }), dmsg(base + BigInt(10))] }]]);
    deps.fetch = f.fetch;
    const out = await discordAdapter.pullNew!(deps, inst, consented, 100);
    assert.deepEqual(out.messages.map((m) => m.providerMessageId), [(base + BigInt(10)).toString(), (base + BigInt(30)).toString()]);
    assert.equal(out.cursor, (base + BigInt(30)).toString());
    const r = await ingestEvent(store, { provider: "discord", deliveryId: `pull:${link.id}:${start}`, eventType: "pull", externalAccountId: GUILD, externalChannelId: CHANNEL, messages: out.messages });
    assert.deepEqual(r, { status: "processed", buffered: 2, links: 1 });
  });

  it("follows pages forward from the stored cursor until the limit", async () => {
    const { deps, store } = makeDeps();
    const { inst, link, user } = await installed(store);
    await store.recordCaptureConsent(user, link.id, "v1");
    await store.setPullCursor(link.id, "1000");
    const page1 = Array.from({ length: 100 }, (_, i) => dmsg(BigInt(1001) + BigInt(i)));
    const f = fakeFetch([
      [`GET ${API}/channels/${CHANNEL}/messages?after=1000&limit=100`, { json: page1.reverse() }],
      [`GET ${API}/channels/${CHANNEL}/messages?after=1100&limit=50`, { json: [dmsg(BigInt(1101))] }],
    ]);
    deps.fetch = f.fetch;
    const out = await discordAdapter.pullNew!(deps, inst, (await store.getLink(link.id))!, 150);
    assert.equal(out.messages.length, 101);
    assert.equal(out.cursor, "1101");
    assert.equal(f.calls.length, 2);
  });

  it("keeps the cursor when nothing is new", async () => {
    const { deps, store } = makeDeps();
    const { inst, link, user } = await installed(store);
    await store.recordCaptureConsent(user, link.id, "v1");
    await store.setPullCursor(link.id, "5000");
    deps.fetch = fakeFetch([[`GET ${API}/channels/${CHANNEL}/messages`, { json: [] }]]).fetch;
    assert.deepEqual(await discordAdapter.pullNew!(deps, inst, (await store.getLink(link.id))!, 100), { messages: [], cursor: "5000" });
  });

  it("429 → ProviderError(rate_limited) with Retry-After; 403/404 → forbidden/not_found (Main pauses the link)", async () => {
    const { deps, store } = makeDeps();
    const { inst, link } = await installed(store);
    for (const [status, code, retry] of [[429, "rate_limited", 7], [403, "forbidden", null], [404, "not_found", null]] as const) {
      deps.fetch = fakeFetch([[`GET ${API}/channels/`, { status, json: { message: "x", retry_after: 6.2 }, headers: retry ? { "retry-after": String(retry) } : {} }]]).fetch;
      await assert.rejects(discordAdapter.pullNew!(deps, inst, link, 100), (e: unknown) => e instanceof ProviderError && e.code === code && (code !== "rate_limited" || e.retryAfterSeconds === 7));
    }
  });

  it("errors never carry the bot token", async () => {
    const { deps, store } = makeDeps();
    const { inst, link } = await installed(store);
    deps.fetch = (async () => {
      throw new Error(`network down for Bot ${TOKEN}`);
    }) as typeof fetch;
    await assert.rejects(discordAdapter.pullNew!(deps, inst, link, 100), (e: unknown) => e instanceof ProviderError && !String(e.message).includes(TOKEN));
  });
});

describe("discord channels, notices, revocation", () => {
  it("lists guild text and announcement channels as #name", async () => {
    const { deps, store } = makeDeps();
    const { inst } = await installed(store);
    deps.fetch = fakeFetch([[`GET ${API}/guilds/${GUILD}/channels`, { json: [
      { id: "11", type: 0, name: "general", position: 2 }, { id: "12", type: 2, name: "voice", position: 0 }, { id: "13", type: 5, name: "news", position: 1 }, { id: "14", type: 4, name: "cat" },
    ] }]]).fetch;
    assert.deepEqual(await discordAdapter.listChannels(deps, inst), [{ id: "13", label: "#news", blockedReason: null }, { id: "11", label: "#general", blockedReason: null }]);
  });

  it("describeChannel refuses a channel of another guild", async () => {
    const { deps, store } = makeDeps();
    const { inst } = await installed(store);
    deps.fetch = fakeFetch([[`GET ${API}/channels/11`, { json: { id: "11", type: 0, name: "x", guild_id: "999" } }]]).fetch;
    assert.equal(await discordAdapter.describeChannel(deps, inst, "11"), null);
  });

  it("announces capture changes without ids, and leaves the guild on disconnect", async () => {
    const { deps, store } = makeDeps();
    const { inst, link } = await installed(store);
    const f = fakeFetch([[`POST ${API}/channels/${CHANNEL}/messages`, { json: {} }], [`DELETE ${API}/users/@me/guilds/${GUILD}`, { status: 204 }]]);
    deps.fetch = f.fetch;
    await discordAdapter.announceCapture!(deps, inst, link, "started");
    const posted = JSON.parse(f.calls[0].body ?? "{}");
    assert.match(posted.content, /Baton is now saving messages/);
    assert.doesNotMatch(posted.content, new RegExp(`${HANDOVER}|${link.id}`));
    await discordAdapter.revokeAtProvider!(deps, inst);
    assert.equal(f.calls[1].method, "DELETE");
  });
});
