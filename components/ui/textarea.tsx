import * as React from "react"
import { cn } from "@/lib/utils"

import { controlClassName } from "@/components/ui/input"

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(controlClassName, "flex field-sizing-content min-h-24 px-3 py-2 leading-relaxed", className)}
      {...props}
    />
  )
}

export { Textarea }
