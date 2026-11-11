/**
 * Pipeline logging: ids, counts, stages, statuses and reason tokens only (§12.7, I2). Never message text,
 * quotes, titles, labels, file names, prompts, model output or secrets.
 *
 * Enforced at runtime, not by convention: a string field is kept only if it is a UUID or a reason token
 * (`[a-z0-9_:]`, ≤ 64); anything else is replaced by "[dropped]". Numbers and booleans pass through.
 */

import { REASON_TOKEN_PATTERN } from "./types";

export type LogValue = string | number | boolean | null | undefined;
export type LogFields = Readonly<Record<string, LogValue>>;

export interface PipelineLogger {
  info(event: string, fields?: LogFields): void;
  warn(event: string, fields?: LogFields): void;
  error(event: string, fields?: LogFields): void;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KEY = /^[A-Za-z][A-Za-z0-9_]{0,40}$/;
export const DROPPED = "[dropped]";

function safeValue(v: LogValue): string | number | boolean | null {
  if (v === undefined || v === null) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "boolean") return v;
  return UUID.test(v) || REASON_TOKEN_PATTERN.test(v) ? v : DROPPED;
}

/** The structured record a logger emits; exported for tests. */
export function toLogRecord(level: "info" | "warn" | "error", event: string, fields?: LogFields) {
  const record: Record<string, string | number | boolean | null> = {
    scope: "pipeline",
    level,
    event: REASON_TOKEN_PATTERN.test(event) ? event : DROPPED,
  };
  for (const [k, v] of Object.entries(fields ?? {})) {
    if (KEY.test(k) && !(k in record)) record[k] = safeValue(v);
  }
  return record;
}

export function createConsoleLogger(): PipelineLogger {
  const emit = (level: "info" | "warn" | "error", event: string, fields?: LogFields) => {
    const line = JSON.stringify(toLogRecord(level, event, fields));
    if (level === "error") console.error(line);
    else if (level === "warn") console.warn(line);
    else console.info(line);
  };
  return {
    info: (e, f) => emit("info", e, f),
    warn: (e, f) => emit("warn", e, f),
    error: (e, f) => emit("error", e, f),
  };
}

/** Collects records in memory (tests). */
export function createMemoryLogger(): PipelineLogger & { records: ReturnType<typeof toLogRecord>[] } {
  const records: ReturnType<typeof toLogRecord>[] = [];
  return {
    records,
    info: (e, f) => void records.push(toLogRecord("info", e, f)),
    warn: (e, f) => void records.push(toLogRecord("warn", e, f)),
    error: (e, f) => void records.push(toLogRecord("error", e, f)),
  };
}
