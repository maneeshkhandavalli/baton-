import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { FilePlus2 } from "lucide-react";
import { Suspense } from "react";

import { DashboardBodySkeleton } from "@/components/dashboard/dashboard-skeleton";
import { DashboardView } from "@/components/dashboard/dashboard-view";
import type { HandoverCardData } from "@/components/dashboard/handover-card";
import { DRAFT_STEPS, loadDashboard, type DashboardRoutes } from "@/components/dashboard/load";
import { classify } from "@/components/dashboard/model";
import { PageContainer } from "@/components/layout/page-container";
import { PageHeader } from "@/components/shared/page-header";
import { buttonVariants } from "@/components/ui/button";
import type { HandoverSummary } from "@/lib/contracts/dto";
import { MOCK_VIEWER_ID } from "@/lib/mocks/fixtures/profiles";
import { createMockQueries } from "@/lib/mocks/queries";

// Titles only in development: a production 404 for this route must not name it.
export const metadata: Metadata = { ...(process.env.NODE_ENV === "development" ? { title: "Preview · Dashboard" } : {}), robots: { index: false, follow: false } };

/** Every destination is a working dev-only preview page. */
const PREVIEW_ROUTES: DashboardRoutes = {
  wizard: () => "/preview/wizard?step=2",
  draft: (_id, step) => `/preview/wizard?step=${step}`,
  review: () => "/preview/review",
  processing: () => "/preview/processing",
  published: () => "/preview/published",
  gaps: () => "/preview/review",
  settings: () => "/preview/review",
  offers: () => "/preview/review",
};

/**
 * Dev-only: the real dashboard components (components/dashboard/dashboard-view) over synthetic data, loaded through
 * the same loader as /dashboard with createMockQueries. `?empty=1` shows the first-run state.
 */
export default function PreviewDashboardPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  if (process.env.NODE_ENV !== "development") notFound();
  const newHandoverLink = (
    <Link href="/preview/wizard?step=1" className={buttonVariants({ size: "lg" })}>
      <FilePlus2 aria-hidden="true" data-icon="inline-start" />
      New handover
    </Link>
  );
  return (
    <PageContainer width="wide" className="space-y-8 lg:space-y-10">
      <PageHeader title="Your handovers" description="What needs you comes first. Drafts, reviews and handovers you've received are below." actions={newHandoverLink} />
      <Suspense fallback={<DashboardBodySkeleton />}>
        <Content searchParams={searchParams} newHandoverLink={newHandoverLink} />
      </Suspense>
    </PageContainer>
  );
}

/** Two synthetic drafts (one nearly ready, one fresh) so "Drafts to finish" shows both shapes; the mocks have none. */
function previewDrafts(base: HandoverSummary): HandoverCardData[] {
  const make = (id: string, title: string, teamName: string, next: (typeof DRAFT_STEPS)[number], sources: number, hoursAgo: number): HandoverCardData => {
    const summary: HandoverSummary = {
      ...base,
      id,
      title,
      teamName,
      state: "draft",
      viewerIsCreator: true,
      viewerRole: "outgoing",
      pendingCreatorTransfer: null,
      currentPublicationId: null,
      updatedAt: new Date(Date.parse(base.updatedAt) + hoursAgo * 3_600_000).toISOString(),
    };
    const step = DRAFT_STEPS.indexOf(next) + 1;
    return {
      handover: summary,
      readiness: null,
      href: PREVIEW_ROUTES.draft(id, step),
      cta: "Continue editing",
      isDemo: false,
      draft: { sources, next },
      row: classify({ summary, draft: { step, steps: DRAFT_STEPS, sources } }, PREVIEW_ROUTES),
    };
  };
  return [
    make("00000000-0000-4000-8000-0000000000d1", "Treasurer handover, Robotics Society 2026–27", "Robotics Society", "Scope and start", 3, 2),
    make("00000000-0000-4000-8000-0000000000d2", "Events lead", "Literary Club", "Consent and sources", 0, -30),
  ];
}

async function Content({ searchParams, newHandoverLink }: { searchParams: Promise<Record<string, string | string[] | undefined>>; newHandoverLink: React.ReactNode }) {
  await connection();
  const query = await searchParams;
  if (query.empty === "1") return <DashboardView result={{ ok: true, cards: [] }} newHandover={newHandoverLink} demoHref="/demo" preview />;
  const result = await loadDashboard(createMockQueries(MOCK_VIEWER_ID), PREVIEW_ROUTES);
  const withDrafts = result.ok && result.cards[0] ? { ok: true as const, cards: [...previewDrafts(result.cards[0].handover), ...result.cards] } : result;
  return <DashboardView result={withDrafts} newHandover={newHandoverLink} demoHref="/demo" preview />;
}
