/**
 * Audit 4.8 (coverage contradiction): how a source's coverage reads in the review rail. A source whose coverage was
 * not recorded never reads "Fully analysed" with "0 messages inspected". Pure, no React.
 */

import type { ExtractionReport, SourceExtractionCoverage, SourceExtractionState } from "@/lib/contracts/extraction";

const stateLabel: Record<SourceExtractionState, string> = {
  not_processed: "Not analysed",
  in_progress: "Analysing",
  complete: "Fully analysed",
  complete_with_skips: "Analysed, some messages skipped",
  partial: "Partly analysed",
  failed: "Not analysed (failed)",
};

export function sourceStateText(s: Pick<SourceExtractionCoverage, "state" | "coverageRecorded">): string {
  return s.state === "complete" && !s.coverageRecorded ? "Analysed, coverage not recorded" : stateLabel[s.state];
}

export const sourceCoverageOk = (s: Pick<SourceExtractionCoverage, "state" | "coverageRecorded">) => s.state === "complete" && s.coverageRecorded;

/** False when the counts are missing: the line says "Coverage not recorded" instead of zeros. */
export const showCoverageCounts = (s: Pick<SourceExtractionCoverage, "state" | "coverageRecorded">) => s.coverageRecorded || s.state === "in_progress";

export function coverageHeadline(completion: ExtractionReport["completion"], unsettled: number): string | null {
  switch (completion) {
    case "complete":
      return unsettled === 0
        ? "Every source was fully analysed."
        : `Every source processed so far was fully analysed, but ${unsettled === 1 ? "a source update still needs" : `${unsettled} source updates still need`} processing, checking or a decision.`;
    case "in_progress":
      return "Analysis is still running.";
    case "partial":
      return "Not everything was analysed. Points may be missing.";
    case "failed":
      return "No source could be analysed.";
    case "unrecorded":
      return "Analysis finished, but coverage was not recorded for every source.";
    default:
      return null;
  }
}

export const coverageIncomplete = (completion: ExtractionReport["completion"], unsettled: number) =>
  completion === "partial" || completion === "failed" || completion === "unrecorded" || unsettled > 0;
