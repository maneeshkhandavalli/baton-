// R3 Task 03: deterministic signal detection (EXT-1), attribution (VER-3) and contradiction retrieval
// (VER-2). Synthetic, pseudonymised text only.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { checkAttribution } from "../attribution";
import { findContradictionCandidates, isNewer, type RetrievalMessage } from "../contradictions";
import { detectMessageSignals, isSignalBearing, normaliseAmount, scanSourceSignals } from "../detect";
import { MAX_SIGNALS_PER_MESSAGE, SIGNAL_DETECTOR_VERSION } from "../taxonomy";

const kinds = (body: string) => [...new Set(detectMessageSignals({ id: "m", body }).map((s) => s.kind))].sort();

describe("detectMessageSignals", () => {
  it("finds each kind of the taxonomy on typical handover lines", () => {
    assert.ok(kinds("Sponsor form is due by 5th December, please don't miss it").includes("deadline"));
    assert.ok(kinds("See you on Monday").includes("date"));
    assert.ok(!kinds("See you on Monday").includes("deadline"));
    assert.ok(kinds("We need to pay ₹5,000 advance to the caterer").includes("financial_commitment"));
    assert.ok(kinds("The poster said 300 rupees").includes("amount"));
    assert.ok(kinds("[PERSON_2] can you book the auditorium?").includes("assignment"));
    assert.ok(kinds("[PERSON_3] is in charge of the sponsor relations").includes("ownership"));
    assert.ok(kinds("Ok we decided to go with the blue banner").includes("decision"));
    assert.ok(kinds("Actually the event is postponed to next week").includes("reversal"));
    assert.ok(kinds("I'll send the invoice tonight").includes("commitment"));
    assert.ok(kinds("We are waiting for the dean to sign off").includes("dependency"));
    assert.ok(kinds("Does anyone know where the cash box key is?").includes("open_question"));
    assert.ok(kinds("ping @[PERSON_4]").includes("person_mention"));
    assert.ok(kinds("Form: https://forms.gle/abc123").includes("url"));
    assert.ok(kinds("Send it to [UPI_1] and the login is with [EMAIL_2]").includes("account_identifier"));
  });

  it("keeps offsets into the original body (the evidence is not copied or changed)", () => {
    const body = "Reminder: venue payment of Rs. 12,000 is due by Friday.";
    for (const s of detectMessageSignals({ id: "m", body })) {
      assert.ok(s.start >= 0 && s.end <= body.length && s.end > s.start);
      assert.equal(s.messageId, "m");
    }
    const amount = detectMessageSignals({ id: "m", body }).find((s) => s.kind === "financial_commitment");
    assert.equal(body.slice(amount!.start, amount!.end), "Rs. 12,000");
    assert.equal(amount!.value, "INR 12000");
  });

  it("never un-masks or resolves tokens: values are the tokens themselves", () => {
    const s = detectMessageSignals({ id: "m", body: "[PERSON_7] please call [PHONE_1]" });
    assert.equal(s.find((x) => x.kind === "assignment")?.value, "[PERSON_7]");
    assert.equal(s.find((x) => x.kind === "account_identifier")?.value, "[PHONE]");
  });

  it("cues ending in ':' match (regression: a trailing \\b never matched after ':')", () => {
    assert.ok(kinds("Correction: travel is £45 per person").includes("reversal"));
    assert.ok(kinds("Final: we go with the blue banner").includes("decision"));
    assert.ok(kinds("Confirmed: venue is the main hall").includes("decision"));
  });

  it("handles Hinglish floors", () => {
    assert.ok(kinds("Kis ke paas hai the storage key?").includes("open_question"));
    assert.ok(kinds("main kar dunga kal tak").includes("commitment"));
    assert.ok(kinds("venue final hai, pakka").includes("decision"));
  });

  it("does not treat ordinary chatter or 'sat'/'sun' as signals", () => {
    assert.deepEqual(kinds("lol ok 😂"), []);
    assert.deepEqual(kinds("I sat in the sun for a bit"), []);
  });

  it("a person mention alone does not make a message signal-bearing", () => {
    assert.equal(isSignalBearing(detectMessageSignals({ id: "m", body: "thanks [PERSON_1]" })), false);
    assert.equal(isSignalBearing(detectMessageSignals({ id: "m", body: "[PERSON_1] is responsible for the budget" })), true);
  });

  it("caps signals per message", () => {
    const body = Array.from({ length: 80 }, (_, i) => `₹${i + 1}00`).join(" pay ");
    assert.ok(detectMessageSignals({ id: "m", body }).length <= MAX_SIGNALS_PER_MESSAGE);
  });

  it("normalises amounts", () => {
    assert.equal(normaliseAmount("₹5,000"), "INR 5000");
    assert.equal(normaliseAmount("20k"), "? 20 k");
    assert.equal(normaliseAmount("2 lakh"), "INR 2 lakh");
    assert.equal(normaliseAmount("$40"), "USD 40");
  });

  it("scanSourceSignals counts inspected and signal-bearing messages and stamps the detector version", () => {
    const scan = scanSourceSignals([
      { id: "a", body: "we decided to book the hall" },
      { id: "b", body: "ok" },
      { id: "c", body: "" },
      { id: "d", body: "pay ₹500 to [UPI_1] by tomorrow" },
    ]);
    assert.equal(scan.detectorVersion, SIGNAL_DETECTOR_VERSION);
    assert.equal(scan.messagesInspected, 4);
    assert.equal(scan.messagesWithSignals, 2);
    assert.ok(scan.signals.every((s) => s.messageId === "a" || s.messageId === "d"));
    assert.ok(scan.byKind.decision >= 1 && scan.byKind.financial_commitment >= 1);
  });

  it("is deterministic", () => {
    const body = "Actually [PERSON_2] will handle the ₹3,000 refund by 12/12, waiting for the bank?";
    assert.deepEqual(detectMessageSignals({ id: "m", body }), detectMessageSignals({ id: "m", body }));
  });
});

describe("checkAttribution (VER-3)", () => {
  const participants = new Set(["[PERSON_1]", "[PERSON_2]", "[PERSON_3]"]);
  const cited = [{ authorLabel: "[PERSON_1]", body: "[PERSON_2] is in charge of the sponsor money" }];

  it("verifies a person field against the cited author or a mention in the evidence", () => {
    assert.deepEqual(checkAttribution({ category: "owner", attributes: { ownerLabel: "[PERSON_1]" }, cited, participants }), [
      { field: "ownerLabel", status: "cited_author", resolution: "verified" },
    ]);
    assert.equal(checkAttribution({ category: "owner", attributes: { ownerLabel: "@[PERSON_2]" }, cited, participants })[0].status, "mentioned_in_evidence");
  });

  it("a known participant not in the evidence is inferred; an unknown name or [PERSON] is unresolved", () => {
    assert.equal(checkAttribution({ category: "open_task", attributes: { assigneeLabel: "[PERSON_3]" }, cited, participants })[0].resolution, "inferred");
    const kabir = checkAttribution({ category: "owner", attributes: { ownerLabel: "Kabir" }, cited, participants })[0];
    assert.deepEqual(kabir, { field: "ownerLabel", status: "unrecognized", resolution: "unresolved" });
    assert.equal(checkAttribution({ category: "owner", attributes: { ownerLabel: "[PERSON]" }, cited, participants })[0].status, "ambiguous");
    assert.equal(checkAttribution({ category: "owner", attributes: { ownerLabel: "the treasurer" }, cited, participants })[0].resolution, "unresolved");
  });

  it("[PERSON_1] never matches [PERSON_12]", () => {
    const c = [{ authorLabel: "[PERSON_9]", body: "[PERSON_12] owns it" }];
    assert.equal(checkAttribution({ category: "owner", attributes: { ownerLabel: "[PERSON_1]" }, cited: c, participants: new Set() })[0].resolution, "unresolved");
  });

  it("skips empty fields and categories without person fields", () => {
    assert.deepEqual(checkAttribution({ category: "owner", attributes: { ownerLabel: null }, cited, participants }), []);
    assert.deepEqual(checkAttribution({ category: "contact", attributes: { nameLabel: "Kabir" }, cited, participants }), []);
  });
});

describe("findContradictionCandidates (VER-2)", () => {
  const m = (id: string, day: number, body: string, author = "[PERSON_1]", seq = day): RetrievalMessage => ({
    id,
    sourceId: "s1",
    seq,
    sentAt: `2026-10-${String(day).padStart(2, "0")}T10:00:00Z`,
    authorLabel: author,
    body,
  });
  const messages = [
    m("a", 1, "Final: the sponsor meetup is on 5 Dec at the auditorium"),
    m("b", 2, "Lunch was great today"),
    m("c", 9, "Actually the sponsor meetup moved to 12 Dec, auditorium not free", "[PERSON_2]"),
    m("d", 0, "Earlier idea: sponsor meetup maybe on 1 Dec at the auditorium"),
    m("e", 10, "Cricket match on 12 Dec anyone?"),
  ];
  const point = { pointId: "p", title: "Sponsor meetup date", statement: "The sponsor meetup is on 5 Dec at the auditorium.", attributes: { decidedAt: "5 Dec" }, citedMessageIds: ["a"] };

  it("finds a later reversal that shares the topic and changes the date", () => {
    const out = findContradictionCandidates([point], messages);
    assert.equal(out[0].messageId, "c");
    assert.ok(out[0].reasons.includes("reversal_marker"));
    assert.ok(out[0].reasons.includes("changed_date"));
  });

  it("never returns the cited message, earlier messages or off-topic chatter", () => {
    const ids = findContradictionCandidates([point], messages).map((c) => c.messageId);
    assert.ok(!ids.includes("a") && !ids.includes("d") && !ids.includes("b") && !ids.includes("e"));
  });

  it("skips points without citations and caps candidates per point", () => {
    assert.deepEqual(findContradictionCandidates([{ ...point, citedMessageIds: [] }], messages), []);
    const many = Array.from({ length: 10 }, (_, i) => m(`r${i}`, 11 + i, `Actually the sponsor meetup at the auditorium moved to ${i + 13} Dec`));
    assert.equal(findContradictionCandidates([point], [...messages, ...many]).length, 3);
  });

  it("orders by time, then by position within a source when times are missing", () => {
    const a = { id: "x", sourceId: "s", seq: 1, sentAt: null, authorLabel: null, body: "" };
    assert.equal(isNewer({ ...a, id: "y", seq: 2 }, a), true);
    assert.equal(isNewer({ ...a, id: "y", seq: 2, sourceId: "t" }, a), false);
  });
});
