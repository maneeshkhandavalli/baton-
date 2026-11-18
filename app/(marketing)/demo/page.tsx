import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, Info, ListChecks, Quote, UserRoundCheck } from "lucide-react";
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
import { DEMO_FRAMING } from "@/components/demo/demo-guide";

export const metadata: Metadata = {
  title: "Demo: CodeCell handover",
  description: "Try a Baton handover end to end for a fictional college coding club. Nothing is saved or sent.",
};

/** Short pointers for a first-time visitor (and judges) on where to look. */
const LOOK_FOR = [
  { icon: Quote, text: "Each point shows the exact quote and source it rests on." },
  { icon: ListChecks, text: "Conflicting and missing points show what still needs a person." },
  { icon: UserRoundCheck, text: "Switch to Incoming handover to see what Neha receives." },
] as const;

export default function DemoPage() {
  return (
    <div className="mx-auto w-full max-w-[90rem] space-y-8 px-4 py-10 sm:px-6 lg:px-10 lg:py-12 xl:px-12">
      <header className="flex flex-col gap-6 border-b border-border pb-8 lg:flex-row lg:items-end lg:justify-between lg:gap-10">
        <div className="max-w-2xl space-y-3">
          <p className="type-eyebrow text-muted-foreground">{DEMO_FRAMING}</p>
          <h1 className="type-page-title">CodeCell: handing over the technical lead role</h1>
          <p className="type-body text-muted-foreground">
            Priya is leaving CodeCell, a college coding club. Baton read the club&rsquo;s WhatsApp groups and its written
            notes. Step through the whole handover yourself: review the points, publish, then read it as Neha, the incoming lead.
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-stretch gap-2 sm:flex-row sm:items-center lg:flex-col lg:items-end">
          {/* R3 Task 06: one clear way in. A plain link: no sign-in, no form, no server function (contract §2.2). */}
          <Link href={routes.demoWorkspace()} className={buttonVariants({ size: "lg" })}>
            Enter the demo
            <ArrowRight aria-hidden="true" data-icon="inline-end" />
          </Link>
          <p className="text-caption text-muted-foreground lg:text-right">Six short steps · no account needed</p>
        </div>
      </header>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start lg:gap-10">
        <ul aria-label="What to look for" className="grid gap-2.5 sm:grid-cols-3 sm:gap-4">
          {LOOK_FOR.map((item) => (
            <li key={item.text} className="flex items-start gap-2.5 text-sm leading-snug">
              <item.icon aria-hidden="true" className="mt-px size-4 shrink-0 text-primary" />
              <span>{item.text}</span>
            </li>
          ))}
        </ul>
        <p className="flex items-start gap-2 text-caption text-muted-foreground lg:max-w-xs">
          <Info aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
          Everyone and everything here is fictional. Below is a read-only preview; the demo itself lets you act.
        </p>
      </div>
      <h2 className="type-section-title">Read-only preview</h2>
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
