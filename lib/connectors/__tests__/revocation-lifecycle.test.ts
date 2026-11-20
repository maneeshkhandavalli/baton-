// Provider-side revocation through the real webhook handlers (2026-11-21): Slack app_uninstalled and tokens_revoked,
// Telegram bot removed, GitHub installation deleted. Each revokes the installation, every link and the buffered
// messages, and deletes sealed credentials. A revocation that fails is observable (a code-only log line, HTTP 503 so
// the provider redelivers) and succeeds on the redelivery. Synthetic data only; no network.
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, it } from "node:test";

import { sealCredentials } from "../secrets";
import type { ConnectorStore } from "../types";
import { CREATOR, HANDOVER, NOW, SITE, SYNTHETIC_ENV, makeDeps } from "../providers/bots/testing";
import { handleSlackWebhook } from "../providers/slack/routes";
import { handleTelegramWebhook } from "../providers/telegram/routes";
import { handleGithubWebhook } from "../providers/github/routes";
import { ENV as GH_ENV, NOW as GH_NOW, SECRETS as GH_SECRETS, setupStore as githubStore, sign as githubSign } from "../providers/github/__tests__/helpers";

const TEAM = "T0REVOKE";
const CH = "C0CORE";
const BOT_TOKEN = "xoxb-synthetic-revocation-token";
const user = { kind: "user", profileId: CREATOR } as const;

let warnings: string[] = [];
const realWarn = console.warn;
beforeEach(() => {
  warnings = [];
  console.warn = (...a: unknown[]) => void warnings.push(a.map(String).join(" "));
});
afterEach(() => {
  console.warn = realWarn;
});

function slackEvent(eventId: string, event: Record<string, unknown>): Request {
  const body = JSON.stringify({ type: "event_callback", team_id: TEAM, event_id: eventId, event });
  const ts = String(Math.floor(NOW / 1000));
  const sig = "v0=" + createHmac("sha256", SYNTHETIC_ENV.SLACK_SIGNING_SECRET).update(`v0:${ts}:${body}`).digest("hex");
  return new Request(`${SITE}/api/connectors/slack/webhook`, { method: "POST", headers: { "content-type": "application/json", "x-slack-request-timestamp": ts, "x-slack-signature": sig }, body });
}

async function slackInstalled() {
  const d = makeDeps();
  const inst = await d.store.upsertInstallation(user, { provider: "slack", externalAccountId: TEAM, accountLabel: "CodeCell", scopes: [], credentials: sealCredentials(d.deps.secretKey!, "slack", TEAM, BOT_TOKEN) });
  const link = await d.store.linkChannel(user, { installationId: inst.id, handoverId: HANDOVER, externalChannelId: CH, channelLabel: "#core" });
  await d.store.recordCaptureConsent(user, link.id, "v1");
  await d.store.bufferMessages(link.id, [{ providerMessageId: "1", sentAt: new Date(NOW - 60_000).toISOString(), authorLabel: "Asha", kind: "text", text: "kept until flushed" }]);
  return { ...d, inst, link };
}

async function assertRevoked(store: ConnectorStore & { bufferedFor(id: string): unknown[] }, instId: string, linkId: string) {
  assert.equal((await store.getInstallation(instId))?.status, "revoked");
  assert.equal(await store.getInstallationCredentials(instId), null, "sealed credentials deleted");
  assert.equal((await store.getLink(linkId))?.state, "revoked");
  assert.equal(store.bufferedFor(linkId).length, 0, "buffered messages deleted");
}

describe("provider uninstall and token revocation", () => {
  it("Slack app_uninstalled revokes installation, links, buffer and sealed token", async () => {
    const { deps, store, inst, link } = await slackInstalled();
    assert.equal((await handleSlackWebhook(slackEvent("EvU1", { type: "app_uninstalled" }), deps)).status, 200);
    await assertRevoked(store, inst.id, link.id);
  });

  it("Slack tokens_revoked (bot token) revokes the same way", async () => {
    const { deps, store, inst, link } = await slackInstalled();
    assert.equal((await handleSlackWebhook(slackEvent("EvT1", { type: "tokens_revoked", tokens: { bot: ["U0BOT"] } }), deps)).status, 200);
    await assertRevoked(store, inst.id, link.id);
  });

  it("Telegram: the bot removed from the group revokes the group's installation", async () => {
    const d = makeDeps();
    const CHAT = "-1009990001";
    const inst = await d.store.upsertInstallation(user, { provider: "telegram", externalAccountId: CHAT, accountLabel: "QA", scopes: [], credentials: null });
    const link = await d.store.linkChannel(user, { installationId: inst.id, handoverId: HANDOVER, externalChannelId: CHAT, channelLabel: "QA" });
    const update = { update_id: 77, my_chat_member: { chat: { id: Number(CHAT), type: "supergroup" }, new_chat_member: { status: "kicked", user: { id: 123456, is_bot: true } } } };
    const res = await handleTelegramWebhook(new Request(`${SITE}/api/connectors/telegram/webhook`, { method: "POST", headers: { "x-telegram-bot-api-secret-token": SYNTHETIC_ENV.TELEGRAM_WEBHOOK_SECRET }, body: JSON.stringify(update) }), d.deps);
    assert.equal(res.status, 200);
    assert.equal((await d.store.getInstallation(inst.id))?.status, "revoked");
    assert.equal((await d.store.getLink(link.id))?.state, "revoked");
  });

  it("GitHub installation.deleted revokes the installation and its repository links", async () => {
    const { store, inst, link } = await githubStore();
    const raw = JSON.stringify({ action: "deleted", installation: { id: Number(inst.externalAccountId), account: { login: "acme" } }, sender: { login: "asha", type: "User" } });
    const req = new Request(`${GH_ENV.BATON_SITE_URL}/api/connectors/github/webhook`, { method: "POST", headers: { "content-type": "application/json", "x-github-event": "installation", "x-github-delivery": "del-1", "x-hub-signature-256": githubSign(raw) }, body: raw });
    const res = await handleGithubWebhook(req, { env: GH_ENV, now: () => GH_NOW, store: () => store, log: () => {} });
    assert.equal(res.status, 200);
    assert.equal((await store.getInstallation(inst.id))?.status, "revoked");
    assert.equal((await store.getLink(link.id))?.state, "revoked");
    assert.ok(!JSON.stringify(warnings).includes(GH_SECRETS.webhook));
  });

  it("a revocation that fails is logged with codes only, answers 503, and succeeds when the provider redelivers", async () => {
    const { deps, store, inst, link } = await slackInstalled();
    const failing: ConnectorStore = Object.create(store);
    failing.revokeInstallation = async () => {
      throw new Error(`db down while revoking ${BOT_TOKEN} for ${TEAM}`);
    };
    const res = await handleSlackWebhook(slackEvent("EvU9", { type: "app_uninstalled" }), { ...deps, store: failing });
    assert.equal(res.status, 503, "Slack retries a 5xx");
    assert.equal((await store.getInstallation(inst.id))?.status, "active");
    const line = warnings.find((w) => w.includes("connector_revocation_failed"));
    assert.ok(line, "the failure is visible in the logs");
    const parsed = JSON.parse(line!);
    assert.deepEqual(Object.keys(parsed).sort(), ["code", "event", "eventType", "provider", "reason", "scope"]);
    assert.equal(parsed.provider, "slack");
    assert.equal(parsed.code, "error");
    for (const w of warnings) {
      assert.ok(!w.includes(BOT_TOKEN), "no token in any log line");
      assert.ok(!w.includes(TEAM), "no workspace id in any log line");
      assert.ok(!w.includes("db down"), "no error message in any log line");
    }
    // redelivery of the same event id after recovery revokes
    assert.equal((await handleSlackWebhook(slackEvent("EvU9", { type: "app_uninstalled" }), deps)).status, 200);
    await assertRevoked(store, inst.id, link.id);
  });
});
