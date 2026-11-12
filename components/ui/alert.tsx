import type * as React from "react"
import { CircleAlert, CircleCheck, Info, TriangleAlert } from "lucide-react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

/**
 * Inline notice inside the flow of a page or form (docs/design/design-system.md → Feedback).
 * Use for anything the user must read or act on; toasts are only confirmations.
 * - neutral — context ("Demo mode: review actions are off")
 * - info — guidance before an action
 * - success — a saved / completed state that persists on the page
 * - warning — reversible risk, needs attention before continuing
 * - danger — failure or irreversible consequence
 */
const alertVariants = cva("relative flex gap-3 rounded-lg border px-4 py-3 text-sm", {
  variants: {
    tone: {
      neutral: "border-border bg-muted/60 text-foreground [&>svg]:text-muted-foreground",
      info: "border-info/20 bg-info-soft text-info-fg",
      success: "border-success/20 bg-success-soft text-success-fg",
      warning: "border-warning/25 bg-warning-soft text-warning-fg",
      danger: "border-destructive/25 bg-destructive-soft text-destructive-fg",
    },
  },
  defaultVariants: { tone: "neutral" },
})

const ICONS = { neutral: Info, info: Info, success: CircleCheck, warning: TriangleAlert, danger: CircleAlert } as const

interface AlertProps extends Omit<React.ComponentProps<"div">, "title">, VariantProps<typeof alertVariants> {
  title?: React.ReactNode
  /** Override the tone's icon, or pass `null` for none. */
  icon?: React.ReactNode | null
  /** Trailing action(s), e.g. a Retry button. Wraps under the text on narrow screens. */
  action?: React.ReactNode
  /**
   * Live-region role. Default: `alert` for danger (announced immediately), `status` otherwise.
   * Pass `none` for static notices rendered with the page.
   */
  live?: "alert" | "status" | "none"
}

function Alert({ className, tone = "neutral", title, icon, action, live, children, ...props }: AlertProps) {
  const Icon = ICONS[tone ?? "neutral"]
  const resolved = live ?? (tone === "danger" ? "alert" : "status")
  const role = resolved === "none" ? undefined : resolved
  return (
    <div data-slot="alert" role={role} className={cn(alertVariants({ tone }), className)} {...props}>
      {icon === undefined ? <Icon aria-hidden="true" className="mt-0.5 size-4 shrink-0" /> : icon}
      <div className="flex min-w-0 flex-1 flex-col gap-3 sm:flex-row sm:items-start">
        <div className="min-w-0 flex-1 space-y-1">
          {title && <p className="font-medium leading-snug">{title}</p>}
          {children && <div className={cn("leading-relaxed", title && "opacity-90")}>{children}</div>}
        </div>
        {action && <div className="flex shrink-0 flex-wrap items-center gap-2">{action}</div>}
      </div>
    </div>
  )
}

export { Alert, alertVariants }
