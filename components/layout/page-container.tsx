import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

const WIDTHS = {
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

/** Consistent horizontal gutters and vertical rhythm for page content. */
export function PageContainer({ children, width = "default", className }: PageContainerProps) {
  return (
    <div
      className={cn(
        "mx-auto w-full px-4 py-8 sm:px-6 lg:px-10 lg:py-10",
        WIDTHS[width],
        className,
      )}
    >
      {children}
    </div>
  );
}
