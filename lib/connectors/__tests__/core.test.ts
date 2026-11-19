// Round 4 connector core (Main): the shared ingest, memory store rules, transcript ⇄ parser round trip, request
// verification, signed state, credential sealing and flush. Synthetic data only; no network, no database.
import assert from "node:assert/strict";
import { createHmac, generateKeyPairSync, sign } from "node:crypto";
import { describe, it } from "node:test";

import { TEST_PEPPER } from "../../../fixtures/parser/load";
import { parseSource } from "../../parsers/parse-source";
import { connectorConfigured, connectorUrls } from "../config";
import { flushDueLinks, flushLink, type SourceWriter } from "../flush";
import { httpStatusFor, ingestEvent, sanitizeMessages } from "../ingest";
import { openCredentials, parseConnectorSecretKey, sealCredentials } from "../secrets";
import { signConnectorState, verifyConnectorState } from "../state";
import { MemoryConnectorStore } from "../store-memory";
import { serializeTranscript, transcriptFileName } from "../transcript";
import type { ConnectorMessage, NormalizedEvent } from "../types";
import { safeEqual, verifyDiscordSignature, verifyGithubSignature, verifySlackSignature, verifyTelegramSecret } from "../verify";

const CREATOR = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const HANDOVER = "33333333-3333-4333-8333-333333333333";

const msg = (id: string, at: string, author = "Asha", text = `message ${id}`): ConnectorMessage => ({ providerMessageId: id, sentAt: at, authorLabel: author, kind: "text", text });

async function setup() {
  const store = new MemoryConnectorStore(() => Date.parse("2026-11-19T10:00:00Z"));
  store.handovers.set(HANDOVER, { id: HANDOVER, creatorProfileId: CREATOR, state: "draft" });
  const user = { kind: "user", profileId: CREATOR } as const;
  const inst = await store.upsertInstallation(user, { provider: "slack", externalAccountId: "T1", accountLabel: "CodeCell", scopes: ["channels:history"], credentials: "c1.x.y.z" });
  const link = await store.linkChannel(user, { installationId: inst.id, handoverId: HANDOVER, externalChannelId: "C1", channelLabel: "#core-team" });
  return { store, user, inst, link };
}

const event = (deliveryId: string, messages: ConnectorMessage[], over: Partial<NormalizedEvent> = {}): NormalizedEvent => ({
  provider: "slack", deliveryId, eventType: "message", externalAccountId: "T1", externalChannelId: "C1", messages, ...over,
});

describe("connector ingest: consent gate, de-duplication, lifecycle", () => {
  it("drops events for a linked channel until the creator consents; nothing is buffered", async () => {
    const { store, link } = await setup();
    const r = await ingestEvent(store, event("e1", [msg("1", "2026-11-19T09:00:00.000Z")]));
    assert.deepEqual(r, { status: "ignored", reason: "no_capturing_link" });
    assert.equal(store.bufferedFor(link.id).length, 0);
  });

  it("only the handover creator can link or consent", async () => {
    const { store, inst, link } = await setup();
    await assert.rejects(store.recordCaptureConsent({ kind: "user", profileId: OTHER }, link.id, "connector-capture-v1"), /forbidden/);
    await assert.rejects(store.linkChannel({ kind: "provider" }, { installationId: inst.id, handoverId: HANDOVER, externalChannelId: "C2", channelLabel: "#x" }), /forbidden/);
  });

  it("buffers after consent, de-duplicates deliveries and replaces edited messages", async () => {
    const { store, user, link } = await setup();
    await store.recordCaptureConsent(user, link.id, "connector-capture-v1");
    const first = await ingestEvent(store, event("e1", [msg("1", "2026-11-19T09:00:00.000Z")]));
    assert.deepEqual(first, { status: "processed", buffered: 1, links: 1 });
    assert.deepEqual(await ingestEvent(store, event("e1", [msg("1", "2026-11-19T09:00:00.000Z")])), { status: "duplicate" });
    await ingestEvent(store, event("e2", [{ ...msg("1", "2026-11-19T09:00:00.000Z", "Asha", "edited"), editedAt: "2026-11-19T09:05:00.000Z" }]));
    assert.deepEqual(store.bufferedFor(link.id).map((m) => m.text), ["edited"]);
  });

  it("a failed delivery is processed again on the provider's retry; a processed one is not", async () => {
    const { store, user, link } = await setup();
    await store.recordCaptureConsent(user, link.id, "connector-capture-v1");
    const r1 = await store.recordEvent({ provider: "slack", deliveryId: "e9", externalAccountId: "T1", eventType: "message" });
    await store.finishEvent(r1.eventId, { status: "failed", code: "internal" });
    const r2 = await ingestEvent(store, event("e9", [msg("9", "2026-11-19T09:00:00.000Z")]));
    assert.equal(r2.status, "processed");
    assert.equal(store.events.find((e) => e.deliveryId === "e9")?.attempts, 2);
  });

  it("other channels, paused links and unknown installations store nothing", async () => {
    const { store, user, link } = await setup();
    await store.recordCaptureConsent(user, link.id, "connector-capture-v1");
    assert.deepEqual(await ingestEvent(store, event("a", [msg("1", "2026-11-19T09:00:00.000Z")], { externalChannelId: "C-other" })), { status: "ignored", reason: "no_capturing_link" });
    assert.deepEqual(await ingestEvent(store, event("b", [msg("1", "2026-11-19T09:00:00.000Z")], { externalAccountId: "T-unknown" })), { status: "ignored", reason: "no_installation" });
    await store.setLinkState(user, link.id, "paused");
    assert.deepEqual(await ingestEvent(store, event("c", [msg("1", "2026-11-19T09:00:00.000Z")])), { status: "ignored", reason: "no_capturing_link" });
    assert.equal(store.bufferedFor(link.id).length, 0);
  });

  it("an uninstall revokes the installation, its links and deletes buffered content", async () => {
    const { store, user, inst, link } = await setup();
    await store.recordCaptureConsent(user, link.id, "connector-capture-v1");
    await ingestEvent(store, event("e1", [msg("1", "2026-11-19T09:00:00.000Z")]));
    await ingestEvent(store, event("u1", [], { externalChannelId: null, eventType: "app_uninstalled", lifecycle: { kind: "uninstalled", reason: "provider_uninstalled" } }));
    assert.equal((await store.getInstallation(inst.id))?.status, "revoked");
    assert.equal(await store.getInstallationCredentials(inst.id), null);
    assert.equal((await store.getLink(link.id))?.state, "revoked");
    assert.equal(store.bufferedFor(link.id).length, 0);
    assert.ok(store.audit.some((a) => a.action === "connector.installation_revoked" && a.actor === "provider"));
  });

  it("resuming capture needs a person and earlier consent; a provider can only pause", async () => {
    const { store, user, link } = await setup();
    await assert.rejects(store.setLinkState(user, link.id, "capturing"), /invalid_transition/);
    await store.recordCaptureConsent(user, link.id, "connector-capture-v1");
    await store.setLinkState({ kind: "provider" }, link.id, "paused");
    await assert.rejects(store.setLinkState({ kind: "provider" }, link.id, "capturing"), /forbidden/);
    assert.equal((await store.setLinkState(user, link.id, "capturing")).state, "capturing");
  });

  it("sanitizes adapter output: control characters, bad timestamps, missing authors, oversized text", () => {
    const out = sanitizeMessages([
      { ...msg("1", "2026-11-19T09:00:00Z"), text: "a\u0000b\r\nc" },
      { ...msg("2", "not a date") },
      { ...msg("3", "2026-11-19T09:00:00Z"), authorLabel: "  " },
      { ...msg("4", "2026-11-19T09:00:00Z"), text: "x".repeat(30_000) },
    ]);
    assert.deepEqual(out.map((m) => m.providerMessageId), ["1", "4"]);
    assert.equal(out[0].text, "ab\nc");
    assert.equal(out[0].sentAt, "2026-11-19T09:00:00.000Z");
    assert.equal(out[1].text.length, 20_000);
  });

  it("maps outcomes to HTTP: retry only on transient failure", () => {
    assert.equal(httpStatusFor({ status: "failed", code: "store_unavailable" }), 503);
    assert.equal(httpStatusFor({ status: "duplicate" }), 200);
    assert.equal(httpStatusFor({ status: "failed", code: "buffer_full" }), 200);
  });
});

describe("chat_import transcript ⇄ parser", () => {
  it("round-trips through parseSource with masking and stable people", async () => {
    const bytes = serializeTranscript("slack", "#core-team", [
      msg("2", "2026-11-19T09:05:00.000Z", "Ravi", "Call me on +91 98765 43210 about sponsors"),
      msg("1", "2026-11-19T09:00:00.000Z", "Asha", "Asha owns reimbursements from now on"),
    ]);
    const r = await parseSource({ kind: "chat_import", fileName: "Slack - #core-team.jsonl", bytes, timezone: "Asia/Kolkata", exclusions: [], identityPepper: TEST_PEPPER });
    assert.ok(r.ok, JSON.stringify(!r.ok && r.error));
    assert.equal(r.data.messages.length, 2);
    assert.match(r.data.messages[0].body, /reimbursements/); // oldest first regardless of input order
    assert.doesNotMatch(r.data.messages[1].body, /98765/); // masked by the shared masker
    assert.deepEqual(r.data.participants.map((p) => p.identityKind), ["name", "name"]);
  });

  it("is deterministic and rejects tampering", async () => {
    const a = serializeTranscript("discord", "#x", [msg("1", "2026-11-19T09:00:00.000Z")]);
    const b = serializeTranscript("discord", "#x", [msg("1", "2026-11-19T09:00:00.000Z")]);
    assert.deepEqual(a, b);
    const bad = new TextEncoder().encode('{"format":"baton.chat_import","version":1,"provider":"x","channel":"y"}\n{"at":"yesterday"}\n');
    const r = await parseSource({ kind: "chat_import", fileName: "x.jsonl", bytes: bad, timezone: "UTC", exclusions: [], identityPepper: TEST_PEPPER });
    assert.equal(r.ok, false);
  });

  it("names the file without unsafe characters", () => {
    assert.equal(transcriptFileName("github", "owner/repo"), "GitHub - owner repo.jsonl");
  });
});

describe("flush: buffer → source through a writer", () => {
  it("writes a source, then a new version, and deletes only flushed rows", async () => {
    const { store, user, link } = await setup();
    await store.recordCaptureConsent(user, link.id, "connector-capture-v1");
    await ingestEvent(store, event("e1", [msg("1", "2026-11-19T09:00:00.000Z")]));
    const writes: Array<{ previousSourceId: string | null; text: string }> = [];
    const writer: SourceWriter = {
      async write(i) {
        writes.push({ previousSourceId: i.previousSourceId, text: new TextDecoder().decode(i.bytes) });
        return { ok: true, sourceId: `src-${writes.length}` };
      },
    };
    assert.equal((await flushLink(store, writer, link.id)).status, "flushed");
    assert.equal(store.bufferedFor(link.id).length, 0);
    await ingestEvent(store, event("e2", [msg("2", "2026-11-19T09:30:00.000Z")]));
    await flushDueLinks(store, writer, { maxLinks: 10, deadlineMs: 10_000 });
    assert.deepEqual(writes.map((w) => w.previousSourceId), [null, "src-1"]);
    assert.doesNotMatch(writes[1].text, /message 1/); // a version holds only new messages (delta)
  });

  it("a refusal keeps the messages buffered and records why", async () => {
    const { store, user, link } = await setup();
    await store.recordCaptureConsent(user, link.id, "connector-capture-v1");
    await ingestEvent(store, event("e1", [msg("1", "2026-11-19T09:00:00.000Z")]));
    const r = await flushLink(store, { write: async () => ({ ok: false, refusal: "handover_not_accepting_updates" }) }, link.id);
    assert.deepEqual(r, { status: "refused", refusal: "handover_not_accepting_updates" });
    assert.equal(store.bufferedFor(link.id).length, 1);
    assert.equal((await store.getLink(link.id))?.lastFlushError, "handover_not_accepting_updates");
  });
});

describe("request verification", () => {
  const body = '{"x":1}';
  it("GitHub sha256 signature", () => {
    const sig = "sha256=" + createHmac("sha256", "s3cret").update(body).digest("hex");
    assert.equal(verifyGithubSignature("s3cret", body, sig), true);
    assert.equal(verifyGithubSignature("s3cret", body + " ", sig), false);
    assert.equal(verifyGithubSignature("", body, sig), false);
  });
  it("Slack v0 signature with replay window", () => {
    const now = Date.parse("2026-11-19T10:00:00Z");
    const ts = String(now / 1000);
    const sig = "v0=" + createHmac("sha256", "signing").update(`v0:${ts}:${body}`).digest("hex");
    assert.equal(verifySlackSignature("signing", body, ts, sig, now), true);
    assert.equal(verifySlackSignature("signing", body, ts, sig, now + 6 * 60_000), false);
  });
  it("Discord Ed25519 signature", () => {
    const { publicKey, privateKey } = generateKeyPairSync("ed25519");
    const raw = publicKey.export({ format: "der", type: "spki" }).subarray(-32).toString("hex");
    const ts = "1700000000";
    const sig = sign(null, Buffer.from(ts + body), privateKey).toString("hex");
    assert.equal(verifyDiscordSignature(raw, body, sig, ts), true);
    assert.equal(verifyDiscordSignature(raw, body + "x", sig, ts), false);
  });
  it("Telegram secret token and constant-time compare", () => {
    assert.equal(verifyTelegramSecret("abc", "abc"), true);
    assert.equal(verifyTelegramSecret("abc", "abd"), false);
    assert.equal(safeEqual("a", "ab"), false);
  });
});

describe("signed state, sealed credentials, config", () => {
  const secret = "x".repeat(40);
  it("state is signed, expires and rejects tampering", () => {
    const tok = signConnectorState(secret, { t: "oauth", p: "slack", profileId: CREATOR, handoverId: HANDOVER, nonce: "n", exp: 2_000_000_000 });
    assert.equal(verifyConnectorState(secret, tok, Date.now()).ok, true);
    assert.deepEqual(verifyConnectorState(secret, tok.replace(/.$/, (c) => (c === "A" ? "B" : "A")), Date.now()), { ok: false, reason: "bad_signature" });
    assert.deepEqual(verifyConnectorState(secret, tok, 2_000_000_001_000), { ok: false, reason: "expired" });
  });
  it("credentials decrypt only for the same account and key", () => {
    const k = parseConnectorSecretKey(Buffer.alloc(32, 7).toString("base64url"), "c1");
    assert.ok(k.ok);
    const env = sealCredentials(k.key, "slack", "T1", "xoxb-synthetic");
    assert.equal(openCredentials(k.key, "slack", "T1", env), "xoxb-synthetic");
    assert.equal(openCredentials(k.key, "slack", "T2", env), null);
    assert.doesNotMatch(env, /xoxb/);
    assert.deepEqual(parseConnectorSecretKey("short", "c1"), { ok: false, reason: "invalid" });
  });
  it("endpoints come from BATON_SITE_URL; a provider is enabled only when fully configured", () => {
    assert.equal(connectorUrls("github", { BATON_SITE_URL: "https://baton.example/" }).webhook, "https://baton.example/api/connectors/github/webhook");
    assert.equal(connectorConfigured("telegram", { BATON_SITE_URL: "https://b.example", CONNECTOR_STATE_SECRET: "s", CONNECTOR_SECRET_KEY: "k", TELEGRAM_BOT_TOKEN: "t", TELEGRAM_BOT_USERNAME: "u" }), false);
  });
});
