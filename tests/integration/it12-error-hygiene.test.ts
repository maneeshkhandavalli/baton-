// IT-12 (lib/db half): whatever the database or a dependency says, the client receives a fixed code and a
// fixed message — never SQL text, constraint names, row values, provider bodies or PII (§3.2, §12.7).
// Actions, pipeline and drain-route error paths are added here as those modules land.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ERROR_CODES } from "../../lib/contracts/api";
import { DbError, toAppError } from "../../lib/db/errors";
import { callRpc } from "../../lib/db/rpc";
import { RecordingDb, RpcFailure } from "./support/recording-db";
import { PLANTED, assertNoLeaks } from "./support/sentinels";

const LEAKY_MESSAGE = `duplicate key value violates unique constraint "profiles_email_key" Key (email)=(${PLANTED.email})`;
const LEAKY_DETAILS = `Failing row contains (${PLANTED.phone}, ${PLANTED.upi})`;

const SQLSTATES = [
  "BTNF0", "BTCF0", "BTIT0", "BTPF0", "BTFB0", "BTVF0", "BTUA0", "BTTI0",
  "23505", "40001", "40P01", "55P03", "22P02", "23502", "23514", "22023", "23503", "42501", "PGRST301",
  "P0001", "XX000", "42883", "08006",
];

describe("IT-12: database errors reach the client only as safe AppErrors", () => {
  for (const state of SQLSTATES) {
    it(`SQLSTATE ${state}`, async () => {
      const db = new RecordingDb().on("fn", () => {
        throw new RpcFailure(state, LEAKY_MESSAGE, LEAKY_DETAILS);
      });
      const error = await callRpc(db, "fn").catch((e: unknown) => e);
      assert.ok(error instanceof DbError);
      const app = toAppError(error, "req-123");
      assert.ok((ERROR_CODES as readonly string[]).includes(app.code), `code ${app.code} is an ERROR_CODE`);
      assertNoLeaks(app, `AppError for ${state}`);
      assertNoLeaks({ message: error.message, name: error.name }, `DbError for ${state}`);
      assert.doesNotMatch(JSON.stringify(app), /profiles_email_key|duplicate key|Failing row/);
      if (app.details !== undefined) assert.deepEqual(Object.keys(app.details), ["requestId"], "details carry only a request id");
      assert.equal(typeof app.retryable, "boolean");
    });
  }

  it("unknown SQLSTATEs and thrown non-database errors become `internal` with the fixed message", () => {
    const thrown = new Error(`provider said: ${PLANTED.apiKey} for ${PLANTED.email}`);
    for (const value of [thrown, "a string", { message: LEAKY_MESSAGE }, null]) {
      const app = toAppError(value);
      assert.equal(app.code, "internal");
      assertNoLeaks(app, "internal AppError");
    }
  });

  it("hidden resources and missing ones produce byte-identical errors (§8.5)", async () => {
    const hidden = toAppError(await callRpc(new RecordingDb().fails("x", "BTNF0", "point 1 is restricted"), "x").catch((e: unknown) => e));
    const missing = toAppError(await callRpc(new RecordingDb().fails("x", "BTNF0", "no such row"), "x").catch((e: unknown) => e));
    assert.deepEqual(hidden, missing);
  });
});
