import { routes } from "@/lib/routes";

/** Stage tabs inside one handover (owned by `handover`; moved here from config/navigation.ts, UI3 D8). */
export interface HandoverNavItem {
  title: string;
  href: (id: string) => string;
}

export const handoverNav: readonly HandoverNavItem[] = [
  { title: "Processing", href: routes.handover.processing },
  { title: "Review", href: routes.handover.review },
  { title: "Gaps", href: routes.handover.gaps },
  // R3 Task 06: source-update change reviews (Task 05E) were reachable only from links on other pages
  { title: "Changes", href: routes.handover.changes },
  { title: "Settings", href: routes.handover.settings },
  { title: "Published", href: routes.handover.published },
];
