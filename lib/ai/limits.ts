import "server-only";

/**
 * Per-call input budgets (§12.10 rule 6, D12; interfaces.md W0 decisions I1 amendment 9).
 *
 * Engineering defaults while D11 is open (no model chosen, so no token-exact limits). Pipeline chunks
 * extract requests to fit; lib/ai rejects a request over these limits with `validation_failed`
 * (`details.reason = "ai_request_too_large"`), never retryable. A single message larger than
 * `maxChars` cannot be sent at all and must be skipped (and counted) by the caller.
 *
 * Size is measured by `measureExtractRequest` / `measureVerifyRequest` so callers and lib/ai agree.
 * Characters are JavaScript UTF-16 code units.
 */

import type { ExtractRequest, VerifySupportRequest } from "./provider";

export const EXTRACT_REQUEST_LIMITS = {
  /** Messages per extract call. */
  maxMessages: 200,
  /** Sum of message bodies and author labels per extract call. */
  maxChars: 60_000,
} as const;

export const VERIFY_REQUEST_LIMITS = {
  /** Neighbouring context messages (§10.8: up to 3). */
  maxContextMessages: 3,
  /** Sum of the claim, the quote and the context bodies and labels per verify call. */
  maxChars: 12_000,
} as const;

const len = (s: string | null | undefined) => (s ? s.length : 0);

export function measureExtractRequest(req: ExtractRequest): { messages: number; chars: number } {
  let chars = len(req.handover.teamName) + len(req.handover.roleTitle);
  for (const m of req.messages) chars += len(m.body) + len(m.authorLabel);
  return { messages: req.messages.length, chars };
}

export function measureVerifyRequest(req: VerifySupportRequest): { contextMessages: number; chars: number } {
  let chars = len(req.claim.title) + len(req.claim.statement) + JSON.stringify(req.claim.attributes ?? {}).length;
  chars += len(req.quote.text) + len(req.quote.authorLabel);
  for (const c of req.context) chars += len(c.body) + len(c.authorLabel);
  return { contextMessages: req.context.length, chars };
}

export function extractRequestWithinLimits(req: ExtractRequest): boolean {
  const { messages, chars } = measureExtractRequest(req);
  return messages <= EXTRACT_REQUEST_LIMITS.maxMessages && chars <= EXTRACT_REQUEST_LIMITS.maxChars;
}

export function verifyRequestWithinLimits(req: VerifySupportRequest): boolean {
  const { contextMessages, chars } = measureVerifyRequest(req);
  return contextMessages <= VERIFY_REQUEST_LIMITS.maxContextMessages && chars <= VERIFY_REQUEST_LIMITS.maxChars;
}
