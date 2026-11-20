/**
 * R5 masking detectors (audit S2 / F12). Synthetic data only: every number below is made up.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { luhnCheckDigit, luhnValid, verhoeffValid } from "../checksums";
import { createMasker, maskText } from "../mask";

const m = (text: string) => maskText({ text });
const total = (counts: Record<string, number>) => Object.values(counts).reduce((a, b) => a + b, 0);

/** A 16-digit run that is NOT Luhn-valid (so it is not a card). */
function nonLuhn16(base15: string): string {
  const good = luhnCheckDigit(base15);
  const d = base15 + ((Number(good) + 1) % 10);
  assert.ok(!luhnValid(d));
  return d;
}

describe("R5: new categories are masked", () => {
  const VID = nonLuhn16("987654321098765");
  const cases: Array<{ name: string; text: string; token: string; leaks: string[]; kind: string }> = [
    { name: "passport after keyword", text: "Passport no. K1234567 expires soon", token: "[ID_1]", leaks: ["1234567"], kind: "government_id" },
    { name: "passport (9-digit foreign) after keyword", text: "his passport: 123456789", token: "[ID_1]", leaks: ["123456789"], kind: "government_id" },
    { name: "voter ID after keyword", text: "voter id ABC1234567", token: "[ID_1]", leaks: ["1234567"], kind: "government_id" },
    { name: "EPIC in lower case after keyword", text: "EPIC number: abc1234567", token: "[ID_1]", leaks: ["1234567"], kind: "government_id" },
    { name: "EPIC shape in upper case with no keyword", text: "card XYZ7654321 attached", token: "[ID_1]", leaks: ["7654321"], kind: "government_id" },
    { name: "driving licence with a space", text: "DL MH12 20110012345", token: "[ID_1]", leaks: ["0012345", "MH12"], kind: "government_id" },
    { name: "driving licence with hyphens, no keyword", text: "licence is KA-05-2015-0123456 ok", token: "[ID_1]", leaks: ["0123456"], kind: "government_id" },
    { name: "driving licence glued", text: "DL0420110149646 belongs to the van driver", token: "[ID_1]", leaks: ["0149646"], kind: "government_id" },
    { name: "GSTIN masked whole, embedded PAN does not leak", text: "GSTIN 27ABCPE1234F1Z5 on the invoice", token: "[ID_1]", leaks: ["ABCPE1234F", "27ABC", "1Z5"], kind: "government_id" },
    { name: "GSTIN with no keyword", text: "bill to 29AAACB1234C1ZV please", token: "[ID_1]", leaks: ["AAACB1234C"], kind: "government_id" },
    { name: "Aadhaar VID with keyword, last 4 digits do not leak", text: "VID 9876 5432 1098 7654", token: "[ID_1]", leaks: ["7654", "9876"], kind: "government_id" },
    { name: "Aadhaar VID with no keyword", text: `use ${VID.slice(0, 4)} ${VID.slice(4, 8)} ${VID.slice(8, 12)} ${VID.slice(12)} for KYC`, token: "[ID_1]", leaks: [VID.slice(12), VID.slice(0, 4)], kind: "government_id" },
    { name: "Aadhaar with a bad checksum next to the keyword", text: "aadhaar 1234 5678 9012", token: "[ID_1]", leaks: ["9012", "1234"], kind: "government_id" },
    { name: "Aadhaar typo glued, keyword 'uid'", text: "UID: 234567890123", token: "[ID_1]", leaks: ["234567890123"], kind: "government_id" },
    { name: "Aadhaar 4-4-4 grouping with no keyword (any checksum)", text: "number on the card 2345 6789 0123", token: "[ID_1]", leaks: ["0123", "2345"], kind: "government_id" },
    { name: "bank number with the bank word later", text: "transfer to 123456789012 at SBI", token: "[BANK_1]", leaks: ["123456789012"], kind: "bank_account" },
    { name: "bank number before IFSC", text: "send it to 50100123456781, IFSC HDFC0001234", token: "[BANK_1]", leaks: ["50100123456781"], kind: "bank_account" },
    { name: "bank number with no keyword at all (long run)", text: "the number is 50100123456781 thanks", token: "[BANK_1]", leaks: ["50100123456781"], kind: "bank_account" },
    { name: "UK mobile without +", text: "ring 447911123456 tonight", token: "[PHONE_1]", leaks: ["7911123456"], kind: "phone" },
    { name: "UK mobile without + and spaced", text: "her UK number 44 7911 123456", token: "[PHONE_1]", leaks: ["7911", "123456"], kind: "phone" },
    { name: "US number without + after a phone keyword", text: "call 14155550123 after 6", token: "[PHONE_1]", leaks: ["4155550123"], kind: "phone" },
    { name: "UAE mobile without +", text: "Dubai office 971501234567", token: "[PHONE_1]", leaks: ["501234567"], kind: "phone" },
    { name: "00 international prefix", text: "dial 0044 20 7946 0958", token: "[PHONE_1]", leaks: ["7946", "0958"], kind: "phone" },
    { name: "date of birth (numeric)", text: "DOB: 12/03/1990", token: "[ID_1]", leaks: ["1990", "12/03"], kind: "government_id" },
    { name: "date of birth (words)", text: "she was born on 3rd March 1988 in Pune", token: "[ID_1]", leaks: ["1988", "March"], kind: "government_id" },
    { name: "date of birth (ISO)", text: "date of birth 1985-07-21", token: "[ID_1]", leaks: ["1985-07-21"], kind: "government_id" },
    { name: "birthday without a year", text: "his birthday is March 14", token: "[ID_1]", leaks: ["March 14"], kind: "government_id" },
    { name: "postal address after keyword, PIN included", text: "Address: Flat 4B, Green Park Apartments, 12th Main Road, Indiranagar, Bengaluru 560038. Thanks", token: "[ID_1]", leaks: ["Green Park", "560038", "Main Road", "Flat 4B"], kind: "government_id" },
    { name: "address line with a house marker and no keyword", text: "#12, 3rd Cross, HSR Layout, Bengaluru - 560102", token: "[ID_1]", leaks: ["3rd Cross", "560102", "HSR"], kind: "government_id" },
    { name: "lives at", text: "He lives at 221B Baker Street, London.", token: "[ID_1]", leaks: ["221B", "Baker"], kind: "government_id" },
    { name: "multi-line address after keyword", text: "home address:\nHouse 7, Sector 15, Noida 201301", token: "[ID_1]", leaks: ["Sector 15", "201301"], kind: "government_id" },
  ];
  for (const c of cases) {
    it(c.name, () => {
      const r = m(c.text);
      assert.ok(r.text.includes(c.token), `expected ${c.token} in ${JSON.stringify(r.text)}`);
      for (const leak of c.leaks) assert.ok(!r.text.includes(leak), `leaked ${leak} in ${JSON.stringify(r.text)}`);
      assert.ok((r.counts as Record<string, number>)[c.kind] >= 1, `count for ${c.kind}: ${JSON.stringify(r.counts)}`);
    });
  }
});

describe("R5: adversarial forms", () => {
  it("full-width and Devanagari digits in a VID", () => {
    const r = m("VID ९८७६ ५४३२ १०९८ ７６５４");
    assert.equal(r.counts.government_id, 1, r.text);
    assert.ok(!/[0-9०-९０-９]/.test(r.text.replace("[ID_1]", "")), r.text);
  });
  it("zero-width characters inside a keyword Aadhaar with a bad checksum", () => {
    const r = m("aadhaar 1234​5678​9012");
    assert.equal(r.counts.government_id, 1, r.text);
  });
  it("a 16-digit VID is never split into a phone plus leftover digits", () => {
    for (const vid of ["9876543210987654", "9876 5432 1098 7654", "9876-5432-1098-7654"]) {
      const r = m(`id ${vid}`);
      assert.equal(r.counts.phone, 0, r.text);
      assert.ok(!/\d{2,}/.test(r.text), r.text);
    }
  });
  it("Aadhaar with a valid checksum is still masked (pre-existing rule unchanged)", () => {
    const r = m("234567890124 and more");
    if (verhoeffValid("234567890124")) assert.equal(r.counts.government_id, 1, r.text);
    assert.ok(!r.text.includes("234567890124"), r.text);
  });
  it("Indian mobile next to a bank word stays a phone", () => {
    const r = m("transfer to 9876543210 via GPay at HDFC");
    assert.equal(r.counts.phone, 1, r.text);
    assert.equal(r.counts.bank_account, 0, r.text);
  });
  it("the same GSTIN gets one token across messages", () => {
    const masker = createMasker();
    const a = masker.mask("GSTIN 27ABCPE1234F1Z5");
    const b = masker.mask("gstin 27abcpe1234f1z5 again");
    assert.equal(a.text, "GSTIN [ID_1]");
    assert.equal(b.text, "gstin [ID_1] again");
  });
  it("existing categories keep their tokens", () => {
    assert.equal(m("PAN ABCPE1234F").text, "PAN [ID_1]");
    assert.equal(m("call 9999900001 now").text, "call [PHONE_1] now");
    assert.equal(m("A/C no. 001234567890").text, "A/C no. [BANK_1]");
    assert.equal(m("call +44 20 7946 0958 now").text, "call [PHONE_1] now");
  });
});

describe("R5: false-positive guards", () => {
  const unchanged = [
    "Meeting on 12/05/2024 at 10:30, budget Rs 1,50,000 for 25 people. Room 204.",
    "meeting on 12/03/2026, deadline 2026-04-01",
    "we need to address the issue before Friday, 5 items left",
    "the email address is on the form",
    "IP address 10.0.0.12 is the router",
    "Flat 3, then we left",
    "release v2.14.3 shipped; build 4521 passed",
    "invoice INV2026001 and order ORD1234567 are paid",
    "ticket JIRA-1234 and PR #5678",
    "commit 3f2a9c1 fixed it",
    "budget 1500000 approved for 2027",
    "pin code 560001",
    "the bank is closed on 15 August",
    "SBI branch opens at 10, token 42",
    "born in 1990 in Pune",
    "we were born ready",
    "epoch 1700000000000 in the log",
    "stamp 20261121103001 in the log",
    "the driver called at 9; DL test on Monday",
    "the passport office opens at 9:30",
    "voter turnout was 67 percent",
    "uid 42 owns the file",
    "Order 403-1234567-1234567 arrived",
  ];
  for (const text of unchanged) {
    it(`leaves ${JSON.stringify(text)}`, () => {
      const r = m(text);
      assert.equal(r.text, text);
      assert.equal(total(r.counts), 0);
    });
  }
});
