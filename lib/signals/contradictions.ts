/**
 * Contradiction retrieval (R3 Task 03, VER-2). Pure and deterministic.
 *
 * Until now a point became `conflicting` only when one of ITS OWN cited quotes was judged to contradict
 * it. This module looks beyond the cited messages: for each point it ranks the messages that came AFTER
 * the point's newest cited message and share something with it (people, dates, amounts, topic words),
 * boosted by reversal markers ("actually", "postponed", "moved to") and decision markers. A message that shares
 * only ONE topic word with the point must also share a person, a date or an amount with it: a marker shows that
 * something changed, not that this point's subject did.
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
  /**
   * Round 4 B (audit 4.12): the point's category. When given, two DECISION points on the same subject are compared
   * with each other (a later decision may supersede an earlier one); without it the behaviour is unchanged.
   */
  category?: string | null;
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

    const ranked: ContradictionCandidate[] = supersedingDecisions(p, anchor, claim, points, byId, msgFacts, limits.minScore);
    for (const m of messages) {
      if (citedIds.has(m.id) || !isNewer(m, anchor)) continue;
      const f = msgFacts.get(m.id)!;
      const sharedWords = [...f.words].filter((w) => words.has(w)).length;
      if (sharedWords === 0) continue; // not on topic: never a candidate
      const msgPeople = new Set([...f.people, ...(m.authorLabel ? [m.authorLabel] : [])]);
      // One shared topic word ("sponsor") is not the same subject. Markers ("replaced by", "from now on") say that
      // SOMETHING changed, not that this point did, so with a single shared word the message must also share a
      // concrete fact with the point (a person, a date or an amount); otherwise it is never a candidate.
      if (sharedWords < 2 && !intersects(msgPeople, people) && !intersects(f.dates, dates) && !intersects(f.amounts, amounts)) continue;
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
      if (score < limits.minScore) continue;
      const already = ranked.find((r) => r.messageId === m.id);
      if (already) {
        if (score > already.score) Object.assign(already, { score, reasons });
      } else ranked.push({ pointId: p.pointId, messageId: m.id, score, reasons });
    }
    ranked.sort((a, b) => b.score - a.score || (a.messageId < b.messageId ? -1 : 1));
    out.push(...ranked.slice(0, limits.perPoint));
  }
  return out;
}

type Facts = ReturnType<typeof entities> & { words: Set<string> };

const differs = <T>(a: ReadonlySet<T>, b: ReadonlySet<T>) => a.size > 0 && b.size > 0 && !intersects(a, b);

/**
 * Round 4 B (audit 4.12, decision-vs-decision supersession). A LATER decision point on the same subject may supersede
 * this decision even when its message uses no listed reversal word ("the expo is in the seminar hall" after "the
 * expo is in the main hall"). Conservative: both points are decisions, their claims (title and statement only) share
 * at least two topic words without being the same claim, the later point's newest cited message is strictly newer
 * than this point's newest cited message and is not cited by this point, and that message carries a decision or
 * reversal marker or the two claims name different dates or amounts. The candidate points at that message, like any
 * other: a pointer for the reviewer, never a status change.
 */
function supersedingDecisions(
  p: RetrievalPoint,
  anchor: RetrievalMessage,
  claim: ReturnType<typeof entities>,
  points: readonly RetrievalPoint[],
  byId: ReadonlyMap<string, RetrievalMessage>,
  msgFacts: ReadonlyMap<string, Facts>,
  minScore: number,
): ContradictionCandidate[] {
  if (p.category !== "decision") return [];
  const citedIds = new Set(p.citedMessageIds);
  const ownWords = topicWords([p.title ?? "", p.statement ?? ""].join("\n"));
  const ownStatement = (p.statement ?? "").trim().toLowerCase();
  const out: ContradictionCandidate[] = [];
  for (const q of points) {
    if (q.pointId === p.pointId || q.category !== "decision" || q.statement === null) continue;
    if (q.statement.trim().toLowerCase() === ownStatement) continue; // the same claim twice is a duplicate, not a change
    const qCited = q.citedMessageIds.map((id) => byId.get(id)).filter((m): m is RetrievalMessage => m !== undefined);
    if (qCited.length === 0) continue;
    const later = qCited.reduce((a, b) => (isNewer(b, a) ? b : a));
    if (citedIds.has(later.id) || !isNewer(later, anchor)) continue;
    const shared = [...topicWords([q.title ?? "", q.statement].join("\n"))].filter((w) => ownWords.has(w)).length;
    if (shared < 2) continue;
    const f = msgFacts.get(later.id);
    if (!f) continue;
    const other = entities(`${q.title ?? ""}\n${q.statement}`);
    const changedDate = differs(other.dates, claim.dates);
    const changedAmount = differs(other.amounts, claim.amounts);
    const reversal = f.kinds.has("reversal");
    const decision = f.kinds.has("decision");
    if (!reversal && !decision && !changedDate && !changedAmount) continue;
    const reasons: ContradictionReason[] = ["newer", "shared_topic"];
    let score = (shared >= 3 ? 3 : 2) + 2; // same subject, later decision
    if (reversal) {
      reasons.push("reversal_marker");
      score += 3;
    }
    if (decision) {
      reasons.push("decision_marker");
      score += 1;
    }
    if (changedDate) {
      reasons.push("changed_date");
      score += 2;
    }
    if (changedAmount) {
      reasons.push("changed_amount");
      score += 2;
    }
    if (score < minScore || out.some((c) => c.messageId === later.id)) continue;
    out.push({ pointId: p.pointId, messageId: later.id, score, reasons });
  }
  return out;
}
