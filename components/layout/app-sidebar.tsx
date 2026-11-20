import Link from "next/link";

import { BatonLogo } from "@/components/shared/baton-logo";
import { HelpMenu } from "@/components/onboarding/help-menu";
import { ThemeToggle } from "@/components/shared/theme-toggle";
import { routes } from "@/lib/routes";

import { WorkspaceNavigation } from "./workspace-navigation";

/**
 * Desktop sidebar (≥ lg). App redesign 2026-11-20: a flush rail on the paper, as in Loopsii's app, separated from
 * the page by one hairline. Logo on top, ink-pill destinations (the landing's primary pill), account and sign-out
 * pinned to the bottom, help and theme in a quiet footer row. Quiet, so the page content carries the hierarchy.
 */
export function AppSidebar() {
  return (
    <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col border-r border-sidebar-border/70 bg-sidebar text-sidebar-foreground lg:flex">
      <div className="flex h-[4.5rem] shrink-0 items-center px-6">
        <Link href={routes.dashboard} aria-label="Baton dashboard" className="rounded-md outline-none focus-ring">
          <BatonLogo />
        </Link>
      </div>
      <WorkspaceNavigation className="min-h-0 flex-1 px-3 pt-2 pb-2" />
      <div className="flex shrink-0 items-center gap-1 border-t border-sidebar-border/70 px-3 py-2.5">
        <HelpMenu className="text-sidebar-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground" />
        <ThemeToggle
          size="icon-sm"
          className="ml-auto text-sidebar-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
        />
      </div>
    </aside>
  );
}
