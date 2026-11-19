// Slack connector (Worker 03): signing secret + replay window, url_verification, message mapping (edits, deletes,
// bots, files, joins), consent gate + de-dup, lifecycle, OAuth with a sealed bot token, slash command intent,
// channels (bot_not_member), history and revocation. Synthetic data only; no network.
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { describe, it } from "node:test";

import { openCredentials } from "../../../secrets";
import { signConnectorState, verifyConnectorState } from "../../../state";
import { CREATOR, HANDOVER, NOW, OTHER, SITE, STATE_SECRET, SYNTHETIC_ENV, fakeFetch, getRequest, makeDeps } from "../../bots/testing";
import { handleSlackCallback, handleSlackInstall, handleSlackWebhook } from "../routes";
import { parseSlackEnvelope, slackAdapter } from "../server";

const TEAM = "T0SYNTH";
const CH = "C0CORE";
const BOT_TOKEN = "xoxb-synthetic";
const API = "https://slack.com/api";
const TS = String(Math.floor(NOW / 1000));

function signed(body: string, opts: { ts?: string; secret?: string; form?: boolean; noSig?: boolean } = {}): Request {
  const ts = opts.ts ?? TS;
  const sig = "v0=" + createHmac("sha256", opts.secret ?? SYNTHETIC_ENV.SLACK_SIGNING_SECRET).update(`v0:${ts}:${body}`).digest("hex");
  const headers: Record<string, string> = { "content-type": opts.form ? "application/x-www-form-urlencoded" : "application/json", "x-slack-request-timestamp": ts };
  if (!opts.noSig) headers["x-slack-signature"] = sig;
  return new Request(`${SITE}/api/connectors/slack/webhook`, { method: "POST", headers, body });
}

const envelope = (eventId: string, event: Record<string, unknown>) => JSON.stringify({ type: "event_callback", team_id: TEAM, event_id: eventId, event });
const msg = (over: Record<string, unknown> = {}) => ({ type: "message", channel: CH, user: "U0ASHA", text: "Sponsor call moved to Tuesday", ts: "1763546400.000100", ...over });

async function installSlack(deps: ReturnType<typeof makeDeps>["deps"], store: ReturnType<typeof makeDeps>["store"]) {
  const { sealCredentials } = await import("../../../secrets");
  const user = { kind: "user", profileId: CREATOR } as const;
  const inst = await store.upsertInstallation(user, { provider: "slack", externalAccountId: TEAM, accountLabel: "CodeCell", scopes: [], credentials: sealCredentials(deps.secretKey!, "slack", TEAM, BOT_TOKEN) });
  const link = await store.linkChannel(user, { installationId: inst.id, handoverId: HANDOVER, externalChannelId: CH, channelLabel: "#core" });
  return { inst, link, user };
}

describe("slack request verification", () => {
  it("404 when not configured; 401 for missing, wrong or stale signatures; nothing parsed or stored", async () => {
    const off = makeDeps({ env: { ...SYNTHETIC_ENV, SLACK_SIGNING_SECRET: "" } }).deps;
    assert.equal((await handleSlackWebhook(signed(envelope("Ev1", msg())), off)).status, 404);
    const { deps, store, logs } = makeDeps();
    assert.equal((await handleSlackWebhook(signed(envelope("Ev1", msg()), { noSig: true }), deps)).status, 401);
    assert.equal((await handleSlackWebhook(signed(envelope("Ev1", msg()), { secret: "wrong" }), deps)).status, 401);
    assert.equal((await handleSlackWebhook(signed(envelope("Ev1", msg()), { ts: String(Number(TS) - 301) }), deps)).status, 401);
    assert.equal((await handleSlackWebhook(signed(envelope("Ev1", msg()), { ts: String(Number(TS) - 200) }), deps)).status, 200);
    assert.equal(store.events.length, 1);
    assert.deepEqual(logs.map((l) => l.code), ["bad_signature", "bad_signature", "bad_signature"]);
  });

  it("echoes url_verification challenges (signed)", async () => {
    const { deps } = makeDeps();
    const res = await handleSlackWebhook(signed(JSON.stringify({ type: "url_verification", challenge: "chal-123", token: "x" })), deps);
    assert.deepEqual(await res.json(), { challenge: "chal-123" });
  });
});

describe("slack event mapping", () => {
  it("maps text with thread parent, edits with the same ts, deletions, files", () => {
    const p = parseSlackEnvelope(JSON.parse(envelope("Ev1", msg({ thread_ts: "1763546000.000001" }))));
    assert.ok(p.kind === "event");
    if (p.kind === "event") {
      assert.equal(p.event.deliveryId, "Ev1");
      assert.equal(p.pending[0].message.providerMessageId, "1763546400.000100");
      assert.equal(p.pending[0].message.replyToId, "1763546000.000001");
      assert.equal(p.pending[0].message.sentAt, "2025-11-19T10:00:00.000Z");
    }
    const edit = parseSlackEnvelope(JSON.parse(envelope("Ev2", { type: "message", subtype: "message_changed", channel: CH, message: msg({ text: "Sponsor call moved to Wed", edited: { user: "U0ASHA", ts: "1763546460.000000" } }) })));
    assert.ok(edit.kind === "event" && edit.pending[0].message.providerMessageId === "1763546400.000100" && edit.pending[0].message.editedAt === "2025-11-19T10:01:00.000Z");
    const del = parseSlackEnvelope(JSON.parse(envelope("Ev3", { type: "message", subtype: "message_deleted", channel: CH, deleted_ts: "1763546400.000100", previous_message: msg() })));
    assert.ok(del.kind === "event" && del.pending[0].message.kind === "deleted");
    const file = parseSlackEnvelope(JSON.parse(envelope("Ev4", msg({ subtype: "file_share", text: "", files: [{ id: "F1" }] }))));
    assert.ok(file.kind === "event" && file.pending[0].message.kind === "media_omitted");
  });

  it("skips bots, joins and leaves", () => {
    for (const e of [msg({ bot_id: "B1" }), msg({ subtype: "bot_message" }), msg({ subtype: "channel_join" }), msg({ subtype: "channel_leave" })]) {
      const p = parseSlackEnvelope(JSON.parse(envelope("Ev9", e)));
      assert.ok(p.kind === "event" && p.pending.length === 0);
    }
  });

  it("app_uninstalled / tokens_revoked (bot) are lifecycle; user-token revocations are not", () => {
    const u = parseSlackEnvelope(JSON.parse(envelope("Ev5", { type: "app_uninstalled" })));
    assert.ok(u.kind === "event" && u.event.lifecycle?.kind === "uninstalled");
    const t = parseSlackEnvelope(JSON.parse(envelope("Ev6", { type: "tokens_revoked", tokens: { bot: ["U0BOT"] } })));
    assert.ok(t.kind === "event" && t.event.lifecycle?.kind === "token_revoked");
    const o = parseSlackEnvelope(JSON.parse(envelope("Ev7", { type: "tokens_revoked", tokens: { oauth: ["U1"] } })));
    assert.ok(o.kind === "event" && !o.event.lifecycle);
  });
});

describe("slack ingest through the webhook", () => {
  it("nothing stored before consent and no users.info lookups; after consent display names are resolved once per request", async () => {
    const f = fakeFetch([[`POST ${API}/users.info`, { json: { ok: true, user: { id: "U0ASHA", name: "asha", profile: { display_name: "Asha", email: "asha@example.test" } } } }]]);
    const { deps, store } = makeDeps({ fetch: f.fetch });
    const { link, user } = await installSlack(deps, store);
    await handleSlackWebhook(signed(envelope("Ev10", msg())), deps);
    assert.equal(store.bufferedFor(link.id).length, 0);
    assert.equal(f.calls.length, 0);

    await store.recordCaptureConsent(user, link.id, "v1");
    const res = await handleSlackWebhook(signed(envelope("Ev11", msg())), deps);
    assert.equal(res.status, 200);
    assert.equal(f.calls[0].headers.authorization, `Bearer ${BOT_TOKEN}`);
    const buffered = store.bufferedFor(link.id);
    assert.equal(buffered[0].authorLabel, "Asha");
    assert.doesNotMatch(JSON.stringify(buffered), /U0ASHA|asha@example/);

    await handleSlackWebhook(signed(envelope("Ev11", msg())), deps); // Slack retry
    assert.equal(store.events.filter((e) => e.deliveryId === "Ev11").length, 1);
    await handleSlackWebhook(signed(envelope("Ev12", { type: "message", subtype: "message_changed", channel: CH, message: msg({ text: "edited", edited: { ts: "1763546460.000000" } }) })), deps);
    assert.deepEqual(store.bufferedFor(link.id).map((m) => m.text), ["edited"]);
    await handleSlackWebhook(signed(envelope("Ev13", { type: "message", subtype: "message_deleted", channel: CH, deleted_ts: "1763546400.000100", previous_message: msg() })), deps);
    assert.deepEqual(store.bufferedFor(link.id).map((m) => m.kind), ["deleted"]);
  });

  it("app_uninstalled revokes the installation, deletes the sealed token and buffered messages", async () => {
    const { deps, store } = makeDeps({ fetch: fakeFetch([[`POST ${API}/users.info`, { json: { ok: true, user: { profile: { display_name: "Asha" } } } }]]).fetch });
    const { inst, link, user } = await installSlack(deps, store);
    await store.recordCaptureConsent(user, link.id, "v1");
    await handleSlackWebhook(signed(envelope("Ev20", msg())), deps);
    await handleSlackWebhook(signed(envelope("Ev21", { type: "app_uninstalled" })), deps);
    assert.equal((await store.getInstallation(inst.id))?.status, "revoked");
    assert.equal(await store.getInstallationCredentials(inst.id), null);
    assert.equal(store.bufferedFor(link.id).length, 0);
  });
});

describe("slack OAuth", () => {
  const state = (profileId = CREATOR, exp = Math.floor(NOW / 1000) + 600) => signConnectorState(STATE_SECRET, { t: "oauth", p: "slack", profileId, handoverId: HANDOVER, nonce: "n", exp });
  const cb = (s: string) => getRequest(`${SITE}/api/connectors/slack/callback?code=code-1&state=${encodeURIComponent(s)}`);

  it("install redirects to Slack with bot scopes, callback URL and signed state", async () => {
    const res = await handleSlackInstall(getRequest(`${SITE}/api/connectors/slack/install?handover=${HANDOVER}`), makeDeps().deps);
    const loc = new URL(res.headers.get("location") ?? "");
    assert.equal(loc.origin + loc.pathname, "https://slack.com/oauth/v2/authorize");
    assert.equal(loc.searchParams.get("scope"), "channels:history,channels:read,groups:history,groups:read,chat:write,commands,users:read");
    assert.equal(loc.searchParams.get("redirect_uri"), `${SITE}/api/connectors/slack/callback`);
    assert.ok(verifyConnectorState(STATE_SECRET, loc.searchParams.get("state"), NOW).ok);
  });

  it("refuses wrong user / expired / tampered state without exchanging the code", async () => {
    const f = fakeFetch([]);
    const { deps } = makeDeps({ fetch: f.fetch });
    assert.equal((await handleSlackCallback(cb(state(OTHER)), deps)).status, 403);
    assert.equal((await handleSlackCallback(cb(state(CREATOR, Math.floor(NOW / 1000) - 5)), deps)).status, 400);
    assert.equal((await handleSlackCallback(cb(state() + "x"), deps)).status, 400);
    assert.equal(f.calls.length, 0);
  });

  it("exchanges the code server-side and stores only the sealed bot token", async () => {
    const f = fakeFetch([[`POST ${API}/oauth.v2.access`, { json: { ok: true, token_type: "bot", access_token: BOT_TOKEN, scope: "channels:history,chat:write", team: { id: TEAM, name: "CodeCell" }, bot_user_id: "U0BOT" } }]]);
    const { deps, store, logs } = makeDeps({ fetch: f.fetch });
    const res = await handleSlackCallback(cb(state()), deps);
    assert.equal(res.headers.get("location"), `${SITE}/handover/${HANDOVER}/settings?connector=slack&installed=1#connectors`);
    assert.match(f.calls[0].body ?? "", /client_secret=slack-synthetic-client-secret/);
    const inst = await store.findInstallation("slack", TEAM);
    assert.ok(inst?.hasCredentials);
    assert.doesNotMatch(JSON.stringify(inst), /xoxb/);
    const envelopeText = (await store.getInstallationCredentials(inst!.id)) ?? "";
    assert.doesNotMatch(envelopeText, /xoxb/);
    assert.equal(openCredentials(deps.secretKey!, "slack", TEAM, envelopeText), BOT_TOKEN);
    assert.doesNotMatch(JSON.stringify([res.headers.get("location"), logs]), /xoxb/);
  });

  it("a re-install by a different Baton user is refused with a clear code", async () => {
    const f = fakeFetch([[`POST ${API}/oauth.v2.access`, { json: { ok: true, token_type: "bot", access_token: BOT_TOKEN, scope: "", team: { id: TEAM, name: "CodeCell" } } }]]);
    const { deps, store } = makeDeps({ fetch: f.fetch, actor: OTHER });
    await store.upsertInstallation({ kind: "user", profileId: CREATOR }, { provider: "slack", externalAccountId: TEAM, accountLabel: "CodeCell", scopes: [], credentials: null });
    const res = await handleSlackCallback(cb(state(OTHER)), deps);
    assert.match(res.headers.get("location") ?? "", /connectorError=installed_by_someone_else/);
  });

  it("provider errors redirect with a code, never Slack's text or the token", async () => {
    const f = fakeFetch([[`POST ${API}/oauth.v2.access`, { json: { ok: false, error: "invalid_code" } }]]);
    const { deps } = makeDeps({ fetch: f.fetch });
    const res = await handleSlackCallback(cb(state()), deps);
    assert.match(res.headers.get("location") ?? "", /connectorError=provider_invalid_response/);
  });
});

describe("slack slash command", () => {
  const form = (over: Record<string, string> = {}) => new URLSearchParams({ command: "/handover", team_id: TEAM, team_domain: "codecell", channel_id: CH, channel_name: "core", user_name: "asha", text: "", ...over }).toString();

  it("answers ephemerally with a verified intent when not capturing, a status when capturing", async () => {
    const { deps, store } = makeDeps();
    const { link, user } = await installSlack(deps, store);
    const body = (await (await handleSlackWebhook(signed(form(), { form: true }), deps)).json()) as { response_type: string; text: string };
    assert.equal(body.response_type, "ephemeral");
    const url = body.text.match(/https:\/\/\S+/)?.[0] ?? "";
    const check = verifyConnectorState(STATE_SECRET, new URL(url).searchParams.get("intent"), NOW);
    assert.ok(check.ok && check.payload.t === "intent" && check.payload.account === TEAM && check.payload.channel === CH && check.payload.channelLabel === "#core");
    assert.equal(store.events.length, 0);

    await store.recordCaptureConsent(user, link.id, "v1");
    const status = (await (await handleSlackWebhook(signed(form(), { form: true }), deps)).json()) as { text: string };
    assert.match(status.text, /saving messages/);
  });

  it("an unsigned slash command is refused", async () => {
    const { deps } = makeDeps();
    assert.equal((await handleSlackWebhook(signed(form(), { form: true, noSig: true }), deps)).status, 401);
  });
});

describe("slack adapter", () => {
  it("lists public and private channels; non-member channels are flagged bot_not_member", async () => {
    const { deps, store } = makeDeps();
    const { inst } = await installSlack(deps, store);
    const f = fakeFetch([[`POST ${API}/conversations.list`, (call) => (call.body?.includes("cursor=") ? { json: { ok: true, channels: [{ id: "C3", name: "random", is_member: true }] } } : { json: { ok: true, channels: [{ id: "C1", name: "core", is_member: true }, { id: "G2", name: "leads", is_private: true, is_member: false }, { id: "C4", name: "old", is_archived: true }], response_metadata: { next_cursor: "abc" } } })]]);
    deps.fetch = f.fetch;
    assert.deepEqual(await slackAdapter.listChannels(deps, inst), [
      { id: "C1", label: "#core", blockedReason: null }, { id: "C3", label: "#random", blockedReason: null }, { id: "G2", label: "#leads", blockedReason: "bot_not_member" },
    ]);
  });

  it("describeChannel: unknown channel → null; revoked token → unauthorized", async () => {
    const { deps, store } = makeDeps();
    const { inst } = await installSlack(deps, store);
    deps.fetch = fakeFetch([[`POST ${API}/conversations.info`, { json: { ok: false, error: "channel_not_found" } }]]).fetch;
    assert.equal(await slackAdapter.describeChannel(deps, inst, "C9ZZ"), null);
    deps.fetch = fakeFetch([[`POST ${API}/conversations.info`, { json: { ok: false, error: "token_revoked" } }]]).fetch;
    await assert.rejects(slackAdapter.describeChannel(deps, inst, "C9ZZ"), (e: { code?: string; message?: string }) => e.code === "unauthorized" && !String(e.message).includes("xoxb"));
  });

  it("fetchHistory returns oldest first with display names", async () => {
    const { deps, store } = makeDeps();
    const { inst, link } = await installSlack(deps, store);
    deps.fetch = fakeFetch([
      [`POST ${API}/conversations.history`, { json: { ok: true, messages: [msg({ ts: "1763546500.000000", text: "second" }), msg({ ts: "1763546400.000000", text: "first", user_profile: { display_name: "Asha" } }), msg({ bot_id: "B1", ts: "1763546450.0" })], has_more: false } }],
      [`POST ${API}/users.info`, { json: { ok: true, user: { profile: { display_name: "Asha" } } } }],
    ]).fetch;
    const out = await slackAdapter.fetchHistory!(deps, inst, link, "2025-11-01T00:00:00Z", 100);
    assert.deepEqual(out.map((m) => [m.text, m.authorLabel]), [["first", "Asha"], ["second", "Asha"]]);
  });

  it("posts notices and revokes the token with auth.revoke", async () => {
    const { deps, store } = makeDeps();
    const { inst, link } = await installSlack(deps, store);
    const f = fakeFetch([[`POST ${API}/chat.postMessage`, { json: { ok: true } }], [`POST ${API}/auth.revoke`, { json: { ok: true, revoked: true } }]]);
    deps.fetch = f.fetch;
    await slackAdapter.announceCapture!(deps, inst, link, "stopped");
    assert.match(f.calls[0].body ?? "", /stopped/);
    await slackAdapter.revokeAtProvider!(deps, inst);
    assert.equal(f.calls[1].headers.authorization, `Bearer ${BOT_TOKEN}`);
  });
});
