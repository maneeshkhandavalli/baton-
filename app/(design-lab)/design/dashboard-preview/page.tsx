import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";

import { classify, deriveActivity, isReviewRole, sortRows, type DashboardLinks, type HandoverInput } from "@/components/dashboard/model";
import { MOCK_VIEWER_ID, PROFILES } from "@/lib/mocks/fixtures/profiles";
import { createMockQueries } from "@/lib/mocks/queries";

import { DashboardPreview } from "./dashboard-preview";
import { extraInputs } from "./fixtures";
import { dpTitleFont } from "./fonts";
import "./dash.css";

export const metadata: Metadata = { title: "Dashboard preview", robots: { index: false, follow: false } };

/** Preview links: every destination is a working dev-only preview route (or a real page). */
const LINKS: DashboardLinks = {
  review: () => "/preview/review",
  processing: () => "/preview/processing",
  published: () => "/preview/published",
  gaps: () => "/preview/review",
  settings: () => "/preview/review",
  draft: (_id, step) => `/preview/wizard?step=${step}`,
  offers: () => "/account",
};

/**
 * DEV-ONLY dashboard redesign preview (UI3 shell). Real model (components/dashboard/model.ts) over lib/mocks data
 * fetched through the same BatonQueries interface production uses, plus a few preview fixtures for states the mocks
 * lack. The design-lab layout already 404s outside development; this guard repeats it.
 */
export default function DashboardPreviewPage() {
  if (process.env.NODE_ENV !== "development") notFound();
  return (
    <div className={`dp ${dpTitleFont.variable}`}>
      <Suspense fallback={null}>
        <Content />
      </Suspense>
    </div>
  );
}

async function Content() {
  await connection();
  const q = createMockQueries(MOCK_VIEWER_ID);
  const list = await q.listMyHandovers();
  const summaries = list.ok ? list.data : [];
  const inputs: HandoverInput[] = await Promise.all(
    summaries.map(async (summary) => {
      const review = isReviewRole(summary.viewerRole);
      const [readiness, processing, gaps, members] = await Promise.all([
        review && summary.state !== "draft" ? q.getReadiness(summary.id) : null,
        review && summary.state === "processing" ? q.getProcessingStatus(summary.id) : null,
        review && summary.state === "in_review" ? q.listGapQuestions(summary.id) : null,
        q.listMembers(summary.id),
      ]);
      return {
        summary,
        readiness: readiness?.ok ? readiness.data : null,
        processing: processing?.ok ? processing.data : null,
        gaps: gaps?.ok ? gaps.data : null,
        members: members.ok ? members.data : null,
      };
    }),
  );
  const all = [...inputs, ...extraInputs()];
  const rows = sortRows(all.map((i) => classify(i, LINKS)));
  const activity = deriveActivity(all, rows, 9);
  const viewer = PROFILES.priya;
  return <DashboardPreview rows={rows} activity={activity} viewer={{ name: viewer.displayName, email: viewer.email }} newHref="/preview/wizard?step=1" />;
}
