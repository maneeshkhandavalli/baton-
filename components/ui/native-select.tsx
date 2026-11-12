import * as React from "react"
import { ChevronDown } from "lucide-react"
import { cn } from "@/lib/utils"

import { controlClassName } from "@/components/ui/input"

/**
 * A styled native <select>. Native keeps keyboard, screen-reader and mobile pickers right for
 * short option lists (roles, priorities, access levels); use it instead of hand-styled selects.
 */
function NativeSelect({ className, children, ...props }: React.ComponentProps<"select">) {
  return (
    <span data-slot="native-select" className={cn("relative block", className)}>
      <select className={cn(controlClassName, "h-9 appearance-none py-1 pr-9 pl-3")} {...props}>
        {children}
      </select>
      <ChevronDown
        aria-hidden="true"
        className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-muted-foreground"
      />
    </span>
  )
}

export { NativeSelect }
