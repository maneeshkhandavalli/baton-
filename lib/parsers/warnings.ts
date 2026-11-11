import type { ParserWarning, ParserWarningCode } from "../contracts/parser";
import { LIMITS } from "./limits";

export type { ParserWarning };

type CollectableCode = Exclude<ParserWarningCode, "warnings_truncated">;

/**
 * Collects warnings deterministically. Codes are restricted to the ratified `PARSER_WARNING_CODES`
 * (§11.4, D31); messages never quote content, names or numbers.
 *
 * Per-line warnings are capped at `LIMITS.maxWarnings`; the overflow is summarised by one
 * `warnings_truncated`, which is always last. Summary warnings (one per source, such as
 * `excluded_mentions_redacted`) are never dropped by the cap.
 */
export class WarningCollector {
  private readonly items: ParserWarning[] = [];
  private readonly summaries: ParserWarning[] = [];
  private dropped = 0;

  add(code: CollectableCode, message: string, line?: number): void {
    if (this.items.length >= LIMITS.maxWarnings) {
      this.dropped++;
      return;
    }
    this.items.push(line === undefined ? { code, message } : { code, message, line });
  }

  /** A per-source summary warning; exempt from the cap and listed after per-line warnings. */
  summary(code: CollectableCode, message: string): void {
    this.summaries.push({ code, message });
  }

  /**
   * The final list. `hideLine(line)` returning true removes that warning's `line`, so a warning never
   * points at content that was excluded (§11.4 preview privacy); its code and message are kept.
   */
  list(hideLine?: (line: number) => boolean): ParserWarning[] {
    const items = this.items.map((w) =>
      w.line !== undefined && hideLine?.(w.line) ? { code: w.code, message: w.message } : { ...w },
    );
    const out = [...items, ...this.summaries.map((w) => ({ ...w }))];
    if (this.dropped > 0) out.push({ code: "warnings_truncated", message: `${this.dropped} further warnings were omitted.` });
    return out;
  }
}
