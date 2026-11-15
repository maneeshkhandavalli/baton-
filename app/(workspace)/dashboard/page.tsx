import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { FilePlus2 } from "lucide-react";
import { Suspense } from "react";

import { DashboardBodySkeleton } from "@/components/dashboard/dashboard-skeleton";
import { DashboardView } from "@/components/dashboard/dashboard-view";
import { loadDashboard, type DashboardRoutes } from "@/components/dashboard/load";
import { PageContainer } from "@/components/layout/page-container";
import { PageHeader } from "@/components/shared/page-header";
import { buttonVariants } from "@/components/ui/button";
import { getQueries } from "@/lib/data";
import { routes } from "@/lib/routes";

export const metadata: Metadata = { title: "Dashboard" };

const DASHBOARD_ROUTES: DashboardRoutes = {
  wizard: (id) => `${routes.handover.new}?draft=${encodeURIComponent(id)}`,
  draft: (id) => `${routes.handover.new}?draft=${encodeURIComponent(id)}`,
  review: routes.handover.review,
  processing: routes.handover.processing,
  published: routes.handover.published,
  gaps: routes.handover.gaps,
  settings: routes.handover.settings,
  offers: routes.handover.settings,
};

export default function DashboardPage() {
  const newHandoverLink = (
    <Link href={routes.handover.new} className={buttonVariants({ size: "lg" })}>
      <FilePlus2 aria-hidden="true" data-icon="inline-start" />
      New handover
    </Link>
  );

  return (
    <PageContainer width="wide" className="space-y-8 lg:space-y-10">
      <PageHeader title="Your handovers" description="What needs you comes first. Drafts, reviews and handovers you've received are below." actions={newHandoverLink} />
      <Suspense fallback={<DashboardBodySkeleton />}>
        <HandoverList newHandoverLink={newHandoverLink} />
      </Suspense>
    </PageContainer>
  );
}

async function HandoverList({ newHandoverLink }: { newHandoverLink: React.ReactNode }) {
  // Request-time only: every Supabase read below checks the session's expiry against the current time
  // (auth-js getSession → Date.now()). With Partial Prefetching, cookies() alone does not end prerendering.
  await connection();
  const result = await loadDashboard(getQueries(), DASHBOARD_ROUTES);
  return <DashboardView result={result} newHandover={newHandoverLink} demoHref={routes.demo} />;
}
