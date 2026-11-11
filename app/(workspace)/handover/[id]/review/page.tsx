import type { Metadata } from "next";
import { FileSearch } from "lucide-react";

import { PageContainer } from "@/components/layout/page-container";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";
import { StatusBadge } from "@/components/shared/status-badge";
import { EVIDENCE_STATUSES } from "@/types/status";

export const metadata: Metadata = { title: "Review" };

export default function ReviewPage() {
  return (
    <PageContainer width="wide" className="space-y-8">
      <PageHeader
        eyebrow="Handover"
        title="Review"
        description="Check each claim against its source before the handover is shared."
        actions={
          <ul aria-label="Evidence statuses" className="flex flex-wrap gap-1.5">
            {EVIDENCE_STATUSES.map((status) => (
              <li key={status}>
                <StatusBadge status={status} size="sm" />
              </li>
            ))}
          </ul>
        }
      />
      <EmptyState
        icon={<FileSearch />}
        title="Nothing to review yet"
        description="Extracted knowledge and its sources will appear here once processing is connected."
      />
    </PageContainer>
  );
}
