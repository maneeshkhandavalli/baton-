// PR #7 review, findings 2 and 3 (2026-11-20).
//  2. A connector chat_import is a CHAT (author + time per message), not a document: an old quotation that turns up in a
//     message with another author or timestamp is "moved", never "present".
//  3. Connector versions are DELTAS. Old evidence whose message a later delta does not re-send stays present (carried);
//     an edit or deletion of a cited message (re-sent at the same place) is still reported.
// The end-to-end case drives three real flushes (memory store → shared transcript → real chat_import parser) and runs
// the real detector on each version, exactly as the analyze job does (lib/pipeline/change-detection.ts).
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { TEST_PEPPER } from "../../../fixtures/parser/load";
import { flushLink, type SourceWriteInput, type SourceWriter } from "../../connectors/flush";
import { ingestEvent } from "../../connectors/ingest";
import { MemoryConnectorStore } from "../../connectors/store-memory";
import type { ConnectorMessage } from "../../connectors/types";
import { parseSource } from "../../parsers/parse-source";
import {
  classifyEvidence,
  detectChanges,
  isAdditiveSourceKind,
  sourceFamily,
  type DetectionInput,
  type DetectionPoint,
  type NewMessage,
  type OldEvidence,
} from "../change-detection";

const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const QUOTE = "Asha is responsible for the monthly reconciliation";
const ev = (n: number, o: Partial<OldEvidence> = {}): OldEvidence => ({
  evidenceId: U(200 + n), pointId: U(300 + n), linkVerdict: "supports", quoteText: QUOTE, messageId: U(400 + n),
  sentAt: "2026-11-20T09:05:00.000Z", authorLabel: "Asha", heading: null, ...o,
});
const msg = (n: number, body: string, o: Partial<NewMessage> = {}): NewMessage => ({
  id: U(100 + n), seq: n, sentAt: "2026-11-20T09:05:00.000Z", authorLabel: "Asha", body, heading: null, ...o,
});
const point = (n: number, o: Partial<DetectionPoint> = {}): DetectionPoint => ({
  pointId: U(300 + n), origin: "extracted", reviewState: "approved", privacyReview: "none", currentRevisionId: U(500 + n),
  title: "Reconciliation", statement: QUOTE, attributes: null, redacted: false, citedMessageIds: [U(400 + n)], ...o,
});
const input = (o: Partial<DetectionInput>): DetectionInput => ({
  family: "chat", watermark: "2026-11-20T09:30:00.000Z", basePublicationId: U(900), basePoints: {}, oldEvidence: [],
  newMessages: [], newLinks: [], points: [], anchors: [], ...o,
});
const kinds = (r: ReturnType<typeof detectChanges>) => r.items.map((i) => i.kind).sort();

describe("finding 2: chat_import is matched as a chat", () => {
  it("sourceFamily: chat_import and whatsapp_export are chats; documents stay documents; only chat_import is additive", () => {
    assert.equal(sourceFamily("chat_import"), "chat");
    assert.equal(sourceFamily("whatsapp_export"), "chat");
    for (const k of ["markdown", "plain_text", "pdf", "docx"]) assert.equal(sourceFamily(k), "document");
    assert.equal(isAdditiveSourceKind("chat_import"), true);
    assert.equal(isAdditiveSourceKind("whatsapp_export"), false);
  });

  const family = sourceFamily("chat_import");
  it("the old quotation in a message by ANOTHER author is moved (author_changed), not present", () => {
    const out = classifyEvidence(family, ev(1), [msg(1, `${QUOTE}.`, { authorLabel: "Ravi" })]);
    assert.equal(out.kind, "moved");
    assert.equal(out.kind === "moved" && out.change, "author_changed");
  });

  it("the old quotation at ANOTHER time is moved (time_changed), not present", () => {
    const out = classifyEvidence(family, ev(1), [msg(1, `${QUOTE}.`, { sentAt: "2026-11-20T10:15:00.000Z" })]);
    assert.equal(out.kind, "moved");
    assert.equal(out.kind === "moved" && out.change, "time_changed");
  });

  it("an unchanged message (same author, same time) is present", () => {
    assert.equal(classifyEvidence(family, ev(1), [msg(1, `${QUOTE}.`)]).kind, "present");
  });

  it("before the fix (document matching, null headings) the moved quotation was wrongly 'present'", () => {
    assert.equal(classifyEvidence("document", ev(1), [msg(1, `${QUOTE}.`, { authorLabel: "Ravi" })]).kind, "present");
  });
});

describe("finding 3: additive (delta) versions", () => {
  const other = msg(9, "The sponsor invoice is still open for this month", { sentAt: "2026-11-20T11:00:00.000Z", authorLabel: "Ravi" });

  it("old evidence absent from the delta is carried, not evidence_missing", () => {
    const r = detectChanges(input({ additive: true, oldEvidence: [ev(1), ev(2, { sentAt: "2026-11-20T09:20:00.000Z" })], newMessages: [other], points: [point(1), point(2)] }));
    assert.equal(r.counts.evidenceMissing, 0);
    assert.equal(r.counts.evidenceCarried, 2);
    assert.deepEqual(kinds(r).filter((k) => k !== "new_information"), []);
  });

  it("the same inputs WITHOUT the additive flag (a full re-export) still report evidence_missing", () => {
    const r = detectChanges(input({ oldEvidence: [ev(1)], newMessages: [other], points: [point(1)] }));
    assert.deepEqual(kinds(r), ["evidence_missing"]);
  });

  it("an EDIT of the cited message (re-sent at the same place) that drops the quotation is evidence_missing", () => {
    const edited = msg(1, "Ravi will take over the monthly reconciliation from December");
    const r = detectChanges(input({ additive: true, oldEvidence: [ev(1)], newMessages: [edited], points: [point(1)] }));
    assert.deepEqual(kinds(r), ["evidence_missing"]);
    assert.equal(r.counts.evidenceCarried, 0);
  });

  it("a DELETION of the cited message (empty tombstone at the same place) is evidence_missing", () => {
    const r = detectChanges(input({ additive: true, oldEvidence: [ev(1)], newMessages: [msg(1, "")], points: [point(1)] }));
    assert.deepEqual(kinds(r), ["evidence_missing"]);
  });

  it("an edit that keeps the quotation at the same place is present (no item)", () => {
    const r = detectChanges(input({ additive: true, oldEvidence: [ev(1)], newMessages: [msg(1, `${QUOTE}, starting next week.`)], points: [point(1)] }));
    assert.deepEqual(kinds(r), []);
    assert.equal(r.counts.evidencePresent, 1);
  });

  it("an edit that moves the quotation to another new message is evidence_moved", () => {
    const r = detectChanges(input({
      additive: true, oldEvidence: [ev(1)],
      newMessages: [msg(1, "(edited: see below)"), msg(2, `Correction: ${QUOTE}.`, { sentAt: "2026-11-20T11:05:00.000Z" })],
      points: [point(1)],
    }));
    assert.deepEqual(kinds(r), ["evidence_moved"]);
  });
});

// ── end to end: three connector versions through the real flush, transcript and parser ─────────────────────────
describe("finding 3, end to end: three successive connector source versions", () => {
  const CREATOR = "11111111-1111-4111-8111-111111111111";
  const HANDOVER = "33333333-3333-4333-8333-333333333333";
  const cm = (id: string, at: string, author: string, text: string, editedAt?: string): ConnectorMessage =>
    ({ providerMessageId: id, sentAt: at, authorLabel: author, kind: "text", text, ...(editedAt ? { editedAt } : {}) });

  async function connector() {
    let clock = Date.parse("2026-11-20T08:00:00Z");
    const store = new MemoryConnectorStore(() => clock);
    store.handovers.set(HANDOVER, { id: HANDOVER, creatorProfileId: CREATOR, state: "in_review" });
    const user = { kind: "user", profileId: CREATOR } as const;
    const inst = await store.upsertInstallation(user, { provider: "telegram", externalAccountId: "-1001", accountLabel: "QA", scopes: [], credentials: null });
    const link = await store.linkChannel(user, { installationId: inst.id, handoverId: HANDOVER, externalChannelId: "-1001", channelLabel: "Treasurer group" });
    await store.recordCaptureConsent(user, link.id, "v1");
    let n = 0;
    const send = (m: ConnectorMessage) =>
      ingestEvent(store, { provider: "telegram", deliveryId: `tg:${++n}`, eventType: "message", externalAccountId: "-1001", externalChannelId: "-1001", messages: [m] });
    const versions: SourceWriteInput[] = [];
    const writer: SourceWriter = { async write(i) { versions.push(i); return { ok: true, sourceId: `src-${versions.length}` }; } };
    const flush = async () => {
      assert.equal((await flushLink(store, writer, link.id)).status, "flushed");
      // parse exactly like the parse job, then expose the rows like list_extraction_messages (author = display label)
      const parsed = await parseSource({ kind: "chat_import", fileName: versions.at(-1)!.fileName, bytes: versions.at(-1)!.bytes, timezone: "UTC", exclusions: [], identityPepper: TEST_PEPPER });
      assert.ok(parsed.ok, JSON.stringify(!parsed.ok && parsed.error));
      const label = new Map(parsed.data.participants.map((p) => [p.localId, p.displayLabel]));
      const v = versions.length;
      return parsed.data.messages.map((m): NewMessage => ({
        id: U(v * 1000 + m.seq), seq: m.seq, sentAt: m.sentAt, authorLabel: m.participantLocalId ? (label.get(m.participantLocalId) ?? null) : null, body: m.body, heading: null,
      }));
    };
    return { send, flush, at: (iso: string) => void (clock = Date.parse(iso)) };
  }

  /** Old evidence exactly as list_change_detection_input returns it: the cited message's author and time. */
  const cite = (n: number, m: NewMessage, quote: string): OldEvidence => ({
    evidenceId: U(700 + n), pointId: U(800 + n), linkVerdict: "supports", quoteText: quote, messageId: m.id, sentAt: m.sentAt, authorLabel: m.authorLabel, heading: null,
  });
  const pt = (n: number, m: NewMessage): DetectionPoint => ({
    pointId: U(800 + n), origin: "extracted", reviewState: "approved", privacyReview: "none", currentRevisionId: U(850 + n),
    title: "t", statement: "s", attributes: null, redacted: false, citedMessageIds: [m.id],
  });
  const detect = (kind: string, oldEvidence: OldEvidence[], newMessages: NewMessage[], points: DetectionPoint[], watermark: string) =>
    detectChanges({ family: sourceFamily(kind), additive: isAdditiveSourceKind(kind), watermark, basePublicationId: U(900), basePoints: {}, oldEvidence, newMessages, newLinks: [], points, anchors: [] });

  const DEADLINE = "The finance report is due by Monday";
  const OWNER = "Asha is responsible for the monthly reconciliation";

  it("v3 delta without the old cited messages → no evidence_missing; their edit in a later delta → reported", async () => {
    const c = await connector();
    c.at("2026-11-20T09:00:00Z");
    await c.send(cm("11", "2026-11-20T09:01:00.000Z", "Asha", `${DEADLINE}.`));
    const v1 = await c.flush();
    await c.send(cm("12", "2026-11-20T09:10:00.000Z", "Asha", `${OWNER}.`));
    const v2 = await c.flush();
    assert.deepEqual([v1.length, v2.length], [1, 1], "each version is a delta");

    // published points cite one message of v1 and one of v2
    const old = [cite(1, v1[0], DEADLINE), cite(2, v2[0], OWNER)];
    const points = [pt(1, v1[0]), pt(2, v2[0])];

    // v3: an unrelated new message only
    await c.send(cm("13", "2026-11-20T09:20:00.000Z", "Ravi", "The sponsor invoice is still open for this month."));
    const v3 = await c.flush();
    assert.equal(v3.length, 1);
    const r3 = detect("chat_import", old, v3, points, v2[0].sentAt as string);
    assert.equal(r3.counts.evidenceMissing, 0, "valid old evidence is not 'missing' because the delta lacks it");
    assert.equal(r3.counts.evidenceCarried, 2);
    assert.equal(r3.items.filter((i) => i.kind === "evidence_missing" || i.kind === "evidence_moved").length, 0);
    // regression guard: the pre-fix comparison (document family, replacement semantics) flagged both
    const before = detectChanges({ family: "document", watermark: null, basePublicationId: U(900), basePoints: {}, oldEvidence: old, newMessages: v3, newLinks: [], points, anchors: [] });
    assert.equal(before.counts.evidenceMissing, 2);

    // v4: Asha edits message 12 in the same capture window; the edit is re-sent with its original time and author
    await c.send(cm("12", "2026-11-20T09:10:00.000Z", "Asha", "Ravi will take over the monthly reconciliation from December.", "2026-11-20T09:25:00.000Z"));
    const v4 = await c.flush();
    assert.equal(v4.length, 1);
    assert.equal(v4[0].sentAt, v2[0].sentAt, "the edit keeps the original send time (same place)");
    const r4 = detect("chat_import", old, v4, points, v3[0].sentAt as string);
    const missing = r4.items.filter((i) => i.kind === "evidence_missing");
    assert.deepEqual(missing.map((i) => i.oldEvidenceId), [U(702)], "the genuinely changed evidence is reported");
    assert.equal(r4.counts.evidenceCarried, 1, "the untouched v1 evidence is carried");

    // v5: message 11 is deleted (a provider tombstone, e.g. Slack/GitHub): its evidence is reported, nothing else
    await c.send({ providerMessageId: "11", sentAt: "2026-11-20T09:01:00.000Z", authorLabel: "Asha", kind: "deleted", text: "" });
    const v5 = await c.flush();
    const r5 = detect("chat_import", old, v5, points, v4[0].sentAt as string);
    assert.deepEqual(r5.items.filter((i) => i.kind === "evidence_missing").map((i) => i.oldEvidenceId), [U(701)],
                     "a deleted cited message is reported as evidence_missing");
  });
});
