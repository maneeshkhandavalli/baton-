import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * Content widths (docs/design/design-system.md → Layout):
 * - prose   42rem — reading: gap interview, token pages
 * - narrow  48rem — single-column forms: account, password
 * - default 90rem — the workspace frame: dashboard, handover tabs (the same edges as the handover header)
 * - wide    90rem — dense multi-pane tools: review, processing (kept as an alias of default)
 * - full    no cap
 *
 * UI polish (2026-11-20): inside the workspace every page shares one frame (90rem, the same gutters as the
 * handover header and tabs), so titles, tabs and content start on the same left edge. A narrower measure is
 * applied to the content inside that frame and stays left-aligned (`align="start"`, the default); pages that
 * stand alone (token links, sign-in) centre it instead (`align="center"`).
 */
const WIDTHS = {
  prose: "max-w-[42rem]",
  narrow: "max-w-3xl",
  medium: "max-w-5xl",
  default: "max-w-[90rem]",
  wide: "max-w-[90rem]",
  full: "max-w-none",
} as const;

/** The workspace frame: the handover header uses the same classes, so edges line up. */
export const FRAME_CLASS = "mx-auto w-full max-w-[90rem] px-4 sm:px-6 lg:px-10 xl:px-12";

interface PageContainerProps {
  children: ReactNode;
  width?: keyof typeof WIDTHS;
  /** Where a capped measure sits: on the frame's left edge (workspace) or centred (standalone pages). */
  align?: "start" | "center";
  className?: string;
  /** Classes for the outer frame of a start-aligned capped page (e.g. `pb-0` when a sticky footer ends the page). */
  frameClassName?: string;
}

/** Consistent gutters (16 / 24 / 40 / 48px) and vertical rhythm for page content. */
export function PageContainer({ children, width = "default", align = "start", className, frameClassName }: PageContainerProps) {
  const vertical = "py-8 sm:py-10 lg:py-12";
  if (align === "center" || width === "default" || width === "wide" || width === "full") {
    return <div className={cn("mx-auto w-full px-4 sm:px-6 lg:px-10 xl:px-12", vertical, WIDTHS[width], frameClassName, className)}>{children}</div>;
  }
  return (
    <div className={cn(FRAME_CLASS, vertical, frameClassName)}>
      <div className={cn("w-full", WIDTHS[width], className)}>{children}</div>
    </div>
  );
}
