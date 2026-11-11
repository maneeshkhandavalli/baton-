import { cn } from "@/lib/utils";

interface ReadinessRingProps {
  value: number;
  size?: number;
  strokeWidth?: number;
  label?: string;
  className?: string;
}

/** Circular readiness percentage. Informational only; readiness never gates on the score. */
export function ReadinessRing({ value, size = 56, strokeWidth = 5, label = "Readiness", className }: ReadinessRingProps) {
  const pct = Math.max(0, Math.min(100, Math.round(value)));
  const r = (size - strokeWidth) / 2;
  const c = 2 * Math.PI * r;
  return (
    <div
      role="img"
      aria-label={`${label}: ${pct}%`}
      className={cn("relative inline-flex shrink-0 items-center justify-center", className)}
      style={{ width: size, height: size }}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90" aria-hidden="true">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={strokeWidth} className="stroke-muted" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - pct / 100)}
          className={cn(
            "transition-[stroke-dashoffset] duration-700 ease-out motion-reduce:transition-none",
            pct === 100 ? "stroke-status-sourced" : "stroke-primary",
          )}
        />
      </svg>
      <span aria-hidden="true" className="absolute font-mono text-xs font-medium tabular-nums">
        {pct}%
      </span>
    </div>
  );
}
