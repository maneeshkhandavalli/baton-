/**
 * `verify_support` job (§10.8, §11.8 rule 1, §12.10 rules 4–5, D16). One job per run, after every
 * per-source job. It covers every active link whose quote exists and has no verdict for the point's
 * CURRENT revision: new extraction links, accepted gap-answer testimony and links made stale by edits.
 *
 * - The request holds the claim (current revision), the quote and ≤ 3 neighbours from the quote's own
 *   source (DB-8). Never the extractor's stance or rationale. Context is trimmed to fit
 *   `VERIFY_REQUEST_LIMITS`; a pair that still does not fit is left unchecked (the point stays inferred).
 * - `recordSupportVerdict` is given the exact quote text the verifier saw; a conflict means the evidence
 *   changed meanwhile (privacy redaction) and the verdict is discarded (§5.5 T6).
 * - PI-11: lib/ai already replaced a promoting verdict on instruction-bearing evidence (injection-guard.ts);
 *   the stage records the guarded verdict and logs only the count.
 * - Per-run budget: ≤ 2000 calls. `progress_done` counts calls, so the budget survives yields and retries.
 * - The provider is only resolved when there is something to verify.
 */

import { verifyRequestWithinLimits } from "../../ai/limits";
import type { AiProvider, AiRunConfig, VerifySupportRequest } from "../../ai/provider";
import type { PointAttributes } from "../../contracts/schemas";
import { DbError } from "../../db/errors";
import { listLinksNeedingSupport, recordSupportVerdict, type LinkNeedingSupport } from "../../db/pipeline";
import { mapAiFailure } from "../ai";
import { claimOf, type StageContext } from "../stage-context";
import { failure, type AttemptRecord, type StageOutcome } from "../types";
import { callSignal, startAiStage } from "./ai-prelude";

export const VERIFY_CALLS_PER_RUN = 2000;
export const VERIFY_YIELD_MARGIN_MS = 20_000;
const PAGE = 100;
const HEARTBEAT_EVERY = 10;

/** The request for one link, with context trimmed to the limits; null when even the bare pair is too large. */
export function buildVerifyRequest(link: LinkNeedingSupport): VerifySupportRequest | null {
  const req: VerifySupportRequest = {
    claim: {
      category: link.claim.category,
      title: link.claim.title,
      statement: link.claim.statement,
      attributes: link.claim.attributes as PointAttributes,
    },
    quote: { text: link.quote.text, authorLabel: link.quote.authorLabel, sentAt: link.quote.sentAt },
    context: link.context.slice(0, 3).map((c) => ({ authorLabel: c.authorLabel, sentAt: c.sentAt, body: c.body })),
  };
  while (!verifyRequestWithinLimits(req)) {
    if (req.context.length === 0) return null;
    req.context.pop();
  }
  return req;
}

export async function runVerifySupport(ctx: StageContext): Promise<StageOutcome> {
  const handoverId = ctx.job.job.handoverId;
  let calls = Math.max(0, ctx.job.job.progressDone ?? 0);
  const callsAtStart = calls;
  const skip = new Set<string>();
  const counts = { verdicts: 0, tooLarge: 0, discarded: 0, injectionGuarded: 0 };
  let ai: { provider: AiProvider; runConfig: AiRunConfig } | null = null;
  let lastAttempt: AttemptRecord | undefined;
  const withAttempt = () => (lastAttempt ? { attemptRecord: lastAttempt } : {});

  for (;;) {
    const page = (await listLinksNeedingSupport(ctx.db, handoverId, PAGE + skip.size)).filter((l) => !skip.has(l.pointEvidenceId));
    if (page.length === 0) break;

    for (const link of page) {
      if (calls > callsAtStart && ctx.now() > ctx.deadlineAt - VERIFY_YIELD_MARGIN_MS) {
        log(ctx, calls, counts);
        return { kind: "yield", progress: { done: calls, total: calls + page.length } };
      }
      if (calls >= VERIFY_CALLS_PER_RUN) {
        log(ctx, calls, counts);
        return { kind: "failed", failure: failure("payload_too_large", "ai_budget_exceeded"), progress: { done: calls, total: calls }, ...withAttempt() };
      }
      const req = buildVerifyRequest(link);
      if (req === null) {
        skip.add(link.pointEvidenceId);
        counts.tooLarge += 1;
        continue;
      }
      if (ai === null) {
        const prelude = await startAiStage(ctx, "verify");
        if (!prelude.ok) return { kind: "failed", failure: prelude.failure };
        ai = { provider: prelude.provider, runConfig: prelude.runConfig };
      }

      const result = await ctx.ai.verifySupport(ai.provider, req, { attempt: ctx.claimed.attempt, runConfig: ai.runConfig, signal: callSignal(ctx) });
      calls += 1;
      if (!result.ok) {
        log(ctx, calls, counts);
        return {
          kind: "failed",
          failure: mapAiFailure(result.error),
          progress: { done: calls, total: calls },
          ...(result.attempt ? { attemptRecord: result.attempt } : {}),
        };
      }
      lastAttempt = result.data.attempt;

      try {
        await recordSupportVerdict(ctx.db, claimOf(ctx), {
          pointEvidenceId: link.pointEvidenceId,
          revisionId: link.revisionId,
          verdict: result.data.verdict,
          rationale: result.data.rationale,
          provenance: verdictProvenance(result.data),
          verifiedQuoteText: link.quote.text,
        });
        counts.verdicts += 1;
        if (result.data.injection?.guarded) counts.injectionGuarded += 1; // PI-11: count only, never the text
      } catch (e) {
        if (!(e instanceof DbError && e.code === "conflict" && !e.retryable)) throw e;
        skip.add(link.pointEvidenceId); // evidence text changed since the call: discard the verdict
        counts.discarded += 1;
      }
      if (calls % HEARTBEAT_EVERY === 0) await ctx.heartbeat({ done: calls, total: calls });
    }
  }

  log(ctx, calls, counts);
  return { kind: "succeeded", progress: { done: calls, total: calls }, ...withAttempt() };
}

/**
 * The stored `verifier_provenance`. PI-11: when the guard replaced the model's verdict, it also carries
 * `injectionGuard` (the model's verdict and the pattern/field ids, never text); `api_get_point`
 * (migration 20261113300900) exposes it as `EvidenceItem.guarded` / `modelVerdict`.
 */
export function verdictProvenance(data: {
  provenance: object;
  modelVerdict?: string;
  injection?: { guarded: boolean; patterns: readonly string[]; fields: readonly string[] };
}): Record<string, unknown> {
  const base: Record<string, unknown> = { ...data.provenance };
  if (!data.injection?.guarded) return base;
  return {
    ...base,
    injectionGuard: { guarded: true, modelVerdict: data.modelVerdict ?? null, patterns: [...data.injection.patterns], fields: [...data.injection.fields] },
  };
}

function log(ctx: StageContext, calls: number, c: { verdicts: number; tooLarge: number; discarded: number }) {
  ctx.logger.info("verify_support_progress", { jobId: ctx.claimed.id, calls, ...c });
}
