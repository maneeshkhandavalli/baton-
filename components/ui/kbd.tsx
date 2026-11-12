import type * as React from "react"

import { cn } from "@/lib/utils"

/** A keyboard key. Hidden on touch-first layouts by the caller (`hidden sm:inline-flex`). */
function Kbd({ className, ...props }: React.ComponentProps<"kbd">) {
  return (
    <kbd
      data-slot="kbd"
      className={cn(
        "inline-flex h-5 min-w-5 items-center justify-center rounded-sm border border-border-strong bg-card px-1 font-mono text-2xs font-medium text-muted-foreground shadow-xs",
        className
      )}
      {...props}
    />
  )
}

export { Kbd }
