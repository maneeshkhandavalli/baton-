import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { maskedCountsText } from "../privacy-summary";

describe("Settings privacy bullet: masked counts", () => {
  it("no parentheses when nothing was masked (empty, or only zero counts)", () => {
    assert.equal(maskedCountsText({}), null);
    assert.equal(maskedCountsText({ phone: 0, email: 0 }), null);
  });

  it("lists only the kinds that were masked", () => {
    const text = maskedCountsText({ phone: 2, email: 0 });
    assert.ok(text);
    assert.match(text, /^2 /);
    assert.doesNotMatch(text, /, $/);
  });
});
