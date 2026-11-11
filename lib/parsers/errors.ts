/**
 * Structured parser failures (§11.4, D34).
 *
 * Every expected failure is RETURNED inside a `ParserResult`, never thrown:
 *  - problems with the FILE → `ParserError` (`parse_failed`, `unsupported_file_type`, `payload_too_large`);
 *  - problems with the CALLER's input or the server configuration (identity pepper, timezone, date
 *    order, exclusion rules, missing fields) → `ParserInputFailure`.
 * Internally both travel as exceptions (`ParserAbort`, `ParserInputError`) and are converted at the
 * module boundary (`parse-source.ts`). Only programming defects escape as thrown errors.
 *
 * Messages are user-safe: they never contain file content, names, numbers, rule values or the pepper.
 */

import {
  PARSER_INPUT_ERROR_APP_CODES,
  type ParserError,
  type ParserErrorCode,
  type ParserInputErrorCode,
  type ParserInputFailure,
  type ParserResult,
} from "../contracts/parser";

const USER_MESSAGES: Record<ParserErrorCode, string> = {
  unsupported_format: "This file type or layout is not supported.",
  empty_source: "The file does not contain any messages or text.",
  encoding_error: "The file's text encoding could not be read. Export it again as UTF-8 text.",
  date_format_ambiguous:
    "The dates in this chat could be day-first or month-first. Choose the date order and try again.",
  too_large: "The file is larger than the supported limit.",
  corrupt_file: "The file appears to be damaged or incomplete.",
  password_protected: "The file is password-protected or encrypted. Remove the password and upload it again.",
  no_text_layer: "The PDF has no selectable text (it may be scanned). Scanned documents are not supported.",
};

const INPUT_MESSAGES: Record<ParserInputErrorCode, string> = {
  identity_pepper_invalid: "The server's identity configuration is missing or invalid. Processing was stopped.",
  timezone_invalid: "The timezone is not a valid IANA timezone name.",
  date_order_invalid: "The date order must be day-month-year, month-day-year or year-month-day.",
  exclusion_invalid: "An exclusion rule is malformed, so the file was not processed.",
  exclusion_context_mismatch: "This exclusion was chosen with different settings. Confirm it again.",
  input_invalid: "The parser input is incomplete or invalid.",
};

function appCodeFor(parserCode: ParserErrorCode): ParserError["code"] {
  if (parserCode === "too_large") return "payload_too_large";
  if (parserCode === "unsupported_format") return "unsupported_file_type";
  return "parse_failed";
}

/**
 * Builds a contract `ParserError`. `message` must be safe to show users: it never contains file
 * content, sender names or stack traces. `detail` is an optional extra sentence, also user-safe.
 */
export function parserError(parserCode: ParserErrorCode, detail?: string, line?: number): ParserError {
  const message = detail ? `${USER_MESSAGES[parserCode]} ${detail}` : USER_MESSAGES[parserCode];
  const details: ParserError["details"] = { parserCode };
  if (line !== undefined) details.line = line;
  return { code: appCodeFor(parserCode), message, retryable: false, details };
}

/**
 * Builds a contract `ParserInputFailure`. `field` is an input path ("exclusions[2]",
 * "identityPepper"), never a value. A pepper problem is a retryable configuration failure
 * (operators are alerted); every other input failure needs the caller to change its input.
 */
export function parserInputFailure(inputCode: ParserInputErrorCode, field: string, ruleId?: string): ParserInputFailure {
  const details: ParserInputFailure["details"] = { inputCode, field };
  if (ruleId !== undefined) details.ruleId = ruleId;
  return {
    code: PARSER_INPUT_ERROR_APP_CODES[inputCode],
    message: INPUT_MESSAGES[inputCode],
    retryable: inputCode === "identity_pepper_invalid",
    details,
  };
}

export function fail<T>(parserCode: ParserErrorCode, detail?: string, line?: number): ParserResult<T> {
  return { ok: false, error: parserError(parserCode, detail, line) };
}

export function ok<T>(data: T): ParserResult<T> {
  return { ok: true, data };
}

/** Internal control-flow exception carrying a `ParserError`; caught at the module boundary. */
export class ParserAbort extends Error {
  readonly error: ParserError;
  constructor(parserCode: ParserErrorCode, detail?: string, line?: number) {
    super(parserCode);
    this.name = "ParserAbort";
    this.error = parserError(parserCode, detail, line);
  }
}

/**
 * Internal control-flow exception for a caller or configuration problem. `parseSource` and
 * `previewSource` convert it to a returned `ParserInputFailure`; it never crosses the module
 * boundary from those entry points. Lower-level helpers (for example `computeIdentityHash` called
 * directly with a bad pepper) still throw it, because there it signals a programming defect.
 */
export class ParserInputError extends Error {
  readonly inputCode: ParserInputErrorCode;
  readonly field: string;
  readonly ruleId: string | undefined;
  constructor(inputCode: ParserInputErrorCode, field: string, message: string, ruleId?: string) {
    super(message);
    this.name = "ParserInputError";
    this.inputCode = inputCode;
    this.field = field;
    this.ruleId = ruleId;
  }

  get failure(): ParserInputFailure {
    return parserInputFailure(this.inputCode, this.field, this.ruleId);
  }
}
