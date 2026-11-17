/**
 * Contradiction retrieval (R3 Task 03, VER-2). Pure and deterministic.
 *
 * Until now a point became `conflicting` only when one of ITS OWN cited quotes was judged to contradict
 * it. This module looks beyond the cited messages: for each point it ranks the messages that came AFTER
 * the point's newest cited message and share something with it (people, dates, amounts, topic words),
 * boosted by reversal markers ("actually", "postponed", "moved to") and decision markers.
 *
 * The result is a list of "possible contradiction" candidates for a reviewer. Nothing here changes a
 * point's status, its evidence or its verdicts: earlier evidence is never overwritten, and a candidate is
 * only a pointer ("this later message may change the picture").
 */

import { detectMessageSignals, normaliseAmount, normaliseDate } from "./detect";

export interface RetrievalMessage {
  id: string;
  sourceId: string;
  seq: number;
  sentAt: string | null;
  authorLabel: string | null;
  body: string;
}

export interface RetrievalPoint {
  pointId: string;
  title: string | null;
  statement: string | null;
  attributes: Record<string, unknown> | null;
  citedMessageIds: readonly string[];
}

export const CONTRADICTION_REASONS = [
  "newer",
  "reversal_marker",
  "decision_marker",
  "shared_participant",
  "shared_date",
  "shared_amount",
  "changed_date",
  "changed_amount",
  "shared_topic",
] as const;
export type ContradictionReason = (typeof CONTRADICTION_REASONS)[number];

export interface ContradictionCandidate {
  pointId: string;
  messageId: string;
  score: number;
  reasons: ContradictionReason[];
}

export const CONTRADICTION_LIMITS = {
  /** Candidates kept per point. */
  perPoint: 3,
  /** Minimum score for a candidate. */
  minScore: 5,
} as const;

const STOPWORDS = new Set(
  (
    "about above after again also another because been before being below between both but could does doing down during each " +
    "from further have having here hers herself himself into itself just more most myself once only other ours ourselves over own " +
    "same should some such than that their theirs them themselves then there these they this those through under until very " +
    "were what when where which while whom will with would your yours yourself yourselves please thanks thank okay sure team " +
    "message messages will shall need needs know think going said says anyone someone everyone today tomorrow week month " +
    "person handover point"
  ).split(" "),
);

function topicWords(text: string): Set<string> {
  const out = new Set<string>();
  const cleaned = text.toLowerCase().replace(/\[[a-z_]+(?:_\d+)?\]/g, " ");
  for (const w of cleaned.split(/[^\p{L}\p{N}]+/u)) {
    if (w.length >= 4 && !STOPWORDS.has(w) && !/^\d+$/.test(w)) out.add(w.length > 5 ? w.slice(0, 6) : w); // crude stem
  }
  return out;
}

function entities(text: string, id = "x") {
  const signals = detectMessageSignals({ id, body: text });
  const people = new Set(signals.filter((s) => s.kind === "person_mention" && s.value).map((s) => s.value as string));
  const dates = new Set(signals.filter((s) => s.kind === "deadline" || s.kind === "date").map((s) => normaliseDate(text.slice(s.start, s.end))));
  const amounts = new Set(
    signals.filter((s) => s.kind === "amount" || s.kind === "financial_commitment").map((s) => normaliseAmount(text.slice(s.start, s.end))),
  );
  const kinds = new Set(signals.map((s) => s.kind));
  return { people, dates, amounts, kinds };
}

function stringsOf(value: unknown, out: string[] = []): string[] {
  if (typeof value === "string") out.push(value);
  else if (Array.isArray(value)) for (const v of value) stringsOf(v, out);
  else if (value && typeof value === "object") for (const v of Object.values(value)) stringsOf(v, out);
  return out;
}

const time = (iso: string | null) => (iso === null ? Number.NaN : Date.parse(iso));

/** True when `m` comes after `anchor`: a later timestamp, or a later position in the same source. */
export function isNewer(m: RetrievalMessage, anchor: RetrievalMessage): boolean {
  const a = time(anchor.sentAt);
  const b = time(m.sentAt);
  if (!Number.isNaN(a) && !Number.isNaN(b) && a !== b) return b > a;
  return m.sourceId === anchor.sourceId && m.seq > anchor.seq;
}

const intersects = <T>(a: ReadonlySet<T>, b: ReadonlySet<T>) => [...a].some((x) => b.has(x));

/**
 * Ranks possible contradictions for every point. `messages` are all text messages of the handover's sources
 * (pseudonymised and masked). Points without a cited message are skipped (nothing to anchor on).
 */
export function findContradictionCandidates(
  points: readonly RetrievalPoint[],
  messages: readonly RetrievalMessage[],
  limits: { perPoint: number; minScore: number } = CONTRADICTION_LIMITS,
): ContradictionCandidate[] {
  const byId = new Map(messages.map((m) => [m.id, m]));
  const msgFacts = new Map(messages.map((m) => [m.id, { ...entities(m.body, m.id), words: topicWords(m.body) }]));
  const out: ContradictionCandidate[] = [];

  for (const p of points) {
    const cited = p.citedMessageIds.map((id) => byId.get(id)).filter((m): m is RetrievalMessage => m !== undefined);
    if (cited.length === 0 || p.statement === null) continue;
    const anchor = cited.reduce((a, b) => (isNewer(b, a) ? b : a));
    const claimText = [p.title ?? "", p.statement, ...stringsOf(p.attributes)].join("\n");
    const claim = entities(claimText);
    const citedText = cited.map((m) => m.body).join("\n");
    const citedFacts = entities(citedText);
    const people = new Set([...claim.people, ...citedFacts.people, ...cited.map((m) => m.authorLabel).filter((a): a is string => !!a)]);
    const dates = new Set([...claim.dates, ...citedFacts.dates]);
    const amounts = new Set([...claim.amounts, ...citedFacts.amounts]);
    const words = topicWords(`${claimText}\n${citedText}`);
    const citedIds = new Set(p.citedMessageIds);

    const ranked: ContradictionCandidate[] = [];
    for (const m of messages) {
      if (citedIds.has(m.id) || !isNewer(m, anchor)) continue;
      const f = msgFacts.get(m.id)!;
      const sharedWords = [...f.words].filter((w) => words.has(w)).length;
      if (sharedWords === 0) continue; // not on topic: never a candidate
      const reasons: ContradictionReason[] = ["newer"];
      let score = 0;
      if (sharedWords >= 2) {
        reasons.push("shared_topic");
        score += sharedWords >= 3 ? 3 : 2;
      } else {
        score += 1;
      }
      if (f.kinds.has("reversal")) {
        reasons.push("reversal_marker");
        score += 3;
      }
      if (f.kinds.has("decision")) {
        reasons.push("decision_marker");
        score += 1;
      }
      const msgPeople = new Set([...f.people, ...(m.authorLabel ? [m.authorLabel] : [])]);
      if (intersects(msgPeople, people)) {
        reasons.push("shared_participant");
        score += 1;
      }
      if (f.dates.size > 0 && dates.size > 0) {
        if (intersects(f.dates, dates)) {
          reasons.push("shared_date");
          score += 1;
        } else {
          reasons.push("changed_date");
          score += 2;
        }
      }
      if (f.amounts.size > 0 && amounts.size > 0) {
        if (intersects(f.amounts, amounts)) {
          reasons.push("shared_amount");
          score += 1;
        } else {
          reasons.push("changed_amount");
          score += 2;
        }
      }
      if (score >= limits.minScore) ranked.push({ pointId: p.pointId, messageId: m.id, score, reasons });
    }
    ranked.sort((a, b) => b.score - a.score || (a.messageId < b.messageId ? -1 : 1));
    out.push(...ranked.slice(0, limits.perPoint));
  }
  return out;
}
