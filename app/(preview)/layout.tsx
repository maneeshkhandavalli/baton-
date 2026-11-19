import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { Suspense } from "react";

import { AppShell } from "@/components/layout/app-shell";
import { PreviewGuidance } from "@/components/onboarding/preview-guidance-data";
import { PreviewBanner } from "@/components/preview/preview-chrome";

export const metadata: Metadata = { robots: { index: false, follow: false } };

/**
 * Dev-only design previews (synthetic lib/mocks data, no session, no server actions). Every page in
 * this group repeats the guard below, so a production build can never serve them.
 */
export default function PreviewLayout({ children }: { children: React.ReactNode }) {
  if (process.env.NODE_ENV !== "development") notFound();
  return (
    <AppShell
      guidance={
        // Round 4: ?guide=creator|incoming|new previews the first-time guidance (nothing is saved)
        <Suspense fallback={null}>
          <PreviewGuidance />
        </Suspense>
      }
    >
      <PreviewBanner />
      {children}
    </AppShell>
  );
}
