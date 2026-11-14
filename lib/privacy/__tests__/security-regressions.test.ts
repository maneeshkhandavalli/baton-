/**
 * Regression and adversarial tests for the security audit findings fixed in the privacy layer:
 * H2 (secrets next to punctuation, hex tokens), M1 (E.164 phone identities),
 * M2 (excluded participants' names and mentions in other people's messages), QA-L5 (credentials
 * written with whitespace or other separators).
 */

import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { describe, it } from "node:test";

import { TEST_PEPPER, input, participantRule } from "../../../fixtures/parser/load";
import { bytesOf } from "../../../fixtures/parser/builders";
import { parseSource } from "../../parsers/parse-source";
import { EXCLUDED_PARTICIPANT_TOKEN, createExcludedMentionRedactor } from "../excluded-mentions";
import { computeIdentityHash, normalizeSenderIdentity } from "../identity";
import { maskText } from "../mask";
import { canonicalPhoneNumber, indianNationalReading } from "../phone";

const SECRET = "Zx9qL2mN8vB4kR7tY1wE5uI3oP6aS0dF";
const HEX = "0123456789abcdef0123456789abcdef";

// ---------------------------------------------------------------------------------------------
// H2

describe("H2: secrets next to punctuation are masked", () => {
  const contexts = [
    (s: string) => `token is ${s}.`,
    (s: string) => `token is ${s},`,
    (s: string) => `(token ${s})`,
    (s: string) => `token: ${s}`,
    (s: string) => `${s}`,
    (s: string) => `"${s}"`,
    (s: string) => `token ${s}!\nnext line`,
    (s: string) => `config.${s}.end`,
  ];
  for (const [label, value] of [["high-entropy", SECRET], ["hex", HEX]] as const) {
    contexts.forEach((ctx, i) => {
      it(`${label} secret, context ${i + 1}`, () => {
        const r = maskText({ text: ctx(value) });
        assert.ok(r.text.includes("[SECRET]"), r.text);
        assert.ok(!r.text.includes(value.slice(4, 20)), `leaked: ${r.text}`);
        assert.equal(r.counts.phone, 0, "hex secret was split into phone numbers");
      });
    });
  }
  it("a hex token is masked whole, not split into phone numbers", () => {
    assert.equal(maskText({ text: `hex ${HEX}.` }).text, "hex [SECRET].");
  });
  it("an email with a long random local part is masked as an email, without leaking any part", () => {
    const r = maskText({ text: `write to ${SECRET}@example.com.` });
    assert.equal(r.text, "write to [EMAIL_1].");
  });
  it("an email whose domain label looks like a secret is masked as an email", () => {
    const r = maskText({ text: `write to ravi.kumar@${SECRET}.com.` });
    assert.equal(r.text, "write to [EMAIL_1].");
  });
  it("UPI IDs are still detected before email", () => {
    const r = maskText({ text: "pay club@okaxis." });
    assert.equal(r.text, "pay [UPI_1].");
  });
  it("ordinary long words and URLs without random tokens are not masked as secrets", () => {
    const text = "See https://example.org/handover/notes for the internationalisation-requirements.";
    assert.equal(maskText({ text }).text, text);
  });
});

// ---------------------------------------------------------------------------------------------
// M1

describe("M1/N3/D28: phone identities (no default region, frozen for p1)", () => {
  const explicit = [
    "+91 99999 00001",
    "+919999900001",
    "0091 99999 00001",
    "00 91 99999 00001",
    "+0091 99999 00001", // "+00" read as the international prefix
    "+91 0 99999 00001", // trunk zero after an explicit +91
    "+91 099999 00001",
    "\u202A+91 99999-00001\u202C",
    "+९१ ९९९९९ ००००१", // Devanagari digits
  ];
  for (const variant of explicit) {
    it(`explicit country "${variant}" → tel:+919999900001`, () => {
      assert.equal(normalizeSenderIdentity(variant), "tel:+919999900001");
      assert.equal(computeIdentityHash(variant, TEST_PEPPER), computeIdentityHash("+91 99999 00001", TEST_PEPPER));
    });
  }
  it("national forms are NOT assumed Indian: bare digits, never equal to an E.164 value", () => {
    assert.equal(normalizeSenderIdentity("099999 00001"), "tel:09999900001");
    assert.equal(normalizeSenderIdentity("99999 00001"), "tel:9999900001");
    assert.equal(normalizeSenderIdentity("919999900001"), "tel:919999900001");
    for (const n of ["099999 00001", "99999 00001", "919999900001"]) {
      assert.notEqual(normalizeSenderIdentity(n), "tel:+919999900001", n);
    }
  });
  it("second-audit collisions are gone: different countries' numbers hash differently", () => {
    // UK London written nationally vs Pune landline written with an explicit +91.
    assert.notEqual(normalizeSenderIdentity("020 7946 0958"), normalizeSenderIdentity("+91 20 7946 0958"));
    // US local number vs Indian mobile.
    assert.notEqual(normalizeSenderIdentity("(650) 253-0000"), normalizeSenderIdentity("+91 65025 30000"));
    assert.notEqual(
      computeIdentityHash("(650) 253-0000", TEST_PEPPER),
      computeIdentityHash("+91 65025 30000", TEST_PEPPER),
    );
    // A UK mobile written nationally is not turned into an Indian number.
    assert.equal(normalizeSenderIdentity("07911 123456"), "tel:07911123456");
  });
  it("international numbers keep their country code; 00 prefix equals +", () => {
    assert.equal(normalizeSenderIdentity("+44 20 7946 0958"), "tel:+442079460958");
    assert.equal(normalizeSenderIdentity("0044 20 7946 0958"), "tel:+442079460958");
    assert.equal(normalizeSenderIdentity("+1 650 253 0000"), "tel:+16502530000");
    assert.equal(normalizeSenderIdentity("001 650 253 0000"), "tel:+16502530000");
  });
  it("the saved-name branch follows §12.11 point 5 (D29)", () => {
    assert.equal(normalizeSenderIdentity("Asha Rao"), "name:asha rao");
    assert.equal(normalizeSenderIdentity("Ravi²"), "name:ravi2");
    assert.equal(
      computeIdentityHash("Asha Rao", TEST_PEPPER),
      createHmac("sha256", TEST_PEPPER).update("name:asha rao").digest("hex"),
    );
  });
  it("a name containing digits is not treated as a phone number", () => {
    assert.equal(normalizeSenderIdentity("Ravi 2024"), "name:ravi 2024");
  });
  it("D28: canonicalPhoneNumber takes no region policy and never infers +91", () => {
    assert.equal(canonicalPhoneNumber.length, 2);
    const g = canonicalPhoneNumber;
    assert.equal(g("919999900001", true), "+919999900001");
    assert.equal(g("9109999900001", true), "+919999900001");
    assert.equal(g("00919999900001", true), "+919999900001");
    assert.equal(g("00919999900001", false), "+919999900001");
    assert.equal(g("9999900001", false), "9999900001");
    assert.equal(g("09999900001", false), "09999900001");
    assert.equal(g("919999900001", false), "919999900001");
    assert.equal(g("08023456789", false), "08023456789");
    assert.equal(g("07911123456", false), "07911123456");
    assert.equal(g("12345678", false), "12345678");
  });
  it("P1/D28: the trunk zero after +91 is removed before ANY 10 national digits (landlines too)", () => {
    assert.equal(normalizeSenderIdentity("+91 022 1234 5678"), "tel:+912212345678");
    assert.equal(normalizeSenderIdentity("0091 022 1234 5678"), "tel:+912212345678");
    assert.equal(normalizeSenderIdentity("+91 22 1234 5678"), "tel:+912212345678");
    assert.equal(normalizeSenderIdentity("+91 080 2345 6789"), "tel:+918023456789");
    // Only exactly one trunk zero followed by exactly 10 digits; other shapes are kept as written.
    assert.equal(normalizeSenderIdentity("+91 0 22 1234 567"), "tel:+910221234567");
    assert.equal(normalizeSenderIdentity("+91 00 99999 00001"), "tel:+91009999900001");
    // Not after another country code.
    assert.equal(normalizeSenderIdentity("+44 0 20 7946 0958"), "tel:+4402079460958");
  });
  it("P2: the Indian national reading is used for mention redaction only, never for identities", () => {
    assert.equal(indianNationalReading("9999900001", false), "+919999900001");
    assert.equal(indianNationalReading("09999900001", false), "+919999900001");
    assert.equal(indianNationalReading("919999900001", false), "+919999900001");
    assert.equal(indianNationalReading("919999900001", true), null);
    assert.equal(indianNationalReading("00919999900001", false), null);
    assert.equal(indianNationalReading("02079460958", false), null);
    for (const local of ["99999 00001", "099999 00001", "919999900001", "080 2345 6789", "07911 123456", "650 253 0000"]) {
      assert.ok(!normalizeSenderIdentity(local).startsWith("tel:+"), local);
    }
  });
  it("an excluded local-form number is still redacted when mentioned in international form (safe failure)", () => {
    const redactor = createExcludedMentionRedactor(["99999 00001"]);
    assert.equal(redactor.redact("call +91 99999 00001").text, `call ${EXCLUDED_PARTICIPANT_TOKEN}`);
    const intl = createExcludedMentionRedactor(["+91 99999 00001"]);
    assert.equal(intl.redact("call 099999 00001").text, `call ${EXCLUDED_PARTICIPANT_TOKEN}`);
  });
  it("masking groups explicit-country forms of one number under one token", () => {
    const r = maskText({ text: "+91 99999 00001 / 0091 99999 00001 / +91 0 99999 00001" });
    assert.equal(r.text, "[PHONE_1] / [PHONE_1] / [PHONE_1]");
  });
  it("an exclusion recorded from one explicit form matches a sender exported in another", async () => {
    const text = "20/02/2024, 08:00 - Asha: hi\n20/02/2024, 08:01 - +91 99999 00001: secret from the number\n";
    const r = await parseSource(
      input({
        kind: "whatsapp_export",
        bytes: bytesOf(text),
        dateOrder: "dmy",
        exclusions: [participantRule("0091 99999 00001")],
      }),
    );
    assert.ok(r.ok);
    assert.ok(!JSON.stringify(r.data).includes("secret from the number"));
  });
  it("accepted v1 under-matching (D28): a local-form hash does not match an E.164 sender", async () => {
    const text = "20/02/2024, 08:00 - Asha: hi\n20/02/2024, 08:01 - +91 99999 00001: message\n";
    const r = await parseSource(
      input({
        kind: "whatsapp_export",
        bytes: bytesOf(text),
        dateOrder: "dmy",
        exclusions: [participantRule("099999 00001")],
      }),
    );
    assert.ok(r.ok);
    assert.equal(r.data.stats.messagesExcluded, 0);
  });
});

// ---------------------------------------------------------------------------------------------
// M2

describe("M2: excluded-mention redactor (unit)", () => {
  const r = createExcludedMentionRedactor(["Ravi Kumar"]);
  const cases: Array<[string, string]> = [
    ["I told Ravi Kumar yesterday", `I told ${EXCLUDED_PARTICIPANT_TOKEN} yesterday`],
    ["call @Ravi Kumar about it", `call ${EXCLUDED_PARTICIPANT_TOKEN} about it`],
    ["call @\u2068~Ravi Kumar\u2069 now", `call ${EXCLUDED_PARTICIPANT_TOKEN} now`],
    ["ask ravi  KUMAR", `ask ${EXCLUDED_PARTICIPANT_TOKEN}`],
    ["Ravi\u00A0Kumar's notes", `${EXCLUDED_PARTICIPANT_TOKEN}'s notes`],
    ["(Ravi Kumar)", `(${EXCLUDED_PARTICIPANT_TOKEN})`],
  ];
  for (const [text, expected] of cases) {
    it(`replaces: ${JSON.stringify(text)}`, () => assert.equal(r.redact(text).text, expected));
  }
  const untouched = ["Ravikumar is fine", "Ravi Kumari is someone else", "ask Ravi about it", "Kumar Ravi", "xRavi Kumar"];
  for (const text of untouched) {
    it(`leaves (conservative / documented limitation): ${JSON.stringify(text)}`, () => assert.equal(r.redact(text).text, text));
  }
  it("counts replacements", () => {
    assert.equal(r.redact("Ravi Kumar and @Ravi Kumar").count, 2);
  });
  it("names with regex metacharacters are matched literally", () => {
    const q = createExcludedMentionRedactor(['Ravi "RK" (Kumar)']);
    assert.equal(q.redact('hi Ravi "RK" (Kumar)!').text, `hi ${EXCLUDED_PARTICIPANT_TOKEN}!`);
    assert.equal(q.redact("hi Ravi RK Kumar").text, "hi Ravi RK Kumar");
  });
  it("skips names with fewer than two letters", () => {
    assert.equal(createExcludedMentionRedactor(["A"]).isEmpty, true);
  });
  it("non-Latin names", () => {
    const d = createExcludedMentionRedactor(["रवि कुमार"]);
    assert.equal(d.redact("रवि कुमार ने").text, `${EXCLUDED_PARTICIPANT_TOKEN} ने`);
  });
  it("phone-number participants: every form of their number", () => {
    const p = createExcludedMentionRedactor(["+91 99999 00001"]);
    for (const form of ["@919999900001", "+91 99999 00001", "099999 00001", "99999-00001"]) {
      assert.equal(p.redact(`ping ${form} now`).text, `ping ${EXCLUDED_PARTICIPANT_TOKEN} now`, form);
    }
    assert.equal(p.redact("ping 99999 00002 now").text, "ping 99999 00002 now");
  });
});

describe("M2: end-to-end", () => {
  const text = [
    "20/02/2024, 08:00 - Asha: I told Ravi Kumar, call @Ravi Kumar about it",
    "20/02/2024, 08:01 - Ravi Kumar: my own message",
    "20/02/2024, 08:02 - Meera: ask Ravi later, and ping @919999900009",
    "20/02/2024, 08:03 - +91 99999 00009: number person's message",
  ].join("\n");
  const parse = (exclusions: Parameters<typeof input>[0]["exclusions"]) =>
    parseSource(input({ kind: "whatsapp_export", bytes: bytesOf(text), dateOrder: "dmy", exclusions }));

  it("removes whole names and mentions of excluded people from kept messages", async () => {
    const r = await parse([
      participantRule("Ravi Kumar"),
      participantRule("+91 99999 00009"),
    ]);
    assert.ok(r.ok);
    const bodies = r.data.messages.map((m) => m.body);
    assert.deepEqual(bodies, [
      `I told ${EXCLUDED_PARTICIPANT_TOKEN}, call ${EXCLUDED_PARTICIPANT_TOKEN} about it`,
      `ask Ravi later, and ping ${EXCLUDED_PARTICIPANT_TOKEN}`, // first name alone: documented limitation
    ]);
    assert.ok(!JSON.stringify(r.data).includes("Ravi Kumar"));
    assert.ok(!JSON.stringify(r.data).includes("99999"));
    const w = r.data.warnings.find((x) => x.code === "excluded_mentions_redacted");
    assert.ok(w);
    assert.ok(!w.message.includes("Ravi"));
    assert.equal(r.data.conversations[0].preview, `I told ${EXCLUDED_PARTICIPANT_TOKEN}, call ${EXCLUDED_PARTICIPANT_TOKEN} about it`);
    // Redactions are not masking: the phone mention does not count as a masked phone.
    assert.equal(r.data.masking.counts.phone, 0);
  });
  it("without exclusions nothing is redacted", async () => {
    const r = await parse([]);
    assert.ok(r.ok);
    assert.ok(r.data.messages[0].body.includes("Ravi Kumar"));
    assert.ok(!r.data.warnings.some((x) => x.code === "excluded_mentions_redacted"));
  });
});

// ---------------------------------------------------------------------------------------------
// QA-L5

describe("QA-L5: credentials written without ':' / '=' are masked end to end", () => {
  const text = [
    "20/02/2024, 08:00 - Asha: password Hunter2",
    "20/02/2024, 08:01 - Asha: pin 4821, otp 556677",
    "20/02/2024, 08:02 - Meera: login: bob / s3cretpw and wifi password CafeNet2024",
    "20/02/2024, 08:03 - Meera: user bob pass hunter2; api key abcd1234efgh",
  ].join("\n");
  it("no credential value survives parsing", async () => {
    const r = await parseSource(input({ kind: "whatsapp_export", bytes: bytesOf(text), dateOrder: "dmy" }));
    assert.ok(r.ok);
    const bodies = r.data.messages.map((x) => x.body).join("\n");
    for (const leak of ["Hunter2", "4821", "556677", "bob", "s3cretpw", "CafeNet2024", "hunter2", "abcd1234efgh"]) {
      assert.ok(!bodies.includes(leak), `leaked ${leak}: ${bodies}`);
    }
    assert.ok(bodies.includes("[PASSWORD]"));
    assert.ok(bodies.includes("[API_KEY]"));
  });
  it("the audit's original examples", () => {
    assert.equal(maskText({ text: "password Hunter2" }).text, "password [PASSWORD]");
    assert.equal(maskText({ text: "pin 4821" }).text, "pin [PASSWORD]");
    assert.equal(maskText({ text: "otp 556677" }).text, "otp [PASSWORD]");
    assert.equal(maskText({ text: "login: bob / secret" }).text, "login: [PASSWORD] / [PASSWORD]");
  });
});
