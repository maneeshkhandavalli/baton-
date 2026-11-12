"use client"

import { Toaster as Sonner, type ToasterProps } from "sonner"
import { CircleCheckIcon, InfoIcon, TriangleAlertIcon, OctagonXIcon, Loader2Icon } from "lucide-react"

/**
 * Toasts confirm the result of an action the user just took ("Point approved", "Draft
 * discarded"). They are never the only place an error or a persistent state is shown:
 * inline messages carry anything the user must act on (docs/design/design-system.md → Toasts).
 *
 * Baton ships light by default; pass `theme` when dark mode is turned on.
 */
const Toaster = ({ theme = "light", ...props }: ToasterProps) => {
  return (
    <Sonner
      theme={theme}
      className="toaster group"
      icons={{
        success: <CircleCheckIcon className="size-4 text-success" />,
        info: <InfoIcon className="size-4 text-info" />,
        warning: <TriangleAlertIcon className="size-4 text-warning" />,
        error: <OctagonXIcon className="size-4 text-destructive" />,
        loading: <Loader2Icon className="size-4 animate-spin text-muted-foreground" />,
      }}
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
          "--border-radius": "calc(var(--radius) * 1.2)",
          "--width": "min(24rem, calc(100vw - 2rem))",
        } as React.CSSProperties
      }
      toastOptions={{
        classNames: {
          toast: "cn-toast !shadow-raised !gap-2.5 !text-sm",
          title: "!font-medium",
          description: "!text-muted-foreground",
        },
      }}
      {...props}
    />
  )
}

export { Toaster }
