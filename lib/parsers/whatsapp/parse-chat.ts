/**
 * WhatsApp chat-export text → raw chat messages (§11.4).
 *
 * Supported header shapes (leading U+200E/U+200F/BOM tolerated):
 *   Android  "31/12/2023, 21:15 - Name: text"     "12/31/23, 9:15 PM - Name: text"
 *            "31.12.23, 21:15 - Name: text"       "2023-12-31, 21:15 - Name: text"
 *   iOS      "[31/12/2023, 21:15:42] Name: text"  "[12/31/23, 9:15:42 PM] Name: text"
 * 12- and 24-hour clocks, optional seconds, "AM"/"am"/"a.m." with a normal, no-break or narrow
 * no-break space. Lines without a header continue the previous message.
 *
 * Date order (dmy / mdy / ymd) is detected from the data. If the data cannot decide and the
 * caller gave no `dateOrder`, parsing fails with `date_format_ambiguous`; the parser never guesses.
 * Wall times are converted to UTC with the source's IANA timezone.
 */

import type { DateOrder } from "../../contracts/enums";
import type { RawChatMessage } from "../build-source";
import { ParserAbort } from "../errors";
import { isValidWallTime, wallTimeToUtc, type WallTime } from "../timezone";
import type { WarningCollector } from "../warnings";
import { isSystemEvent } from "./system-events";

const LEADING_MARKS = /^[\u200E\u200F\uFEFF\u202A-\u202E]+/;
const DATE = "(\\d{1,4})([/.\\-])(\\d{1,2})\\2(\\d{1,4})";
const TIME = "(\\d{1,2})[:.](\\d{2})(?:[:.](\\d{2}))?(?:[ \\u00A0\\u202F]?([AaPp])\\.?[ \\u00A0\\u202F]?[Mm]\\.?)?";
const ANDROID_RE = new RegExp(`^${DATE},?[ \\u00A0\\u202F]${TIME}[ \\u00A0\\u202F]?[-\\u2013\\u2014][ \\u00A0\\u202F](.*)$`);
const IOS_RE = new RegExp(`^\\[${DATE},?[ \\u00A0\\u202F]${TIME}\\][ \\u00A0\\u202F]?(.*)$`);

interface Header {
  line: number; // 1-based
  a: string;
  b: string;
  c: string;
  hour: number;
  minute: number;
  second: number;
  meridiem: "a" | "p" | null;
  rest: string;
}

function matchHeader(rawLine: string, line: number): Header | null {
  const s = rawLine.replace(LEADING_MARKS, "");
  const m = ANDROID_RE.exec(s) ?? IOS_RE.exec(s);
  if (!m) return null;
  return {
    line,
    a: m[1],
    b: m[3],
    c: m[4],
    hour: Number(m[5]),
    minute: Number(m[6]),
    second: m[7] === undefined ? 0 : Number(m[7]),
    meridiem: m[8] === undefined ? null : (m[8].toLowerCase() as "a" | "p"),
    rest: m[9],
  };
}

type OrderEvidence = "ymd" | "dmy" | "mdy" | "either" | "same" | "invalid";

/** What a header's date says about the order, independent of other lines. */
function evidenceFor(h: Header): OrderEvidence {
  if (h.a.length === 4) return h.c.length <= 2 ? "ymd" : "invalid";
  if (h.a.length > 2 || h.b.length > 2 || (h.c.length !== 2 && h.c.length !== 4)) return "invalid";
  const a = Number(h.a);
  const b = Number(h.b);
  if (a > 12 && b > 12) return "invalid";
  if (a > 12) return "dmy";
  if (b > 12) return "mdy";
  return a === b ? "same" : "either";
}

function wallTimeFor(h: Header, order: DateOrder): WallTime | null {
  let year: number;
  let month: number;
  let day: number;
  if (h.a.length === 4) {
    year = Number(h.a);
    month = Number(h.b);
    day = Number(h.c);
  } else {
    const y = Number(h.c);
    year = h.c.length === 2 ? 2000 + y : y;
    if (order === "mdy") {
      month = Number(h.a);
      day = Number(h.b);
    } else if (order === "dmy") {
      day = Number(h.a);
      month = Number(h.b);
    } else {
      return null; // a two-digit first field cannot be a year
    }
  }
  let hour = h.hour;
  if (h.meridiem !== null) {
    if (hour < 1 || hour > 12) return null;
    if (h.meridiem === "a" && hour === 12) hour = 0;
    else if (h.meridiem === "p" && hour !== 12) hour += 12;
  }
  const t: WallTime = { year, month, day, hour, minute: h.minute, second: h.second };
  return isValidWallTime(t) ? t : null;
}

function resolveDateOrder(headers: Header[], requested: DateOrder | undefined): DateOrder {
  let firstDmy: Header | null = null;
  let firstMdy: Header | null = null;
  let firstEither: Header | null = null;
  let firstYmd: Header | null = null;
  let firstSame: Header | null = null;
  for (const h of headers) {
    const e = evidenceFor(h);
    if (e === "dmy") firstDmy ??= h;
    else if (e === "mdy") firstMdy ??= h;
    else if (e === "either") firstEither ??= h;
    else if (e === "ymd") firstYmd ??= h;
    else if (e === "same") firstSame ??= h;
  }

  if (requested !== undefined) {
    // A two-digit first field can never be a year, so `ymd` is contradicted by every non-ymd date,
    // including day == month ones (R3: those used to be dropped silently, ending in empty_source).
    const contradiction =
      requested === "dmy" ? firstMdy : requested === "mdy" ? firstDmy : (firstDmy ?? firstMdy ?? firstEither ?? firstSame);
    if (contradiction) {
      throw new ParserAbort(
        "date_format_ambiguous",
        `The chosen date order (${requested}) does not fit the date on line ${contradiction.line}.`,
        contradiction.line,
      );
    }
    return requested;
  }
  if (firstDmy && firstMdy) {
    const later = firstDmy.line > firstMdy.line ? firstDmy : firstMdy;
    throw new ParserAbort(
      "date_format_ambiguous",
      `Dates in this chat are both day-first and month-first (line ${later.line}).`,
      later.line,
    );
  }
  if (firstDmy) return "dmy";
  if (firstMdy) return "mdy";
  if (firstEither) {
    throw new ParserAbort("date_format_ambiguous", undefined, firstEither.line);
  }
  // Only ymd dates, or day == month everywhere: both orders give the same dates.
  return firstYmd && !firstEither ? "ymd" : "dmy";
}

// ---------------------------------------------------------------------------------------------
// Message classification

const DELETED_RE = /^(?:this message was deleted(?: by .+)?|you deleted this message|this message was deleted by admin.*)\.?$/i;
const EDITED_RE = /[ \t]*[\u200E\u200F]?<This message was edited>[ \t]*$/;
const MEDIA_RE =
  /^(?:<media omitted>|<[^<>\n]*omitted>|<attached: [^>\n]+>|(?:image|video|audio|sticker|gif|document|contact card|voice message|video note) omitted|.+\bdocument omitted)$/i;
const FILE_ATTACHED_RE = /^.+ \(file attached\)$/i;

function stripMarks(s: string): string {
  return s.replace(LEADING_MARKS, "");
}

interface Classified {
  sender: string | null;
  kind: RawChatMessage["kind"];
  body: string;
  /** iOS only: the name field of a direction-marked system line (see RawChatMessage). */
  systemAttribution?: string;
}

/**
 * Splits a header's text into sender and body.
 *
 * 1. If the whole first line is an anchored system event (Android: "Asha added Ravi"), it is a
 *    system message.
 * 2. Otherwise, if it contains ": ", the text before the first ": " is the sender, unconditionally.
 *    Words such as "left" or "changed" and quotes in a name never demote a message to system.
 * 3. Otherwise (no ": " and not a known event) it is an unrecognised system line; there is no
 *    sender candidate, so no identity can be lost.
 * iOS writes events as "<group name>: \u200E<event>"; that is a system message only when the
 * body starts with the direction mark AND the remainder is an anchored event.
 */
function classify(rest: string, continuation: string[]): Classified {
  const cleanRest = stripMarks(rest);
  const sep = cleanRest.indexOf(": ");
  let sender: string | null = null;
  let firstLine = cleanRest;
  // Android event whose first ": " lies inside a quoted subject. The grammar's name slots and
  // tails cannot contain ": ", so this is the only way a line with ": " can be an event; the text
  // before the ": " is kept as an attribution so the line stays excludable if it was a sender.
  let eventAttribution: string | undefined;
  if (sep > 0) {
    if (isSystemEvent(cleanRest)) {
      eventAttribution = cleanRest.slice(0, sep);
    } else {
      sender = cleanRest.slice(0, sep);
      firstLine = cleanRest.slice(sep + 2);
    }
  }

  const lines = [firstLine, ...continuation];
  // Strip the edited marker from the last non-empty line.
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i].trim() === "") continue;
    lines[i] = lines[i].replace(EDITED_RE, "");
    break;
  }
  const bodyMarkedFirst = lines[0];
  lines[0] = stripMarks(lines[0]);
  const body = lines.join("\n").replace(/\s+$/, "");
  const trimmed = body.trim();

  if (sender === null) {
    return eventAttribution === undefined
      ? { sender: null, kind: "system", body: trimmed }
      : { sender: null, kind: "system", body: trimmed, systemAttribution: eventAttribution };
  }
  if (DELETED_RE.test(trimmed)) return { sender, kind: "deleted", body: "" };
  if (MEDIA_RE.test(trimmed)) return { sender, kind: "media_omitted", body: "" };
  if (FILE_ATTACHED_RE.test(lines[0].trim()) || /^<attached: [^>\n]+>$/i.test(lines[0].trim())) {
    const caption = lines.slice(1).join("\n").trim();
    return caption === "" ? { sender, kind: "media_omitted", body: "" } : { sender, kind: "text", body: caption };
  }
  // iOS writes group-level system events as "Group name: \u200E<event>". Both conditions are
  // required: the direction mark alone, or event-like words alone, never drop the sender. The
  // name field is kept as an attribution candidate, so if a real message is ever misread as an
  // event, excluding its author still removes it.
  if (/^[\u200E\u200F]/.test(bodyMarkedFirst) && continuation.length === 0 && isSystemEvent(lines[0])) {
    return { sender: null, kind: "system", body: trimmed, systemAttribution: sender };
  }
  return { sender, kind: "text", body };
}

// ---------------------------------------------------------------------------------------------

export interface ParseChatOptions {
  timezone: string;
  dateOrder?: DateOrder;
  warnings: WarningCollector;
}

export interface ParsedChat {
  messages: RawChatMessage[];
  totalLines: number;
  /** The EFFECTIVE date order: the caller's choice, or the one detected (part of `ParseContext`). */
  dateOrder: DateOrder;
}

/** True if any of the first non-empty lines look like a WhatsApp header (used for sniffing). */
export function looksLikeWhatsApp(lines: readonly string[]): boolean {
  let checked = 0;
  for (let i = 0; i < lines.length && checked < 50; i++) {
    if (lines[i].trim() === "") continue;
    checked++;
    if (matchHeader(lines[i], i + 1)) return true;
  }
  return false;
}

export function parseChatLines(lines: readonly string[], opts: ParseChatOptions): ParsedChat {
  const totalLines = lines.length > 0 && lines[lines.length - 1] === "" ? lines.length - 1 : lines.length;
  if (lines.every((l) => l.trim() === "")) throw new ParserAbort("empty_source");

  const headerAt: Array<Header | null> = lines.map((l, i) => matchHeader(l, i + 1));
  const headers = headerAt.filter((h): h is Header => h !== null && evidenceFor(h) !== "invalid");
  if (headers.length === 0) {
    throw new ParserAbort("unsupported_format", "No WhatsApp messages were recognised in the file.");
  }
  const order = resolveDateOrder(headers, opts.dateOrder);

  const messages: RawChatMessage[] = [];
  let orphanLines = 0;
  let current: { header: Header; wall: WallTime; continuation: string[]; lineEnd: number } | null = null;
  let prevMs: number | null = null;
  let nonMonotonic = 0;

  const flush = () => {
    if (!current) return;
    const zoned = wallTimeToUtc(current.wall, opts.timezone);
    if (zoned.nonexistent) {
      opts.warnings.add(
        "dst_gap",
        "A message time does not exist in the source timezone (daylight-saving change); the earlier offset was used.",
        current.header.line,
      );
    }
    if (prevMs !== null && zoned.utcMs < prevMs) nonMonotonic++;
    prevMs = zoned.utcMs;
    const c = classify(current.header.rest, current.continuation);
    messages.push({
      lineStart: current.header.line,
      lineEnd: current.lineEnd,
      sentAtIso: zoned.iso,
      sentAtMs: zoned.utcMs,
      sender: c.sender,
      ...(c.systemAttribution !== undefined ? { systemAttribution: c.systemAttribution } : {}),
      kind: c.kind,
      body: c.body.normalize("NFC"),
    });
    current = null;
  };

  for (let i = 0; i < lines.length; i++) {
    const h = headerAt[i];
    const wall = h ? wallTimeFor(h, order) : null;
    if (h && wall) {
      flush();
      current = { header: h, wall, continuation: [], lineEnd: i + 1 };
      continue;
    }
    if (h && !wall) {
      opts.warnings.add(
        "invalid_timestamp",
        "A line looks like a message header but its date or time is invalid; it was kept as text of the previous message.",
        i + 1,
      );
    }
    if (current) {
      current.continuation.push(lines[i]);
      if (lines[i] !== "" || i < lines.length - 1) current.lineEnd = i + 1;
    } else if (lines[i].trim() !== "") {
      orphanLines++;
    }
  }
  flush();

  // Trailing blank continuation lines do not extend a message.
  for (const m of messages) {
    while (m.lineEnd > m.lineStart && (lines[m.lineEnd - 1] ?? "").trim() === "") m.lineEnd--;
  }
  if (orphanLines > 0) {
    opts.warnings.add("orphan_lines", `${orphanLines} line(s) before the first message were ignored.`);
  }
  if (nonMonotonic > 0) {
    opts.warnings.add("non_monotonic_timestamps", `${nonMonotonic} message(s) are earlier than the message before them.`);
  }
  if (messages.length === 0) throw new ParserAbort("empty_source");
  return { messages, totalLines, dateOrder: order };
}
