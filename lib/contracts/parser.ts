/**
 * Parser contracts (docs/architecture/shared-contracts.md §11.4).
 *
 * Main defines these; the parser agent implements them in lib/parsers and lib/privacy.
 * Parsers are pure: bytes and options in, data out. They never import Supabase and never read
 * environment variables, so the identity pepper is passed in explicitly.
 *
 * Every expected failure, including invalid caller input and configuration, is RETURNED as a typed
 * failure (`ParserFailure`). The parser functions throw only on programming defects, which the job
 * runner treats as `internal`.
 */

import type { AppError } from "./api";
import type {
  DateOrder,
  ExclusionRuleMode,
  IdentityKind,
  IdentityPepperVersion,
  MaskKind,
  MessageKind,
  SourceKind,
} from "./enums";

// ── Parse context and exclusion rules ────────────────────────────────────────

/**
 * What positional ids (`c_N`, `p_N`) depend on. A conversation exclusion is bound to the context it
 * was chosen in; if the context changes it is rejected (§10.3).
 */
export interface ParseContext {
  timezone: string; // IANA
  dateOrder: DateOrder | null; // the EFFECTIVE order (detected or supplied); null for documents
  parserVersion: string;
}

interface ExclusionRuleBase {
  /** Opaque id echoed back in reports (the `source_exclusions.id`); never interpreted by the parser. */
  ruleId?: string;
}

/** Matches a participant only when identity kind, hash and pepper version all agree (§12.11). */
export interface ParticipantExclusionRule extends ExclusionRuleBase {
  kind: "participant";
  identityKind: IdentityKind;
  participantIdentityHash: string; // 64 lower-case hex
  identityPepperVersion: IdentityPepperVersion;
  /** `apply` drops the participant; `detect` keeps them and reports an `IdentityMatch` (§6.8.1). */
  mode: ExclusionRuleMode;
}

export interface ConversationExclusionRule extends ExclusionRuleBase {
  kind: "conversation";
  conversationLocalId: string; // "c_1"…
  /** The context the id was chosen in. A mismatch fails with `exclusion_context_mismatch`. */
  context: ParseContext;
}

export interface DateRangeExclusionRule extends ExclusionRuleBase {
  kind: "date_range";
  rangeStart?: string; // ISO 8601 with offset; inclusive
  rangeEnd?: string; // ISO 8601 with offset; inclusive. At least one end is required
}

export type ExclusionRule = ParticipantExclusionRule | ConversationExclusionRule | DateRangeExclusionRule;

// ── Inputs ───────────────────────────────────────────────────────────────────

export interface ParseSourceInput {
  kind: SourceKind;
  fileName: string;
  bytes: Uint8Array;
  timezone: string; // IANA, e.g. "Asia/Kolkata"
  dateOrder?: DateOrder; // required if the parser reports date_format_ambiguous
  exclusions: ExclusionRule[];
  identityPepper: string; // server secret passed in; the parser never reads env
}

/**
 * Preview takes the same rules as the final parse (§10.3): main supplies the handover-wide
 * participant rules and the source's own rules, so a preview never shows an excluded participant.
 */
export type PreviewSourceInput = ParseSourceInput;

// ── Output ───────────────────────────────────────────────────────────────────

/** Canonical text that replaces an excluded participant's name or mention inside kept messages. */
export const EXCLUDED_PARTICIPANT_TOKEN = "[EXCLUDED_PARTICIPANT]";

export interface ParsedParticipant {
  localId: string; // "p_1"…
  displayLabel: string; // masked; phone-number senders become "Participant N"
  identityKind: IdentityKind;
  identityHash: string; // 64 lower-case hex HMAC
  identityPepperVersion: IdentityPepperVersion;
  messageCount: number; // retained messages only
}

export interface ParsedConversation {
  localId: string; // "c_1"…
  startedAt: string | null; // retained messages only
  endedAt: string | null;
  messageCount: number; // retained messages only
  participantLocalIds: string[]; // retained participants only
  preview: string; // masked, ≤ 140 chars, from a retained message; "" if none
}

export interface MessageLocation {
  page?: number;
  heading?: string;
  lineStart: number;
  lineEnd: number;
}

export interface NormalizedMessage {
  seq: number; // 0-based, dense, in source order (after exclusion)
  conversationLocalId: string | null;
  participantLocalId: string | null;
  sentAt: string | null; // ISO, converted using timezone; null for documents
  kind: MessageKind;
  body: string; // masked, NFC; "" for media_omitted/deleted. May contain EXCLUDED_PARTICIPANT_TOKEN
  location: MessageLocation | null;
}

export interface MaskingReport {
  counts: Record<MaskKind, number>;
}

/** A `detect` rule that matched a retained participant. Needs a human decision (§6.8.1). */
export interface IdentityMatch {
  ruleId: string | null;
  participantLocalId: string;
  identityKind: IdentityKind;
}

export const PARSER_WARNING_CODES = [
  "dst_gap",
  "invalid_timestamp",
  "orphan_lines",
  "non_monotonic_timestamps",
  "excluded_mentions_redacted",
  "pdf_page_limit",
  "pdf_stream_skipped",
  "pdf_cmap_truncated",
  "pdf_font_limit",
  "pdf_decode_failures",
  "pdf_undecodable_text",
  "warnings_truncated", // always last; summarises warnings beyond the per-source cap
] as const;
export type ParserWarningCode = (typeof PARSER_WARNING_CODES)[number];

/** `message` is user-safe: it never quotes content, names or numbers. */
export interface ParserWarning {
  code: ParserWarningCode;
  message: string;
  line?: number;
}

export interface ParsedSource {
  kind: SourceKind;
  parserVersion: string; // semver of the parser module
  parseContext: ParseContext; // store it with every conversation exclusion chosen from this result
  participants: ParsedParticipant[]; // excluded participants are never listed
  conversations: ParsedConversation[]; // conversations with no retained message are omitted
  messages: NormalizedMessage[];
  masking: MaskingReport;
  stats: {
    totalLines: number;
    messagesKept: number;
    messagesExcluded: number; // aggregate count only; never which or whose
    systemMessages: number;
    mediaOmitted: number;
  };
  identityMatches: IdentityMatch[];
  firstMessageAt: string | null;
  lastMessageAt: string | null;
  warnings: ParserWarning[];
}

export type SourcePreview = Pick<
  ParsedSource,
  | "kind"
  | "parserVersion"
  | "parseContext"
  | "participants"
  | "conversations"
  | "masking"
  | "stats"
  | "identityMatches"
  | "firstMessageAt"
  | "lastMessageAt"
  | "warnings"
>;

// ── Failures ─────────────────────────────────────────────────────────────────

/** Problems with the FILE. */
export const PARSER_ERROR_CODES = [
  "unsupported_format",
  "empty_source",
  "encoding_error",
  "date_format_ambiguous",
  "too_large",
  "corrupt_file",
  "password_protected",
  "no_text_layer",
] as const;
export type ParserErrorCode = (typeof PARSER_ERROR_CODES)[number];

export interface ParserError extends AppError {
  code: "parse_failed" | "unsupported_file_type" | "payload_too_large";
  details: { parserCode: ParserErrorCode; line?: number };
}

/** Problems with the CALLER's input or the server configuration (§11.4). */
export const PARSER_INPUT_ERROR_CODES = [
  "identity_pepper_invalid", // missing, < 32 chars, or padded: configuration error
  "timezone_invalid",
  "date_order_invalid",
  "exclusion_invalid", // malformed rule; never silently ignored
  "exclusion_context_mismatch", // a conversation rule from another parse context
  "input_invalid", // bytes not a Uint8Array, missing fields, unknown kind
] as const;
export type ParserInputErrorCode = (typeof PARSER_INPUT_ERROR_CODES)[number];

/** The `AppError` code each input failure maps to. */
export const PARSER_INPUT_ERROR_APP_CODES = {
  identity_pepper_invalid: "processing_failed", // retryable; operators alerted (§12.8 point 9)
  timezone_invalid: "validation_failed",
  date_order_invalid: "validation_failed",
  exclusion_invalid: "validation_failed",
  exclusion_context_mismatch: "precondition_failed", // the user must re-confirm the exclusion
  input_invalid: "validation_failed",
} as const satisfies Record<ParserInputErrorCode, AppError["code"]>;

export interface ParserInputFailure extends AppError {
  code: (typeof PARSER_INPUT_ERROR_APP_CODES)[ParserInputErrorCode];
  /** `field` names the input path, e.g. "exclusions[2]"; never a value. `ruleId` when a rule failed. */
  details: { inputCode: ParserInputErrorCode; field: string; ruleId?: string };
}

export type ParserFailure = ParserError | ParserInputFailure;

/** The parser's `Result<T>`. Failures are assignable to `AppError`. */
export type ParserResult<T> = { ok: true; data: T } | { ok: false; error: ParserFailure };

export function isParserInputFailure(error: ParserFailure): error is ParserInputFailure {
  return "inputCode" in error.details;
}

// ── Masking ──────────────────────────────────────────────────────────────────

export const MASK_CONTEXTS = ["chat", "document", "user_input"] as const;
export type MaskContext = (typeof MASK_CONTEXTS)[number];

export interface MaskTextInput {
  text: string;
  context?: MaskContext;
}

export interface MaskResult {
  text: string;
  counts: Record<MaskKind, number>;
}

/** Function signatures the parser agent exports (lib/parsers, lib/privacy). */
export type ParseSourceFn = (input: ParseSourceInput) => Promise<ParserResult<ParsedSource>>;
export type PreviewSourceFn = (input: PreviewSourceInput) => Promise<ParserResult<SourcePreview>>;
export type MaskTextFn = (input: MaskTextInput) => MaskResult; // sync, pure

/** Limits from §11.4 (D15). */
export const PARSER_LIMITS = {
  maxFileBytes: 25 * 1024 * 1024,
  maxMessagesPerSource: 200_000,
  maxPreviewChars: 140,
} as const;
