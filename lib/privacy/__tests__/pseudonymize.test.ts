// R3 Task 02 (PRIV-1): participant-name detection and replacement. Synthetic names and text only.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { ParsedSource } from "../../contracts/parser";
import { AMBIGUOUS_PERSON_TOKEN, createPseudonymizer, isPersonToken, nameWords, personToken } from "../pseudonymize";
import { pseudonymizeParsedSource } from "../pseudonymize-source";

const P = (people: Array<[number, string | null]>) => createPseudonymizer(people.map(([ordinal, label]) => ({ ordinal, label })));
const apply = (people: Array<[number, string | null]>, text: string) => P(people).apply(text).text;

describe("pseudonymizer: exact mentions, variations, case and spacing", () => {
  const people: Array<[number, string | null]> = [
    [1, "Ravi Kumar"],
    [2, "Priya Sharma"],
  ];

  it("replaces whole names and unambiguous name words", () => {
    assert.equal(apply(people, "Ravi Kumar will book the hall"), "[PERSON_1] will book the hall");
    assert.equal(apply(people, "ask Priya about the deposit"), "ask [PERSON_2] about the deposit");
    assert.equal(apply(people, "Sharma has the keys"), "[PERSON_2] has the keys");
  });

  it("is case-insensitive and tolerates extra spaces, NBSP, dots, underscores and hyphens between words", () => {
    assert.equal(apply(people, "RAVI KUMAR and ravi   kumar"), "[PERSON_1] and [PERSON_1]");
    assert.equal(apply(people, "Ravi Kumar / ravi.kumar / ravi_kumar / Ravi-Kumar"), "[PERSON_1] / [PERSON_1] / [PERSON_1] / [PERSON_1]");
  });

  it("handles @mentions, WhatsApp's isolate form and possessives", () => {
    assert.equal(apply(people, "@Priya please check"), "[PERSON_2] please check");
    assert.equal(apply(people, "@⁨~Ravi Kumar⁩ ok"), "[PERSON_1] ok");
    assert.equal(apply(people, "Ravi's laptop"), "[PERSON_1]'s laptop");
  });

  it("never replaces inside longer words, and leaves ordinary text alone", () => {
    assert.equal(apply(people, "Ravindra and Kumaran are new; Priyanka too"), "Ravindra and Kumaran are new; Priyanka too");
    assert.equal(apply(people, "The budget is due Friday."), "The budget is due Friday.");
  });

  it("does not touch Baton's own tokens", () => {
    const p = [[1, "Secret Person"], [2, "Phone"]] as Array<[number, string]>;
    assert.equal(apply(p, "[SECRET] [PHONE_1] [PERSON_2] [EXCLUDED_PARTICIPANT]"), "[SECRET] [PHONE_1] [PERSON_2] [EXCLUDED_PARTICIPANT]");
  });
});

describe("pseudonymizer: Unicode, non-English, Indian-English and Hinglish", () => {
  it("matches Devanagari, Tamil and Arabic names with combining marks", () => {
    const people: Array<[number, string]> = [
      [1, "रवि कुमार"],
      [2, "प्रिया"],
      [3, "முருகன் செல்வம்"],
      [4, "فاطمة الزهراء"],
    ];
    assert.equal(apply(people, "कल रवि कुमार हॉल बुक करेगा"), "कल [PERSON_1] हॉल बुक करेगा");
    assert.equal(apply(people, "प्रिया से पूछो"), "[PERSON_2] से पूछो");
    assert.equal(apply(people, "முருகன் செல்வம் நாளை வருவார்"), "[PERSON_3] நாளை வருவார்");
    assert.equal(apply(people, "تحدث مع فاطمة الزهراء"), "تحدث مع [PERSON_4]");
  });

  it("matches NFC and NFD spellings alike", () => {
    const people: Array<[number, string]> = [[1, "José Álvarez"]];
    assert.equal(apply(people, "José Álvarez".normalize("NFD") + " paid"), "[PERSON_1] paid");
  });

  it("Hinglish chat: names with honorifics and Hindi words around them", () => {
    const people: Array<[number, string]> = [
      [1, "Rahul Verma"],
      [2, "Sneha Iyer"],
    ];
    assert.equal(
      apply(people, "Rahul bhai ne bola ki Iyer didi kal fees collect karegi, theek hai?"),
      "[PERSON_1] bhai ne bola ki [PERSON_2] didi kal fees collect karegi, theek hai?",
    );
    assert.equal(apply(people, "rahul-ji ka number lo"), "[PERSON_1]-ji ka number lo");
  });

  it("Indian-English: common words that are also names are left alone outside the whole name", () => {
    const people: Array<[number, string]> = [
      [1, "Asha Menon"],
      [2, "Kiran Rao"],
      [3, "Will Thomas"],
    ];
    const text = "There is asha (hope) we finish; kiran means ray; we will meet. Menon and Rao confirmed; Asha Menon too.";
    assert.equal(
      apply(people, text),
      "There is asha (hope) we finish; kiran means ray; we will meet. [PERSON_1] and [PERSON_2] confirmed; [PERSON_1] too.",
    );
    assert.equal(apply(people, "@Asha can you send it"), "[PERSON_1] can you send it");
  });

  it("single-word contact names that are ordinary words are replaced only as @mentions", () => {
    const people: Array<[number, string]> = [
      [1, "Mom"],
      [2, "Admin"],
    ];
    assert.equal(apply(people, "tell mom the admin password changed"), "tell mom the admin password changed");
    assert.equal(apply(people, "@Mom @Admin"), "[PERSON_1] [PERSON_2]");
  });
});

describe("pseudonymizer: similar names", () => {
  const people: Array<[number, string]> = [
    [1, "Ravi Kumar"],
    [2, "Ravi Shankar"],
    [3, "Ravi"],
    [4, "Anil Kumar"],
  ];

  it("full names always map to the right person", () => {
    assert.equal(apply(people, "Ravi Kumar and Ravi Shankar and Anil Kumar"), "[PERSON_1] and [PERSON_2] and [PERSON_4]");
  });

  it("a single-word whole name wins over a shared first name", () => {
    assert.equal(apply(people, "Ravi said yes"), "[PERSON_3] said yes");
  });

  it("a shared word that is nobody's whole name becomes an unnumbered [PERSON], never a guess", () => {
    assert.equal(apply(people, "Kumar will call"), `${AMBIGUOUS_PERSON_TOKEN} will call`);
    assert.equal(apply(people, "Shankar will call"), "[PERSON_2] will call");
  });
});

describe("pseudonymizer: guard and helpers", () => {
  it("containsKnownName finds reintroduced names, never placeholders", () => {
    const d = P([[1, "Ravi Kumar"]]);
    assert.equal(d.containsKnownName("[PERSON_1] owns the bank login"), false);
    assert.equal(d.containsKnownName("Ravi owns the bank login"), true);
    assert.equal(d.containsKnownName("RAVI KUMAR"), true);
    assert.equal(d.containsKnownName("Ravindra"), false);
  });

  it("people without a usable label are skipped; an empty detector is the identity", () => {
    const d = P([[1, null], [2, "🌸"]]);
    assert.equal(d.isEmpty, true);
    assert.equal(d.apply("anything Ravi").text, "anything Ravi");
  });

  it("nameWords drops masks and placeholders; tokens are well formed", () => {
    assert.deepEqual(nameWords("Ravi [PHONE_1] Kumar 🌸"), ["Ravi", "Kumar"]);
    assert.equal(personToken(12), "[PERSON_12]");
    assert.ok(isPersonToken("[PERSON_3]") && isPersonToken("[PERSON]") && !isPersonToken("[PERSON_0]"));
    assert.throws(() => personToken(0));
  });
});

describe("pseudonymizeParsedSource", () => {
  const parsed: ParsedSource = {
    kind: "whatsapp_export",
    parserVersion: "x",
    parseContext: { timezone: "Asia/Kolkata", dateOrder: "dmy", parserVersion: "x" },
    participants: [
      { localId: "p_1", displayLabel: "Ravi Kumar", identityKind: "name", identityHash: "a".repeat(64), identityPepperVersion: "p1", messageCount: 1 },
      { localId: "p_2", displayLabel: "Participant 2", identityKind: "phone", identityHash: "b".repeat(64), identityPepperVersion: "p1", messageCount: 1 },
    ],
    conversations: [{ localId: "c_1", startedAt: null, endedAt: null, messageCount: 2, participantLocalIds: ["p_1", "p_2"], preview: "Priya Sharma has the cash box and a very long tail" }],
    messages: [
      { seq: 0, conversationLocalId: "c_1", participantLocalId: "p_1", sentAt: null, kind: "text", body: "Priya Sharma has the cash box", location: { lineStart: 1, lineEnd: 1 } },
      { seq: 1, conversationLocalId: "c_1", participantLocalId: "p_2", sentAt: null, kind: "text", body: "thanks Ravi", location: { lineStart: 2, lineEnd: 2, heading: "Ravi Kumar notes" } },
    ],
    masking: { counts: {} as ParsedSource["masking"]["counts"] },
    stats: { totalLines: 2, messagesKept: 2, messagesExcluded: 0, systemMessages: 0, mediaOmitted: 0 },
    identityMatches: [],
    firstMessageAt: null,
    lastMessageAt: null,
    warnings: [],
  };

  it("labels become placeholders; bodies, headings and previews use the handover-wide numbers", () => {
    const { parsed: out, replaced } = pseudonymizeParsedSource(parsed, {
      ordinalOf: new Map([["p_1", 3], ["p_2", 4]]),
      people: [
        { ordinal: 1, label: "Priya Sharma" }, // known from another source of the handover
        { ordinal: 3, label: "Ravi Kumar" },
        { ordinal: 4, label: null },
      ],
    });
    assert.deepEqual(out.participants.map((p) => p.displayLabel), ["[PERSON_3]", "[PERSON_4]"]);
    assert.equal(out.messages[0].body, "[PERSON_1] has the cash box");
    assert.equal(out.messages[1].body, "thanks [PERSON_3]");
    assert.equal(out.messages[1].location?.heading, "[PERSON_3] notes");
    assert.equal(out.conversations[0].preview, "[PERSON_1] has the cash box");
    assert.equal(replaced, 3);
    const json = JSON.stringify(out);
    for (const name of ["Ravi", "Priya", "Sharma", "Kumar"]) assert.equal(json.includes(name), false, name);
    assert.equal(parsed.participants[0].displayLabel, "Ravi Kumar", "the input is not mutated");
  });

  it("refuses a participant without a placeholder", () => {
    assert.throws(() => pseudonymizeParsedSource(parsed, { ordinalOf: new Map([["p_1", 1]]), people: [] }), /placeholder/);
  });
});
