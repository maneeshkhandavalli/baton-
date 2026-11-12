import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { PageContainer } from "@/components/layout/page-container";
import { PREVIEW_PAGES } from "@/components/preview/preview-chrome";
import { PageHeader } from "@/components/shared/page-header";

export const metadata: Metadata = { title: "Design previews", robots: { index: false, follow: false } };

const VARIANTS: Record<string, Array<{ href: string; label: string }>> = {
  Dashboard: [
    { href: "/preview/dashboard", label: "Drafts, preparing, receiving" },
    { href: "/preview/dashboard?empty=1", label: "Empty state" },
  ],
  Wizard: [1, 2, 3, 4].map((n) => ({ href: `/preview/wizard?step=${n}`, label: `Step ${n}` })),
  Processing: [
    { href: "/preview/processing?state=running", label: "Running" },
    { href: "/preview/processing?state=partial", label: "Partial" },
    { href: "/preview/processing?state=failed", label: "Failed" },
    { href: "/preview/processing?state=schema", label: "db_schema_outdated" },
    { href: "/preview/processing?state=nojobs", label: "no_jobs" },
  ],
  Review: [{ href: "/preview/review", label: "All evidence and review states" }],
  Published: [{ href: "/preview/published", label: "Incoming member view" }],
};

export default function PreviewIndexPage() {
  if (process.env.NODE_ENV !== "development") notFound();
  return (
    <PageContainer width="narrow" className="space-y-8">
      <PageHeader
        eyebrow="Development only"
        title="Design previews"
        description="The real page components rendered from synthetic data, for screenshots at 1440, 1024 and 390. No sign-in, no database, and no actions."
      />
      <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card shadow-soft">
        {PREVIEW_PAGES.map((p) => (
          <li key={p.href} className="space-y-2 p-4 sm:p-5">
            <h2 className="type-heading">{p.label}</h2>
            <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
              {VARIANTS[p.label].map((v) => (
                <li key={v.href}>
                  <Link href={v.href} className="font-medium text-primary-fg underline-offset-4 hover:underline">
                    {v.label}
                  </Link>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </PageContainer>
  );
}
