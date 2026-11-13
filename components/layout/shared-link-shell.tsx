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
      <header className="border-b border-border/70 bg-background">
        <div className="mx-auto flex h-14 w-full max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
          <BatonLogo size="sm" />
          <div className="flex items-center gap-2">
            <p className="flex items-center gap-1.5 text-caption text-muted-foreground">
              <LockKeyhole aria-hidden="true" className="size-3.5" />
              Private link shared with you
            </p>
            <ThemeToggle size="icon-sm" />
          </div>
        </div>
      </header>
      <main id="main" className="flex-1">
        {children}
      </main>
    </div>
  );
}
