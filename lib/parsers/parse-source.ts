/**
 * Parser module entry points (§11.4): `parseSource` and `previewSource`.
 *
 * Pure: bytes and options in, data out. No I/O, no environment variables, no clock, no randomness,
 * so the same input always gives the same output. The identity pepper is passed in.
 *
 * Failures (D34) are always RETURNED:
 *  - file problems → `ParserError`;
 *  - caller and configuration problems (pepper, timezone, date order, exclusion rules, missing or
 *    mistyped fields, unknown kind, a conversation rule from another parse context) →
 *    `ParserInputFailure`.
 * Only programming defects throw.
 *
 * Input is validated before the file is read, in this order: input object and fields, pepper,
 * timezone, date order, exclusion rules. The conversation-rule context check needs the effective
 * date order, so it runs after the chat headers are parsed and before anything is built.
 *
 * `previewSource` takes the same rules as `parseSource` (D33) and returns the same data minus the
 * messages: excluded participants and conversations never reach a preview.
 */

import { DATE_ORDERS, SOURCE_KINDS } from "../contracts/enums";
import type {
  ParsedSource,
  ParseSourceFn,
  ParseSourceInput,
  ParserResult,
  PreviewSourceFn,
  SourcePreview,
} from "../contracts/parser";
import { compileExclusions, type CompiledExclusions } from "../privacy/exclusions";
import { assertIdentityPepper } from "../privacy/identity";
import { buildChatSource, buildDocumentSource, type BuildCommon } from "./build-source";
import { parseDocx } from "./docx/parse-docx";
import { parseMarkdownLines } from "./documents/parse-markdown";
import { ParserAbort, ParserInputError } from "./errors";
import { LIMITS } from "./limits";
import { parsePdf } from "./pdf/parse-pdf";
import { decodeText, splitLines } from "./text-decode";
import { assertTimezone } from "./timezone";
import { PARSER_VERSION } from "./version";
import { WarningCollector } from "./warnings";
import { parseChatLines } from "./whatsapp/parse-chat";
import { selectChatEntry } from "./whatsapp/select-chat-entry";
import { isZip, openZip } from "./zip/read-zip";

/** Validates the caller's input. Throws `ParserInputError`; returns the compiled rules. */
function validateInput(input: unknown): { input: ParseSourceInput; exclusions: CompiledExclusions } {
  if (!input || typeof input !== "object") {
    throw new ParserInputError("input_invalid", "input", "input must be an object");
  }
  const i = input as Record<string, unknown>;
  if (!(SOURCE_KINDS as readonly unknown[]).includes(i.kind)) {
    throw new ParserInputError("input_invalid", "kind", "kind must be a supported source kind");
  }
  if (typeof i.fileName !== "string") {
    throw new ParserInputError("input_invalid", "fileName", "fileName must be a string");
  }
  if (!(i.bytes instanceof Uint8Array)) {
    throw new ParserInputError("input_invalid", "bytes", "bytes must be a Uint8Array");
  }
  assertIdentityPepper(i.identityPepper);
  assertTimezone(i.timezone);
  if (i.dateOrder !== undefined && !(DATE_ORDERS as readonly unknown[]).includes(i.dateOrder)) {
    throw new ParserInputError("date_order_invalid", "dateOrder", "dateOrder must be one of dmy, mdy, ymd");
  }
  const exclusions = compileExclusions(i.exclusions);
  return { input: input as ParseSourceInput, exclusions };
}

function parseInternal(input: ParseSourceInput, exclusions: CompiledExclusions): ParsedSource {
  const { bytes, kind } = input;
  if (bytes.length > LIMITS.maxFileBytes) {
    throw new ParserAbort("too_large", `Files can be at most ${LIMITS.maxFileBytes / (1024 * 1024)} MB.`);
  }
  if (bytes.length === 0) throw new ParserAbort("empty_source");

  const warnings = new WarningCollector();
  const common = (totalLines: number, dateOrder: BuildCommon["parseContext"]["dateOrder"]): BuildCommon => ({
    kind,
    totalLines,
    warnings,
    exclusions,
    parseContext: { timezone: input.timezone, dateOrder, parserVersion: PARSER_VERSION },
  });

  switch (kind) {
    case "whatsapp_export": {
      let textBytes = bytes;
      if (isZip(bytes)) {
        const zip = openZip(bytes);
        textBytes = zip.read(selectChatEntry(zip));
        if (textBytes.length === 0) throw new ParserAbort("empty_source");
      }
      const lines = splitLines(decodeText(textBytes));
      const chat = parseChatLines(lines, { timezone: input.timezone, dateOrder: input.dateOrder, warnings });
      return buildChatSource(common(chat.totalLines, chat.dateOrder), chat.messages, input.identityPepper);
    }
    case "pdf": {
      const doc = parsePdf(bytes, warnings);
      return buildDocumentSource(common(doc.totalLines, null), doc.blocks);
    }
    case "docx": {
      const doc = parseDocx(bytes);
      return buildDocumentSource(common(doc.totalLines, null), doc.blocks);
    }
    case "markdown":
    case "text": {
      if (isZip(bytes)) throw new ParserAbort("unsupported_format", "The file is an archive, not a text document.");
      const lines = splitLines(decodeText(bytes));
      const blocks = parseMarkdownLines(lines, kind === "markdown");
      const totalLines = lines.length > 0 && lines[lines.length - 1] === "" ? lines.length - 1 : lines.length;
      return buildDocumentSource(common(totalLines, null), blocks);
    }
    default: {
      // Unreachable: `validateInput` accepts only SOURCE_KINDS. A new kind without a parser is a defect.
      const unhandled: never = kind;
      throw new Error(`no parser for source kind ${String(unhandled)}`);
    }
  }
}

function run<T>(rawInput: ParseSourceInput, map: (s: ParsedSource) => T): ParserResult<T> {
  try {
    const { input, exclusions } = validateInput(rawInput);
    return { ok: true, data: map(parseInternal(input, exclusions)) };
  } catch (e) {
    if (e instanceof ParserAbort) return { ok: false, error: e.error };
    if (e instanceof ParserInputError) return { ok: false, error: e.failure };
    throw e; // programming defect: the job runner treats it as `internal`
  }
}

/** Final parse: exclusions applied in memory, then masking. */
export const parseSource: ParseSourceFn = async (input) => run(input, (s) => s);

/**
 * Read-only preview with the SAME rules as the final parse (D33): labels, counts and masked
 * previews of retained content only, plus `parseContext` and `identityMatches`. Messages are omitted.
 */
export const previewSource: PreviewSourceFn = async (input) =>
  run(input, (s): SourcePreview => ({
    kind: s.kind,
    parserVersion: s.parserVersion,
    parseContext: s.parseContext,
    participants: s.participants,
    conversations: s.conversations,
    masking: s.masking,
    stats: s.stats,
    identityMatches: s.identityMatches,
    firstMessageAt: s.firstMessageAt,
    lastMessageAt: s.lastMessageAt,
    warnings: s.warnings,
  }));
