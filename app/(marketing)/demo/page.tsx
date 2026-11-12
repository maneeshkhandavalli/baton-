import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Info } from "lucide-react";
import { Suspense } from "react";

import { DemoTabs } from "@/components/marketing/demo-tabs";
import { PublishedHandoverView } from "@/components/published/published-handover-view";
import { loadReview } from "@/components/review/load-review";
import { ReviewWorkspace } from "@/components/review/review-workspace";
import { WorkspaceSkeleton } from "@/components/shared/skeletons";
import { buttonVariants } from "@/components/ui/button";
import { CODECELL_ID } from "@/lib/mocks/fixtures/codecell";
import { PROFILES } from "@/lib/mocks/fixtures/profiles";
import { createMockQueries } from "@/lib/mocks/queries";
import { routes } from "@/lib/routes";
import { cn } from "@/lib/utils";

export const metadata: Metadata = {
  title: "Demo: CodeCell handover",
  description: "Explore a read-only Baton handover for a fictional college coding club.",
};

export default function DemoPage() {
  return (
    <div className="mx-auto w-full max-w-[90rem] space-y-8 px-4 py-10 sm:px-6 lg:px-10 lg:py-12 xl:px-12">
      <header className="flex flex-col gap-6 border-b border-border pb-8 lg:flex-row lg:items-end lg:justify-between">
        <div className="max-w-2xl space-y-3">
          <p className="type-eyebrow text-muted-foreground">Public demo · read only</p>
          <h1 className="type-page-title">CodeCell: handing over the technical lead role</h1>
          <p className="type-body text-muted-foreground">
            Priya is leaving CodeCell, a college coding club. Baton read two WhatsApp groups, a sponsorship MoU, the hackathon runbook and some infrastructure
            notes. Browse what it found, how each point is backed, and what Neha, the incoming lead, receives.
          </p>
        </div>
        <Link href={routes.handover.new} className={cn(buttonVariants({ size: "lg" }), "shrink-0")}>
          Start your own handover
          <ArrowRight aria-hidden="true" data-icon="inline-end" />
        </Link>
      </header>
      <p className="flex items-start gap-2 text-sm text-muted-foreground">
        <Info aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
        Everyone and everything here is fictional. Press J and K to move between points.
      </p>
      <Suspense fallback={<WorkspaceSkeleton label="Loading the demo…" />}>
        <DemoContent />
      </Suspense>
    </div>
  );
}

async function DemoContent() {
  // The demo reads as Arjun (reviewer) and Neha (incoming). The real demo dataset will need its own
  // public, read-only data source; see the handover report.
  const [review, published] = await Promise.all([
    loadReview(createMockQueries(PROFILES.arjun.id), CODECELL_ID),
    createMockQueries(PROFILES.neha.id).getPublishedHandover(CODECELL_ID),
  ]);
  return (
    <DemoTabs
      review={
        review.kind === "ok" ? (
          <ReviewWorkspace {...review.data} readOnly readOnlyReason="Demo mode: review actions are turned off." gapsHref={null} publishedHref={null} />
        ) : (
          <p className="text-sm text-muted-foreground">The demo isn&rsquo;t available right now.</p>
        )
      }
      incoming={
        published.ok ? (
          <div className="rounded-2xl border border-border bg-background p-4 sm:p-8 lg:p-10">
            <PublishedHandoverView handover={published.data} viewerLabel={PROFILES.neha.displayName} viewerRole="incoming" preview />
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">The incoming view isn&rsquo;t available right now.</p>
        )
      }
    />
  );
}
