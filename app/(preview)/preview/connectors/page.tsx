import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { PageContainer } from "@/components/layout/page-container";
import { ConnectorFixtureGallery } from "@/components/connectors/fixture-gallery";
import { FIXTURE_SCENARIOS, type FixtureScenario } from "@/components/connectors/fixture-actions";

// Titles only in development: a production 404 for this route must not name it.
export const metadata: Metadata = { ...(process.env.NODE_ENV === "development" ? { title: "Preview · Connected channels" } : {}), robots: { index: false, follow: false } };

/** Dev-only (Main, Round 4 review): every Connected channels state on synthetic data, clickable end to end. */
export default function PreviewConnectorsPage({ searchParams }: PageProps<"/preview/connectors">) {
  if (process.env.NODE_ENV !== "development") notFound();
  return (
    <PageContainer width="default">
      <Suspense fallback={null}>
        <Gallery searchParams={searchParams} />
      </Suspense>
    </PageContainer>
  );
}

async function Gallery({ searchParams }: { searchParams: PageProps<"/preview/connectors">["searchParams"] }) {
  const q = (await searchParams).scenario;
  const initial = (FIXTURE_SCENARIOS as readonly unknown[]).includes(q) ? (q as FixtureScenario) : "capturing";
  return <ConnectorFixtureGallery initial={initial} />;
}
