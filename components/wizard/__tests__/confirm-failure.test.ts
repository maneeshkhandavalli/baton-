// QA-R3-16 (UI half): confirmSourceUploaded returns validation_failed for several checks. Only a
// kind mismatch may say "This file isn't a valid …"; a damaged upload offers Retry; oversize shows the size message.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { uploadPhaseMeta } from "../../shared/upload-status";
import { confirmFailure, TOO_LARGE_MESSAGE } from "../draft-state";

const file = { kindNoun: "PDF" };
const invalid = (reason?: string) => ({ code: "validation_failed", retryable: false, details: reason ? { reason } : undefined });

describe("confirmFailure", () => {
  it("kind_mismatch: the type message, not retryable", () => {
    const f = confirmFailure(invalid("kind_mismatch"), { kindNoun: "WhatsApp chat export", textHint: " If it's a plain text document, switch it to Plain text." });
    assert.equal(f.phase, "unsupported");
    assert.equal(f.message, "This file isn't a valid WhatsApp chat export. Choose the right file. If it's a plain text document, switch it to Plain text.");
    assert.equal(uploadPhaseMeta[f.phase].retryable, false);
  });

  it("integrity_mismatch: didn't arrive intact, with Retry", () => {
    const f = confirmFailure(invalid("integrity_mismatch"), file);
    assert.equal(f.phase, "failed");
    assert.match(f.message, /didn't arrive intact/);
    assert.doesNotMatch(f.message, /isn't a valid/);
    assert.equal(uploadPhaseMeta[f.phase].retryable, true);
  });

  it("too_large: the size message", () => {
    const f = confirmFailure(invalid("too_large"), file);
    assert.deepEqual(f, { phase: "too_large", message: TOO_LARGE_MESSAGE });
  });

  it("an unknown or missing reason never blames the file type", () => {
    for (const reason of [undefined, "something_new"]) {
      const f = confirmFailure(invalid(reason), file);
      assert.equal(f.phase, "failed");
      assert.doesNotMatch(f.message, /isn't a valid/);
    }
  });

  it("other errors keep the transient / mismatch wording", () => {
    assert.match(confirmFailure({ code: "internal", retryable: true }, file).message, /Check your connection/);
    assert.match(confirmFailure(null, file).message, /Check your connection/);
    assert.match(confirmFailure({ code: "forbidden", retryable: false }, file).message, /didn't match what was sent/);
  });
});
