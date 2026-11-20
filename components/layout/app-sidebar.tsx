import Link from "next/link";

import { BatonLogo } from "@/components/shared/baton-logo";
import { HelpMenu } from "@/components/onboarding/help-menu";
import { ThemeToggle } from "@/components/shared/theme-toggle";
import { routes } from "@/lib/routes";

import { WorkspaceNavigation } from "./workspace-navigation";

/**
 * Desktop sidebar (≥ lg). The landing's header pill turned on its side: a floating hairline panel on the same
 * paper, round-cornered, with the four-colour Baton mark, pill-shaped destinations, then account + sign-out pinned
 * to the bottom. Quiet, so the page content carries the hierarchy.
 */
export function AppSidebar() {
  return (
    <aside className="sticky top-0 hidden h-dvh w-64 shrink-0 p-3 pr-0 lg:flex">
      <div className="flex min-h-0 flex-1 flex-col rounded-[1.75rem] border border-sidebar-border bg-sidebar text-sidebar-foreground">
        <div className="flex h-16 shrink-0 items-center justify-between gap-2 pr-2 pl-5">
          <Link href={routes.dashboard} aria-label="Baton dashboard" className="rounded-md outline-none focus-ring">
            <BatonLogo />
          </Link>
          <div className="flex items-center gap-0.5">
            <HelpMenu className="text-sidebar-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground" />
            <ThemeToggle
              size="icon-sm"
              className="text-sidebar-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
            />
          </div>
        </div>
        <WorkspaceNavigation className="flex-1 px-2.5 pt-3 pb-2.5" />
      </div>
    </aside>
  );
}
