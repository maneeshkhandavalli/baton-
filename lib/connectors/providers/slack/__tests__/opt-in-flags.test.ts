// Slack optional capabilities stay OPT-IN (2026-11-21): SLACK_PRIVATE_CHANNELS and SLACK_SLASH_COMMAND are off unless
// set to an explicit "on" value. Off means: no extra scopes requested, private channels listed as blocked and refused,
// private-channel messages never stored, and the slash command never issues a connect link. Synthetic only.
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { describe, it } from "node:test";

import { sealCredentials } from "../../../secrets";
import { CREATOR, HANDOVER, NOW, SITE, SYNTHETIC_ENV, fakeFetch, makeDeps } from "../../bots/testing";
import { slackBotScopes, slackOptions } from "../api";
import { handleSlackInstall, handleSlackWebhook } from "../routes";
import { slackAdapter } from "../server";

const TEAM = "T0FLAGS";
const PRIVATE = "G0LEADS";
const OFF_VALUES = [undefined, "", "0", "false", "no", "off", "2", "enabled", " ", "TRUE-ish"];
const ON_VALUES = ["1", "true", "yes", "on", " ON "];
const user = { kind: "user", profileId: CREATOR } as const;

function signed(body: string, form = false): Request {
  const ts = String(Math.floor(NOW / 1000));
  const sig = "v0=" + createHmac("sha256", SYNTHETIC_ENV.SLACK_SIGNING_SECRET).update(`v0:${ts}:${body}`).digest("hex");
  return new Request(`${SITE}/api/connectors/slack/webhook`, { method: "POST", headers: { "content-type": form ? "application/x-www-form-urlencoded" : "application/json", "x-slack-request-timestamp": ts, "x-slack-signature": sig }, body });
}

describe("Slack flags are opt-in", () => {
  it("every value other than an explicit on value leaves both flags off", () => {
    for (const v of OFF_VALUES) {
      assert.deepEqual(slackOptions({ SLACK_PRIVATE_CHANNELS: v, SLACK_SLASH_COMMAND: v }), { privateChannels: false, slashCommand: false }, `value ${JSON.stringify(v)}`);
    }
    for (const v of ON_VALUES) assert.deepEqual(slackOptions({ SLACK_PRIVATE_CHANNELS: v, SLACK_SLASH_COMMAND: v }), { privateChannels: true, slashCommand: true });
    assert.deepEqual(slackOptions({}), { privateChannels: false, slashCommand: false }, "unset = off");
  });

  it("by default the install requests exactly the four required scopes (no groups:*, no commands)", async () => {
    const { deps } = makeDeps();
    const res = await handleSlackInstall(new Request(`${SITE}/api/connectors/slack/install?handover=${HANDOVER}`), deps);
    const scope = new URL(res.headers.get("location") ?? "").searchParams.get("scope");
    assert.equal(scope, "channels:history,channels:read,chat:write,users:read");
    assert.deepEqual(slackBotScopes(slackOptions({})), ["channels:history", "channels:read", "chat:write", "users:read"]);
  });

  for (const [flag, expected] of [[undefined, 0], ["1", 1]] as const) it(`private-channel message with SLACK_PRIVATE_CHANNELS=${flag ?? "unset"}: ${expected ? "stored (control)" : "never stored, even for a capturing link"}`, async () => {
    const { deps, store } = makeDeps({ env: { ...SYNTHETIC_ENV, ...(flag ? { SLACK_PRIVATE_CHANNELS: flag } : {}) } });
    const inst = await store.upsertInstallation(user, { provider: "slack", externalAccountId: TEAM, accountLabel: "QA", scopes: [], credentials: sealCredentials(deps.secretKey!, "slack", TEAM, "xoxb-synthetic") });
    const link = await store.linkChannel(user, { installationId: inst.id, handoverId: HANDOVER, externalChannelId: PRIVATE, channelLabel: "#leads" });
    await store.recordCaptureConsent(user, link.id, "v1");
    deps.fetch = fakeFetch([["POST https://slack.com/api/users.info", { json: { ok: true, user: { profile: { display_name: "Asha" } } } }]]).fetch;
    const event = { type: "message", channel: PRIVATE, channel_type: "group", user: "U1", text: "private plan", ts: String(Math.floor((NOW - 60_000) / 1000)) + ".000100" };
    const res = await handleSlackWebhook(signed(JSON.stringify({ type: "event_callback", team_id: TEAM, event_id: "EvP1", event })), deps);
    assert.equal(res.status, 200);
    assert.equal(store.bufferedFor(link.id).length, expected);
  });

  it("with private channels off, the adapter marks a private channel as private_channel (linking refused upstream)", async () => {
    const { deps, store } = makeDeps();
    const inst = await store.upsertInstallation(user, { provider: "slack", externalAccountId: TEAM, accountLabel: "QA", scopes: [], credentials: sealCredentials(deps.secretKey!, "slack", TEAM, "xoxb-synthetic") });
    deps.fetch = fakeFetch([["POST https://slack.com/api/conversations.info", { json: { ok: true, channel: { id: PRIVATE, name: "leads", is_private: true, is_member: true } } }]]).fetch;
    assert.equal((await slackAdapter.describeChannel(deps, inst, PRIVATE))?.blockedReason, "private_channel");
  });

  it("with the slash command off, /handover (any text) never returns a connect link", async () => {
    const { deps } = makeDeps({ env: { ...SYNTHETIC_ENV, SLACK_SLASH_COMMAND: "0" } });
    for (const text of ["", "status", "help", "pause", "connect"]) {
      const body = new URLSearchParams({ command: "/handover", team_id: TEAM, channel_id: "C0CORE", channel_name: "core", text }).toString();
      const r = (await (await handleSlackWebhook(signed(body, true), deps)).json()) as { response_type: string; text: string };
      assert.equal(r.response_type, "ephemeral");
      assert.doesNotMatch(r.text, /intent=/);
      assert.match(r.text, /isn't turned on/);
    }
  });
});
