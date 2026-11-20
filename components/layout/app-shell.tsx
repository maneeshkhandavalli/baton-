import type { ReactNode } from "react";

import { GuidanceProvider } from "@/components/onboarding/guidance";

import { AppSidebar } from "./app-sidebar";
import { MobileHeader } from "./mobile-header";

/**
 * Authenticated workspace frame: quiet paper sidebar on desktop (≥ lg), a top bar with a drawer
 * below that, and a scrollable main region. Pages set their own width with <PageContainer>, so
 * dense views (review) can go wide while forms stay narrow.
 *
 * Round 4: first-time guidance (welcome, tour, Help menu) lives in the shell's GuidanceProvider, so a running
 * tour survives navigation; `guidance` streams the signed-in user's state in (nothing shows until it arrives).
 */
export function AppShell({ children, guidance }: { children: ReactNode; guidance?: ReactNode }) {
  return (
    <GuidanceProvider>
      {guidance}
      <div className="flex min-h-dvh">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:rounded-md focus:bg-card focus:px-3 focus:py-2 focus:text-sm focus:font-medium focus:shadow-raised"
        >
          Skip to content
        </a>
        <AppSidebar />
        <div className="flex min-w-0 flex-1 flex-col">
          <MobileHeader />
          <main id="main" tabIndex={-1} className="flex-1 outline-none">
            {children}
          </main>
        </div>
      </div>
    </GuidanceProvider>
  );
}
