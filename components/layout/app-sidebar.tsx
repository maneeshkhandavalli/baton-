import Link from "next/link";

import { BatonLogo } from "@/components/shared/baton-logo";
import { routes } from "@/lib/routes";

import { WorkspaceNavigation } from "./workspace-navigation";

/**
 * Desktop sidebar (≥ lg). Paper-toned and quiet so the page content carries the hierarchy:
 * logo, primary destinations, then account + sign-out pinned to the bottom.
 */
export function AppSidebar() {
  return (
    <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground lg:flex">
      <div className="flex h-16 shrink-0 items-center px-5">
        <Link href={routes.dashboard} aria-label="Baton dashboard" className="rounded-md outline-none focus-visible:ring-3 focus-visible:ring-sidebar-ring/40">
          <BatonLogo />
        </Link>
      </div>
      <WorkspaceNavigation className="flex-1 px-3 pt-2 pb-4" />
    </aside>
  );
}
