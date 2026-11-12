/**
 * The save state of an autosaved object (draft details, wizard steps) and how it reads to the
 * user. Pure and React-free so it is unit-tested (components/shared/__tests__/save-state.test.ts).
 * Rendered by <SaveIndicator>.
 */

export type SaveState =
  /** Nothing exists on the server yet (before the draft is created). */
  | { kind: "unsaved" }
  /** Local edits waiting for the debounce to send them. */
  | { kind: "dirty" }
  | { kind: "saving" }
  | { kind: "saved"; at: Date | string }
  | { kind: "error"; message?: string }
  /** The server held a newer version (stale `expectedUpdatedAt`); the latest was reloaded. */
  | { kind: "conflict" };

export type SaveTone = "muted" | "progress" | "success" | "warning" | "danger";
export type SaveIcon = "dot" | "spinner" | "check" | "alert" | "refresh";

export interface SaveDescription {
  label: string;
  detail?: string;
  tone: SaveTone;
  icon: SaveIcon;
  /** Errors and conflicts interrupt (role="alert"); everything else is a quiet status. */
  urgent: boolean;
  /** Offer a retry action. */
  retry: boolean;
}

/** "just now", "4 min ago", "at 14:05" (same day) or "on 12 Nov". */
export function formatSavedAgo(at: Date | string, now: Date = new Date()): string {
  const then = typeof at === "string" ? new Date(at) : at;
  const seconds = Math.max(0, Math.round((now.getTime() - then.getTime()) / 1000));
  if (seconds < 45) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const sameDay = then.toDateString() === now.toDateString();
  if (sameDay) return `at ${then.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
  return `on ${then.toLocaleDateString([], { day: "numeric", month: "short" })}`;
}

export function describeSave(state: SaveState, now: Date = new Date()): SaveDescription {
  switch (state.kind) {
    case "unsaved":
      return { label: "Not saved yet", detail: "Your draft is created when you continue.", tone: "muted", icon: "dot", urgent: false, retry: false };
    case "dirty":
      return { label: "Unsaved changes", tone: "muted", icon: "dot", urgent: false, retry: false };
    case "saving":
      return { label: "Saving…", tone: "progress", icon: "spinner", urgent: false, retry: false };
    case "saved":
      return { label: "Draft saved", detail: formatSavedAgo(state.at, now), tone: "success", icon: "check", urgent: false, retry: false };
    case "error":
      return {
        label: "Couldn’t save",
        detail: state.message ?? "Check your connection and try again. Nothing you typed is lost.",
        tone: "danger",
        icon: "alert",
        urgent: true,
        retry: true,
      };
    case "conflict":
      return {
        label: "Updated elsewhere",
        detail: "This draft was changed in another tab or by someone else. We loaded the latest version; check your last edit.",
        tone: "warning",
        icon: "refresh",
        urgent: true,
        retry: false,
      };
  }
}
