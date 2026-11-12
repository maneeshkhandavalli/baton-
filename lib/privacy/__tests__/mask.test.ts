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

// ---------------------------------------------------------------------------------------------
// QA-L5: credentials written with whitespace or other separators (§12.1 widened; over-mask)

describe("QA-L5: credentials with whitespace and other separators", () => {
  const masked: Array<{ text: string; leak: string[]; expected?: string; kind?: string }> = [
    { text: "password Hunter2", leak: ["Hunter2"], expected: "password [PASSWORD]" },
    { text: "Password Hunter2 for the office PC", leak: ["Hunter2"] },
    { text: "pwd: x", leak: [], expected: "pwd: [PASSWORD]" },
    { text: "pwd x9y8", leak: ["x9y8"] },
    { text: "pw letmein", leak: ["letmein"] },
    { text: "pin 4821", leak: ["4821"], expected: "pin [PASSWORD]" },
    { text: "PIN is 4821", leak: ["4821"], expected: "PIN is [PASSWORD]" },
    { text: "PIN: 4821", leak: ["4821"] },
    { text: "my pin's 4821", leak: ["4821"] },
    { text: "pin no. 4821", leak: ["4821"] },
    { text: "pin number 4821", leak: ["4821"] },
    { text: "pin #4821", leak: ["4821"] },
    { text: "pin-4821", leak: ["4821"] },
    { text: "ATM pin 4821", leak: ["4821"] },
    { text: "mpin 902211", leak: ["902211"] },
    { text: "otp 556677", leak: ["556677"], expected: "otp [PASSWORD]" },
    { text: "OTP: 556677", leak: ["556677"] },
    { text: "one time password 556677", leak: ["556677"] },
    { text: "passcode 7788", leak: ["7788"], expected: "passcode [PASSWORD]" },
    { text: "the passcode is lemontree", leak: ["lemontree"] },
    { text: "passphrase correcthorse", leak: ["correcthorse"] },
    { text: "door code 4821", leak: ["4821"] },
    { text: "alarm code is 1234", leak: ["1234"] },
    { text: "password changed to Hunter3", leak: ["Hunter3"] },
    { text: "password is: Hunter4", leak: ["Hunter4"] },
    { text: "password -> Hunter5", leak: ["Hunter5"] },
    { text: "password—Hunter6 ", leak: [] },
    { text: "the password for the router is admin123", leak: ["admin123"] },
    { text: "password\nHunter2", leak: ["Hunter2"] },
    { text: "login: bob / secret", leak: ["bob", "secret"], expected: "login: [PASSWORD] / [PASSWORD]" },
    { text: "login bob/secret", leak: ["bob", "secret"] },
    { text: "creds bob:hunter2", leak: ["bob", "hunter2"] },
    { text: "credentials - admin | admin123", leak: ["admin123"] },
    { text: "user bob pass hunter2", leak: ["bob", "hunter2"], expected: "user [PASSWORD] pass [PASSWORD]" },
    { text: "username: bob, password: hunter", leak: ["bob", "hunter"] },
    { text: "user: admin / pass: 1234", leak: ["admin", "1234"] },
    { text: "id ravi92 and pwd ravi@123", leak: ["ravi92", "ravi@123"] },
    { text: "wifi password CafeNet2024", leak: ["CafeNet2024"] },
    { text: "WiFi password is sunflower", leak: ["sunflower"] },
    { text: "wi-fi key Sunflower99", leak: ["Sunflower99"] },
    { text: "wifi pw abc123", leak: ["abc123"] },
    { text: "WiFi: HomeNet_5G", leak: ["HomeNet_5G"] },
    { text: "wifi HomeNet5G", leak: ["HomeNet5G"] },
    { text: "hotspot pass Jio4G99", leak: ["Jio4G99"] },
    { text: "the wifi password for guests is Hunter2", leak: ["Hunter2"] },
    { text: "api key abcd1234efgh", leak: ["abcd1234efgh"], kind: "api_key" },
    { text: "API_KEY=xyz", leak: ["xyz"], kind: "api_key" },
    { text: "apikey: qwerty", leak: ["qwerty"], kind: "api_key" },
    { text: "token: abcdefgh", leak: ["abcdefgh"], kind: "api_key" },
    { text: "access token abc123def456", leak: ["abc123def456"], kind: "api_key" },
    { text: "Authorization: Bearer abc123def456ghi", leak: ["abc123def456ghi"] },
    { text: "the api key is abcd1234efgh", leak: ["abcd1234efgh"], kind: "api_key" },
    { text: "client secret: s3cr3t", leak: ["s3cr3t"], kind: "secret" },
    { text: "secret key Zz12Yy34Xx56", leak: ["Zz12Yy34Xx56"] },
    { text: "key: hunter2", leak: ["hunter2"] },
    { text: "svc token Ab3dEf6hIj9kLm2nOp5qRs", leak: ["Ab3dEf6hIj9kLm2nOp5qRs"] },
    { text: "Ab3dEf6hIj9kLm2nOp5qRs", leak: ["Ab3dEf6hIj9kLm2nOp5qRs"], kind: "secret" },
    { text: "password Hunter2 and guest pass Guest99", leak: ["Hunter2", "Guest99"] },
    { text: "ｐａｓｓｗｏｒｄ Hunter2", leak: ["Hunter2"] },
  ];
  for (const c of masked) {
    it(`masks ${JSON.stringify(c.text)}`, () => {
      const r = m(c.text);
      if (c.expected) assert.equal(r.text, c.expected);
      for (const leak of c.leak) assert.ok(!r.text.includes(leak), `leaked ${leak} in ${JSON.stringify(r.text)}`);
      const total = Object.values(r.counts).reduce((a, b) => a + b, 0);
      assert.ok(total >= 1, `nothing masked in ${JSON.stringify(r.text)}`);
      if (c.kind) assert.ok((r.counts as Record<string, number>)[c.kind] >= 1, `count for ${c.kind}: ${JSON.stringify(r.counts)}`);
    });
  }

  // Ordinary prose that shares a keyword. These stay readable; anything ambiguous is masked.
  const prose = [
    "pin the message",
    "please pin it.",
    "pass the keys to Ravi",
    "pass 2 copies to the treasurer",
    "the token is valid until March",
    "secret santa on Friday",
    "Key: Ravi holds the safe",
    "use a password manager",
    "reset your password please",
    "forgot my password\nRavi will reset it",
    "the user / admin roles",
    "login and/or password",
    "sign in / sign up",
    "boarding pass",
    "otp sent",
    "wifi is down again",
    "a pass-through cable",
    "We are passing: the baton to next year",
    "pin code 560001",
  ];
  for (const text of prose) {
    it(`leaves prose ${JSON.stringify(text)}`, () => assert.equal(m(text).text, text));
  }

  it("is still deterministic and keeps the fixed [PASSWORD] token", () => {
    const text = "pin 4821 / otp 556677 / login bob/secret";
    assert.deepEqual(m(text), m(text));
    assert.equal(m(text).text, "pin [PASSWORD] / otp [PASSWORD] / login [PASSWORD]/[PASSWORD]");
  });
  it("createMasker keeps the same signature and counts credentials", () => {
    const masker = createMasker();
    masker.mask("password Hunter2");
    masker.mask("pin 4821", "chat");
    assert.equal(masker.totals().password, 2);
  });
});

// QA-L5 residuals (R1–R6), found by QA after E0 and fixed in Round 3 by Agent 3 (mask.ts ownership moved).
describe("maskText: QA-L5 residual credential forms (over-mask preferred)", () => {
  const cases: Array<{ id: string; text: string; secrets: string[] }> = [
    { id: "R1 cvv bare", text: "card cvv 123 and CVV: 456", secrets: ["123", "456"] },
    { id: "R1 cvc / csc / card security code", text: "cvc2 913, csc 207, card security code 778", secrets: ["913", "207", "778"] },
    { id: "R2 pin no:", text: "locker pin no: 4821", secrets: ["4821"] },
    { id: "R2 pin number =", text: "pin number = 4821", secrets: ["4821"] },
    { id: "R3 pass code", text: "the pass code 4821 opens it", secrets: ["4821"] },
    { id: "R3 pass phrase:", text: "pass phrase: Blue Kite 77", secrets: ["Blue", "Kite", "77"] },
    { id: "R4 qualifier before value", text: "the pin for the locker 4821", secrets: ["4821"] },
    { id: "R4 password for the router", text: "password for the router Hunter2", secrets: ["Hunter2"] },
    { id: "R5 spaced otp", text: "OTP 556 677 and password Hunter 2", secrets: ["556", "677", "Hunter", " 2"] },
    { id: "R5 one digit per group", text: "pin 4 8 2 1 for the door", secrets: ["4 8 2 1"] },
    { id: "R6 passphrase after strong keyword", text: "password: correct horse battery staple", secrets: ["correct", "horse battery staple"] },
    { id: "R6 passphrase with is", text: "the wifi password is purple monkey dishwasher", secrets: ["purple", "monkey", "dishwasher"] },
  ];
  for (const c of cases) {
    it(c.id, () => {
      const r = m(c.text);
      for (const s of c.secrets) assert.ok(!r.text.includes(s), `${JSON.stringify(s)} survived: ${r.text}`);
      assert.ok(r.counts.password >= 1, r.text);
    });
  }

  it("createMasker gives the same result per message", () => {
    const masker = createMasker();
    for (const c of cases) {
      const out = masker.mask(c.text).text;
      for (const s of c.secrets) assert.ok(!out.includes(s), `${s} survived: ${out}`);
    }
  });

  it("over-masking stays bounded: the passphrase stops at a clause word or punctuation", () => {
    assert.equal(m("password: Hunter2 for the lab wifi").text, "password: [PASSWORD] for the lab wifi");
    assert.equal(m("We decided the lab wifi password Hunter2 stays until March").text, "We decided the lab wifi password [PASSWORD] stays until March");
    assert.equal(m("wifi password: Robo@2024! is retired").text, "wifi password: [PASSWORD] is retired");
    assert.equal(m("password: blue kite, then log in").text, "password: [PASSWORD] then log in");
    assert.equal(m("pwd = \"two words\" ok").text, "pwd = [PASSWORD] ok");
  });

  it("prose with the new keywords is untouched", () => {
    for (const text of [
      "The pin for the team photo went missing",
      "pin for 2 hours",
      "pass code reset tomorrow",
      "We decided to pass the budget on Friday",
      "The pin badge order is pending",
      "Login page redesign is next step",
      "the card was declined twice",
      "Call me on 9999900001 before 5",
    ]) {
      const r = m(text);
      assert.equal(r.counts.password, 0, `${text} → ${r.text}`);
    }
  });
});
