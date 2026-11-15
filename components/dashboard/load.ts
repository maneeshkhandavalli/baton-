/**
 * Loads everything /dashboard shows, through the BatonQueries interface: the real page passes getQueries(), the dev
 * preview passes createMockQueries(), so both render exactly the same components. Routing and CTAs are master's
 * (unchanged behaviour); `row` adds the plain-language status and "needs you" items from classify().
 */

import type { BatonQueries } from "@/lib/contracts/queries";
import type { HandoverSummary, ProcessingStatus, ReadinessReport } from "@/lib/contracts/dto";

import type { HandoverCardData } from "./handover-card";
import { classify, isReviewRole, type DashboardLinks, type HandoverInput } from "./model";

/** The wizard steps a resumable draft moves through (the dashboard's "next" wording). */
export const DRAFT_STEPS = ["Details", "Consent and sources", "Finish uploads", "Scope and start"] as const;

export interface DashboardRoutes extends DashboardLinks {
  /** Resume a draft in the wizard. */
  wizard: (id: string) => string;
}

export type DashboardResult = { ok: true; cards: HandoverCardData[] } | { ok: false; message: string };

async function cardFor(queries: BatonQueries, h: HandoverSummary, routes: DashboardRoutes): Promise<HandoverCardData> {
  const isDemo = false;
  const input: HandoverInput = { summary: h };

  if (!isReviewRole(h.viewerRole)) {
    // Lead and incoming members read the publication by membership.
    return { handover: h, readiness: null, href: routes.published(h.id), cta: "Read handover", isDemo, row: classify(input, routes) };
  }

  if (h.state === "draft" && (h.viewerIsCreator || h.viewerRole === "outgoing")) {
    const sources = await queries.listSources(h.id);
    const live = sources.ok ? sources.data.filter((s) => s.state !== "removed") : [];
    if (!live.some((s) => s.state === "parsed" || s.state === "parsing")) {
      const ready = live.filter((s) => s.state === "uploaded" && s.consentRecordedAt).length;
      const next = live.length === 0 ? "Consent and sources" : ready > 0 ? "Scope and start" : "Finish uploads";
      input.draft = { step: DRAFT_STEPS.indexOf(next) + 1, steps: DRAFT_STEPS, sources: live.length };
      return {
        handover: h,
        readiness: null,
        href: routes.wizard(h.id),
        cta: "Continue editing",
        isDemo,
        draft: { sources: live.length, next },
        row: classify(input, routes),
      };
    }
  }

  const [readiness, processing] = await Promise.all([
    queries.getReadiness(h.id),
    // QA-UI3-D1: a draft that reached this point has parsed sources, so it may hold a failed or cancelled run.
    h.state === "processing" || h.state === "draft" ? queries.getProcessingStatus(h.id) : Promise.resolve(null),
  ]);
  input.readiness = readiness.ok ? (readiness.data as ReadinessReport) : null;
  input.processing = processing && processing.ok ? (processing.data as ProcessingStatus) : null;
  const target =
    h.pendingCreatorTransfer && !h.viewerIsCreator
      ? { href: routes.settings(h.id), cta: "Review the offer" }
      : h.state === "draft" || h.state === "processing"
        ? // QA-UI3-D2: only the creator (or outgoing member) sets a draft up; a reviewer just follows its progress.
          { href: routes.processing(h.id), cta: h.state === "draft" && (h.viewerIsCreator || h.viewerRole === "outgoing") ? "Continue setup" : "View progress" }
        : h.state === "in_review"
          ? { href: routes.review(h.id), cta: "Continue review" }
          : { href: routes.review(h.id), cta: "Open" };
  return { handover: h, readiness: readiness.ok ? readiness.data.score : null, ...target, isDemo, row: classify(input, routes) };
}

export async function loadDashboard(queries: BatonQueries, routes: DashboardRoutes): Promise<DashboardResult> {
  const result = await queries.listMyHandovers();
  if (!result.ok) return { ok: false, message: result.error.message };
  const cards = await Promise.all(result.data.map((h) => cardFor(queries, h, routes)));
  return { ok: true, cards };
}
