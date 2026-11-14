/**
 * `verify_quotes` job (§10.7, W0 decision I2.5). Deterministic, no AI. The authoritative existence check
 * of every pending source quote of one source, against the PERSISTED masked message body:
 *
 * - stored offsets that slice exactly the stored text (and the quote meets the §10.7.4 minimum) → exact;
 * - otherwise `checkQuote`; it counts only when it lands on the stored offsets (offsets cannot be changed
 *   here, so a match elsewhere in the message is not evidence for this row) → not_found otherwise;
 * - a quote without offsets is not_found (mis-cited quotes are kept for audit, §10.7.3);
 * - a pruned message (null body) leaves the row unchanged.
 * The database re-checks plausibility (QA-M1); a refused exact/normalized is recorded as not_found.
 */

import { checkQuote, meetsQuoteMinimum } from "../../ai/quote-check";
import type { QuoteCheck } from "../../contracts/enums";
import { DbError } from "../../db/errors";
import { listQuotesForCheck, recordQuoteCheck, type PendingQuote } from "../../db/pipeline";
import { claimOf, type StageContext } from "../stage-context";
import { failed, type StageOutcome } from "../types";

const HEARTBEAT_EVERY = 200;

export function authoritativeCheck(q: Pick<PendingQuote, "quoteText" | "quoteStart" | "quoteEnd" | "messageBody">): Exclude<QuoteCheck, "pending"> | null {
  const body = q.messageBody;
  if (body === null) return null;
  if (q.quoteStart === null || q.quoteEnd === null) return "not_found";
  if (body.slice(q.quoteStart, q.quoteEnd) === q.quoteText && meetsQuoteMinimum(q.quoteText)) return "exact";
  const r = checkQuote(body, q.quoteText);
  return r.check !== "not_found" && r.start === q.quoteStart && r.end === q.quoteEnd ? r.check : "not_found";
}

export async function runVerifyQuotes(ctx: StageContext): Promise<StageOutcome> {
  const sourceId = ctx.job.job.sourceId;
  if (!sourceId) return failed("internal", "internal");
  const quotes = await listQuotesForCheck(ctx.db, sourceId);
  const counts = { exact: 0, normalized: 0, not_found: 0, unchanged: 0, refused: 0 };

  for (const [i, q] of quotes.entries()) {
    const check = authoritativeCheck(q);
    if (check === null) {
      counts.unchanged += 1;
      continue;
    }
    try {
      await recordQuoteCheck(ctx.db, claimOf(ctx), q.evidenceId, check);
      counts[check] += 1;
    } catch (e) {
      if (!(e instanceof DbError && e.code === "validation_failed" && check !== "not_found")) throw e;
      counts.refused += 1;
      await recordQuoteCheck(ctx.db, claimOf(ctx), q.evidenceId, "not_found"); // fail closed
      counts.not_found += 1;
    }
    if ((i + 1) % HEARTBEAT_EVERY === 0) await ctx.heartbeat({ done: i + 1, total: quotes.length });
  }

  ctx.logger.info("verify_quotes_done", { jobId: ctx.claimed.id, sourceId, quotes: quotes.length, ...counts });
  return { kind: "succeeded", progress: { done: quotes.length, total: quotes.length } };
}
