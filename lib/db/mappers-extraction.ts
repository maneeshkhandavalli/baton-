/**
 * Mappers for the R3 Task 03 readers (api_list_unreviewed_signals, api_list_point_flags). Defensive: an
 * unexpected row is refused (DbError internal) rather than passed to the UI half-formed.
 */

import { POINT_FLAG_KINDS, POINT_FLAG_STATES, type PointReviewFlag, type UnreviewedSignalMessage } from "../contracts/extraction";
import { DbError } from "./errors";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TOKEN = /^[a-z0-9_]{1,64}$/;

const obj = (v: unknown): Record<string, unknown> => {
  if (!v || typeof v !== "object" || Array.isArray(v)) throw new DbError("internal");
  return v as Record<string, unknown>;
};
const uuid = (v: unknown): string => {
  if (typeof v !== "string" || !UUID.test(v)) throw new DbError("internal");
  return v.toLowerCase();
};
const strOrNull = (v: unknown): string | null => (typeof v === "string" ? v : null);
const int = (v: unknown): number => (typeof v === "number" && Number.isInteger(v) && v >= 0 ? v : 0);

export function mapUnreviewedSignal(raw: unknown): UnreviewedSignalMessage {
  const r = obj(raw);
  const signals = Array.isArray(r.signals) ? r.signals : [];
  return {
    sourceId: uuid(r.sourceId),
    messageId: uuid(r.messageId),
    sentAt: strOrNull(r.sentAt),
    authorLabel: strOrNull(r.authorLabel),
    body: typeof r.body === "string" ? r.body : "",
    signals: signals.flatMap((s) => {
      const x = obj(s);
      if (typeof x.kind !== "string" || !TOKEN.test(x.kind)) return [];
      return [{ kind: x.kind, strength: x.strength === "strong" ? ("strong" as const) : ("weak" as const), start: int(x.start), end: int(x.end) }];
    }),
  };
}

export function mapPointReviewFlag(raw: unknown): PointReviewFlag {
  const r = obj(raw);
  if (!(POINT_FLAG_KINDS as readonly unknown[]).includes(r.kind) || !(POINT_FLAG_STATES as readonly unknown[]).includes(r.state)) {
    throw new DbError("internal");
  }
  const d = r.detail && typeof r.detail === "object" ? (r.detail as Record<string, unknown>) : {};
  const detail: PointReviewFlag["detail"] = {};
  if (Array.isArray(d.reasons)) detail.reasons = d.reasons.filter((x): x is string => typeof x === "string" && TOKEN.test(x));
  if (typeof d.score === "number" && Number.isFinite(d.score)) detail.score = d.score;
  if (typeof d.field === "string" && /^[A-Za-z]{1,40}$/.test(d.field)) detail.field = d.field;
  if (typeof d.status === "string" && TOKEN.test(d.status)) detail.status = d.status;
  return {
    id: uuid(r.id),
    pointId: uuid(r.pointId),
    kind: r.kind as PointReviewFlag["kind"],
    state: r.state as PointReviewFlag["state"],
    sourceMessageId: r.sourceMessageId === null || r.sourceMessageId === undefined ? null : uuid(r.sourceMessageId),
    detail,
    messageExcerpt: strOrNull(r.messageExcerpt),
    messageSentAt: strOrNull(r.messageSentAt),
  };
}
