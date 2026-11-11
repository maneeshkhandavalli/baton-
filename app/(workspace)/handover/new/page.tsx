import type { Metadata } from "next";

import { PageContainer } from "@/components/layout/page-container";
import { PageHeader } from "@/components/shared/page-header";
import { NewHandoverWizard } from "@/components/wizard/new-handover-wizard";

export const metadata: Metadata = { title: "New handover" };

export default function NewHandoverPage() {
  return (
    <PageContainer width="narrow" className="space-y-8">
      <PageHeader
        eyebrow="New handover"
        title="Start a handover"
        description="Four short steps: who is involved, the chats and documents that hold the knowledge, what Baton may read, and consent."
      />
      <NewHandoverWizard />
    </PageContainer>
  );
}
