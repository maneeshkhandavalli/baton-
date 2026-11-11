import type { ReactNode } from "react";

import { AppSidebar } from "./app-sidebar";
import { MobileHeader } from "./mobile-header";

/**
 * Authenticated workspace frame: dark sidebar on desktop, compact header on
 * mobile, and a scrollable main region. Page content controls its own width
 * via <PageContainer>, so dense views (e.g. review) can go full-width.
 */
export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:rounded-lg focus:bg-card focus:px-3 focus:py-2 focus:text-sm focus:shadow-raised"
      >
        Skip to content
      </a>
      <AppSidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <MobileHeader />
        <main id="main" className="flex-1">
          {children}
        </main>
      </div>
    </div>
  );
}
