import type * as React from "react"

import { cn } from "@/lib/utils"

/**
 * Data tables for genuinely tabular data (members, access links, masking counts). Lists of
 * objects with actions (sources, gap questions) use <ul> rows, not tables. Below `sm`, give
 * tables a stacked alternative or keep them to ≤3 columns; the wrapper scrolls horizontally as a
 * last resort only.
 */
/**
 * `stacked` (default true): below `sm` every row becomes a stacked block and the header is visually
 * hidden; give each cell a `label` so the column name is shown inline on phones.
 */
function Table({ className, stacked = true, ...props }: React.ComponentProps<"table"> & { stacked?: boolean }) {
  return (
    <div data-slot="table-container" className="relative w-full overflow-x-auto">
      <table
        data-slot="table"
        data-stacked={stacked ? "true" : undefined}
        className={cn(
          "group/table w-full caption-bottom text-sm",
          stacked &&
            "max-sm:block max-sm:[&_tbody]:block max-sm:[&_thead]:sr-only max-sm:[&_tr]:flex max-sm:[&_tr]:flex-col max-sm:[&_tr]:gap-1 max-sm:[&_tr]:py-3 max-sm:[&_td]:p-0",
          className
        )}
        {...props}
      />
    </div>
  )
}

function TableHeader({ className, ...props }: React.ComponentProps<"thead">) {
  return <thead data-slot="table-header" className={cn("[&_tr]:border-b", className)} {...props} />
}

function TableBody({ className, ...props }: React.ComponentProps<"tbody">) {
  return <tbody data-slot="table-body" className={cn("[&_tr:last-child]:border-0", className)} {...props} />
}

function TableRow({ className, ...props }: React.ComponentProps<"tr">) {
  return <tr data-slot="table-row" className={cn("border-b border-border transition-colors hover:bg-muted/40", className)} {...props} />
}

function TableHead({ className, ...props }: React.ComponentProps<"th">) {
  return (
    <th
      data-slot="table-head"
      className={cn("h-9 px-3 text-left align-middle type-eyebrow whitespace-nowrap text-muted-foreground first:pl-0 last:pr-0", className)}
      {...props}
    />
  )
}

function TableCell({ className, label, children, ...props }: React.ComponentProps<"td"> & { label?: React.ReactNode }) {
  return (
    <td data-slot="table-cell" className={cn("px-3 py-3 align-middle first:pl-0 last:pr-0", className)} {...props}>
      {label && <span className="mr-2 hidden type-eyebrow text-muted-foreground group-data-[stacked=true]/table:max-sm:inline">{label}</span>}
      {children}
    </td>
  )
}

function TableCaption({ className, ...props }: React.ComponentProps<"caption">) {
  return <caption data-slot="table-caption" className={cn("mt-3 text-caption text-muted-foreground", className)} {...props} />
}

export { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow }
