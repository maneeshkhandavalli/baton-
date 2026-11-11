import "server-only";

/**
 * Extraction stage (§10.6, §10.7, §11.8, §12.10; interfaces.md I1 with the W0 amendments).
 *
 * The model output is untrusted. Each candidate is parsed with the contract schema and then:
 * - must be in a requested category;
 * - citations naming a message that was not in this request are removed (`unknown_message`), and a
 *   candidate whose citations were ALL foreign is dropped even if it has a rationale (§10.6);
 * - duplicate citations are merged; the same quote cited with both stances drops the candidate;
 * - any model string that masking would change drops the candidate (`unmasked_content`, never re-masked);
 * - every citation is checked with `checkQuote` against the exact masked body that was sent, and carries
 *   `matchedText = body.slice(start, end)` for exact/normalized matches;
 * - a `not_found` quote that masking would change is removed as a citation (counted as `unmasked_content`);
 * - a candidate left with no exact/normalized citation and no rationale is `fabricated`.
 * Surviving candidates keep their `not_found` citations for audit (§10.7.3); they never count towards
 * status (§4.2). Candidates whose only verified citations contradict them are kept (status derives it).
 *
 * Nothing here logs; `dropped` holds counts by reason only.
 */

import { z } from "zod";

import { POINT_CATEGORIES } from "../contracts/enums";
import type { PointCategory } from "../contracts/enums";
import type { ExtractionCandidate, ExtractionCitation } from "../contracts/schemas";
import { EXTRACTION_CITATIONS_MAX, EXTRACTION_STATEMENT_MAX, extractionCandidateSchema, extractionResponseSchema } from "../contracts/schemas";
import { AI_ERROR_REASONS } from "./errors";
import { extractRequestWithinLimits } from "./limits";
import type { AiAttemptRecord, AiProvenance, AiProvider, AiResult, AiStageOptions, ExtractRequest } from "./provider";
import { checkQuote, normalizeForQuoteMatch } from "./quote-check";
import { attemptRecord, callProvider, checkStageOptions, invalidOutputFailure, requestFailure, wouldMask } from "./stage";

export { EXTRACT_REQUEST_LIMITS } from "./limits";

export const EXTRACT_DROP_REASONS = [
  "schema_invalid",
  "unknown_message",
  "all_citations_foreign",
  "category_not_requested",
  "contradictory_citations",
  "fabricated",
  "unmasked_content",
  "over_budget",
] as const;
export type ExtractDropReason = (typeof EXTRACT_DROP_REASONS)[number];

/** Serialized size cap for one candidate, and caps for attribute values the contract leaves unbounded. */
export const EXTRACT_CANDIDATE_BUDGET = {
  maxSerializedChars: 16_000,
  maxAttributeStringChars: EXTRACTION_STATEMENT_MAX,
  maxAttributeArrayItems: EXTRACTION_CITATIONS_MAX,
} as const;

export interface CheckedCitation extends ExtractionCitation {
  quoteCheck: "exact" | "normalized" | "not_found";
  /** UTF-16 offsets into the masked body that was sent; null for not_found. */
  quoteStart: number | null;
  quoteEnd: number | null;
  /** `body.slice(quoteStart, quoteEnd)` for exact/normalized; null for not_found. */
  matchedText: string | null;
}

/** Distributes over the category union so `attributes` stays correlated with `category`. */
export type CheckedCandidate = ExtractionCandidate extends infer C
  ? C extends ExtractionCandidate
    ? Omit<C, "citations"> & { citations: CheckedCitation[] }
    : never
  : never;

export interface ExtractOutcome {
  candidates: CheckedCandidate[];
  /** Counts by reason only, never content. Every reason is present (0 when unused). */
  dropped: Record<ExtractDropReason, number>;
  provenance: AiProvenance;
  attempt: AiAttemptRecord;
}

const extractRequestSchema = z.object({
  handover: z.object({ teamName: z.string(), roleTitle: z.string().nullable() }),
  categories: z.array(z.enum(POINT_CATEGORIES)).min(1),
  messages: z
    .array(z.object({ id: z.uuid(), authorLabel: z.string().nullable(), sentAt: z.string().nullable(), body: z.string() }))
    .min(1)
    .refine((ms) => new Set(ms.map((m) => m.id)).size === ms.length, "message ids must be unique"),
});

export function emptyDropCounts(): Record<ExtractDropReason, number> {
  return Object.fromEntries(EXTRACT_DROP_REASONS.map((r) => [r, 0])) as Record<ExtractDropReason, number>;
}

export async function extractCandidates(
  provider: AiProvider,
  req: ExtractRequest,
  opts: AiStageOptions,
): Promise<AiResult<ExtractOutcome>> {
  const checked = checkStageOptions(provider, opts, "extract");
  if (!checked.ok) return checked;
  const { clock, expected } = checked;

  if (!extractRequestSchema.safeParse(req).success) return requestFailure(clock, expected, AI_ERROR_REASONS.requestInvalid);
  if (!extractRequestWithinLimits(req)) return requestFailure(clock, expected, AI_ERROR_REASONS.requestTooLarge);

  const called = await callProvider(clock, expected, () => provider.extract(req, { signal: opts.signal }));
  if (!called.ok) return called;

  const envelope = extractionResponseSchema.safeParse(called.raw);
  if (!envelope.success) return invalidOutputFailure(clock, called.provenance, called.extra);

  const bodies = new Map(req.messages.map((m) => [m.id, m.body]));
  const requested = new Set<PointCategory>(req.categories);
  const dropped = emptyDropCounts();
  const candidates: CheckedCandidate[] = [];

  for (const raw of envelope.data.candidates) {
    const verdict = checkCandidate(raw, bodies, requested, dropped);
    if (typeof verdict === "string") dropped[verdict]++;
    else candidates.push(verdict);
  }

  return {
    ok: true,
    data: {
      candidates,
      dropped,
      provenance: called.provenance,
      attempt: attemptRecord(clock, { ...called.extra, outcome: "succeeded" }),
    },
  };
}

function checkCandidate(
  raw: unknown,
  bodies: ReadonlyMap<string, string>,
  requested: ReadonlySet<PointCategory>,
  dropped: Record<ExtractDropReason, number>,
): CheckedCandidate | ExtractDropReason {
  const parsed = extractionCandidateSchema.safeParse(raw);
  if (!parsed.success) return "schema_invalid";
  const candidate = parsed.data;

  if (overBudget(candidate)) return "over_budget";
  if (!requested.has(candidate.category)) return "category_not_requested";

  // Citations must name a message from THIS request (§10.6, §12.10 rule 3).
  const known = candidate.citations.filter((c) => bodies.has(c.messageId));
  dropped.unknown_message += candidate.citations.length - known.length;
  if (candidate.citations.length > 0 && known.length === 0) return "all_citations_foreign";

  // De-duplicate; the same quote cited with both stances is contradictory output.
  const stanceByKey = new Map<string, ExtractionCitation["stance"]>();
  const unique: ExtractionCitation[] = [];
  for (const c of known) {
    const key = `${c.messageId}\u0000${normalizeForQuoteMatch(c.quote)}`;
    const seen = stanceByKey.get(key);
    if (seen === undefined) {
      stanceByKey.set(key, c.stance);
      unique.push(c);
    } else if (seen !== c.stance) {
      return "contradictory_citations";
    }
  }

  // No unmasked model text is persisted (QA-M6): drop, never re-mask.
  if (modelStrings(candidate).some(wouldMask)) return "unmasked_content";

  const citations: CheckedCitation[] = [];
  for (const c of unique) {
    const body = bodies.get(c.messageId) as string;
    const r = checkQuote(body, c.quote);
    if (r.check === "not_found") {
      if (wouldMask(c.quote)) {
        dropped.unmasked_content++;
        continue;
      }
      citations.push({ ...c, quoteCheck: "not_found", quoteStart: null, quoteEnd: null, matchedText: null });
    } else {
      citations.push({ ...c, quoteCheck: r.check, quoteStart: r.start, quoteEnd: r.end, matchedText: body.slice(r.start!, r.end!) });
    }
  }

  const verified = citations.some((c) => c.quoteCheck !== "not_found");
  if (!verified && candidate.inferenceRationale === null) return "fabricated";

  return { ...candidate, citations } as CheckedCandidate;
}

/** Every free-text string the model wrote for the candidate (not quotes: those are checked separately). */
function modelStrings(candidate: ExtractionCandidate): string[] {
  const out = [candidate.title, candidate.statement];
  if (candidate.inferenceRationale !== null) out.push(candidate.inferenceRationale);
  collectStrings(candidate.attributes, out);
  return out;
}

function collectStrings(value: unknown, out: string[]): void {
  if (typeof value === "string") out.push(value);
  else if (Array.isArray(value)) for (const v of value) collectStrings(v, out);
  else if (typeof value === "object" && value !== null) for (const v of Object.values(value)) collectStrings(v, out);
}

function overBudget(candidate: ExtractionCandidate): boolean {
  if (JSON.stringify(candidate).length > EXTRACT_CANDIDATE_BUDGET.maxSerializedChars) return true;
  for (const value of Object.values(candidate.attributes as Record<string, unknown>)) {
    if (typeof value === "string" && value.length > EXTRACT_CANDIDATE_BUDGET.maxAttributeStringChars) return true;
    if (Array.isArray(value)) {
      if (value.length > EXTRACT_CANDIDATE_BUDGET.maxAttributeArrayItems) return true;
      if (value.some((v) => typeof v === "string" && v.length > EXTRACT_CANDIDATE_BUDGET.maxAttributeStringChars)) return true;
    }
  }
  return false;
}
