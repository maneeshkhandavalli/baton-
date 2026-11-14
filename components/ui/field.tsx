import type * as React from "react"

import { Label } from "@/components/ui/label"
import { cn } from "@/lib/utils"

/** Ids a control should reference with `aria-describedby`. */
export function fieldDescribedBy(id: string, { hint, error }: { hint?: unknown; error?: unknown }): string | undefined {
  const ids = [error ? `${id}-error` : null, hint ? `${id}-hint` : null].filter(Boolean)
  return ids.length ? ids.join(" ") : undefined
}

interface FieldProps {
  /** The control's id; the label points at it and hint/error ids derive from it. */
  id: string
  label: React.ReactNode
  /** Shown after the label in muted text, e.g. "Optional". */
  optional?: boolean
  hint?: React.ReactNode
  error?: React.ReactNode
  className?: string
  children: React.ReactNode
}

/**
 * Label + control + hint/error, stacked (docs/design/design-system.md → Forms).
 * The control must set `id={id}`, `aria-invalid={!!error}` and
 * `aria-describedby={fieldDescribedBy(id, { hint, error })}`.
 * The hint stays visible when there is an error, so the user keeps the instruction.
 */
function Field({ id, label, optional, hint, error, className, children }: FieldProps) {
  return (
    <div data-slot="field" data-invalid={error ? "true" : undefined} className={cn("space-y-2", className)}>
      <Label htmlFor={id}>
        {label}
        {optional && <span className="font-normal text-muted-foreground">Optional</span>}
      </Label>
      {children}
      {hint && (
        <p id={`${id}-hint`} className="text-caption text-muted-foreground">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} className="text-caption font-medium text-destructive-fg">
          {error}
        </p>
      )}
    </div>
  )
}

/** A titled group of fields (radio groups, related inputs). Renders a real fieldset + legend. */
function FieldGroup({
  legend,
  description,
  error,
  className,
  children,
  ...props
}: Omit<React.ComponentProps<"fieldset">, "children"> & { legend: React.ReactNode; description?: React.ReactNode; error?: React.ReactNode; children: React.ReactNode }) {
  return (
    <fieldset className={cn("min-w-0 space-y-3", className)} {...props}>
      <legend className="mb-1 text-sm font-medium text-foreground">{legend}</legend>
      {description && <p className="-mt-1 text-caption text-muted-foreground">{description}</p>}
      {children}
      {error && <p className="text-caption font-medium text-destructive-fg">{error}</p>}
    </fieldset>
  )
}

export { Field, FieldGroup }
