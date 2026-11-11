import "server-only";

/**
 * Support verification (§10.8; §11.8 rule 1; §12.10 rule 5; interfaces.md I1 with the W0 amendments).
 *
 * An independent call: the request holds only the claim (current revision), the quote and at most three
 * neighbouring masked messages from the quote's own source. It never carries the extractor's stance or
 * rationale. The answer is parsed with `supportVerdictResponseSchema`; malformed output follows the
 * retry-once policy. A rationale that masking would change is replaced by `null` (QA-M6), never re-masked.
 *
 * This verdict alone can never make a point `sourced`: status also requires the deterministic quote
 * existence check (§4.2, §10.7).
 */

import { z } from "zod";

import { POINT_CATEGORIES } from "../contracts/enums";
import type { SupportVerdict } from "../contracts/enums";
import { supportVerdictResponseSchema } from "../contracts/schemas";
import { AI_ERROR_REASONS } from "./errors";
import { verifyRequestWithinLimits } from "./limits";
import type { AiAttemptRecord, AiProvenance, AiProvider, AiResult, AiStageOptions, VerifySupportRequest } from "./provider";
import { attemptRecord, callProvider, checkStageOptions, invalidOutputFailure, requestFailure, wouldMask } from "./stage";

export { VERIFY_REQUEST_LIMITS } from "./limits";

export interface SupportOutcome {
  verdict: Exclude<SupportVerdict, "unchecked">;
  /** One sentence from the model; null when it would have needed masking. */
  rationale: string | null;
  provenance: AiProvenance;
  attempt: AiAttemptRecord;
}

const contextItem = z.object({ authorLabel: z.string().nullable(), sentAt: z.string().nullable(), body: z.string() });

const verifyRequestSchema = z.object({
  claim: z.object({
    category: z.enum(POINT_CATEGORIES),
    title: z.string(),
    statement: z.string().min(1),
    attributes: z.record(z.string(), z.unknown()),
  }),
  quote: z.object({ text: z.string().min(1), authorLabel: z.string().nullable(), sentAt: z.string().nullable() }),
  context: z.array(contextItem),
});

export async function verifySupport(
  provider: AiProvider,
  req: VerifySupportRequest,
  opts: AiStageOptions,
): Promise<AiResult<SupportOutcome>> {
  const checked = checkStageOptions(provider, opts, "verify");
  if (!checked.ok) return checked;
  const { clock, expected } = checked;

  if (!verifyRequestSchema.safeParse(req).success) return requestFailure(clock, expected, AI_ERROR_REASONS.requestInvalid);
  if (!verifyRequestWithinLimits(req)) return requestFailure(clock, expected, AI_ERROR_REASONS.requestTooLarge);

  // Only the documented fields are forwarded, so nothing else (e.g. a stance) can reach the verifier.
  const forwarded: VerifySupportRequest = {
    claim: { category: req.claim.category, title: req.claim.title, statement: req.claim.statement, attributes: req.claim.attributes },
    quote: { text: req.quote.text, authorLabel: req.quote.authorLabel, sentAt: req.quote.sentAt },
    context: req.context.map((c) => ({ authorLabel: c.authorLabel, sentAt: c.sentAt, body: c.body })),
  };

  const called = await callProvider(clock, expected, () => provider.verifySupport(forwarded, { signal: opts.signal }));
  if (!called.ok) return called;

  const parsed = supportVerdictResponseSchema.safeParse(called.raw);
  if (!parsed.success) return invalidOutputFailure(clock, called.provenance, called.extra);

  return {
    ok: true,
    data: {
      verdict: parsed.data.verdict,
      rationale: wouldMask(parsed.data.rationale) ? null : parsed.data.rationale,
      provenance: called.provenance,
      attempt: attemptRecord(clock, { ...called.extra, outcome: "succeeded" }),
    },
  };
}
