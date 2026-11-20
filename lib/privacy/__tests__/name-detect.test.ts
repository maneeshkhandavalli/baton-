// R4 (audit 3.2 / 3.4 / S3): local detection of names that are not known participants. Synthetic names only.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { ParsedSource } from "../../contracts/parser";
import {
  createFuzzyKnownMatcher,
  createNameReplacer,
  createUnknownNamePseudonymizer,
  discoverNames,
  translitSkeleton,
} from "../name-detect";
import { discoverSourceNames, pseudonymizeMentionedNames, pseudonymizeParsedSource } from "../pseudonymize-source";

const labels = (texts: string[]) => discoverNames(texts).map((n) => n.label);
const scrub = (texts: string[]) => {
  const p = createUnknownNamePseudonymizer(texts);
  return texts.map((t) => p.apply(t).text);
};

describe("discoverNames: mentioned-only people", () => {
  it("finds names by cue, honorific, @mention, possessive and capitalised runs", () => {
    const found = labels([
      "Ask Kavya Menon about the vendor list before Friday.",
      "Mr. Rao has the godown keys. Dr Iyer signs the forms",
      "Farhan said the Excel sheet is on Google Drive",
      "Send the invoice to Arjun Pillai",
      "talk to sharma sir, and @nikhil please check",
      "Owner: Deepa Nair",
      "The ledger is updated every Saturday by Suresh.",
      "Kiran's laptop is with the front desk",
    ]);
    for (const n of ["Kavya Menon", "Rao", "Iyer", "Farhan", "Arjun Pillai", "sharma", "nikhil", "Deepa Nair", "Suresh", "Kiran"]) {
      assert.ok(found.includes(n), `${n} not found in ${JSON.stringify(found)}`);
    }
  });

  it("joined honorifics are kept whole (never split into a shorter name)", () => {
    const found = labels(["Ravibhai collects the rent and Balaji keeps the receipts; Meenadidi signs"]);
    assert.ok(found.includes("Ravibhai"));
    assert.ok(found.includes("Meenadidi"));
    assert.equal(found.includes("Ravi"), false);
    assert.equal(found.includes("Bala"), false);
  });

  it("false-positive guards: weekdays, months, apps, brands, places, acronyms and sentence starters are not names", () => {
    const texts = [
      "Please file the GST return by Monday. The Invoice for Q3 is in Excel on Google Drive.",
      "Slack and WhatsApp alerts go to the Finance team in Mumbai every March.",
      "Everything is fine. Nothing has changed. Tomorrow will be busy. Payment is due on Friday.",
      "Next Steps",
      "Pay via UPI or NEFT to the HDFC account; Zoom link is in Outlook.",
    ];
    assert.deepEqual(labels(texts), []);
    assert.deepEqual(scrub(texts), texts);
  });

  it("a capitalised word that is also used as an ordinary lower-case word is not a name without a cue", () => {
    assert.deepEqual(labels(["Update the Stall Rotation Plan", "the stall opens at nine", "rotation is weekly"]), []);
  });

  it("common words that are also names need a cue, and are then replaced only where capitalised", () => {
    assert.deepEqual(labels(["We will meet later"]), []);
    const found = discoverNames(["Thanks Asha for the keys", "there is always asha (hope)"]);
    assert.deepEqual(found, [{ label: "Asha", caseSensitive: true }]);
    const r = createNameReplacer(found.map((f) => ({ ...f, token: "[PERSON_9]" })));
    assert.equal(r.apply("Thanks Asha, asha remains").text, "Thanks [PERSON_9], asha remains");
  });

  it("lower-case words before 'ji' or 'sir' are names only when unambiguous", () => {
    assert.deepEqual(labels(["chalo ji, haan ji, theek hai sir", "ok sir done"]), []);
    assert.deepEqual(labels(["please ask mehta ji"]), ["mehta"]);
    assert.deepEqual(labels(["mehta ji will come", "the mehta file is ready"]), [], "used as an ordinary word elsewhere");
  });

  it("placeholders, URLs, e-mail addresses and hashtags are never names", () => {
    const texts = ["Visit https://Example.com/Path or write to Kumar@example.org #Diwali [PERSON_1] [EXCLUDED_PARTICIPANT] [PHONE_2]"];
    assert.deepEqual(labels(texts), []);
    assert.deepEqual(scrub(texts), texts);
  });

  it("the word after a placeholder is judged by the word before it", () => {
    assert.deepEqual(labels(["[PERSON_1] Robotics"]), []);
    assert.ok(labels(["Thanks [PERSON_1] Menon"]).includes("Menon"));
  });

  it("is deterministic", () => {
    const t = ["Ask Kavya Menon and Farhan", "Suresh will bring the projector"];
    assert.deepEqual(discoverNames(t), discoverNames(t));
  });
});

describe("createUnknownNamePseudonymizer: AI payload text", () => {
  it("replaces every form of a discovered name with [PERSON], consistently across texts", () => {
    const [claim, quote] = scrub(["Kavya Menon owns the venue booking", "ask Kavya Menon, Kavya's number is with Kavyaji"]);
    assert.equal(claim, "[PERSON] owns the venue booking");
    assert.equal(quote, "ask [PERSON], [PERSON]'s number is with [PERSON]");
  });

  it("an edit or Gap Interview answer naming a person who never wrote is pseudonymised", () => {
    const out = scrub(["The deposit receipt is with Mrs Lata Joshi, call her before the audit"]);
    assert.equal(out[0].includes("Lata"), false);
    assert.equal(out[0].includes("Joshi"), false);
  });
});

describe("createFuzzyKnownMatcher: nicknames, transliterations and joined forms of known people", () => {
  const f = createFuzzyKnownMatcher([
    { ordinal: 1, label: "Ravindra Shah" },
    { ordinal: 2, label: "Priya Sharma" },
    { ordinal: 3, label: "Sandeep" },
    { ordinal: 4, label: null },
  ]);
  it("maps each variant to the known number", () => {
    assert.equal(f.apply("Ravi will call").text, "[PERSON_1] will call");
    assert.equal(f.apply("Ravibhai said so").text, "[PERSON_1]-bhai said so");
    assert.equal(f.apply("Preeya agreed").text, "[PERSON_2] agreed");
    assert.equal(f.apply("Sandip paid").text, "[PERSON_3] paid");
    assert.equal(f.apply("priyaji is late").text, "[PERSON_2]-ji is late");
    assert.equal(f.apply("Sharma's form").text, "[PERSON_2]'s form");
  });
  it("leaves ordinary words alone", () => {
    for (const t of ["Sure thing", "Sand the table", "Prism report", "ok"]) assert.equal(f.apply(t).text, t);
  });
  it("a form shared by two people becomes [PERSON]", () => {
    const g = createFuzzyKnownMatcher([
      { ordinal: 1, label: "Ravindra Shah" },
      { ordinal: 2, label: "Ravikiran Rao" },
    ]);
    assert.equal(g.apply("Ravi will call").text, "[PERSON] will call");
  });
  it("transliteration skeleton", () => {
    assert.equal(translitSkeleton("Preeya"), translitSkeleton("Priya"));
    assert.equal(translitSkeleton("Sandeep"), translitSkeleton("Sandip"));
    assert.notEqual(translitSkeleton("Sunil"), translitSkeleton("Sonal"));
  });
});

describe("document-only source: discovery is never a no-op", () => {
  const doc: ParsedSource = {
    kind: "markdown",
    parserVersion: "test",
    parseContext: { kind: "markdown" } as never,
    participants: [],
    conversations: [],
    messages: [
      { seq: 0, conversationLocalId: null, participantLocalId: null, sentAt: null, kind: "text", body: "Owner: Deepa Nair. Ask Farhan for the locker key.", location: { heading: "Contacts for Deepa Nair", lineStart: 1, lineEnd: 1 } },
      { seq: 1, conversationLocalId: null, participantLocalId: null, sentAt: null, kind: "text", body: "Deepa will hand over the GST files on Monday.", location: { heading: "Contacts for Deepa Nair", lineStart: 2, lineEnd: 2 } },
    ],
    identityMatches: [],
  } as unknown as ParsedSource;

  it("known pass is a no-op without people, the mentioned pass is not", () => {
    const known = pseudonymizeParsedSource(doc, { ordinalOf: new Map(), people: [] });
    assert.equal(known.replaced, 0);
    const names = discoverSourceNames(known.parsed);
    assert.deepEqual(names.map((n) => n.label).sort(), ["Deepa", "Deepa Nair", "Farhan"]);
    const tokens: Record<string, string> = { "Deepa Nair": "[PERSON_1]", Deepa: "[PERSON_1]", Farhan: "[PERSON_2]" };
    const out = pseudonymizeMentionedNames(known.parsed, names.map((n) => ({ ...n, token: tokens[n.label] })));
    assert.equal(out.parsed.messages[0].body, "Owner: [PERSON_1]. Ask [PERSON_2] for the locker key.");
    assert.equal(out.parsed.messages[0].location?.heading, "Contacts for [PERSON_1]");
    assert.equal(out.parsed.messages[1].body, "[PERSON_1] will hand over the GST files on Monday.");
    assert.equal(JSON.stringify(out.parsed).includes("Deepa"), false);
    assert.equal(JSON.stringify(out.parsed).includes("Farhan"), false);
  });
});
