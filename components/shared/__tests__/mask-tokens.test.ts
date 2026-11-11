import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { EXCLUDED_PARTICIPANT_TOKEN } from "../../../lib/contracts/parser";
import { isMaskToken, segmentMaskedText } from "../mask-tokens";

describe("segmentMaskedText (§12.1, D31)", () => {
  it("renders [EXCLUDED_PARTICIPANT] as its own segment, never as a mask", () => {
    const segs = segmentMaskedText(`front desk has a spare, ${EXCLUDED_PARTICIPANT_TOKEN} knows where it is`);
    assert.deepEqual(segs, [
      { kind: "text", text: "front desk has a spare, " },
      { kind: "excluded_participant" },
      { kind: "text", text: " knows where it is" },
    ]);
    assert.equal(isMaskToken(EXCLUDED_PARTICIPANT_TOKEN), false);
  });

  it("recognises every canonical mask token", () => {
    for (const t of ["[PHONE_1]", "[EMAIL_12]", "[UPI_2]", "[BANK_1]", "[IFSC_3]", "[CARD_1]", "[ID_4]", "[PASSWORD]", "[API_KEY]", "[SECRET]"]) {
      assert.deepEqual(segmentMaskedText(t), [{ kind: "mask", token: t }], t);
    }
  });

  it("leaves other bracketed text alone", () => {
    for (const t of ["[NOTE]", "[PHONE]", "[PASSWORD_1]", "[EXCLUDED_PARTICIPANT_1]", "[excluded_participant]", "[TODO_1]"]) {
      assert.deepEqual(segmentMaskedText(`see ${t} here`), [{ kind: "text", text: `see ${t} here` }], t);
    }
  });

  it("handles adjacent and repeated tokens of both kinds", () => {
    const segs = segmentMaskedText(`[PHONE_1]${EXCLUDED_PARTICIPANT_TOKEN} and ${EXCLUDED_PARTICIPANT_TOKEN} paid [UPI_1]`);
    assert.deepEqual(
      segs.map((s) => s.kind),
      ["mask", "excluded_participant", "text", "excluded_participant", "text", "mask"],
    );
  });

  it("returns no segments for an empty string", () => {
    assert.deepEqual(segmentMaskedText(""), []);
  });
});

describe("maskedTextToPlain (plain-text contexts)", () => {
  it("names an excluded participant in words and keeps mask tokens as written", async () => {
    const { maskedTextToPlain } = await import("../mask-tokens");
    assert.equal(maskedTextToPlain(`ask ${EXCLUDED_PARTICIPANT_TOKEN} or call [PHONE_1]`), "ask excluded participant or call [PHONE_1]");
    assert.doesNotMatch(maskedTextToPlain(EXCLUDED_PARTICIPANT_TOKEN), /\[|mask/i);
  });
});
