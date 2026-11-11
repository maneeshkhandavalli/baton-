/**
 * Wall-clock time in an IANA timezone → UTC instant, using only `Intl` (no dependency).
 *
 * DST handling is deterministic:
 *  - a wall time that occurs twice (clocks go back) resolves to the EARLIER instant;
 *  - a wall time that does not exist (clocks go forward) resolves using the offset in force
 *    before the transition, and the caller is told so it can emit a warning.
 */

import { ParserInputError } from "./errors";

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone);
  if (!f) {
    try {
      f = new Intl.DateTimeFormat("en-US", {
        timeZone,
        hourCycle: "h23",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      });
    } catch {
      throw new ParserInputError("timezone_invalid", "timezone", "timezone must be a valid IANA timezone name");
    }
    formatters.set(timeZone, f);
  }
  return f;
}

/** Throws `ParserInputError` (`timezone_invalid`) if `timeZone` is not a valid IANA zone. */
export function assertTimezone(timeZone: unknown): asserts timeZone is string {
  if (typeof timeZone !== "string" || timeZone.trim() === "" || timeZone.trim() !== timeZone) {
    throw new ParserInputError("timezone_invalid", "timezone", "timezone is required");
  }
  formatterFor(timeZone);
}

/** Offset (ms) of `timeZone` from UTC at the instant `utcMs`. */
function offsetAt(timeZone: string, utcMs: number): number {
  const parts = formatterFor(timeZone).formatToParts(new Date(utcMs));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return asUtc - Math.floor(utcMs / 1000) * 1000;
}

export interface WallTime {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number; // 0-23
  minute: number;
  second: number;
}

export function isValidWallTime(t: WallTime): boolean {
  if (t.month < 1 || t.month > 12 || t.day < 1) return false;
  if (t.hour < 0 || t.hour > 23 || t.minute < 0 || t.minute > 59 || t.second < 0 || t.second > 59) return false;
  const daysInMonth = new Date(Date.UTC(t.year, t.month, 0)).getUTCDate();
  return t.day <= daysInMonth;
}

export interface ZonedResult {
  iso: string;
  utcMs: number;
  /** True when the wall time does not exist in the zone (DST gap). */
  nonexistent: boolean;
}

export function wallTimeToUtc(t: WallTime, timeZone: string): ZonedResult {
  const naive = Date.UTC(t.year, t.month - 1, t.day, t.hour, t.minute, t.second);
  // Candidate offsets: those in force a day before and a day after cover any transition.
  const candidates = Array.from(
    new Set([offsetAt(timeZone, naive - 86_400_000), offsetAt(timeZone, naive), offsetAt(timeZone, naive + 86_400_000)]),
  );
  const matches = candidates.map((o) => naive - o).filter((utc) => offsetAt(timeZone, utc) === naive - utc);
  if (matches.length > 0) {
    const utcMs = Math.min(...matches);
    return { iso: new Date(utcMs).toISOString(), utcMs, nonexistent: false };
  }
  // DST gap: use the offset in force before the transition.
  const utcMs = naive - offsetAt(timeZone, naive - 86_400_000);
  return { iso: new Date(utcMs).toISOString(), utcMs, nonexistent: true };
}
