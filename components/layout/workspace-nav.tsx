"use client";

import { usePathname } from "next/navigation";

import { WorkspaceNavList, type WorkspaceNavListProps } from "./workspace-nav-list";

/**
 * Workspace navigation with active-route highlighting.
 *
 * `usePathname` suspends while prerendering routes with unknown dynamic
 * params (Cache Components), so always render this inside <Suspense> with a
 * <WorkspaceNavList pathname={null} /> fallback — see <WorkspaceNavigation>.
 */
export function WorkspaceNav(props: Omit<WorkspaceNavListProps, "pathname">) {
  const pathname = usePathname();
  return <WorkspaceNavList {...props} pathname={pathname} />;
}
