import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { FilePlus2, Inbox } from "lucide-react";
import { Suspense } from "react";

import { DiscardDraftButton } from "@/components/dashboard/discard-draft-button";
import { HandoverCard, HandoverCardSkeleton, type HandoverCardData } from "@/components/dashboard/handover-card";
import { PageContainer } from "@/components/layout/page-container";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { buttonVariants } from "@/components/ui/button";
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
    <PageContainer className="space-y-8">
      <PageHeader
        eyebrow="Workspace"
        title="Your handovers"
        description="Every handover you are preparing, reviewing or receiving."
        actions={newHandoverLink}
      />
      <Suspense
        fallback={
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            <HandoverCardSkeleton />
            <HandoverCardSkeleton />
            <HandoverCardSkeleton />
          </div>
        }
      >
        <HandoverList newHandoverLink={newHandoverLink} />
      </Suspense>
    </PageContainer>
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
    return <EmptyState icon={<Inbox />} title="We couldn't load your handovers" description={result.error.message} />;
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
  // The demo first, then most recently updated.
  cards.sort((a, b) => Number(b.isDemo) - Number(a.isDemo));
  const preparing = cards.filter((c) => isReview(c.handover));
  const receiving = cards.filter((c) => !isReview(c.handover));

  return (
    <div className="space-y-10">
      <section aria-labelledby="preparing" className="space-y-4">
        <h2 id="preparing" className="text-sm font-semibold">
          Preparing and reviewing <span className="font-normal text-muted-foreground">· {preparing.length}</span>
        </h2>
        <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {preparing.map((c) => (
            <li key={c.handover.id} className="flex flex-col gap-1">
              <HandoverCard data={c} />
              {c.draft && c.handover.viewerIsCreator && <DiscardDraftButton handoverId={c.handover.id} title={c.handover.title} />}
            </li>
          ))}
        </ul>
      </section>
      {receiving.length > 0 && (
        <section aria-labelledby="receiving" className="space-y-4">
          <h2 id="receiving" className="text-sm font-semibold">
            Handed over to you <span className="font-normal text-muted-foreground">· {receiving.length}</span>
          </h2>
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
