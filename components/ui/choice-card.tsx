import type * as React from "react"

import { cn } from "@/lib/utils"

interface ChoiceCardProps extends Omit<React.ComponentProps<"input">, "type" | "title"> {
  type?: "radio" | "checkbox"
  title: React.ReactNode
  description?: React.ReactNode
  /** Optional leading icon element. */
  icon?: React.ReactNode
}

/**
 * A selectable option card wrapping a real radio/checkbox, so keyboard, form and screen-reader
 * behaviour stay native. Use inside <FieldGroup> for 2–4 mutually exclusive, explained choices
 * (who is leaving, access level). For long lists use plain checkboxes.
 */
function ChoiceCard({ type = "radio", title, description, icon, className, disabled, ...props }: ChoiceCardProps) {
  return (
    <label
      data-slot="choice-card"
      className={cn(
        "group/choice relative flex cursor-pointer items-start gap-3 rounded-lg border border-border bg-card p-3.5 text-sm shadow-xs transition-[border-color,box-shadow,background-color] duration-150 hover:border-border-strong has-checked:border-primary/60 has-checked:bg-primary-soft/40 has-checked:ring-3 has-checked:ring-primary/12 has-focus-visible:ring-3 has-focus-visible:ring-ring/35",
        disabled && "cursor-not-allowed opacity-60",
        className
      )}
    >
      <input type={type} disabled={disabled} className="mt-0.5 size-4 shrink-0 accent-primary outline-none" {...props} />
      {icon && (
        <span aria-hidden="true" className="mt-px shrink-0 text-muted-foreground group-has-checked/choice:text-primary [&_svg]:size-4">
          {icon}
        </span>
      )}
      <span className="min-w-0 space-y-0.5">
        <span className="block font-medium text-foreground">{title}</span>
        {description && <span className="block text-caption text-muted-foreground">{description}</span>}
      </span>
    </label>
  )
}

export { ChoiceCard }
