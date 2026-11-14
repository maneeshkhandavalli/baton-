// R3 QA-R3-16: toAppError passes only structural, snake_case details from a lib/db error to the client.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { DbError, toAppError } from "../errors";
import { UploadRejectedError } from "../storage";

describe("toAppError details passthrough (QA-R3-16)", () => {
  for (const reason of ["kind_mismatch", "integrity_mismatch", "too_large"] as const) {
    it(`an upload rejected for ${reason} reaches the client with its reason`, () => {
      const app = toAppError(new UploadRejectedError(reason));
      assert.equal(app.code, "validation_failed");
      assert.equal(app.retryable, false);
      assert.deepEqual(app.details, { reason });
    });
  }

  it("a plain DbError carries no details", () => {
    assert.equal(toAppError(new DbError("validation_failed")).details, undefined);
  });

  it("only short snake_case string values pass: no database text, ids or content", () => {
    const e = Object.assign(new DbError("validation_failed"), {
      details: { reason: "kind_mismatch", message: 'duplicate key value violates "sources_sha"', id: "6f0c-uuid", n: 3, nested: { a: "b" } },
    });
    assert.deepEqual(toAppError(e).details, { reason: "kind_mismatch" });
  });

  it("internal errors still expose only the request id", () => {
    const e = Object.assign(new DbError("internal"), { details: { reason: "kind_mismatch" } });
    assert.deepEqual(toAppError(e, "req-1").details, { requestId: "req-1" });
  });
});
