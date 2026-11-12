import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * Content widths (docs/design/design-system.md → Layout):
 * - prose   42rem — reading: published handover body, gap interview, sign-in copy
 * - narrow  48rem — forms and single-column flows: wizard, settings, account
 * - default 72rem — dashboard and overview pages
 * - wide    90rem — dense multi-pane tools: review, processing
 * - full    no cap
 */
const WIDTHS = {
  prose: "max-w-[42rem]",
  narrow: "max-w-3xl",
  default: "max-w-6xl",
  wide: "max-w-[90rem]",
  full: "max-w-none",
} as const;

interface PageContainerProps {
  children: ReactNode;
  width?: keyof typeof WIDTHS;
  className?: string;
}

/** Consistent gutters (16 / 24 / 40 / 48px) and vertical rhythm for page content. */
export function PageContainer({ children, width = "default", className }: PageContainerProps) {
  return (
    <div className={cn("mx-auto w-full px-4 py-8 sm:px-6 sm:py-10 lg:px-10 lg:py-12 xl:px-12", WIDTHS[width], className)}>
      {children}
    </div>
  );
}
