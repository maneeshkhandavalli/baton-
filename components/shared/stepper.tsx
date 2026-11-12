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
 * ≥ sm: numbered steps with labels joined by a rule. < sm: "Step 2 of 4 · Sources" + a bar.
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
            <span key={s.id} className={cn("h-1 flex-1 rounded-full transition-colors duration-300", i <= safe ? "bg-primary" : "bg-border")} />
          ))}
        </div>
      </div>

      {/* ≥ sm: full list */}
      <ol className="hidden items-center gap-3 sm:flex">
        {steps.map((s, i) => {
          const state = stepState(i, safe);
          const clickable = state === "complete" && !!onStepClick;
          const content = (
            <>
              <span
                aria-hidden="true"
                className={cn(
                  "flex size-6 shrink-0 items-center justify-center rounded-full border text-2xs font-semibold transition-colors",
                  state === "complete" && "border-primary bg-primary text-primary-foreground",
                  state === "current" && "border-primary bg-card text-primary-fg ring-4 ring-primary/12",
                  state === "upcoming" && "border-border-strong bg-card text-muted-foreground",
                )}
              >
                {state === "complete" ? <Check className="size-3.5" /> : i + 1}
              </span>
              <span className={cn("text-sm whitespace-nowrap", state === "upcoming" ? "text-muted-foreground" : "font-medium text-foreground")}>
                {s.label}
              </span>
              <span className="sr-only">{state === "complete" ? " (done)" : state === "current" ? " (current step)" : ""}</span>
            </>
          );
          return (
            <li key={s.id} aria-current={state === "current" ? "step" : undefined} className="flex min-w-0 items-center gap-3">
              {clickable ? (
                <button
                  type="button"
                  onClick={() => onStepClick(i)}
                  className="-m-1 flex items-center gap-2 rounded-md p-1 transition-colors outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/40"
                >
                  {content}
                </button>
              ) : (
                <span className="flex items-center gap-2">{content}</span>
              )}
              {i < steps.length - 1 && (
                <span aria-hidden="true" className={cn("h-px w-6 shrink-0 lg:w-10", i < safe ? "bg-primary/50" : "bg-border-strong")} />
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
