import type { Metadata } from "next";
import { BookOpen } from "lucide-react";

import { PageContainer } from "@/components/layout/page-container";
import { EmptyState } from "@/components/shared/empty-state";
import { PageHeader } from "@/components/shared/page-header";

export const metadata: Metadata = { title: "Handover" };

export default function SharedHandoverPage() {
  return (
    <PageContainer width="narrow" className="space-y-8">
      <PageHeader
        eyebrow="Handover"
        title="Your handover"
        description="Everything the previous team knew, with a source for every claim."
      />
      <EmptyState
        icon={<BookOpen />}
        title="Handover content will appear here"
        description="Shared handover links will be connected in a later phase."
      />
    </PageContainer>
  );
}
