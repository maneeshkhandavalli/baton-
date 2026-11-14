import { PageContainer } from "@/components/layout/page-container";
import { WorkspaceSkeleton } from "@/components/shared/skeletons";

/** Route-level skeleton shown while this page's server work starts (same layout as the page). */
export default function Loading() {
  return (
    <PageContainer width="wide">
      <WorkspaceSkeleton label="Loading the demo…" />
    </PageContainer>
  );
}
