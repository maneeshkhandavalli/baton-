import type { ReactNode } from "react";
import { LockKeyhole } from "lucide-react";

import { BatonLogo } from "@/components/shared/baton-logo";
import { ThemeToggle } from "@/components/shared/theme-toggle";

/**
 * Minimal frame for token-based pages (/g/[token], /h/[token]) opened by people without a Baton
 * account. No workspace navigation; the header says plainly that this is a private link, and offers
 * the theme switch.
 */
export function SharedLinkShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:rounded-md focus:bg-card focus:px-3 focus:py-2 focus:text-sm focus:font-medium focus:shadow-raised"
      >
        Skip to content
      </a>
      <header className="border-b border-border/70 bg-background">
        <div className="mx-auto flex h-14 w-full max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
          <BatonLogo size="sm" />
          <div className="flex min-w-0 items-center gap-2">
            <p className="flex min-w-0 items-center gap-1.5 rounded-full border border-border bg-muted/50 px-2.5 py-1 text-caption text-muted-foreground">
              <LockKeyhole aria-hidden="true" className="size-3.5 shrink-0" />
              <span className="truncate">
                Private link<span className="max-sm:hidden"> shared with you</span>
              </span>
            </p>
            <ThemeToggle size="icon-sm" />
          </div>
        </div>
      </header>
      <main id="main" tabIndex={-1} className="flex-1 outline-none">
        {children}
      </main>
    </div>
  );
}
