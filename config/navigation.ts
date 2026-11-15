import { CircleUserRound, FilePlus2, LayoutDashboard, type LucideIcon } from "lucide-react";

import { routes } from "@/lib/routes";

export interface NavItem {
  title: string;
  href: string;
  icon: LucideIcon;
  /** Extra path prefixes that also make this item current (e.g. a handover's pages belong to the Dashboard). */
  alsoActiveOn?: readonly string[];
  /** Paths that never make this item current, even when a prefix matches. */
  notActiveOn?: readonly string[];
}

/** Primary workspace destinations (top of the sidebar). */
export const workspaceNav: readonly NavItem[] = [
  // A handover's pages (/handover/[id]/…) are reached from the dashboard, so it stays current there.
  { title: "Dashboard", href: routes.dashboard, icon: LayoutDashboard, alsoActiveOn: ["/handover/"], notActiveOn: [routes.handover.new] },
  { title: "New handover", href: routes.handover.new, icon: FilePlus2 },
];

/** Personal destinations (bottom of the sidebar, above sign-out). */
export const accountNav: readonly NavItem[] = [{ title: "Account", href: routes.account, icon: CircleUserRound }];
