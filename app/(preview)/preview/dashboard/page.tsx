import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { FilePlus2, Inbox } from "lucide-react";
import { Suspense } from "react";

import { DraftRow, HandoverCard, type HandoverCardData } from "@/components/dashboard/handover-card";
import { PageContainer } from "@/components/layout/page-container";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { SectionHeading } from "@/components/shared/section-heading";
import { DashboardSkeleton } from "@/components/shared/skeletons";
import { buttonVariants } from "@/components/ui/button";
import type { HandoverSummary } from "@/lib/contracts/dto";
import { MOCK_VIEWER_ID } from "@/lib/mocks/fixtures/profiles";
import { createMockQueries } from "@/lib/mocks/queries";

export const metadata: Metadata = { title: "Preview · Dashboard", robots: { index: false, follow: false } };

/** Dev-only: the dashboard from synthetic data (lib/mocks). `?empty=1` shows the empty state. */
export default function PreviewDashboardPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  if (process.env.NODE_ENV !== "development") notFound();
  const newHandoverLink = (
    <Link href="/preview/wizard?step=1" className={buttonVariants({ size: "lg" })}>
      <FilePlus2 aria-hidden="true" data-icon="inline-start" />
      New handover
    </Link>
  );
  return (
    <PageContainer className="space-y-10 lg:space-y-12">
      <PageHeader
        eyebrow="Workspace"
        title="Your handovers"
        description="Pick up a draft where you left it, keep reviews moving, and read what was handed over to you."
        actions={newHandoverLink}
      />
      <Suspense fallback={<DashboardSkeleton />}>
        <Content searchParams={searchParams} newHandoverLink={newHandoverLink} />
      </Suspense>
    </PageContainer>
  );
}

const isReview = (h: HandoverSummary) => h.viewerRole === "outgoing" || h.viewerRole === "reviewer";

async function Content({ searchParams, newHandoverLink }: { searchParams: Promise<Record<string, string | string[] | undefined>>; newHandoverLink: React.ReactNode }) {
  const query = await searchParams;
  if (query.empty === "1") {
    return (
      <EmptyState
        icon={<Inbox />}
        title="No handovers yet"
        description="Start a handover to gather your team's chats and documents and turn them into source-backed knowledge for whoever comes next."
        action={
          <>
            {newHandoverLink}
            <Link href="/demo" className={buttonVariants({ size: "lg", variant: "outline" })}>
              Explore the demo
            </Link>
          </>
        }
      />
    );
  }

  const queries = createMockQueries(MOCK_VIEWER_ID);
  const list = await queries.listMyHandovers();
  const all = list.ok ? list.data : [];
  const cards: HandoverCardData[] = await Promise.all(
    all.map(async (h) => {
      if (!isReview(h)) return { handover: h, readiness: null, href: "/preview/published", cta: "Read handover", isDemo: false };
      const r = await queries.getReadiness(h.id);
      return {
        handover: h,
        readiness: r.ok ? r.data.score : null,
        href: h.state === "processing" ? "/preview/processing" : "/preview/review",
        cta: h.state === "in_review" ? "Continue review" : h.state === "processing" ? "View progress" : "Open",
        isDemo: false,
      };
    }),
  );

  // Two synthetic drafts (one fresh, one nearly ready) so the "Drafts to finish" list shows both shapes.
  const base = all.find(isReview) ?? all[0];
  const drafts: HandoverCardData[] = base
    ? [
        {
          handover: { ...base, id: "00000000-0000-4000-8000-0000000000d1", title: "Treasurer handover, Robotics Society 2026–27", teamName: "Robotics Society", state: "draft", viewerIsCreator: true, viewerRole: "outgoing", pendingCreatorTransfer: null, currentPublicationId: null },
          readiness: null,
          href: "/preview/wizard?step=4",
          cta: "Continue",
          isDemo: false,
          draft: { sources: 3, next: "Scope and start" },
        },
        {
          handover: { ...base, id: "00000000-0000-4000-8000-0000000000d2", title: "Events lead", teamName: "Literary Club", state: "draft", viewerIsCreator: true, viewerRole: "reviewer", pendingCreatorTransfer: null, currentPublicationId: null },
          readiness: null,
          href: "/preview/wizard?step=2",
          cta: "Continue",
          isDemo: false,
          draft: { sources: 0, next: "Consent and sources" },
        },
      ]
    : [];
  const preparing = cards.filter((c) => isReview(c.handover));
  const receiving = cards.filter((c) => !isReview(c.handover));

  return (
    <div className="space-y-12">
      <section aria-labelledby="drafts" className="space-y-4">
        <SectionHeading id="drafts" title="Drafts to finish" count={drafts.length} description="Saved as you go. Continue from the step you reached." />
        <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card shadow-soft">
          {drafts.map((c) => (
            <DraftRow key={c.handover.id} data={c} preview />
          ))}
        </ul>
      </section>
      {preparing.length > 0 && (
        <section aria-labelledby="preparing" className="space-y-4">
          <SectionHeading id="preparing" title="Preparing and reviewing" count={preparing.length} />
          <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {preparing.map((c) => (
              <li key={c.handover.id}>
                <HandoverCard data={c} />
              </li>
            ))}
          </ul>
        </section>
      )}
      {receiving.length > 0 && (
        <section aria-labelledby="receiving" className="space-y-4">
          <SectionHeading id="receiving" title="Handed over to you" count={receiving.length} description="Read the handover, work through the first week, and acknowledge it." />
          <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {receiving.map((c) => (
              <li key={c.handover.id}>
                <HandoverCard data={c} />
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
