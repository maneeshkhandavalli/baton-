import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { FileSearch, Lock } from "lucide-react";
import { Suspense } from "react";

import { PageContainer } from "@/components/layout/page-container";
import { loadReview } from "@/components/review/load-review";
import { ReviewWorkspace } from "@/components/review/review-workspace";
import { EmptyState } from "@/components/shared/empty-state";
import { LoadingState } from "@/components/shared/loading-state";
import { buttonVariants } from "@/components/ui/button";
import { getQueries } from "@/lib/data";
import { routes } from "@/lib/routes";

export const metadata: Metadata = { title: "Review" };

export default function ReviewPage({ params }: PageProps<"/handover/[id]/review">) {
  return (
    <PageContainer width="wide" className="lg:py-8">
      <Suspense fallback={<LoadingState label="Loading the review…" className="min-h-96" />}>
        <ReviewContent params={params} />
      </Suspense>
    </PageContainer>
  );
}

async function ReviewContent({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const load = await loadReview(getQueries(), id);
  if (load.kind === "not_found") notFound();

  if (load.kind === "not_reviewer") {
    return (
      <EmptyState
        icon={<Lock />}
        title="Review is for reviewers"
        description="Only the creator, the outgoing member and reviewers can see the review workspace. You can read the published handover instead."
        action={
          <Link href={routes.handover.published(id)} className={buttonVariants()}>
            Read the handover
          </Link>
        }
      />
    );
  }

  const { data } = load;
  const { state } = data.handover;

  if (data.points.length === 0) {
    return (
      <EmptyState
        icon={<FileSearch />}
        title={state === "processing" || state === "draft" ? "Nothing to review yet" : "No points found"}
        description={
          state === "processing"
            ? "Baton is still reading your sources. Points will appear here when processing finishes."
            : state === "draft"
              ? "Add sources and start processing to extract source-backed points."
              : "Processing finished without finding any points."
        }
        action={
          <Link href={routes.handover.processing(id)} className={buttonVariants({ variant: "outline" })}>
            View processing
          </Link>
        }
      />
    );
  }

  const readOnlyReason =
    state === "processing"
      ? "Processing is running. Review opens again when it finishes."
      : state === "approved" || state === "acknowledged"
        ? data.handover.viewerIsCreator
          ? "This handover is published. Start a revision in Settings to make changes."
          : "This handover is published. Only the creator can start a revision."
        : undefined;


  return (
    <ReviewWorkspace
      {...data}
      readOnly={!!readOnlyReason}
      readOnlyReason={readOnlyReason}
      gapsHref={routes.handover.gaps(id)}
      publishedHref={data.handover.currentPublicationId ? routes.handover.published(id) : null}
    />
  );
}
