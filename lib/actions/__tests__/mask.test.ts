// The shared input masker (§12.1, QA-H1). Synthetic values only.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createInputMasker, UNMASKED_ATTRIBUTE_KEYS } from "../core/mask";
import { SYNTHETIC_EMAIL, SYNTHETIC_PHONE } from "./helpers";

describe("createInputMasker", () => {
  it("masks phone numbers and emails in free text", () => {
    const m = createInputMasker();
    const out = m.text(`Call ${SYNTHETIC_PHONE} or write to ${SYNTHETIC_EMAIL}`);
    assert.doesNotMatch(out, /99999|example\.test/);
    assert.match(out, /\[PHONE_1\]/);
    assert.match(out, /\[EMAIL_1\]/);
  });

  it("numbers tokens consistently across the fields of one request, and afresh per request", () => {
    const m = createInputMasker();
    assert.equal(m.text(SYNTHETIC_PHONE), "[PHONE_1]");
    assert.equal(m.text("+44 20 7946 0958"), "[PHONE_2]");
    assert.equal(m.text(`again ${SYNTHETIC_PHONE}`), "again [PHONE_1]");
    assert.equal(createInputMasker().text("+44 20 7946 0958"), "[PHONE_1]");
  });

  it("optional and nullable keep absent values absent", () => {
    const m = createInputMasker();
    assert.equal(m.optional(undefined), undefined);
    assert.equal(m.nullable(null), null);
    assert.equal(m.nullable(undefined), undefined);
    assert.equal(m.optional(SYNTHETIC_EMAIL), "[EMAIL_1]");
  });

  it("masks every string in attributes, nested and in arrays, except directContact and dueDate", () => {
    assert.deepEqual([...UNMASKED_ATTRIBUTE_KEYS].sort(), ["directContact", "dueDate"]);
    const m = createInputMasker();
    const out = m.attributes({
      rationale: `per ${SYNTHETIC_PHONE}`,
      alternativesConsidered: [`ask ${SYNTHETIC_EMAIL}`, "wait"],
      nested: { note: SYNTHETIC_PHONE },
      directContact: { channel: "phone", value: SYNTHETIC_PHONE },
      dueDate: "2026-12-01",
      likelihood: "low",
      count: 3,
      empty: null,
    });
    assert.deepEqual(out, {
      rationale: "per [PHONE_1]",
      alternativesConsidered: ["ask [EMAIL_1]", "wait"],
      nested: { note: "[PHONE_1]" },
      directContact: { channel: "phone", value: SYNTHETIC_PHONE },
      dueDate: "2026-12-01",
      likelihood: "low",
      count: 3,
      empty: null,
    });
  });
});
