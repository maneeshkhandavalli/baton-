import Link from "next/link";

import { BatonLogo } from "@/components/shared/baton-logo";
import { siteConfig } from "@/config/site";
import { routes } from "@/lib/routes";

import { WorkspaceNavigation } from "./workspace-navigation";

/** Fixed dark sidebar for the workspace on large screens. */
export function AppSidebar() {
  return (
    <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground lg:flex">
      <div className="flex h-16 items-center px-5">
        <Link
          href={routes.dashboard}
          className="rounded-md outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring"
        >
          <BatonLogo tone="inverse" />
        </Link>
      </div>
      <WorkspaceNavigation className="flex-1 px-3 py-2" />
      <div className="border-t border-sidebar-border px-5 py-4">
        <p className="text-xs leading-relaxed text-sidebar-muted-foreground">{siteConfig.tagline}</p>
      </div>
    </aside>
  );
}
