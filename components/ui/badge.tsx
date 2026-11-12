import type * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"

/**
 * Badges (docs/design/design-system.md → Badges & status).
 * - `shape="pill"` (default) for states: handover state, evidence status, review outcome.
 * - `shape="tag"` for metadata: access level, category, "possibly outdated".
 * Tones map 1:1 to tokens. Evidence tones are only for evidence status.
 */
const badgeVariants = cva(
  "group/badge inline-flex w-fit shrink-0 items-center justify-center gap-1 overflow-hidden border font-medium whitespace-nowrap transition-colors focus-visible:ring-3 focus-visible:ring-ring/40 [&>svg]:pointer-events-none [&>svg]:size-3!",
  {
    variants: {
      tone: {
        neutral: "border-border bg-muted text-muted-foreground",
        outline: "border-border-strong bg-transparent text-muted-foreground",
        primary: "border-primary/20 bg-primary-soft text-primary-fg",
        info: "border-info/20 bg-info-soft text-info-fg",
        success: "border-success/20 bg-success-soft text-success-fg",
        warning: "border-warning/25 bg-warning-soft text-warning-fg",
        danger: "border-destructive/20 bg-destructive-soft text-destructive-fg",
        inverse: "border-inverse bg-inverse text-inverse-foreground",
        sourced: "border-status-sourced/20 bg-status-sourced-soft text-status-sourced-fg",
        inferred: "border-status-inferred/25 bg-status-inferred-soft text-status-inferred-fg",
        conflicting: "border-status-conflicting/20 bg-status-conflicting-soft text-status-conflicting-fg",
        missing: "border-status-missing/20 bg-status-missing-soft text-status-missing-fg",
      },
      size: {
        sm: "h-5 px-1.5 text-2xs",
        md: "h-6 px-2 text-xs",
      },
      shape: {
        pill: "rounded-full",
        tag: "rounded-sm",
      },
    },
    compoundVariants: [
      { shape: "pill", size: "sm", className: "px-2" },
      { shape: "pill", size: "md", className: "px-2.5" },
    ],
    defaultVariants: {
      tone: "neutral",
      size: "md",
      shape: "pill",
    },
  }
)

/** Dot colours for pills that lead with a status dot. */
const badgeDotClass: Record<NonNullable<VariantProps<typeof badgeVariants>["tone"]>, string> = {
  neutral: "bg-status-missing",
  outline: "bg-border-strong",
  primary: "bg-primary",
  info: "bg-info",
  success: "bg-success",
  warning: "bg-warning",
  danger: "bg-destructive",
  inverse: "bg-inverse-foreground",
  sourced: "bg-status-sourced",
  inferred: "bg-status-inferred",
  conflicting: "bg-status-conflicting",
  missing: "bg-status-missing",
}

type BadgeProps = React.ComponentProps<"span"> &
  VariantProps<typeof badgeVariants> & {
    /** Lead with a small status dot in the tone's colour. */
    dot?: boolean
    /** Animate the dot (live states such as "Processing"); static under reduced motion. */
    pulse?: boolean
  }

/** Server-safe (no hooks): usable from server and client components alike. */
function Badge({ className, tone = "neutral", size = "md", shape = "pill", dot = false, pulse = false, children, ...props }: BadgeProps) {
  return (
    <span data-slot="badge" className={cn(badgeVariants({ tone, size, shape }), className)} {...props}>
      {dot && (
        <span aria-hidden="true" className={cn("size-1.5 shrink-0 rounded-full", badgeDotClass[tone ?? "neutral"], pulse && "animate-pulse")} />
      )}
      {children}
    </span>
  )
}

export { Badge, badgeVariants, badgeDotClass }
