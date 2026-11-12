import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { FilePlus2, Inbox } from "lucide-react";
import { Suspense } from "react";

import { DraftRow, HandoverCard, HandoverCardSkeleton, type HandoverCardData } from "@/components/dashboard/handover-card";
import { PageContainer } from "@/components/layout/page-container";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { SectionHeading } from "@/components/shared/section-heading";
import { buttonVariants } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import type { HandoverSummary } from "@/lib/contracts/dto";
import { getQueries } from "@/lib/data";
import { routes } from "@/lib/routes";

export const metadata: Metadata = { title: "Dashboard" };

export default function DashboardPage() {
  const newHandoverLink = (
    <Link href={routes.handover.new} className={buttonVariants({ size: "lg" })}>
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
        <HandoverList newHandoverLink={newHandoverLink} />
      </Suspense>
    </PageContainer>
  );
}

function DashboardSkeleton() {
  return (
    <div className="space-y-10" aria-busy="true" aria-label="Loading your handovers">
      <div className="space-y-4">
        <Skeleton className="h-4 w-40" />
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          <HandoverCardSkeleton />
          <HandoverCardSkeleton />
          <HandoverCardSkeleton />
        </div>
      </div>
    </div>
  );
}

const isReview = (h: HandoverSummary) => h.viewerRole === "outgoing" || h.viewerRole === "reviewer";

async function cardFor(h: HandoverSummary): Promise<HandoverCardData> {
  const queries = getQueries();
  const isDemo = false; // real data only; the synthetic CodeCell demo lives at /demo
  if (!isReview(h)) {
    // Lead and incoming members read the publication by membership (reconciliation Q3 proposal).
    return { handover: h, readiness: null, href: routes.handover.published(h.id), cta: "Read handover", isDemo };
  }
  if (h.state === "draft" && (h.viewerIsCreator || h.viewerRole === "outgoing")) {
    const sources = await queries.listSources(h.id);
    const live = sources.ok ? sources.data.filter((s) => s.state !== "removed") : [];
    if (!live.some((s) => s.state === "parsed" || s.state === "parsing")) {
      const ready = live.filter((s) => s.state === "uploaded" && s.consentRecordedAt).length;
      return {
        handover: h,
        readiness: null,
        href: `${routes.handover.new}?draft=${encodeURIComponent(h.id)}`,
        cta: "Continue editing",
        isDemo,
        draft: { sources: live.length, next: live.length === 0 ? "Consent and sources" : ready > 0 ? "Scope and start" : "Finish uploads" },
      };
    }
  }
  const readiness = await queries.getReadiness(h.id);
  const target =
    h.pendingCreatorTransfer && !h.viewerIsCreator
      ? { href: routes.handover.settings(h.id), cta: "Review the offer" }
      : h.state === "draft" || h.state === "processing"
      ? { href: routes.handover.processing(h.id), cta: h.state === "draft" ? "Continue setup" : "View progress" }
      : h.state === "in_review"
        ? { href: routes.handover.review(h.id), cta: "Continue review" }
        : { href: routes.handover.review(h.id), cta: "Open" };
  return { handover: h, readiness: readiness.ok ? readiness.data.score : null, ...target, isDemo };
}

async function HandoverList({ newHandoverLink }: { newHandoverLink: React.ReactNode }) {
  // Request-time only: every Supabase read below checks the session's expiry against the current time
  // (auth-js getSession → Date.now()). With Partial Prefetching, cookies() alone does not end prerendering.
  await connection();
  const result = await getQueries().listMyHandovers();
  if (!result.ok) {
    return (
      <EmptyState
        tone="error"
        icon={<Inbox />}
        title="We couldn’t load your handovers"
        description={`${result.error.message} Refresh the page to try again.`}
      />
    );
  }
  if (result.data.length === 0) {
    return (
      <EmptyState
        icon={<Inbox />}
        title="No handovers yet"
        description="Start a handover to gather your team's chats and documents and turn them into source-backed knowledge for whoever comes next."
        action={
          <>
            {newHandoverLink}
            <Link href={routes.demo} className={buttonVariants({ size: "lg", variant: "outline" })}>
              Explore the demo
            </Link>
          </>
        }
      />
    );
  }

  const cards = await Promise.all(result.data.map(cardFor));
  const drafts = cards.filter((c) => c.draft && isReview(c.handover));
  // Work that needs the viewer first: offers to them, reviews in progress, then the rest.
  const rank = (c: HandoverCardData) =>
    c.handover.pendingCreatorTransfer && !c.handover.viewerIsCreator ? 0 : c.handover.state === "in_review" ? 1 : c.handover.state === "processing" ? 2 : 3;
  const preparing = cards.filter((c) => !c.draft && isReview(c.handover)).sort((a, b) => rank(a) - rank(b));
  const receiving = cards.filter((c) => !isReview(c.handover));

  return (
    <div className="space-y-12">
      {drafts.length > 0 && (
        <section aria-labelledby="drafts" className="space-y-4">
          <SectionHeading id="drafts" title="Drafts to finish" count={drafts.length} description="Saved as you go. Continue from the step you reached." />
          <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card shadow-soft">
            {drafts.map((c) => (
              <DraftRow key={c.handover.id} data={c} />
            ))}
          </ul>
        </section>
      )}
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
