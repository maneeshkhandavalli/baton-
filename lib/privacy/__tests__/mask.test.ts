import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { luhnCheckDigit, luhnValid, verhoeffCheckDigit, verhoeffValid } from "../checksums";
import { createMasker, maskText } from "../mask";

const m = (text: string) => maskText({ text });

// Synthetic values built with valid checksums.
const CARD = "411111111111111" + luhnCheckDigit("411111111111111"); // 16 digits, Luhn-valid
const AADHAAR_BASE = "23456789012";
const AADHAAR = AADHAAR_BASE + verhoeffCheckDigit(AADHAAR_BASE);

describe("checksums", () => {
  it("Luhn", () => {
    assert.ok(luhnValid(CARD));
    assert.ok(!luhnValid(CARD.slice(0, -1) + ((Number(CARD.slice(-1)) + 1) % 10)));
  });
  it("Verhoeff", () => {
    assert.ok(verhoeffValid(AADHAAR));
    assert.ok(!verhoeffValid(AADHAAR.slice(0, -1) + ((Number(AADHAAR.slice(-1)) + 1) % 10)));
  });
});

describe("maskText: each category", () => {
  const cases: Array<{ name: string; text: string; token: string; leak: string; kind: string }> = [
    { name: "E.164 phone", text: "call +44 20 7946 0958 now", token: "[PHONE_1]", leak: "7946", kind: "phone" },
    { name: "Indian mobile", text: "call 9999900001 now", token: "[PHONE_1]", leak: "9999900001", kind: "phone" },
    { name: "spaced Indian mobile with +91", text: "call +91 99999 00001", token: "[PHONE_1]", leak: "00001", kind: "phone" },
    { name: "dashed mobile", text: "call 99999-00001", token: "[PHONE_1]", leak: "00001", kind: "phone" },
    { name: "landline with STD", text: "office 080-23456789", token: "[PHONE_1]", leak: "23456789", kind: "phone" },
    { name: "email", text: "mail a.b+c@example.co.in today", token: "[EMAIL_1]", leak: "example", kind: "email" },
    { name: "UPI (known PSP)", text: "pay club@okaxis", token: "[UPI_1]", leak: "club@", kind: "upi" },
    { name: "UPI (phone handle)", text: "pay 9999900001@ybl", token: "[UPI_1]", leak: "9999900001", kind: "upi" },
    { name: "bank account near keyword", text: "A/C no. 001234567890", token: "[BANK_1]", leak: "001234567890", kind: "bank_account" },
    { name: "bank account keyword after", text: "001234567890 is the account", token: "[BANK_1]", leak: "001234567890", kind: "bank_account" },
    { name: "IFSC", text: "IFSC HDFC0001234", token: "[IFSC_1]", leak: "HDFC0001234", kind: "ifsc" },
    { name: "card", text: `card ${CARD.slice(0, 4)} ${CARD.slice(4, 8)} ${CARD.slice(8, 12)} ${CARD.slice(12)}`, token: "[CARD_1]", leak: CARD.slice(12), kind: "card" },
    { name: "Aadhaar", text: `aadhaar ${AADHAAR.slice(0, 4)} ${AADHAAR.slice(4, 8)} ${AADHAAR.slice(8)}`, token: "[ID_1]", leak: AADHAAR.slice(8), kind: "government_id" },
    { name: "PAN", text: "PAN ABCPE1234F", token: "[ID_1]", leak: "ABCPE1234F", kind: "government_id" },
    { name: "password", text: "password: hunter2xyz", token: "[PASSWORD]", leak: "hunter2xyz", kind: "password" },
    { name: "otp is", text: "the otp is 482913", token: "[PASSWORD]", leak: "482913", kind: "password" },
    { name: "quoted password with spaces", text: 'pwd = "correct horse battery"', token: "[PASSWORD]", leak: "horse", kind: "password" },
    { name: "OpenAI-style key", text: "key sk-abcdefghijklmnop1234", token: "[API_KEY]", leak: "abcdefghijklmnop", kind: "api_key" },
    { name: "GitHub PAT", text: "ghp_ABCDEFGHIJKLMNOPQRSTuvwxyz0123", token: "[API_KEY]", leak: "ABCDEFGHIJ", kind: "api_key" },
    { name: "AWS key id", text: "AKIAABCDEFGHIJKLMNOP", token: "[API_KEY]", leak: "ABCDEFGHIJKLMNOP", kind: "api_key" },
    { name: "Google key", text: "AIzaSyA1234567890abcdefghijklmnopqrstuv", token: "[API_KEY]", leak: "1234567890abc", kind: "api_key" },
    { name: "Slack token", text: "xoxb-1234567890-abcdefghij", token: "[API_KEY]", leak: "abcdefghij", kind: "api_key" },
    { name: "JWT", text: "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.c2lnbmF0dXJlX2hlcmU", token: "[API_KEY]", leak: "eyJzdWIi", kind: "api_key" },
    { name: "high-entropy secret", text: "token Zx9qL2mN8vB4kR7tY1wE5uI3oP6aS0dF", token: "[SECRET]", leak: "Zx9qL2mN8v", kind: "secret" },
    { name: "long hex secret", text: "hex 0123456789abcdef0123456789abcdef", token: "[SECRET]", leak: "0123456789abcdef", kind: "secret" },
    { name: "private key block", text: "-----BEGIN PRIVATE KEY-----\nMIIBVQIBADANBg\n-----END PRIVATE KEY-----", token: "[SECRET]", leak: "MIIBVQ", kind: "secret" },
  ];
  for (const c of cases) {
    it(c.name, () => {
      const r = m(c.text);
      assert.ok(r.text.includes(c.token), `expected ${c.token} in ${JSON.stringify(r.text)}`);
      assert.ok(!r.text.includes(c.leak), `leaked ${c.leak} in ${JSON.stringify(r.text)}`);
      assert.ok((r.counts as Record<string, number>)[c.kind] >= 1, `count for ${c.kind}`);
    });
  }
});

describe("maskText: adversarial cases (§12.1)", () => {
  it("phone number split across lines", () => {
    const r = m("my number is 99999\n00001 ok");
    assert.ok(!r.text.includes("00001"), r.text);
    assert.equal(r.counts.phone, 1);
  });
  it("Devanagari digits", () => {
    const r = m("call ٩٩٩٩٩००००१".replace(/٩/g, "९"));
    assert.equal(r.counts.phone, 1, r.text);
  });
  it("full-width digits", () => {
    const r = m("call ９９９９９００００１");
    assert.equal(r.counts.phone, 1, r.text);
  });
  it("zero-width characters inside a number", () => {
    const r = m("call 99999\u200B00001");
    assert.equal(r.counts.phone, 1, r.text);
  });
  it("name [at] domain [dot] org", () => {
    const r = m("write to treasurer [at] example [dot] org");
    assert.equal(r.counts.email, 1, r.text);
    assert.ok(!r.text.includes("example"), r.text);
  });
  it("name(at)domain.com", () => {
    const r = m("write to treasurer(at)example.com");
    assert.equal(r.counts.email, 1, r.text);
  });
  it("name at domain dot com (words)", () => {
    const r = m("write to treasurer at example dot com please");
    assert.equal(r.counts.email, 1, r.text);
  });
  it("two phone numbers separated by a space are both masked", () => {
    const r = m("9999900001 9999900002");
    assert.equal(r.counts.phone, 2, r.text);
    assert.equal(r.text, "[PHONE_1] [PHONE_2]");
  });
  it("UPI is matched before email, and email domains are not UPI", () => {
    const r = m("club@okaxis and club@okaxis.com");
    assert.equal(r.counts.upi, 1);
    assert.equal(r.counts.email, 1);
  });
  it("WhatsApp @mention of a number", () => {
    const r = m("ping @919999900001 please");
    assert.equal(r.counts.phone, 1, r.text);
  });
});

describe("maskText: false-positive guards", () => {
  it("leaves ordinary text, dates, times and amounts alone", () => {
    const text = "Meeting on 12/05/2024 at 10:30, budget Rs 1,50,000 for 25 people. Room 204.";
    const r = m(text);
    assert.equal(r.text, text);
    assert.equal(Object.values(r.counts).reduce((a, b) => a + b, 0), 0);
  });
  it("does not treat the word 'passing' as a password keyword", () => {
    const text = "We are passing: the baton to next year";
    assert.equal(m(text).text, text);
  });
  it("does not mask a pass-through hyphen compound", () => {
    const text = "a pass-through cable";
    assert.equal(m(text).text, text);
  });
});

describe("createMasker: consistent tokens within a source", () => {
  it("reuses a token for the same value across messages", () => {
    const masker = createMasker();
    const a = masker.mask("send to club@okaxis");
    const b = masker.mask("club@okaxis received; also other@ybl");
    assert.equal(a.text, "send to [UPI_1]");
    assert.equal(b.text, "[UPI_1] received; also [UPI_2]");
    assert.equal(masker.totals().upi, 3);
  });
  it("explicit-country forms of one number share a token", () => {
    const masker = createMasker();
    const r = masker.mask("+91 99999 00001 / 0091 99999 00001 / +91 0 99999 00001");
    assert.equal(r.text, "[PHONE_1] / [PHONE_1] / [PHONE_1]");
  });
  it("national forms are still masked but not assumed Indian while the phone policy is pending", () => {
    const masker = createMasker();
    const r = masker.mask("+91 99999 00001 / 099999 00001 / 9999900001");
    assert.equal(r.text, "[PHONE_1] / [PHONE_2] / [PHONE_3]");
    assert.equal(r.counts.phone, 3);
  });
  it("maskText uses a fresh map per call", () => {
    assert.equal(maskText({ text: "x@okaxis" }).text, "[UPI_1]");
    assert.equal(maskText({ text: "y@okaxis" }).text, "[UPI_1]");
  });
  it("is deterministic", () => {
    const text = "pay club@okaxis, call 9999900001, password: abc123";
    assert.deepEqual(maskText({ text }), maskText({ text }));
  });
  it("output is NFC", () => {
    const r = maskText({ text: "Café" });
    assert.equal(r.text, "Café");
  });
  it("accepts every context", () => {
    for (const context of ["chat", "document", "user_input"] as const) {
      assert.equal(maskText({ text: "call 9999900001", context }).text, "call [PHONE_1]");
    }
  });
  it("input that imitates internal placeholders is not decoded into tokens it should not have", () => {
    const r = maskText({ text: "\uE000\uE011\uE001 and 9999900001" });
    assert.ok(r.text.includes("[PHONE_1]"));
  });
});
