import { PageContainer } from "@/components/layout/page-container";
import { DocumentSkeleton } from "@/components/shared/skeletons";

/** Route-level skeleton shown while this page's server work starts (same layout as the page). */
export default function Loading() {
  return (
    <PageContainer width="prose">
      <DocumentSkeleton label="Opening your questions…" withNav={false} />
    </PageContainer>
  );
}
