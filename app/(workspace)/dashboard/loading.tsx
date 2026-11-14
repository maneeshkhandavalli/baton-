import { PageContainer } from "@/components/layout/page-container";
import { DashboardSkeleton } from "@/components/shared/skeletons";

/** Route-level skeleton shown while this page's server work starts (same layout as the page). */
export default function Loading() {
  return (
    <PageContainer width="default">
      <DashboardSkeleton withHeader />
    </PageContainer>
  );
}
