// R3 Task 02 (PRIV-1): [PERSON_n] placeholders in stored text are segmented, never shown as raw tokens in
// plain-text places, and never confused with masks or the excluded-participant token.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { maskedTextToPlain, personPlainLabel, segmentMaskedText } from "../mask-tokens";

describe("person placeholders", () => {
  it("segments numbered and ambiguous person tokens next to masks and exclusions", () => {
    assert.deepEqual(segmentMaskedText("[PERSON_3] paid [PHONE_1]; ask [PERSON] or [EXCLUDED_PARTICIPANT]"), [
      { kind: "person", ordinal: 3 },
      { kind: "text", text: " paid " },
      { kind: "mask", token: "[PHONE_1]" },
      { kind: "text", text: "; ask " },
      { kind: "person", ordinal: null },
      { kind: "text", text: " or " },
      { kind: "excluded_participant" },
    ]);
  });

  it("leaves look-alikes as text", () => {
    for (const s of ["[PERSON_0]", "[PERSON_x]", "[person_1]", "[PERSON_1234567]"]) {
      assert.deepEqual(segmentMaskedText(s), [{ kind: "text", text: s }], s);
    }
  });

  it("plain-text places read 'Person n' or 'a participant', never the raw token", () => {
    assert.equal(maskedTextToPlain("Erase [PERSON_12]?"), "Erase Person 12?");
    assert.equal(maskedTextToPlain("[PERSON] said so"), "a participant said so");
    assert.equal(personPlainLabel(4), "Person 4");
  });
});
