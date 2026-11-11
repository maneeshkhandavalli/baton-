import type { ReactNode } from "react";

import { BatonLogo } from "@/components/shared/baton-logo";

/**
 * Minimal frame for token-based pages (/g/[token], /h/[token]) opened by
 * people without a Baton account. No workspace navigation is exposed.
 */
export function SharedLinkShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="border-b border-border/70 bg-background">
        <div className="mx-auto flex h-14 w-full max-w-4xl items-center justify-between px-4 sm:px-6">
          <BatonLogo size="sm" />
          <p className="text-xs text-muted-foreground">Shared with you via Baton</p>
        </div>
      </header>
      <main id="main" className="flex-1">
        {children}
      </main>
    </div>
  );
}
