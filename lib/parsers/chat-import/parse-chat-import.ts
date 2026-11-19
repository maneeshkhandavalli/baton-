/**
 * Parser for `chat_import` sources (Round 4): the JSON Lines transcript written by lib/connectors/transcript.ts.
 * Produces the same RawChatMessage values as the WhatsApp parser, so masking, identity hashing, exclusions,
 * conversation segmentation and everything downstream are shared unchanged.
 *
 * Pure: no I/O, env, clock or randomness (self-contained: no import from lib/connectors, which is server code).
 * Any malformed line fails the whole source as `unsupported_format` with its line number (the server is the only
 * writer, so a malformed file is tampering or a defect, never something to guess around).
 */

import type { RawChatMessage } from "../build-source";
import { ParserAbort } from "../errors";

const FORMAT = "baton.chat_import";
const KINDS = new Set(["text", "system", "media_omitted", "deleted"]);
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

export interface ChatImportParse {
  provider: string;
  channel: string;
  messages: RawChatMessage[];
  totalLines: number;
}

function bad(line: number, why: string): never {
  throw new ParserAbort("unsupported_format", `Line ${line} is not a valid Baton chat import (${why}).`, line);
}

export function parseChatImportLines(lines: readonly string[]): ChatImportParse {
  const effective = lines.length > 0 && lines[lines.length - 1] === "" ? lines.slice(0, -1) : lines;
  if (effective.length === 0) throw new ParserAbort("empty_source");

  let header: { format?: unknown; version?: unknown; provider?: unknown; channel?: unknown };
  try {
    header = JSON.parse(effective[0].replace(/^﻿/, ""));
  } catch {
    return bad(1, "header is not JSON");
  }
  if (!header || header.format !== FORMAT) bad(1, "missing format header");
  if (header.version !== 1) bad(1, "unsupported version");
  if (typeof header.provider !== "string" || typeof header.channel !== "string") bad(1, "header fields");

  const messages: RawChatMessage[] = [];
  let lastMs = -Infinity;
  for (let i = 1; i < effective.length; i++) {
    const lineNo = i + 1;
    let row: Record<string, unknown>;
    try {
      row = JSON.parse(effective[i]);
    } catch {
      return bad(lineNo, "not JSON");
    }
    if (!row || typeof row !== "object" || Array.isArray(row)) bad(lineNo, "not an object");
    const { at, author, kind, text } = row as { at: unknown; author: unknown; kind: unknown; text: unknown };
    if (typeof at !== "string" || !ISO_UTC.test(at)) bad(lineNo, "timestamp");
    const ms = Date.parse(at as string);
    if (Number.isNaN(ms)) bad(lineNo, "timestamp");
    if (ms < lastMs) bad(lineNo, "messages out of order");
    lastMs = ms;
    if (typeof kind !== "string" || !KINDS.has(kind)) bad(lineNo, "kind");
    if (typeof author !== "string" || typeof text !== "string") bad(lineNo, "author or text");
    const isSystem = kind === "system";
    if (!isSystem && (author as string).trim() === "") bad(lineNo, "author");
    messages.push({
      lineStart: lineNo,
      lineEnd: lineNo,
      sentAtIso: at as string,
      sentAtMs: ms,
      sender: isSystem ? null : (author as string),
      kind: kind as RawChatMessage["kind"],
      body: kind === "media_omitted" || kind === "deleted" ? "" : (text as string),
    });
  }
  if (messages.length === 0) throw new ParserAbort("empty_source");
  return { provider: header.provider as string, channel: header.channel as string, messages, totalLines: effective.length };
}
