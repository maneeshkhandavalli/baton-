import { REVIEW_MEMBER_ROLES, type MemberRole } from "@/lib/contracts/enums";
import { routes } from "@/lib/routes";

/** Stage tabs inside one handover (owned by `handover`; moved here from config/navigation.ts, UI3 D8). */
export interface HandoverNavItem {
  title: string;
  href: (id: string) => string;
  /** Only review roles (outgoing, reviewer) can use this stage; the pages show "for reviewers" to everyone else. */
  reviewOnly: boolean;
}

export const handoverNav: readonly HandoverNavItem[] = [
  { title: "Processing", href: routes.handover.processing, reviewOnly: true },
  { title: "Review", href: routes.handover.review, reviewOnly: true },
  { title: "Gaps", href: routes.handover.gaps, reviewOnly: true },
  // R3 Task 06: source-update change reviews (Task 05E) were reachable only from links on other pages
  { title: "Changes", href: routes.handover.changes, reviewOnly: true },
  { title: "Settings", href: routes.handover.settings, reviewOnly: true },
  { title: "Published", href: routes.handover.published, reviewOnly: false },
];

/**
 * R3 Task 06: the tabs a viewer can actually use. Incoming and lead members read the publication only, so they are
 * not offered stages that would just say "this is for reviewers". An unknown role (still loading) sees every tab, as
 * before; access itself is always enforced by the pages and the database, never by this list.
 */
export function visibleHandoverNav(role: MemberRole | null | undefined): readonly HandoverNavItem[] {
  if (!role || (REVIEW_MEMBER_ROLES as readonly string[]).includes(role)) return handoverNav;
  return handoverNav.filter((item) => !item.reviewOnly);
}
