/**
 * The processing page's heading and one-line summary (R3 Task 06: extracted from processing-view.tsx so it is
 * testable). Pure and React-free (components/processing/__tests__/processing-headline.test.ts).
 *
 * Truthfulness rules: never "complete" while a current source version (an update OR a newly added first version) is
 * unprocessed, unchecked, or has changes
 * waiting for a decision (R3 Task 05C/05D); and once the handover is published, never invite a review that is over.
 */

import type { HandoverState, RunStatus } from "@/lib/contracts/enums";

export interface HeadlineInput {
  active: boolean;
  runStatus: RunStatus | null;
  /** Already formatted for display ("18 Nov 2026, 19:52"), or null. */
  startedAt: string | null;
  finishedAt: string | null;
  pendingUpdates: number;
  /** Sources added since the last succeeded run and not processed yet (processing-controls.ts). */
  newSources?: number;
  openReviews: number;
  handoverState: HandoverState;
}

export function processingHeadline(i: HeadlineInput): { title: string; description: string } {
  const finished = i.finishedAt ? `Finished ${i.finishedAt}.` : "Finished.";
  if (i.active) {
    return {
      title: "Processing your sources",
      description: `You can leave this page. Baton keeps working and the review opens when it's done.${i.startedAt ? ` Started ${i.startedAt}.` : ""}`,
    };
  }
  if (i.runStatus === "succeeded" && i.pendingUpdates > 0) {
    const one = i.pendingUpdates === 1;
    return {
      title: one ? "A source update needs processing" : "Source updates need processing",
      description: `The last run finished${i.finishedAt ? ` ${i.finishedAt}` : ""}, but ${one ? "a newer version of a source hasn't" : `${i.pendingUpdates} newer source versions haven't`} been processed and checked yet. Publishing waits until ${one ? "it is" : "they are"}.`,
    };
  }
  const fresh = i.newSources ?? 0;
  if (i.runStatus === "succeeded" && fresh > 0 && (i.handoverState === "draft" || i.handoverState === "in_review")) {
    const one = fresh === 1;
    return {
      title: one ? "A new source needs processing" : "New sources need processing",
      description: `The last run finished${i.finishedAt ? ` ${i.finishedAt}` : ""}, but ${one ? "a source added since then hasn't" : `${fresh} sources added since then haven't`} been processed yet, so ${one ? "it isn't" : "they aren't"} in the review. Confirm consent, then process ${one ? "it" : "them"}.`,
    };
  }
  if (i.runStatus === "succeeded" && i.openReviews > 0) {
    return {
      title: "Processed · changes to review",
      description: `${finished} Baton compared the new source version with the previous one and found ${i.openReviews} ${i.openReviews === 1 ? "change that needs" : "changes that need"} a decision before publishing.`,
    };
  }
  if (i.runStatus === "succeeded") {
    const after =
      i.handoverState === "approved"
        ? "The handover has since been published."
        : i.handoverState === "acknowledged"
          ? "The handover has since been published and acknowledged."
          : "Every point is ready for your review.";
    return { title: "Processing complete", description: `${finished} ${after}` };
  }
  if (i.runStatus === "failed") return { title: "Processing failed", description: "Your sources are safe. Nothing was published." };
  if (i.runStatus === "cancelled") {
    return {
      title: "Processing cancelled",
      description: i.handoverState === "draft" ? "Add consent for every source, then start processing." : "Start processing to extract source-backed points.",
    };
  }
  return {
    title: "Ready to process",
    description: i.handoverState === "draft" ? "Add consent for every source, then start processing." : "Start processing to extract source-backed points.",
  };
}
