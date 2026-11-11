import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { DB_ERROR_CODES, DB_SQLSTATE_ERROR_CODES, ERROR_CODES } from "../api";
import { MASK_KINDS } from "../enums";
import {
  EXCLUDED_PARTICIPANT_TOKEN,
  PARSER_INPUT_ERROR_APP_CODES,
  PARSER_INPUT_ERROR_CODES,
  PARSER_WARNING_CODES,
  isParserInputFailure,
  type ParserFailure,
} from "../parser";

describe("parser failures (§11.4)", () => {
  it("maps every input error code to an AppError code", () => {
    for (const code of PARSER_INPUT_ERROR_CODES) {
      assert.ok((ERROR_CODES as readonly string[]).includes(PARSER_INPUT_ERROR_APP_CODES[code]), code);
    }
  });

  it("treats a pepper problem as a retryable configuration failure, and a stale exclusion as a precondition", () => {
    assert.equal(PARSER_INPUT_ERROR_APP_CODES.identity_pepper_invalid, "processing_failed");
    assert.equal(PARSER_INPUT_ERROR_APP_CODES.exclusion_context_mismatch, "precondition_failed");
  });

  it("distinguishes input failures from file failures", () => {
    const fileFailure: ParserFailure = {
      code: "parse_failed",
      message: "The file appears to be damaged or incomplete.",
      retryable: false,
      details: { parserCode: "corrupt_file" },
    };
    const inputFailure: ParserFailure = {
      code: "precondition_failed",
      message: "This exclusion was chosen with different settings. Confirm it again.",
      retryable: false,
      details: { inputCode: "exclusion_context_mismatch", field: "exclusions[0]", ruleId: "r1" },
    };
    assert.equal(isParserInputFailure(fileFailure), false);
    assert.equal(isParserInputFailure(inputFailure), true);
  });
});

describe("parser output vocabulary (§11.4, §12.1)", () => {
  it("includes the ratified warning codes, with warnings_truncated last", () => {
    for (const code of ["excluded_mentions_redacted", "pdf_cmap_truncated", "pdf_font_limit"]) {
      assert.ok((PARSER_WARNING_CODES as readonly string[]).includes(code), code);
    }
    assert.equal(PARSER_WARNING_CODES.at(-1), "warnings_truncated");
    assert.equal(new Set(PARSER_WARNING_CODES).size, PARSER_WARNING_CODES.length);
  });

  it("reserves [EXCLUDED_PARTICIPANT], which is not a mask token", () => {
    assert.equal(EXCLUDED_PARTICIPANT_TOKEN, "[EXCLUDED_PARTICIPANT]");
    assert.equal((MASK_KINDS as readonly string[]).includes("excluded_participant"), false);
    // Mask tokens are numbered ([PHONE_1]) or fixed ([PASSWORD], [API_KEY], [SECRET]); none collides.
    for (const fixed of ["[PASSWORD]", "[API_KEY]", "[SECRET]"]) assert.notEqual(fixed, EXCLUDED_PARTICIPANT_TOKEN);
  });
});

describe("DB error categories (§3.2)", () => {
  it("are a subset of ErrorCode and include the documented categories", () => {
    for (const code of DB_ERROR_CODES) assert.ok((ERROR_CODES as readonly string[]).includes(code), code);
    for (const code of ["precondition_failed", "token_invalid", "forbidden", "validation_failed"]) {
      assert.ok((DB_ERROR_CODES as readonly string[]).includes(code), code);
    }
  });

  it("maps every custom SQLSTATE to a distinct DB error code", () => {
    const values = Object.values(DB_SQLSTATE_ERROR_CODES);
    assert.equal(new Set(values).size, values.length);
    for (const state of Object.keys(DB_SQLSTATE_ERROR_CODES)) assert.match(state, /^BT[A-Z]{2}0$/);
  });
});
