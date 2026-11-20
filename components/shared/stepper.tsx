import { Check } from "lucide-react";

import { cn } from "@/lib/utils";

import { stepState, stepSummary } from "./steps";

export interface StepperStep {
  id: string;
  label: string;
}

interface StepperProps {
  steps: readonly StepperStep[];
  /** Index of the current step. */
  current: number;
  /**
   * Called with a step index when a COMPLETED step is chosen. Omit to render a static stepper.
   * Upcoming steps are never clickable: the wizard decides when they unlock.
   */
  onStepClick?: (index: number) => void;
  label?: string;
  className?: string;
}

/**
 * Horizontal step indicator for multi-step flows (new handover wizard).
 * ≥ sm: one bordered pill rail (the tab rail's language); the current step is the ink pill. < sm: "Step 2 of 4 · Sources" + a bar.
 */
export function Stepper({ steps, current, onStepClick, label = "Progress", className }: StepperProps) {
  const safe = Math.min(Math.max(current, 0), steps.length - 1);
  return (
    <nav aria-label={label} className={className}>
      {/* Mobile: compact summary */}
      <div className="space-y-2 sm:hidden">
        <p className="flex items-baseline justify-between gap-3 text-caption">
          <span className="font-medium text-foreground">{steps[safe]?.label}</span>
          <span className="text-muted-foreground">{stepSummary(safe, steps.length)}</span>
        </p>
        <div aria-hidden="true" className="flex gap-1">
          {steps.map((s, i) => (
            <span key={s.id} className={cn("h-1 flex-1 rounded-full transition-colors duration-300", i <= safe ? "bg-foreground" : "bg-track")} />
          ))}
        </div>
      </div>

      {/* ≥ sm: full list */}
      <ol className="hidden w-fit max-w-full items-center gap-1 overflow-x-auto rounded-full border border-border bg-card p-1 sm:flex">
        {steps.map((s, i) => {
          const state = stepState(i, safe);
          const clickable = state === "complete" && !!onStepClick;
          const content = (
            <>
              <span
                aria-hidden="true"
                className={cn(
                  "flex size-6 shrink-0 items-center justify-center rounded-full border text-2xs font-semibold transition-colors",
                  state === "complete" && "border-transparent bg-success-soft text-success-fg",
                  state === "current" && "border-background/40 bg-transparent text-background",
                  state === "upcoming" && "border-border-strong bg-card text-muted-foreground",
                )}
              >
                {state === "complete" ? <Check className="size-3.5" /> : i + 1}
              </span>
              <span className={cn("text-sm whitespace-nowrap", state === "upcoming" ? "text-muted-foreground" : state === "current" ? "font-semibold text-background" : "font-medium text-foreground")}>
                {s.label}
              </span>
              <span className="sr-only">{state === "complete" ? " (done)" : state === "current" ? " (current step)" : ""}</span>
            </>
          );
          return (
            <li key={s.id} aria-current={state === "current" ? "step" : undefined} className={cn("flex h-9 shrink-0 items-center rounded-full px-3 transition-colors duration-150", state === "current" && "bg-foreground")}>
              {clickable ? (
                <button
                  type="button"
                  onClick={() => onStepClick(i)}
                  className="-mx-3 flex h-9 items-center gap-2 rounded-full px-3 transition-colors outline-none hover:bg-muted focus-ring"
                >
                  {content}
                </button>
              ) : (
                <span className="flex items-center gap-2">{content}</span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
