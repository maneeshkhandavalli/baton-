import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { FilePlus2 } from "lucide-react";
import { Suspense } from "react";

import { DashboardBodySkeleton } from "@/components/dashboard/dashboard-skeleton";
import { DashboardView } from "@/components/dashboard/dashboard-view";
import { loadDashboard, type DashboardRoutes } from "@/components/dashboard/load";
import { PageContainer } from "@/components/layout/page-container";
import { GettingStarted } from "@/components/onboarding/getting-started";
import { PageHeader } from "@/components/shared/page-header";
import { buttonVariants } from "@/components/ui/button";
import { getQueries } from "@/lib/data";
import type { ChecklistLinks } from "@/lib/onboarding/checklist";
import { loadChecklist, loadGuidanceRoles } from "@/lib/onboarding/load";
import { readSessionOnboarding } from "@/lib/onboarding/server";
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
  changes: routes.handover.changes,
};

/** Where each Getting Started item is done (the real pages). */
const CHECKLIST_LINKS: ChecklistLinks = {
  newHandover: routes.handover.new,
  draft: (id) => `${routes.handover.new}?draft=${encodeURIComponent(id)}`,
  processing: routes.handover.processing,
  review: routes.handover.review,
  gaps: routes.handover.gaps,
  changes: routes.handover.changes,
  settings: routes.handover.settings,
  published: routes.handover.published,
};

export default function DashboardPage({ searchParams }: PageProps<"/dashboard">) {
  const newHandoverLink = (
    <Link href={routes.handover.new} className={buttonVariants({ size: "lg" })} data-tour="new-handover">
      <FilePlus2 aria-hidden="true" data-icon="inline-start" />
      New handover
    </Link>
  );

  return (
    <PageContainer width="wide" className="space-y-8 lg:space-y-10">
      <PageHeader title="Your handovers" actions={newHandoverLink} />
      {/* Wide screens: the handover list and, beside it, Getting Started (UI polish: no empty side gutters).
          Below xl the checklist comes first, full width. The aside collapses when the checklist renders nothing. */}
      <div className="flex flex-col gap-8 xl:flex-row xl:items-start xl:gap-10">
        {/* Round 4: Getting Started, from the user's real handover state (nothing while it loads). */}
        <aside aria-label="Getting started" className="empty:hidden xl:order-last xl:w-[22rem] xl:shrink-0">
          <Suspense fallback={null}>
            <GettingStartedSection searchParams={searchParams} />
          </Suspense>
        </aside>
        <div className="min-w-0 flex-1">
          <Suspense fallback={<DashboardBodySkeleton />}>
            <HandoverList newHandoverLink={newHandoverLink} />
          </Suspense>
        </div>
      </div>
    </PageContainer>
  );
}

async function GettingStartedSection({ searchParams }: { searchParams: PageProps<"/dashboard">["searchParams"] }) {
  await connection(); // session reads check token expiry against the current time; request-time only
  const [query, session] = await Promise.all([searchParams, readSessionOnboarding()]);
  if (!session) return null;
  const queries = getQueries();
  const loaded = await loadGuidanceRoles(queries);
  if (!loaded) return null; // role unknown: show no guidance rather than the wrong one
  const checklist = await loadChecklist(queries, loaded.handovers, loaded.roles, loaded.roles.primary, session.state, CHECKLIST_LINKS);
  const forced = query.checklist === "show";
  // keyed: Help → "Getting started checklist" remounts it, so a list hidden in this tab shows again
  return <GettingStarted key={forced ? "shown" : "default"} checklist={checklist} dismissed={!!session.state.checklistDismissedAt} forced={forced} />;
}

async function HandoverList({ newHandoverLink }: { newHandoverLink: React.ReactNode }) {
  // Request-time only: every Supabase read below checks the session's expiry against the current time
  // (auth-js getSession → Date.now()). With Partial Prefetching, cookies() alone does not end prerendering.
  await connection();
  const result = await loadDashboard(getQueries(), DASHBOARD_ROUTES);
  return <DashboardView result={result} newHandover={newHandoverLink} demoHref={routes.demo} />;
}
