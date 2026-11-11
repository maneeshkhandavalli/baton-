import { Suspense } from "react";

import { WorkspaceNav } from "./workspace-nav";
import { WorkspaceNavList, type WorkspaceNavListProps } from "./workspace-nav-list";

/** Suspense-safe workspace nav: a static list prerenders, the active state fills in on request. */
export function WorkspaceNavigation(props: Omit<WorkspaceNavListProps, "pathname">) {
  return (
    <Suspense fallback={<WorkspaceNavList {...props} pathname={null} />}>
      <WorkspaceNav {...props} />
    </Suspense>
  );
}
