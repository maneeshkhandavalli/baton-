import Link from "next/link";

import { BatonLogo } from "@/components/shared/baton-logo";
import { routes } from "@/lib/routes";

import { WorkspaceNavigation } from "./workspace-navigation";

/** Compact workspace header for small screens; replaces the sidebar below `lg`. */
export function MobileHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-sidebar-border bg-sidebar text-sidebar-foreground lg:hidden">
      <div className="flex h-14 items-center gap-4 overflow-x-auto px-4">
        <Link
          href={routes.dashboard}
          className="shrink-0 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring"
        >
          <BatonLogo tone="inverse" size="sm" />
        </Link>
        <WorkspaceNavigation orientation="horizontal" className="ml-auto" />
      </div>
    </header>
  );
}
