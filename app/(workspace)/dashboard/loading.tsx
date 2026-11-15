import { DashboardBodySkeleton } from "@/components/dashboard/dashboard-skeleton";
import { PageContainer } from "@/components/layout/page-container";
import { Skeleton } from "@/components/ui/skeleton";

/** Route-level skeleton shown while this page's server work starts (same layout as the page). */
export default function Loading() {
  return (
    <PageContainer width="wide" className="space-y-8 lg:space-y-10">
      <div aria-hidden="true" className="flex flex-col gap-5 border-b border-border pb-6 sm:flex-row sm:items-end sm:justify-between sm:pb-8">
        <div className="space-y-3">
          <Skeleton className="h-9 w-64" />
          <Skeleton className="h-4 w-96 max-w-full" />
        </div>
        <Skeleton className="h-10 w-40 rounded-md" />
      </div>
      <DashboardBodySkeleton />
    </PageContainer>
  );
}
