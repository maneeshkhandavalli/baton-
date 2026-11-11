import { statusConfig } from "@/config/status";
import { cn } from "@/lib/utils";
import type { EvidenceStatus } from "@/types/status";

interface StatusBadgeProps {
  status: EvidenceStatus;
  /** Override the default label, e.g. with a count ("3 missing"). */
  label?: string;
  size?: "sm" | "md";
  className?: string;
}

export function StatusBadge({ status, label, size = "md", className }: StatusBadgeProps) {
  const meta = statusConfig[status];

  return (
    <span
      title={meta.description}
      className={cn(
        "inline-flex w-fit shrink-0 items-center gap-1.5 rounded-full border font-medium whitespace-nowrap",
        size === "sm" ? "h-5 px-2 text-[0.6875rem]" : "h-6 px-2.5 text-xs",
        meta.className.badge,
        className,
      )}
    >
      <span aria-hidden="true" className={cn("size-1.5 rounded-full", meta.className.dot)} />
      {label ?? meta.label}
    </span>
  );
}
