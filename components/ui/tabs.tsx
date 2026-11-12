"use client"

import { Tabs as TabsPrimitive } from "@base-ui/react/tabs"
import { createContext, useContext } from "react"

import { cn } from "@/lib/utils"

/**
 * Tabs switch between views of the SAME object without navigating (e.g. the demo's
 * "Review" / "What the incoming member sees"). For moving between pages of a handover use
 * <HandoverNav> (links), which shares the `underline` look.
 *
 * - `underline` — page-level views; hairline under the list, 2px active bar.
 * - `segmented` — compact switches inside a section (filters, small view toggles).
 */
type TabsVariant = "underline" | "segmented"
const VariantContext = createContext<TabsVariant>("underline")

function Tabs({ className, variant = "underline", ...props }: TabsPrimitive.Root.Props & { variant?: TabsVariant }) {
  return (
    <VariantContext.Provider value={variant}>
      <TabsPrimitive.Root data-slot="tabs" className={cn("flex flex-col gap-6", variant === "segmented" && "gap-4", className)} {...props} />
    </VariantContext.Provider>
  )
}

function TabsList({ className, ...props }: TabsPrimitive.List.Props) {
  const variant = useContext(VariantContext)
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      className={cn(
        "relative flex max-w-full items-center overflow-x-auto [scrollbar-width:none]",
        variant === "underline" && "gap-6 border-b border-border",
        variant === "segmented" && "w-fit gap-1 rounded-lg border border-border bg-muted p-1",
        className
      )}
      {...props}
    />
  )
}

function TabsTab({ className, ...props }: TabsPrimitive.Tab.Props) {
  const variant = useContext(VariantContext)
  return (
    <TabsPrimitive.Tab
      data-slot="tabs-tab"
      className={cn(
        "inline-flex shrink-0 items-center gap-2 text-sm font-medium whitespace-nowrap text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/40 disabled:pointer-events-none disabled:opacity-50 data-active:text-foreground [&_svg]:size-4 [&_svg]:shrink-0",
        variant === "underline" && "-mb-px h-11 border-b-2 border-transparent rounded-none focus-visible:rounded-sm data-active:border-primary",
        variant === "segmented" && "h-8 rounded-md px-3 max-sm:h-10 data-active:bg-card data-active:shadow-xs",
        className
      )}
      {...props}
    />
  )
}

function TabsPanel({ className, ...props }: TabsPrimitive.Panel.Props) {
  return <TabsPrimitive.Panel data-slot="tabs-panel" className={cn("min-w-0 outline-none", className)} {...props} />
}

export { Tabs, TabsList, TabsPanel, TabsTab }
