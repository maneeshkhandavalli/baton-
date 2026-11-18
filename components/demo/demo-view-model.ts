/**
 * Reads what one demo screen needs from the engine's queries (R3 Task 06, contract §2.5: `demoQueries` /
 * `demoSnapshot` return a subset of BatonQueries with the real DTOs). No React; the queries are injected, so this
 * is unit-tested with a fake (components/demo/__tests__/demo-view-model.test.ts).
 */

import type { Result } from "@/lib/contracts/api";
import type {
  GapQuestionSummary,
  HandoverSummary,
  PointDetail,
  ProcessingStatus,
  PublishedHandover,
  ReadinessReport,
  SourceSummary,
} from "@/lib/contracts/dto";
import type { ExtractionReport } from "@/lib/contracts/extraction";
import type { DemoQueries } from "@/lib/demo/engine";

import type { DemoScreen } from "./demo-guide";

export interface DemoView {
  handover: HandoverSummary;
  sources: SourceSummary[];
  processing: ProcessingStatus | null;
  points: PointDetail[];
  readiness: ReadinessReport | null;
  extraction: ExtractionReport | null;
  gaps: GapQuestionSummary[];
  /** Null before the first publish (not_found). */
  published: PublishedHandover | null;
}

export type DemoViewResult = { ok: true; view: DemoView } | { ok: false; message: string };

const data = <T>(r: Result<T>): T | null => (r.ok ? r.data : null);

/** Which reads each screen needs (the others stay empty), so a step never waits on data it doesn't show. */
export const SCREEN_NEEDS: Readonly<Record<DemoScreen, ReadonlyArray<"sources" | "points" | "readiness" | "extraction" | "gaps" | "published">>> = {
  sources: ["sources"],
  draft: ["points", "extraction"],
  review: ["points", "readiness", "gaps"],
  decisions: ["points"],
  publish: ["points", "readiness", "gaps", "published"],
  receive: ["published", "gaps"],
};

/**
 * `reader` sees the handover as the step's viewer (Priya or Neha); `reviewer` is Priya, for the reads only a review
 * role may make (gap answers to accept on the receive step).
 */
export async function loadDemoView(screen: DemoScreen, reader: DemoQueries, reviewer: DemoQueries = reader): Promise<DemoViewResult> {
  const list = await reader.listMyHandovers();
  const handover = list.ok ? list.data[0] : undefined;
  if (!handover) return { ok: false, message: "The demo handover isn't available. Reset the demo to start again." };
  const id = handover.id;
  const needs = new Set(SCREEN_NEEDS[screen]);

  const [sources, processing, pointList, readiness, extraction, gaps, published] = await Promise.all([
    needs.has("sources") ? reader.listSources(id) : null,
    needs.has("sources") ? reader.getProcessingStatus(id) : null,
    needs.has("points") ? reader.listPoints(id) : null,
    needs.has("readiness") ? reader.getReadiness(id) : null,
    needs.has("extraction") ? reader.getExtractionReport(id) : null,
    needs.has("gaps") ? reviewer.listGapQuestions(id) : null,
    needs.has("published") ? reader.getPublishedHandover(id) : null,
  ]);

  const summaries = pointList ? (data(pointList) ?? []) : [];
  const details = await Promise.all(summaries.map((p) => reader.getPoint(p.id)));

  return {
    ok: true,
    view: {
      handover,
      sources: sources ? (data(sources) ?? []) : [],
      processing: processing ? data(processing) : null,
      points: details.flatMap((d) => (d.ok ? [d.data] : [])),
      readiness: readiness ? data(readiness) : null,
      extraction: extraction ? data(extraction) : null,
      gaps: gaps ? (data(gaps) ?? []) : [],
      published: published ? data(published) : null,
    },
  };
}

/** The gap question a missing point is waiting on (PointCard's `gapQuestion`). */
export function gapForPoint(gaps: readonly GapQuestionSummary[], pointId: string): GapQuestionSummary | undefined {
  return gaps.find((g) => g.pointId === pointId);
}

/** Submitted answers waiting for Priya's decision, oldest first. */
export function answersToReview(gaps: readonly GapQuestionSummary[]): { question: GapQuestionSummary; answer: GapQuestionSummary["answers"][number] }[] {
  return gaps
    .flatMap((question) => question.answers.filter((a) => a.status === "submitted" && !a.privacyHeld).map((answer) => ({ question, answer })))
    .sort((a, b) => (a.answer.createdAt < b.answer.createdAt ? -1 : 1));
}
