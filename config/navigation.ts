import { CircleUserRound, FilePlus2, LayoutDashboard, type LucideIcon } from "lucide-react";

import { routes } from "@/lib/routes";

export interface NavItem {
  title: string;
  href: string;
  icon: LucideIcon;
}

export const workspaceNav: readonly NavItem[] = [
  { title: "Dashboard", href: routes.dashboard, icon: LayoutDashboard },
  { title: "New handover", href: routes.handover.new, icon: FilePlus2 },
  { title: "Account", href: routes.account, icon: CircleUserRound },
];

export interface HandoverNavItem {
  title: string;
  href: (id: string) => string;
}

export const handoverNav: readonly HandoverNavItem[] = [
  { title: "Processing", href: routes.handover.processing },
  { title: "Review", href: routes.handover.review },
  { title: "Gaps", href: routes.handover.gaps },
  { title: "Settings", href: routes.handover.settings },
];
