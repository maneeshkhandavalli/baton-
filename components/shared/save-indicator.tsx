"use client";

import { AlertCircle, Check, Loader2, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { describeSave, type SaveIcon, type SaveState, type SaveTone } from "./save-state";

const TONE: Record<SaveTone, string> = {
  muted: "text-muted-foreground",
  progress: "text-muted-foreground",
  success: "text-muted-foreground",
  warning: "text-warning-fg",
  danger: "text-destructive-fg",
};

function Icon({ icon }: { icon: SaveIcon }) {
  switch (icon) {
    case "spinner":
      return <Loader2 aria-hidden="true" className="size-3.5 shrink-0 animate-spin" />;
    case "check":
      return <Check aria-hidden="true" className="size-3.5 shrink-0 text-success" />;
    case "alert":
      return <AlertCircle aria-hidden="true" className="size-3.5 shrink-0" />;
    case "refresh":
      return <RefreshCw aria-hidden="true" className="size-3.5 shrink-0" />;
    case "dot":
      return <span aria-hidden="true" className="mx-1 size-1.5 shrink-0 rounded-full bg-border-strong" />;
  }
}

interface SaveIndicatorProps {
  state: SaveState;
  onRetry?: () => void;
  /** `inline` — one line in a toolbar. `stacked` — label with the detail underneath. */
  layout?: "inline" | "stacked";
  className?: string;
}

/**
 * The always-visible autosave line ("Draft saved · just now"). It re-renders every 30s so the
 * relative time stays honest. Errors and conflicts use role="alert"; everything else is a
 * polite status so screen readers aren't chatty while typing.
 */
export function SaveIndicator({ state, onRetry, layout = "inline", className }: SaveIndicatorProps) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    if (state.kind !== "saved") return;
    const t = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(t);
  }, [state.kind]);

  const d = describeSave(state, state.kind === "saved" ? now : new Date());
  return (
    <div
      role={d.urgent ? "alert" : "status"}
      aria-live={d.urgent ? "assertive" : "polite"}
      className={cn("flex min-w-0 items-center gap-1.5 text-caption", TONE[d.tone], className)}
    >
      <Icon icon={d.icon} />
      <p className={cn("min-w-0", layout === "inline" ? "truncate" : "")}>
        <span className="font-medium">{d.label}</span>
        {/* Relative time differs between server render and hydration by design. */}
        {d.detail &&
          (layout === "inline" ? (
            <span suppressHydrationWarning className="text-muted-foreground">
              {" · "}
              {d.detail}
            </span>
          ) : (
            <span suppressHydrationWarning className="block text-muted-foreground">
              {d.detail}
            </span>
          ))}
      </p>
      {d.retry && onRetry && (
        <Button size="xs" variant="ghost" onClick={onRetry} className="ml-1">
          Retry
        </Button>
      )}
    </div>
  );
}
