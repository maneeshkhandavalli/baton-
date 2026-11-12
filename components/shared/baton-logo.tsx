import { cn } from "@/lib/utils";

const SEGMENTS = [
  "bg-status-sourced",
  "bg-status-inferred",
  "bg-status-conflicting",
  "bg-status-missing",
] as const;

const SIZES = {
  sm: { bar: "h-1 w-5 gap-px", word: "text-[0.6875rem] tracking-[0.22em]", gap: "gap-2" },
  md: { bar: "h-1.5 w-7 gap-[2px]", word: "text-xs tracking-[0.24em]", gap: "gap-2.5" },
  lg: { bar: "h-2 w-10 gap-[3px]", word: "text-sm tracking-[0.26em]", gap: "gap-3" },
} as const;

interface BatonLogoProps {
  size?: keyof typeof SIZES;
  /** `inverse` renders the wordmark on `bg-inverse` surfaces (dark bands). */
  tone?: "default" | "inverse";
  /** Hide the wordmark to render the bar mark alone. */
  showWordmark?: boolean;
  className?: string;
}

/** The baton mark: four segments for sourced, inferred, conflicting and missing. */
export function BatonMark({ size = "md", className }: Pick<BatonLogoProps, "size" | "className">) {
  return (
    <span aria-hidden="true" className={cn("flex shrink-0", SIZES[size].bar, className)}>
      {SEGMENTS.map((segment, i) => (
        <span
          key={segment}
          className={cn(
            "h-full flex-1",
            segment,
            i === 0 && "rounded-l-full",
            i === SEGMENTS.length - 1 && "rounded-r-full",
          )}
        />
      ))}
    </span>
  );
}

export function BatonLogo({
  size = "md",
  tone = "default",
  showWordmark = true,
  className,
}: BatonLogoProps) {
  return (
    <span
      role="img"
      aria-label="Baton"
      className={cn("inline-flex items-center", SIZES[size].gap, className)}
    >
      <BatonMark size={size} />
      {showWordmark && (
        <span
          aria-hidden="true"
          className={cn(
            "font-sans leading-none font-semibold uppercase",
            SIZES[size].word,
            tone === "inverse" ? "text-inverse-foreground" : "text-foreground",
          )}
        >
          Baton
        </span>
      )}
    </span>
  );
}
