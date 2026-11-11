// Run: node --import ./lib/ai/__tests__/resolve-ai.mjs --test "lib/ai/__tests__/*.test.ts"
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { maskText } from "../../privacy/mask";
import { checkQuote, MASK_TOKEN_PATTERN, meetsQuoteMinimum, normalizeForQuoteMatch } from "../quote-check";

const BODY = "Asha said: “We decided to move the meeting to Friday — final answer.”";

describe("normalizeForQuoteMatch (§10.7.1)", () => {
  it("maps curly quotes and dashes to ASCII, collapses whitespace, trims, preserves case", () => {
    assert.equal(normalizeForQuoteMatch("  “Hello” —\n\t‘World’  "), "\"Hello\" - 'World'");
    assert.equal(normalizeForQuoteMatch("CASE Stays"), "CASE Stays");
    for (const dash of ["‐", "‑", "‒", "–", "—", "―", "−", "﹘", "﹣", "－"]) {
      assert.equal(normalizeForQuoteMatch(`a${dash}b`), "a-b");
    }
  });

  it("applies NFC", () => {
    assert.equal(normalizeForQuoteMatch("café"), "café");
  });

  it("strips zero-width and bidi format characters but keeps ZWJ and ZWNJ (I1.8)", () => {
    assert.equal(normalizeForQuoteMatch("pa​ss‎w‏o‪r‬d⁦x⁩﻿­"), "passwordx");
    assert.equal(normalizeForQuoteMatch("क्‍ष"), "क्‍ष");
    assert.equal(normalizeForQuoteMatch("a‌b"), "a‌b");
    // A format character between a base and its combining mark does not block composition.
    assert.equal(normalizeForQuoteMatch("e‎́"), "é");
  });

  it("collapses whitespace runs that were separated only by format characters", () => {
    assert.equal(normalizeForQuoteMatch("a ​ b"), "a b");
  });

  it("is idempotent", () => {
    for (const s of [BODY, "  x—y  ", "café ​ “q”", "🏴‍☠️ flag  test"]) {
      const once = normalizeForQuoteMatch(s);
      assert.equal(normalizeForQuoteMatch(once), once);
    }
  });
});

describe("quote minimum (§10.7.4, I1.8)", () => {
  it("requires 12 characters and 3 words", () => {
    assert.equal(meetsQuoteMinimum("one two three"), true); // 13 chars, 3 words
    assert.equal(meetsQuoteMinimum("ab cd efghij"), true); // exactly 12 chars
    assert.equal(meetsQuoteMinimum("ab cd efghi"), false); // 11 chars
    assert.equal(meetsQuoteMinimum("verylongword another"), false); // 2 words
  });

  it("does not count mask tokens or [EXCLUDED_PARTICIPANT]", () => {
    assert.equal(meetsQuoteMinimum("[PHONE_1] [EMAIL_2] [UPI_3] [PASSWORD]"), false);
    assert.equal(meetsQuoteMinimum("call [PHONE_1] now"), false);
    assert.equal(meetsQuoteMinimum("[EXCLUDED_PARTICIPANT] said okay [BANK_1]"), false);
    assert.equal(meetsQuoteMinimum("[EXCLUDED_PARTICIPANT] said ok then"), true); // "said ok then" = 12 chars, 3 words
    assert.equal(meetsQuoteMinimum("please call [PHONE_1] before noon"), true);
  });

  it("counts words in unspaced scripts", () => {
    assert.equal(meetsQuoteMinimum("我们决定把会议改到星期五举行"), true);
  });

  it("the token pattern matches every token maskText produces (vocabulary cannot drift)", () => {
    const text = [
      "phone +91 99999 00001",
      "email someone@example.org",
      "upi someone@okicici",
      "a/c 123456789012",
      "ifsc HDFC0001234",
      "card 4111 1111 1111 1111",
      "pan ABCDE1234F",
      "password: hunter2hunter2",
      `key ${["sk", "live", "x".repeat(24)].join("_")}`, // assembled at runtime: synthetic, not a real key
      "secret Zq8xK2pL9mN4vB7cR1tY6wE3uI0oPaSd",
    ].join("\n");
    const masked = maskText({ text }).text;
    const tokens = masked.match(/\[[A-Z_]+(?:_\d+)?\]/g) ?? [];
    assert.ok(tokens.length >= 8, `expected many tokens, got ${tokens.join(",")}`);
    for (const token of tokens) {
      assert.equal(token.replace(MASK_TOKEN_PATTERN, ""), "", `pattern must match ${token}`);
    }
  });
});

describe("checkQuote (§10.7.2–3)", () => {
  it("exact match returns body offsets", () => {
    const quote = "We decided to move the meeting";
    const r = checkQuote(BODY, quote);
    assert.equal(r.check, "exact");
    assert.equal(BODY.slice(r.start!, r.end!), quote);
  });

  it("normalized match maps back to body coordinates", () => {
    const quote = "\"We decided to move the meeting to Friday - final answer.\"";
    const r = checkQuote(BODY, quote);
    assert.equal(r.check, "normalized");
    assert.equal(BODY.slice(r.start!, r.end!), "“We decided to move the meeting to Friday — final answer.”");
  });

  it("matches across line breaks, NBSP and zero-width characters", () => {
    const body = "Treasurer:\n  hands over the​ keys\n\nto Ravi on Monday";
    const r = checkQuote(body, "hands over the keys to Ravi");
    assert.equal(r.check, "normalized");
    assert.equal(body.slice(r.start!, r.end!), "hands over the​ keys\n\nto Ravi");
  });

  it("matches decomposed body text against a composed quote", () => {
    const body = "The café booking is confirmed for Sunday";
    const r = checkQuote(body, "The café booking is confirmed");
    assert.equal(r.check, "normalized");
    assert.equal(body.slice(r.start!, r.end!), "The café booking is confirmed");
  });

  it("is case-sensitive", () => {
    assert.equal(checkQuote(BODY, "WE DECIDED TO MOVE THE MEETING").check, "not_found");
  });

  it("does not match a quote that is absent, too short or ill-formed", () => {
    assert.deepEqual(checkQuote(BODY, "we never talked about this at all"), { check: "not_found", start: null, end: null });
    assert.equal(checkQuote(BODY, "decided").check, "not_found");
    assert.equal(checkQuote(BODY, "Friday —").check, "not_found");
    assert.equal(checkQuote(BODY + " \uD83D", "move the meeting \uD83D").check, "not_found");
    assert.equal(checkQuote(BODY, "").check, "not_found");
  });

  it("returns the first occurrence", () => {
    const body = "pay the hall deposit today. pay the hall deposit today.";
    const r = checkQuote(body, "pay the hall deposit today");
    assert.deepEqual(r, { check: "exact", start: 0, end: 26 });
  });

  it("never splits a grapheme cluster", () => {
    // Body has e + combining acute; a quote ending in a bare "e" must not match inside it.
    const body = "Reserve the café for tomorrow";
    assert.equal(checkQuote(body, "Reserve the cafe").check, "not_found");
    // Emoji with ZWJ sequence: the quote cannot end in the middle of it.
    const emoji = "Team lunch is on us 👩‍👩‍👧 yes";
    assert.equal(checkQuote(emoji, "Team lunch is on us 👩").check, "not_found");
    assert.equal(checkQuote(emoji, "Team lunch is on us 👩‍👩‍👧").check, "exact");
  });

  it("handles Devanagari and astral characters with UTF-16 offsets", () => {
    const body = "📌 नोट: हॉल की चाबी रवि के पास है।";
    const quote = "हॉल की चाबी रवि के पास";
    const r = checkQuote(body, quote);
    assert.equal(r.check, "exact");
    assert.equal(r.start, body.indexOf(quote));
    assert.equal(body.slice(r.start!, r.end!), quote);
  });

  it("keeps mask tokens as literal text", () => {
    const body = "Send the deposit to [UPI_1] before Friday please";
    const r = checkQuote(body, "Send the deposit to [UPI_1] before Friday");
    assert.equal(r.check, "exact");
  });

  it("property: a normalized match always re-normalizes to the quote (seeded fuzz)", () => {
    let seed = 0x2f6e2b1;
    const rand = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };
    const alphabet = ["a", "b", "c", "x", "y", " ", "  ", "\n", " ", "​", "‎", "—", "–", "“", "”", "‘", "’", "é", "é", "क्ष", "😀", "[PHONE_1]", "‍", "."];
    let matched = 0;
    for (let n = 0; n < 400; n++) {
      let body = "";
      const len = 10 + Math.floor(rand() * 40);
      for (let k = 0; k < len; k++) body += alphabet[Math.floor(rand() * alphabet.length)];
      body = `word one ${body} word two three`;
      const from = Math.floor(rand() * body.length);
      const to = Math.min(body.length, from + 12 + Math.floor(rand() * 30));
      const quote = normalizeForQuoteMatch(body.slice(from, to)).replace(/"/g, "”");
      const r = checkQuote(body, quote);
      if (r.check === "not_found") continue;
      matched++;
      assert.ok(r.start! >= 0 && r.end! <= body.length && r.start! < r.end!);
      assert.equal(normalizeForQuoteMatch(body.slice(r.start!, r.end!)), normalizeForQuoteMatch(quote), `seed case ${n}`);
    }
    assert.ok(matched > 50, `fuzz should exercise matches (got ${matched})`);
  });
});
