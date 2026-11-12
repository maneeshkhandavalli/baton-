import { statusConfig } from "@/config/status";
import { Badge } from "@/components/ui/badge";
import type { EvidenceStatus } from "@/types/status";

interface StatusBadgeProps {
  status: EvidenceStatus;
  /** Override the default label, e.g. with a count ("3 missing"). */
  label?: string;
  size?: "sm" | "md";
  className?: string;
}

/** Evidence status pill (sourced / inferred / conflicting / missing). Only for evidence. */
export function StatusBadge({ status, label, size = "md", className }: StatusBadgeProps) {
  const meta = statusConfig[status];
  return (
    <Badge tone={status} size={size} dot title={meta.description} className={className}>
      {label ?? meta.label}
    </Badge>
  );
}
