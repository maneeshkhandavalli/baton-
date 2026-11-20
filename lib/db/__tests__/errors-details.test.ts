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

// Bug C (20261121400200): a Baton function can name WHICH conflict it is with a snake_case HINT.
describe("DbError.fromRpc: a reason token in HINT", () => {
  it("passes a snake_case hint as details.reason; the message stays the fixed safe one", () => {
    const e = DbError.fromRpc({ code: "BTCF0", message: "this person already has an open invitation", hint: "invite_pending" });
    assert.equal(e.code, "conflict");
    assert.deepEqual(e.details, { reason: "invite_pending" });
    const app = toAppError(e);
    assert.deepEqual(app.details, { reason: "invite_pending" });
    assert.ok(!app.message.includes("open invitation"));
  });

  it("ignores Postgres' own sentence hints, empty and missing hints", () => {
    for (const hint of ["No function matches the given name and argument types.", "", null, undefined, "Invite_Pending", "x".repeat(65)]) {
      const e = DbError.fromRpc({ code: "BTCF0", message: "m", hint });
      assert.equal(e.details, undefined, String(hint));
      assert.equal(toAppError(e).details, undefined);
    }
  });
});
