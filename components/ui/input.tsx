import * as React from "react"
import { Input as InputPrimitive } from "@base-ui/react/input"
import { cn } from "@/lib/utils"

/**
 * Shared look for text-like controls: Input, Textarea and NativeSelect use these classes so
 * every field has the same border, focus ring and invalid state.
 * Text is 16px below `md` so iOS never zooms on focus.
 */
export const controlClassName =
  "w-full min-w-0 rounded-md border border-input bg-card text-base text-foreground shadow-xs transition-[border-color,box-shadow] duration-150 outline-none placeholder:text-muted-foreground/75 hover:border-foreground/45 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/20 disabled:cursor-not-allowed disabled:bg-muted disabled:opacity-60 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/15 md:text-sm"

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <InputPrimitive
      type={type}
      data-slot="input"
      className={cn(
        controlClassName,
        "h-9 px-3 py-1 file:inline-flex file:h-6 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground",
        className
      )}
      {...props}
    />
  )
}

export { Input }
