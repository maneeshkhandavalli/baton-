import Link from "next/link";
import { LogOut } from "lucide-react";

import { accountNav, SIGN_OUT_PATH, workspaceNav, type NavItem } from "@/config/navigation";
import { cn } from "@/lib/utils";

export interface WorkspaceNavListProps {
  /** Current pathname, or null when not yet known (static prerender fallback). */
  pathname: string | null;
  className?: string;
}

const itemClass =
  "flex h-9 w-full items-center gap-2.5 rounded-md px-2.5 text-sm font-medium whitespace-nowrap transition-colors outline-none focus-visible:ring-3 focus-visible:ring-sidebar-ring/40";

function isActive(pathname: string | null, href: string) {
  return pathname !== null && (pathname === href || pathname.startsWith(`${href}/`));
}

function NavLinks({ items, pathname }: { items: readonly NavItem[]; pathname: string | null }) {
  return (
    <ul className="space-y-0.5">
      {items.map(({ title, href, icon: Icon }) => {
        const active = isActive(pathname, href);
        return (
          <li key={href}>
            <Link
              href={href}
              aria-current={active ? "page" : undefined}
              className={cn(
                itemClass,
                active
                  ? "bg-card text-sidebar-accent-foreground shadow-xs ring-1 ring-sidebar-border"
                  : "text-sidebar-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground",
              )}
            >
              <Icon aria-hidden="true" className={cn("size-4 shrink-0", active && "text-sidebar-primary")} />
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
      <div className="mt-auto space-y-0.5 border-t border-sidebar-border pt-3">
        <NavLinks items={accountNav} pathname={pathname} />
        <form action={SIGN_OUT_PATH} method="post">
          <button type="submit" className={cn(itemClass, "text-sidebar-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground")}>
            <LogOut aria-hidden="true" className="size-4 shrink-0" />
            Sign out
          </button>
        </form>
      </div>
    </nav>
  );
}
