import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { PageContainer } from "@/components/layout/page-container";
import { ConnectorFixtureGallery } from "@/components/connectors/fixture-gallery";

// Titles only in development: a production 404 for this route must not name it.
export const metadata: Metadata = { ...(process.env.NODE_ENV === "development" ? { title: "Preview · Connected channels" } : {}), robots: { index: false, follow: false } };

/** Dev-only (Main, Round 4 review): every Connected channels state on synthetic data, clickable end to end. */
export default function PreviewConnectorsPage() {
  if (process.env.NODE_ENV !== "development") notFound();
  return (
    <PageContainer width="default">
      <ConnectorFixtureGallery />
    </PageContainer>
  );
}
