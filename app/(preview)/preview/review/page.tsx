import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { PageContainer } from "@/components/layout/page-container";
import { PreviewHandoverHeader } from "@/components/preview/preview-chrome";
import { loadReview } from "@/components/review/load-review";
import { ReviewWorkspace } from "@/components/review/review-workspace";
import { WorkspaceSkeleton } from "@/components/shared/skeletons";
import type { PointDetail } from "@/lib/contracts/dto";
import { CODECELL_ID } from "@/lib/mocks/fixtures/codecell";
import { PROFILES } from "@/lib/mocks/fixtures/profiles";
import { createMockQueries } from "@/lib/mocks/queries";

// Titles only in development: a production 404 for this route must not name it.
export const metadata: Metadata = { ...(process.env.NODE_ENV === "development" ? { title: "Preview · Review" } : {}), robots: { index: false, follow: false } };

/**
 * Dev-only: the review workspace on the CodeCell fixture with live-looking actions (they only show a
 * toast). Points are adjusted so every evidence status and review outcome appears, plus key facts
 * with a very long assignee and invalid dates (QA-R3-12).
 */
export default function PreviewReviewPage() {
  if (process.env.NODE_ENV !== "development") notFound();
  return (
    <Suspense fallback={<WorkspaceSkeleton />}>
      <Content />
    </Suspense>
  );
}

const LONG_ASSIGNEE = "Dr. Venkataraghavan Subramaniam-Iyer (Faculty Coordinator, Technical Events and Hackathons)";

function adjust(points: PointDetail[]): PointDetail[] {
  const out = points.map((p) => ({ ...p }));
  const firstWith = (pred: (p: PointDetail) => boolean, skip: Set<number>) => out.findIndex((p, i) => !skip.has(i) && pred(p));
  const used = new Set<number>();

  // An open task with a long assignee and an impossible due date.
  let i = firstWith((p) => p.category === "open_task", used);
  if (i === -1) i = firstWith((p) => p.evidenceStatus === "sourced", used);
  if (i !== -1) {
    out[i] = { ...out[i], category: "open_task", attributes: { assigneeLabel: LONG_ASSIGNEE, dueDate: "2026-02-31", progressNote: null } as unknown as PointDetail["attributes"] };
    used.add(i);
  }
  // A decision with a date the regex accepts but the calendar doesn't.
  const d = firstWith((p) => p.category === "decision", used);
  if (d !== -1) {
    out[d] = { ...out[d], attributes: { ...(out[d].attributes as object), decidedAt: "2026-13-45", decidedByLabel: "Core team" } as unknown as PointDetail["attributes"] };
    used.add(d);
  }
  // One approved and one rejected point (sourced ones), so both outcomes are visible.
  const a = firstWith((p) => p.evidenceStatus === "sourced" && p.reviewState === "pending", used);
  if (a !== -1) {
    out[a] = { ...out[a], reviewState: "approved" };
    used.add(a);
  }
  const r = firstWith((p) => p.reviewState === "pending" && p.evidenceStatus !== "conflicting" && p.evidenceStatus !== "missing", used);
  if (r !== -1) out[r] = { ...out[r], reviewState: "rejected" };
  return out;
}

async function Content() {
  const load = await loadReview(createMockQueries(PROFILES.arjun.id), CODECELL_ID);
  if (load.kind !== "ok") return <p className="p-8 text-sm text-muted-foreground">The review fixture isn&rsquo;t available.</p>;
  const data = { ...load.data, points: adjust(load.data.points), handover: { ...load.data.handover, state: "in_review" as const } };
  return (
    <>
      <PreviewHandoverHeader handover={data.handover} active="Review" />
      <PageContainer width="wide" className="lg:py-8">
        <ReviewWorkspace {...data} readOnly={false} preview gapsHref="/preview/review" publishedHref="/preview/published" />
      </PageContainer>
    </>
  );
}
