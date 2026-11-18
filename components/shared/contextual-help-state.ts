/**
 * Contextual help open/close rules (R3 Task 06). Pure and React-free (components/shared/__tests__/contextual-help.test.ts).
 *
 * The trigger is a real button: click, tap, Enter and Space all toggle it (no hover-only help). Escape closes it and
 * returns focus to the trigger; a pointer press outside closes it without moving focus; focus leaving both the trigger
 * and the panel closes it.
 */

export type HelpEvent =
  | { type: "toggle" }
  | { type: "escape" }
  | { type: "outside_press" }
  | { type: "focus_left" }
  | { type: "close" };

export interface HelpState {
  open: boolean;
  /** Set when closing should put focus back on the trigger (keyboard dismissal). */
  restoreFocus: boolean;
}

export const INITIAL_HELP_STATE: HelpState = Object.freeze({ open: false, restoreFocus: false });

export function helpReducer(state: HelpState, event: HelpEvent): HelpState {
  switch (event.type) {
    case "toggle":
      return { open: !state.open, restoreFocus: false };
    case "escape":
      return state.open ? { open: false, restoreFocus: true } : state;
    case "outside_press":
    case "focus_left":
    case "close":
      return state.open ? { open: false, restoreFocus: false } : state;
  }
}

/** ARIA for the trigger: the panel describes the trigger only while it is shown. */
export function helpTriggerAria(open: boolean, panelId: string): { "aria-expanded": boolean; "aria-controls": string; "aria-describedby"?: string } {
  return open ? { "aria-expanded": true, "aria-controls": panelId, "aria-describedby": panelId } : { "aria-expanded": false, "aria-controls": panelId };
}
