import { Loader2 } from "lucide-react";

import { cn } from "@/lib/utils";

interface LoadingStateProps {
  label?: string;
  description?: string;
  /** `inline` for compact use inside cards; `block` fills its container. */
  variant?: "inline" | "block";
  className?: string;
}

export function LoadingState({
  label = "Loading…",
  description,
  variant = "block",
  className,
}: LoadingStateProps) {
  const isBlock = variant === "block";

  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        "flex items-center text-muted-foreground",
        isBlock ? "min-h-48 flex-col justify-center gap-3 px-6 py-12 text-center" : "gap-2 text-sm",
        className,
      )}
    >
      <Loader2
        aria-hidden="true"
        className={cn("animate-spin text-primary", isBlock ? "size-5" : "size-4")}
      />
      <div className="space-y-1">
        <p className={cn(isBlock && "text-sm font-medium text-foreground")}>{label}</p>
        {description && isBlock && <p className="text-sm">{description}</p>}
      </div>
    </div>
  );
}
