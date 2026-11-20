// 2026-11-20: the pending-version consent workflow is provider-agnostic. Every connector (GitHub, Discord, Slack,
// Telegram) writes through the SAME shared flush (flushLink → SourceWriter): the first flush creates a chat_import
// source, every later flush a new VERSION of it holding only the messages since the previous flush. That version is an
// uploaded candidate until the creator's consent activates it (processing page; components/processing/
// processing-controls.ts), whatever the provider. Synthetic data only; no network, no database.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { TEST_PEPPER } from "../../../fixtures/parser/load";
import { parseSource } from "../../parsers/parse-source";
import { flushLink, type SourceWriteInput, type SourceWriter } from "../flush";
import { ingestEvent } from "../ingest";
import { MemoryConnectorStore } from "../store-memory";
import { CONNECTOR_PROVIDERS, type ConnectorMessage, type ConnectorProvider } from "../types";

const CREATOR = "11111111-1111-4111-8111-111111111111";
const HANDOVER = "33333333-3333-4333-8333-333333333333";
const msg = (id: string, at: string, text: string): ConnectorMessage => ({ providerMessageId: id, sentAt: at, authorLabel: "Asha", kind: "text", text });

const CHANNEL: Record<ConnectorProvider, { account: string; channel: string; label: string }> = {
  github: { account: "777001", channel: "4242", label: "acme/sponsors" },
  discord: { account: "900000000000000001", channel: "900000000000000002", label: "#treasury" },
  slack: { account: "T0SYNTH", channel: "C0CORE", label: "#core-team" },
  telegram: { account: "-1001234567890", channel: "-1001234567890", label: "Treasurer group" },
};

async function linkFor(provider: ConnectorProvider) {
  const store = new MemoryConnectorStore(() => Date.parse("2026-11-20T08:00:00Z"));
  store.handovers.set(HANDOVER, { id: HANDOVER, creatorProfileId: CREATOR, state: "in_review" });
  const user = { kind: "user", profileId: CREATOR } as const;
  const c = CHANNEL[provider];
  const inst = await store.upsertInstallation(user, { provider, externalAccountId: c.account, accountLabel: c.label, scopes: [], credentials: null });
  const link = await store.linkChannel(user, { installationId: inst.id, handoverId: HANDOVER, externalChannelId: c.channel, channelLabel: c.label });
  await store.recordCaptureConsent(user, link.id, "connector-capture-v1");
  const ingest = (deliveryId: string, m: ConnectorMessage) =>
    ingestEvent(store, { provider, deliveryId, eventType: "message", externalAccountId: c.account, externalChannelId: c.channel, messages: [m] });
  return { store, link, ingest };
}

describe("pending source versions: one shared workflow for every connector", () => {
  assert.deepEqual([...CONNECTOR_PROVIDERS].sort(), ["discord", "github", "slack", "telegram"]);

  for (const provider of CONNECTOR_PROVIDERS) {
    it(`${provider}: the second flush is a new VERSION of the first source holding only the new messages`, async () => {
      const { store, link, ingest } = await linkFor(provider);
      const writes: SourceWriteInput[] = [];
      const writer: SourceWriter = {
        async write(i) {
          writes.push(i);
          return { ok: true, sourceId: `src-${provider}-${writes.length}` };
        },
      };

      assert.equal((await ingest("d1", msg("1", "2026-11-20T09:00:00.000Z", "The sponsor invoice is still open"))).status, "processed");
      assert.equal((await flushLink(store, writer, link.id)).status, "flushed");
      assert.equal((await ingest("d2", msg("2", "2026-11-20T09:30:00.000Z", "The finance report is due by Monday"))).status, "processed");
      assert.equal((await flushLink(store, writer, link.id)).status, "flushed");

      // v1 → v2 chain through the shared writer interface (the database writer turns a non-null previousSourceId
      // into create_source_version: an uploaded candidate awaiting consent)
      assert.deepEqual(writes.map((w) => w.previousSourceId), [null, `src-${provider}-1`]);
      assert.equal(writes[0].handoverId, HANDOVER);
      assert.equal(writes[1].fileName, writes[0].fileName, "the same channel transcript name for every version");

      // the version holds only the delta, and parses as an ordinary chat_import source (provider-specific parsing unchanged)
      const v2 = await parseSource({ kind: "chat_import", fileName: writes[1].fileName, bytes: writes[1].bytes, timezone: "UTC", exclusions: [], identityPepper: TEST_PEPPER });
      assert.ok(v2.ok, JSON.stringify(!v2.ok && v2.error));
      assert.equal(v2.data.messages.length, 1);
      assert.match(v2.data.messages[0].body, /due by Monday/);
      const header = JSON.parse(new TextDecoder().decode(writes[1].bytes).split("\n")[0]);
      assert.equal(header.provider, provider);
      assert.equal(header.format, "baton.chat_import");

      // the link now follows the newest version; nothing stays buffered
      assert.equal(store.bufferedFor(link.id).length, 0);
      assert.equal((await store.getLink(link.id))?.sourceId, `src-${provider}-2`);
    });
  }
});
