/** Step helpers shared by <Stepper> (horizontal, wizard) and <ProgressIndicator> (vertical). */

export type StepState = "complete" | "current" | "upcoming";

/** Steps before `current` are complete; `current` may equal the step count when all are done. */
export function stepState(index: number, current: number): StepState {
  if (index < current) return "complete";
  if (index === current) return "current";
  return "upcoming";
}

/** "Step 2 of 4" — the compact label shown instead of the full step list on small screens. */
export function stepSummary(current: number, total: number): string {
  const shown = Math.min(Math.max(current, 0), Math.max(total - 1, 0)) + 1;
  return `Step ${shown} of ${total}`;
}
