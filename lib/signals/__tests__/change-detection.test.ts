// R3 Task 05D: deterministic change detection of a source update. Synthetic, pseudonymised text only.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  CHANGE_DETECTOR_VERSION,
  classifyEvidence,
  detectChanges,
  findOccurrences,
  isBounded,
  locateQuote,
  samePlace,
  sourceFamily,
  type DetectionInput,
  type DetectionPoint,
  type NewLink,
  type NewMessage,
  type OldEvidence,
} from "../change-detection";

const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const T = (min: number, day = 5) => `2026-01-0${day}T12:${String(min).padStart(2, "0")}:00.000Z`;
const msg = (n: number, body: string, o: Partial<NewMessage> = {}): NewMessage => ({
  id: U(100 + n), seq: n, sentAt: T(30 + n), authorLabel: "[PERSON_1]", body, heading: null, ...o,
});
const ev = (n: number, quoteText: string, o: Partial<OldEvidence> = {}): OldEvidence => ({
  evidenceId: U(200 + n), pointId: U(300 + n), linkVerdict: "supports", quoteText, messageId: U(400 + n),
  sentAt: T(31), authorLabel: "[PERSON_1]", heading: null, ...o,
});
const point = (n: number, o: Partial<DetectionPoint> = {}): DetectionPoint => ({
  pointId: U(300 + n), origin: "extracted", reviewState: "approved", privacyReview: "none", currentRevisionId: U(500 + n),
  title: "Bank signing mandate", statement: "[PERSON_1] is responsible for the club bank signing mandate", attributes: null,
  redacted: false, citedMessageIds: [U(400 + n)], ...o,
});

const QUOTE = "[PERSON_1] is responsible for the club bank signing mandate";

describe("quote location (matcher)", () => {
  it("exact quote present at the same place: present, no item", () => {
    const out = classifyEvidence("chat", ev(1, QUOTE), [msg(1, `${QUOTE} until the AGM`)]);
    assert.equal(out.kind, "present");
  });

  it("quote moved to another message (other time): evidence_moved with offsets in the new body", () => {
    const body = `Reminder: ${QUOTE}.`;
    const out = classifyEvidence("chat", ev(1, QUOTE), [msg(1, "Hi all, notes below"), msg(5, body)]);
    assert.equal(out.kind, "moved");
    assert.ok(out.kind === "moved" && body.slice(out.at.start, out.at.end) === QUOTE && out.change === "time_changed");
  });

  it("quote missing: evidence_missing (not_found)", () => {
    const out = classifyEvidence("chat", ev(1, QUOTE), [msg(1, "Nobody has taken over the club bank signing mandate yet")]);
    assert.deepEqual(out, { kind: "missing", reason: "not_found", candidates: 0 });
  });

  it("same quote repeated in several messages, one of them at the original place: present", () => {
    const out = classifyEvidence("chat", ev(1, QUOTE), [msg(1, QUOTE), msg(7, QUOTE)]);
    assert.equal(out.kind, "present");
    assert.ok(out.kind === "present" && out.at.messageId === U(101));
  });

  it("same quote in several other messages: ambiguous, no message is picked", () => {
    const out = classifyEvidence("chat", ev(1, QUOTE), [msg(3, QUOTE), msg(7, QUOTE)]);
    assert.deepEqual(out, { kind: "ambiguous", candidates: 2 });
    const twice = classifyEvidence("chat", ev(1, QUOTE), [msg(3, `${QUOTE}; again: ${QUOTE}`)]);
    assert.deepEqual(twice, { kind: "ambiguous", candidates: 2 });
  });

  it("placeholder number changed: never a match (PERSON_2 is not assumed to be PERSON_1), reported as placeholder_changed", () => {
    const out = classifyEvidence("chat", ev(1, QUOTE), [msg(1, "[PERSON_2] is responsible for the club bank signing mandate")]);
    assert.deepEqual(out, { kind: "missing", reason: "placeholder_changed", candidates: 1 });
    const phone = classifyEvidence("chat", ev(2, "Call the bank on [PHONE_1] before Friday"), [msg(1, "Call the bank on [PHONE_3] before Friday")]);
    assert.equal(phone.kind === "missing" && phone.reason, "placeholder_changed");
  });

  it("different placeholder types never match each other", () => {
    const out = classifyEvidence("chat", ev(2, "Call the bank on [PHONE_1] before Friday"), [msg(1, "Call the bank on [EMAIL_1] before Friday")]);
    assert.deepEqual(out, { kind: "missing", reason: "not_found", candidates: 0 });
    assert.deepEqual(locateQuote(QUOTE, [msg(1, "[PHONE_1] is responsible for the club bank signing mandate")]), { strict: [], relaxed: [] });
  });

  it("unicode, curly quotes and line breaks in a re-export still match (normalized tier)", () => {
    const quote = "The \"treasurer's\" folder - kept on the shared drive";
    const body = "The “treasurer’s” folder —\n  kept on the shared drive";
    const out = classifyEvidence("chat", ev(3, quote), [msg(1, body)]);
    assert.equal(out.kind, "present");
    assert.ok(out.kind === "present" && out.at.check === "normalized");
    const nfd = classifyEvidence("chat", ev(3, "Café receipts are filed every Monday"), [msg(1, "Café receipts are filed every Monday")]);
    assert.equal(nfd.kind, "present");
  });

  it("case changes are NOT normalised away (consistent with quote verification)", () => {
    const out = classifyEvidence("chat", ev(1, QUOTE), [msg(1, QUOTE.toUpperCase())]);
    assert.equal(out.kind, "missing");
  });

  it("edited context around an unchanged quote: still present", () => {
    const out = classifyEvidence("chat", ev(1, QUOTE), [msg(1, `Update after the meeting — ${QUOTE}, with [PERSON_2] as backup from March`)]);
    assert.equal(out.kind, "present");
  });

  it("a different quote with a misleading substring overlap never matches", () => {
    assert.equal(classifyEvidence("chat", ev(4, "the deposit for the hall is 500"), [msg(1, "the deposit for the hall is 5000")]).kind, "missing");
    assert.equal(classifyEvidence("chat", ev(4, "keys stay with the lab assistant"), [msg(1, "keys stay with the lab assistants office")]).kind, "missing");
    // a short fragment that happens to occur is below the quote minimum and is never evidence
    assert.equal(classifyEvidence("chat", ev(4, "the bank"), [msg(1, "the bank")]).kind, "missing");
    assert.equal(isBounded("x 5000", 2, 5), false);
    assert.equal(isBounded("x 500.", 2, 5), true);
  });

  it("document location: a line shift in the same section is present; another section is moved", () => {
    const e = ev(5, QUOTE, { sentAt: null, authorLabel: null, heading: "Banking" });
    const same = classifyEvidence("document", e, [msg(9, QUOTE, { sentAt: null, authorLabel: null, heading: "Banking", seq: 40 })]);
    assert.equal(same.kind, "present");
    const moved = classifyEvidence("document", e, [msg(9, QUOTE, { sentAt: null, authorLabel: null, heading: "Archive" })]);
    assert.ok(moved.kind === "moved" && moved.change === "section_changed");
    assert.equal(samePlace("document", e, msg(1, "", { heading: "Banking" })), true);
  });

  it("finds every bounded occurrence with offsets into the original body", () => {
    const body = "Note: the receipts folder is on the shared drive. Again, the receipts folder is on the shared drive.";
    const occ = findOccurrences(body, "the receipts folder is on the shared drive");
    assert.equal(occ.length, 2);
    for (const o of occ) assert.equal(body.slice(o.start, o.end), "the receipts folder is on the shared drive");
  });

  it("source family", () => {
    assert.equal(sourceFamily("whatsapp_export"), "chat");
    assert.equal(sourceFamily("markdown"), "document");
    assert.equal(sourceFamily("pdf"), "document");
  });
});

function input(o: Partial<DetectionInput>): DetectionInput {
  return {
    family: "chat", watermark: T(37), basePublicationId: U(900), basePoints: {}, oldEvidence: [], newMessages: [], newLinks: [],
    points: [], anchors: [], ...o,
  };
}

describe("detectChanges", () => {
  const anchor = { id: U(401), sourceId: U(1), seq: 1, sentAt: T(32), authorLabel: "[PERSON_1]", body: QUOTE };
  const reexport = [
    msg(0, "Hi all, writing down the treasurer handover bits", { sentAt: T(30) }),
    msg(1, QUOTE, { sentAt: T(31) }),
    msg(2, "Thanks, I will keep the receipts folder updated", { sentAt: T(34) }),
    msg(3, "Great, the lab cupboard keys stay with the lab assistant", { sentAt: T(37) }),
  ];

  it("present / moved / missing: one item each for moved and missing, none for present; base revision from the publication", () => {
    const r = detectChanges(input({
      oldEvidence: [ev(1, QUOTE), ev(2, "Sponsor reimbursements come from the shared account"), ev(3, "[PERSON_2] keeps the receipts book in the office")],
      newMessages: [...reexport, msg(9, "Sponsor reimbursements come from the shared account", { sentAt: T(9, 6) })],
      points: [point(1), point(2), point(3)],
      basePoints: { [U(301)]: U(601) },
    }));
    assert.deepEqual(r.items.map((i) => i.kind).sort(), ["evidence_missing", "evidence_moved"]);
    assert.equal(r.counts.evidencePresent, 1);
    const moved = r.items.find((i) => i.kind === "evidence_moved")!;
    assert.equal(moved.oldEvidenceId, U(202));
    assert.equal(moved.newMessageId, U(109));
    assert.equal(moved.baseRevisionId, U(502), "unpublished point: its current revision");
    assert.equal(r.items.find((i) => i.kind === "evidence_missing")!.oldEvidenceId, U(203));
    assert.match(moved.dedupeKey, /^evidence_moved:[0-9a-f-]{36}:[0-9a-f-]{36}$/);
  });

  it("ambiguous: an evidence_moved item that names no message", () => {
    const r = detectChanges(input({ oldEvidence: [ev(1, QUOTE)], newMessages: [msg(3, QUOTE), msg(7, QUOTE)], points: [point(1)] }));
    assert.equal(r.items.length, 1);
    assert.equal(r.items[0].kind, "evidence_moved");
    assert.equal(r.items[0].newMessageId, undefined);
    assert.deepEqual(r.items[0].detail, { match: "ambiguous", candidates: 2, family: "chat" });
  });

  it("new chat content: after the watermark, at the watermark conservatively, never re-exported earlier content", () => {
    const r = detectChanges(input({
      oldEvidence: [ev(1, QUOTE)], points: [point(1)],
      newMessages: [...reexport, msg(4, "Another note at the same minute as the last one", { sentAt: T(37) }),
                    msg(5, "The bank signing mandate submission was moved to 15 April", { sentAt: T(35, 6) })],
    }));
    // after: msg 5; at the watermark: msgs 3 and 4 (equal timestamp → possibly new); earlier re-exports excluded;
    // msg 1 carries retained evidence
    assert.equal(r.counts.newContentMessages, 3);
  });

  it("a cumulative re-export of the same content creates no item at all", () => {
    const r = detectChanges(input({ oldEvidence: [ev(1, QUOTE)], points: [point(1)], newMessages: reexport.slice(0, 3), anchors: [anchor] }));
    assert.deepEqual(r.items, []);
    assert.equal(r.counts.newContentMessages, 0);
  });

  it("a later message that may change an existing point: possible_contradiction (new content only)", () => {
    const later = msg(6, "Actually the club bank signing mandate is moved to [PERSON_2] from 15 April", { sentAt: T(5, 6), authorLabel: "[PERSON_2]" });
    const r = detectChanges(input({
      oldEvidence: [ev(1, QUOTE)], points: [point(1)], anchors: [anchor], newMessages: [...reexport, later],
    }));
    const c = r.items.filter((i) => i.kind === "possible_contradiction");
    assert.equal(c.length, 1);
    assert.equal(c[0].newMessageId, later.id);
    assert.equal(c[0].pointId, U(301));
    assert.equal(c[0].detail.coverage, "after_watermark");
    assert.ok((c[0].detail.reasons as string[]).includes("reversal_marker"));
  });

  it("a new-version block this run already cites is also an anchor: still one item per point and message (unique dedupe keys)", () => {
    // Judge repro: a .md notes update whose extraction cites new blocks; those blocks come back as anchors too.
    const e = ev(1, QUOTE, { sentAt: null, authorLabel: null, heading: "Banking" });
    const later = msg(2, "Actually the club bank signing mandate moved to [PERSON_2] in April", { sentAt: null, authorLabel: null, heading: "Banking" });
    const r = detectChanges(input({
      // the point's own anchor sorts before the duplicated block (ids are random in production)
      family: "document", watermark: null, oldEvidence: [e], points: [point(1, { citedMessageIds: [U(11)] })],
      anchors: [{ ...anchor, id: U(11), sentAt: null }, { id: later.id, sourceId: U(2), seq: 2, sentAt: null, authorLabel: null, body: later.body }],
      newMessages: [msg(1, QUOTE, { sentAt: null, authorLabel: null, heading: "Banking" }), later],
    }));
    const keys = r.items.map((i) => i.dedupeKey);
    assert.equal(new Set(keys).size, keys.length, "the database refuses duplicate dedupe keys for the whole update");
    const c = r.items.filter((i) => i.kind === "possible_contradiction");
    assert.equal(c.length, 1);
    assert.equal(c[0].newMessageId, later.id);
    assert.equal(r.counts.possibleContradictions, 1);
  });

  it("documents: uncited blocks are only previously uncited; a contradiction there says so", () => {
    const e = ev(1, QUOTE, { sentAt: null, authorLabel: null, heading: "Banking" });
    const r = detectChanges(input({
      family: "document", watermark: null, oldEvidence: [e], points: [point(1)],
      anchors: [{ ...anchor, sentAt: null }],
      newMessages: [msg(1, QUOTE, { sentAt: null, authorLabel: null, heading: "Banking" }),
                    msg(2, "Actually the club bank signing mandate moved to [PERSON_2] in April", { sentAt: null, authorLabel: null, heading: "Banking" })],
    }));
    assert.equal(r.counts.newContentMessages, 1);
    const c = r.items.find((i) => i.kind === "possible_contradiction");
    assert.equal(c?.detail.coverage, "previously_uncited");
  });

  it("new information: a pending point backed only by the new version, once; never for a never-published handover", () => {
    const links: NewLink[] = [
      { evidenceId: U(701), pointId: U(309), messageId: U(105), quoteStart: 0, quoteEnd: 20, verdict: "supports", quoteCheck: "exact", pointHasOtherEvidence: false },
      { evidenceId: U(702), pointId: U(301), messageId: U(101), quoteStart: 0, quoteEnd: 20, verdict: "supports", quoteCheck: "exact", pointHasOtherEvidence: true },
    ];
    const pts = [point(1), point(9, { reviewState: "pending", citedMessageIds: [U(105)] })];
    const msgs = [...reexport, msg(5, "The sponsor reimbursements moved to the new shared drive folder", { sentAt: T(30, 6) })];
    const r = detectChanges(input({ oldEvidence: [ev(1, QUOTE)], points: pts, newLinks: links, newMessages: msgs }));
    const ni = r.items.filter((i) => i.kind === "new_information");
    assert.equal(ni.length, 1);
    assert.equal(ni[0].candidatePointId, U(309));
    assert.equal(ni[0].newEvidenceId, U(701));
    assert.equal(ni[0].detail.coverage, "after_watermark");
    const unpublished = detectChanges(input({ basePublicationId: null, oldEvidence: [ev(1, QUOTE)], points: pts, newLinks: links, newMessages: msgs }));
    assert.equal(unpublished.items.filter((i) => i.kind === "new_information").length, 0, "initial review flow instead");
  });

  it("support_changed only when the support check judged the same passage the other way", () => {
    const link = (verdict: string): NewLink => ({ evidenceId: U(710), pointId: U(301), messageId: U(101), quoteStart: 0, quoteEnd: QUOTE.length, verdict,
                                                  quoteCheck: "exact", pointHasOtherEvidence: true });
    const base = { oldEvidence: [ev(1, QUOTE)], points: [point(1)], newMessages: reexport };
    assert.equal(detectChanges(input({ ...base, newLinks: [link("supports")] })).items.length, 0, "same polarity: nothing");
    assert.equal(detectChanges(input({ ...base, newLinks: [link("unchecked")] })).items.length, 0, "not judged: no basis");
    const r = detectChanges(input({ ...base, newLinks: [link("contradicts")] }));
    assert.equal(r.items.length, 1);
    assert.deepEqual([r.items[0].kind, r.items[0].newEvidenceId, r.items[0].detail], ["support_changed", U(710), { from: "supports", to: "contradicts" }]);
  });

  it("is deterministic: the same input gives the same items (a retry creates the same set)", () => {
    const i = input({ oldEvidence: [ev(1, QUOTE), ev(2, "Nothing like this remains anywhere")], points: [point(1), point(2)], anchors: [anchor],
                      newMessages: [...reexport, msg(6, "Actually the club bank signing mandate is moved to [PERSON_2] from 15 April", { sentAt: T(5, 6) })] });
    assert.deepEqual(detectChanges(i), detectChanges(structuredClone(i)));
    assert.equal(new Set(detectChanges(i).items.map((x) => x.dedupeKey)).size, detectChanges(i).items.length, "dedupe keys are unique");
  });

  it("detail never carries message text", () => {
    const later = msg(6, "Actually the club bank signing mandate is moved to [PERSON_2] from 15 April", { sentAt: T(5, 6) });
    const r = detectChanges(input({ oldEvidence: [ev(1, QUOTE), ev(2, "gone gone gone gone gone")], points: [point(1), point(2)], anchors: [anchor], newMessages: [...reexport, later] }));
    for (const it of r.items) {
      for (const v of Object.values(it.detail).flat()) if (typeof v === "string") assert.match(v, /^[a-z0-9_.-]{0,64}$/);
    }
    assert.match(CHANGE_DETECTOR_VERSION, /^[a-z0-9_.@-]{1,32}$/);
  });

  it("erased (unlisted) points and rejected points produce nothing", () => {
    const r = detectChanges(input({ oldEvidence: [ev(1, "Nothing like this remains anywhere")], points: [], newMessages: reexport }));
    assert.deepEqual(r.items, []);
  });
});

// 2026-11-20 (Round 4, Telegram connector version 2): a connector chat_import is a chat (PR #7 finding 2) and each
// flush is a DELTA (additive, finding 3). Version 1 had no retained evidence (nothing was extracted from it), so version 2 (two new
// messages) must yield only new_information for its two new points: no evidence_missing, nothing about existing points.
describe("detectChanges: connector delta version over a version without evidence", () => {
  it("two new messages → two new_information items, zero evidence_missing; existing points are never referenced", () => {
    assert.equal(sourceFamily("chat_import"), "chat");
    const existing = [1, 2, 3, 4].map((n) => point(n, { reviewState: n <= 2 ? "approved" : "pending", origin: n <= 2 ? "extracted" : "gap_answer" }));
    const fresh = [point(7, { reviewState: "pending", citedMessageIds: [U(107)] }), point(8, { reviewState: "pending", citedMessageIds: [U(108)] })];
    const links: NewLink[] = [7, 8].map((n) => ({
      evidenceId: U(600 + n), pointId: U(300 + n), messageId: U(100 + n), quoteStart: 0, quoteEnd: 30, verdict: "supports",
      quoteCheck: "exact", pointHasOtherEvidence: false,
    }));
    const r = detectChanges(input({
      family: "chat", additive: true, watermark: T(36),
      oldEvidence: [], // version 1 retained no evidence
      newMessages: [msg(7, "The finance report is due by Monday."), msg(8, "[PERSON_2] is responsible for the monthly reconciliation.")],
      newLinks: links,
      points: [...existing, ...fresh],
    }));
    assert.equal(r.counts.evidenceMissing, 0);
    assert.equal(r.items.filter((i) => i.kind === "evidence_missing").length, 0);
    const info = r.items.filter((i) => i.kind === "new_information");
    assert.deepEqual(info.map((i) => i.candidatePointId).sort(), [U(307), U(308)]);
    const touched = new Set(r.items.flatMap((i) => [i.pointId, i.candidatePointId]).filter(Boolean));
    for (const p of existing) assert.ok(!touched.has(p.pointId), `existing point ${p.pointId} is not referenced`);
  });
});
