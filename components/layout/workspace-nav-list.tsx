import Link from "next/link";
import { LogOut } from "lucide-react";

import { accountNav, workspaceNav, type NavItem } from "@/config/navigation";
import { routes } from "@/lib/routes";
import { cn } from "@/lib/utils";

import { isNavActive } from "./nav-match";

export interface WorkspaceNavListProps {
  /** Current pathname, or null when not yet known (static prerender fallback). */
  pathname: string | null;
  className?: string;
}

/* Pill destinations, as in the landing and Loopsii headers: the current page is the ink pill (the primary action
   colour), others are quiet text that fills on hover. 40px targets everywhere. */
const itemClass =
  "flex h-10 w-full items-center gap-2.5 rounded-full px-3.5 text-sm font-medium whitespace-nowrap transition-colors duration-150 outline-none focus-ring";


function NavLinks({ items, pathname }: { items: readonly NavItem[]; pathname: string | null }) {
  return (
    <ul className="space-y-0.5">
      {items.map((item) => {
        const { title, href, icon: Icon } = item;
        const active = isNavActive(pathname, item);
        return (
          <li key={href}>
            <Link
              href={href}
              aria-current={active ? "page" : undefined}
              className={cn(
                itemClass,
                active
                  ? "bg-sidebar-primary font-semibold text-sidebar-primary-foreground"
                  : "text-sidebar-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground",
              )}
            >
              <Icon aria-hidden="true" className={cn("size-4 shrink-0", active && "text-sidebar-primary-foreground")} />
              {title}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * Presentational workspace navigation (sidebar and mobile drawer): primary destinations on top,
 * account + sign-out pinned to the bottom. Usable from server (fallback) and client components.
 */
export function WorkspaceNavList({ pathname, className }: WorkspaceNavListProps) {
  return (
    <nav aria-label="Workspace" className={cn("flex flex-col gap-6", className)}>
      <NavLinks items={workspaceNav} pathname={pathname} />
      <div className="mt-auto space-y-0.5 border-t border-sidebar-border/70 pt-3">
        <NavLinks items={accountNav} pathname={pathname} />
        {/* POST-only route: a link or prefetch can never sign someone out. */}
        <form action={routes.signOut} method="post">
          <button type="submit" className={cn(itemClass, "text-sidebar-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground")}>
            <LogOut aria-hidden="true" className="size-4 shrink-0" />
            Sign out
          </button>
        </form>
      </div>
    </nav>
  );
}
