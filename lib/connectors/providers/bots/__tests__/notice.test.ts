// Capture notices name the person who connected / paused / stopped capture (Baton display name only), for every bot.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { sealCredentials } from "../../../secrets";
import { discordAdapter } from "../../discord/server";
import { slackAdapter } from "../../slack/server";
import { telegramAdapter } from "../../telegram/server";
import { captureNotice, safeDisplayName } from "../shared";
import { CREATOR, HANDOVER, SYNTHETIC_ENV, fakeFetch, makeDeps } from "../testing";

describe("capture notice wording", () => {
  it("names the person and keeps the consent and disclosure language", () => {
    const started = captureNotice("started", "Asha K");
    assert.match(started, /^Asha K connected this channel to a Baton handover\./);
    assert.match(started, /now saving messages/);
    assert.match(started, /A channel admin or the handover’s creator can pause or stop it in Baton\./);
    assert.match(captureNotice("paused", "Asha K"), /paused by Asha K\)\. Nothing new is saved until the handover’s creator resumes it\./);
    assert.match(captureNotice("stopped", "Asha K"), /stopped by Asha K\)\. Messages it had not yet added to the handover were deleted\./);
  });

  it("falls back to the neutral wording without a usable name", () => {
    for (const name of [null, undefined, "", "   ", "<>*_", "asha@example.test"]) {
      assert.equal(captureNotice("started", name), "Baton is now saving messages in this channel for a handover. A channel admin or the handover’s creator can pause or stop it in Baton.");
      assert.doesNotMatch(captureNotice("paused", name), /paused by/);
    }
  });

  it("never posts mention syntax, markup, control characters, emails or overlong names", () => {
    assert.equal(safeDisplayName("<!channel> Asha"), "!channel Asha");
    assert.equal(safeDisplayName("@everyone"), null);
    assert.equal(safeDisplayName("Asha‮\u0007 *K*"), "Asha K");
    assert.equal(safeDisplayName("someone@example.test"), null);
    assert.equal(safeDisplayName("x".repeat(200))?.length, 60);
  });
});

describe("each bot posts the named notice", () => {
  const BY = "Asha K";

  it("Discord: content names the person; mentions are disabled", async () => {
    const f = fakeFetch([["POST https://discord.com/api/v10/channels/900000000000000777/messages", { json: { id: "1" } }]]);
    const { deps, store } = makeDeps({ fetch: f.fetch });
    const user = { kind: "user", profileId: CREATOR } as const;
    const inst = await store.upsertInstallation(user, { provider: "discord", externalAccountId: "900000000000000555", accountLabel: "Guild", scopes: [], credentials: null });
    const link = await store.linkChannel(user, { installationId: inst.id, handoverId: HANDOVER, externalChannelId: "900000000000000777", channelLabel: "#core" });
    await discordAdapter.announceCapture!(deps, inst, link, "started", BY);
    const body = JSON.parse(f.calls[0].body ?? "{}") as { content: string; allowed_mentions: { parse: string[] } };
    assert.match(body.content, /^Asha K connected this channel/);
    assert.deepEqual(body.allowed_mentions, { parse: [] });
  });

  it("Slack: chat.postMessage text names the person", async () => {
    const f = fakeFetch([["POST https://slack.com/api/chat.postMessage", { json: { ok: true } }]]);
    const { deps, store } = makeDeps({ fetch: f.fetch });
    const user = { kind: "user", profileId: CREATOR } as const;
    const inst = await store.upsertInstallation(user, { provider: "slack", externalAccountId: "T0SYNTH", accountLabel: "WS", scopes: [], credentials: sealCredentials(deps.secretKey!, "slack", "T0SYNTH", "xoxb-synthetic") });
    const link = await store.linkChannel(user, { installationId: inst.id, handoverId: HANDOVER, externalChannelId: "C0CORE", channelLabel: "#core" });
    await slackAdapter.announceCapture!(deps, inst, link, "paused", BY);
    assert.match(decodeURIComponent((f.calls[0].body ?? "").replace(/\+/g, " ")), /paused by Asha K\)/);
  });

  it("Telegram: sendMessage text names the person", async () => {
    const f = fakeFetch([[`POST https://api.telegram.org/bot${SYNTHETIC_ENV.TELEGRAM_BOT_TOKEN}/sendMessage`, { json: { ok: true, result: { message_id: 1 } } }]]);
    const { deps, store } = makeDeps({ fetch: f.fetch });
    const user = { kind: "user", profileId: CREATOR } as const;
    const inst = await store.upsertInstallation(user, { provider: "telegram", externalAccountId: "-1001234567890", accountLabel: "Group", scopes: [], credentials: null });
    const link = await store.linkChannel(user, { installationId: inst.id, handoverId: HANDOVER, externalChannelId: "-1001234567890", channelLabel: "Group" });
    await telegramAdapter.announceCapture!(deps, inst, link, "stopped", BY);
    assert.match((JSON.parse(f.calls[0].body ?? "{}") as { text: string }).text, /stopped by Asha K\)/);
  });
});
