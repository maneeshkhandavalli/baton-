/**
 * Parser contracts (docs/architecture/shared-contracts.md §11.4).
 *
 * Main defines these; the parser agent implements them in lib/parsers and lib/privacy.
 * Parsers are pure: bytes and options in, data out. They never import Supabase and never read
 * environment variables, so the identity pepper is passed in explicitly.
 */

import type { AppError } from "./api";
import type { DateOrder, ExclusionKind, MaskKind, MessageKind, SourceKind } from "./enums";

export interface ExclusionRule {
  kind: ExclusionKind;
  participantIdentityHash?: string; // hex
  conversationLocalId?: string;
  rangeStart?: string;
  rangeEnd?: string;
}

export interface ParseSourceInput {
  kind: SourceKind;
  fileName: string;
  bytes: Uint8Array;
  timezone: string; // IANA, e.g. "Asia/Kolkata"
  dateOrder?: DateOrder; // required if the parser reports date_format_ambiguous
  exclusions: ExclusionRule[];
  identityPepper: string; // server secret passed in; the parser never reads env
}

export type PreviewSourceInput = Omit<ParseSourceInput, "exclusions">;

export interface ParsedParticipant {
  localId: string; // "p_1"…
  displayLabel: string; // masked; phone-number senders become "Participant N"
  identityHash: string; // hex HMAC
  messageCount: number;
}

export interface ParsedConversation {
  localId: string; // "c_1"…
  startedAt: string | null;
  endedAt: string | null;
  messageCount: number;
  participantLocalIds: string[];
  preview: string; // masked, ≤ 140 chars
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
  body: string; // masked, NFC; "" for media_omitted/deleted
  location: MessageLocation | null;
}

export interface MaskingReport {
  counts: Record<MaskKind, number>;
}

export interface ParsedSource {
  kind: SourceKind;
  parserVersion: string; // semver of the parser module
  participants: ParsedParticipant[];
  conversations: ParsedConversation[];
  messages: NormalizedMessage[];
  masking: MaskingReport;
  stats: {
    totalLines: number;
    messagesKept: number;
    messagesExcluded: number;
    systemMessages: number;
    mediaOmitted: number;
  };
  firstMessageAt: string | null;
  lastMessageAt: string | null;
  warnings: Array<{ code: string; message: string; line?: number }>;
}

export type SourcePreview = Pick<
  ParsedSource,
  "kind" | "participants" | "conversations" | "masking" | "stats" | "firstMessageAt" | "lastMessageAt" | "warnings"
>;

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

/** The parser's `Result<T>`: failures carry `ParserError`, which is assignable to `AppError`. */
export type ParserResult<T> = { ok: true; data: T } | { ok: false; error: ParserError };

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
} as const;
