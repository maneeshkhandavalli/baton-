import { Check } from "lucide-react";

import { cn } from "@/lib/utils";

export interface ProgressStep {
  id: string;
  label: string;
  description?: string;
}

interface ProgressIndicatorProps {
  steps: readonly ProgressStep[];
  /** Index of the step in progress. Steps before it are complete. Use `steps.length` when all are done. */
  currentStep: number;
  /** Accessible name for the step list. */
  label?: string;
  className?: string;
}

type StepState = "complete" | "current" | "upcoming";

function getState(index: number, current: number): StepState {
  if (index < current) return "complete";
  if (index === current) return "current";
  return "upcoming";
}

/** A vertical, multi-step progress indicator for long-running work such as processing. */
export function ProgressIndicator({
  steps,
  currentStep,
  label = "Progress",
  className,
}: ProgressIndicatorProps) {
  const completed = Math.min(Math.max(currentStep, 0), steps.length);
  const percent = steps.length === 0 ? 0 : Math.round((completed / steps.length) * 100);

  return (
    <div className={cn("space-y-5", className)}>
      <div className="space-y-2">
        <div className="flex items-baseline justify-between text-sm">
          <span className="font-medium text-foreground">{label}</span>
          <span className="font-mono text-xs text-muted-foreground tabular-nums">
            {completed}/{steps.length}
          </span>
        </div>
        <div
          role="progressbar"
          aria-label={label}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent}
          className="h-1 w-full overflow-hidden rounded-full bg-muted"
        >
          <div
            className="h-full rounded-full bg-primary transition-[width] duration-500 ease-out motion-reduce:transition-none"
            style={{ width: `${percent}%` }}
          />
        </div>
      </div>

      <ol aria-label={label} className="space-y-0">
        {steps.map((step, index) => {
          const state = getState(index, currentStep);
          const isLast = index === steps.length - 1;

          return (
            <li
              key={step.id}
              aria-current={state === "current" ? "step" : undefined}
              className="relative flex gap-3 pb-5 last:pb-0"
            >
              {!isLast && (
                <span
                  aria-hidden="true"
                  className={cn(
                    "absolute top-6 left-[11px] h-[calc(100%-1.5rem)] w-px",
                    state === "complete" ? "bg-primary/40" : "bg-border",
                  )}
                />
              )}
              <span
                aria-hidden="true"
                className={cn(
                  "relative flex size-6 shrink-0 items-center justify-center rounded-full border text-[0.6875rem] font-medium",
                  state === "complete" && "border-primary bg-primary text-primary-foreground",
                  state === "current" && "border-primary bg-card text-primary ring-4 ring-primary/10",
                  state === "upcoming" && "border-input bg-card text-muted-foreground",
                )}
              >
                {state === "complete" ? <Check className="size-3.5" /> : index + 1}
              </span>
              <div className="min-w-0 pt-0.5">
                <p
                  className={cn(
                    "text-sm leading-5",
                    state === "upcoming" ? "text-muted-foreground" : "font-medium text-foreground",
                  )}
                >
                  {step.label}
                  <span className="sr-only">
                    {state === "complete" ? " (complete)" : state === "current" ? " (in progress)" : ""}
                  </span>
                </p>
                {step.description && (
                  <p className="mt-0.5 text-sm text-muted-foreground">{step.description}</p>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
