import type { Metadata } from "next";

import { PageContainer } from "@/components/layout/page-container";
import { PageHeader } from "@/components/shared/page-header";
import { SectionHeading } from "@/components/shared/section-heading";

export const metadata: Metadata = { title: "Handover settings" };

export default function HandoverSettingsPage() {
  return (
    <PageContainer width="wide" className="space-y-8">
      <PageHeader
        eyebrow="Handover"
        title="Settings"
        description="Manage sharing links and the details of this handover."
      />
      <section className="max-w-2xl space-y-6 rounded-xl border border-border bg-card p-6 shadow-soft">
        <SectionHeading
          title="Sharing"
          description="Links for contributors and successors will be managed here."
        />
        <SectionHeading
          title="Danger zone"
          description="Archiving and deleting this handover will be available here."
          className="border-t border-border pt-6"
        />
      </section>
    </PageContainer>
  );
}
