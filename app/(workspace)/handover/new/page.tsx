import type { Metadata } from "next";
import { Upload } from "lucide-react";

import { PageContainer } from "@/components/layout/page-container";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";

export const metadata: Metadata = { title: "New handover" };

export default function NewHandoverPage() {
  return (
    <PageContainer width="narrow" className="space-y-8">
      <PageHeader
        eyebrow="New handover"
        title="Start a handover"
        description="Name the role or team being handed over and add the documents that hold its knowledge."
      />
      <EmptyState
        icon={<Upload />}
        title="Handover setup is coming soon"
        description="Document upload and handover details will be added in a later phase."
      />
    </PageContainer>
  );
}
