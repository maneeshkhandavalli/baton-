import Link from "next/link";

import { workspaceNav } from "@/config/navigation";
import { cn } from "@/lib/utils";

export interface WorkspaceNavListProps {
  orientation?: "vertical" | "horizontal";
  /** Current pathname, or null when not yet known (static prerender fallback). */
  pathname: string | null;
  className?: string;
}

/** Presentational nav list; usable from server (as a fallback) and client components. */
export function WorkspaceNavList({
  orientation = "vertical",
  pathname,
  className,
}: WorkspaceNavListProps) {
  const isVertical = orientation === "vertical";

  return (
    <nav aria-label="Workspace" className={className}>
      <ul className={cn("flex gap-1", isVertical ? "flex-col" : "flex-row")}>
        {workspaceNav.map(({ title, href, icon: Icon }) => {
          const active = pathname !== null && (pathname === href || pathname.startsWith(`${href}/`));

          return (
            <li key={href}>
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium whitespace-nowrap transition-colors outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring",
                  active
                    ? "bg-sidebar-accent text-sidebar-accent-foreground"
                    : "text-sidebar-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground",
                )}
              >
                <Icon aria-hidden="true" className="size-4 shrink-0" />
                {title}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
