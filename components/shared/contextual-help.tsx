"use client";

import { CircleHelp } from "lucide-react";
import { useCallback, useEffect, useId, useLayoutEffect, useReducer, useRef, useState } from "react";

import { cn } from "@/lib/utils";

import { helpReducer, helpTriggerAria, INITIAL_HELP_STATE } from "./contextual-help-state";
import { helpTopic, type HelpTopicId } from "./help-topics";

/** Width of the panel in px (w-72); used to keep it inside the viewport. */
const PANEL_WIDTH = 288;
const GUTTER = 16;

interface ContextualHelpProps {
  topic: HelpTopicId;
  /** Accessible name of the trigger; defaults to "What does “<title>” mean?". */
  label?: string;
  className?: string;
}

/**
 * A small "?" button that shows a short explanation (R3 Task 06). Works the same with mouse, keyboard and touch:
 * the trigger is a real <button> (click, tap, Enter, Space), never hover-only. While open, the panel is linked to
 * the trigger with aria-controls + aria-describedby; Escape closes it and returns focus to the trigger; a press
 * outside, or focus leaving both, closes it. Copy lives in help-topics.ts; open/close rules in contextual-help-state.ts.
 */
export function ContextualHelp({ topic, label, className }: ContextualHelpProps) {
  const t = helpTopic(topic);
  const panelId = useId();
  const [state, dispatch] = useReducer(helpReducer, INITIAL_HELP_STATE);
  const [pos, setPos] = useState<{ top?: number; bottom?: number; left: number } | null>(null);
  const rootRef = useRef<HTMLSpanElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  // The panel is fixed to the viewport (so a card's overflow-hidden never clips it), below the trigger and kept
  // inside the viewport with a gutter; it follows the trigger while anything scrolls or the window resizes.
  useLayoutEffect(() => {
    if (!state.open) return;
    const place = () => {
      const t = triggerRef.current;
      if (!t) return;
      const r = t.getBoundingClientRect();
      const width = Math.min(PANEL_WIDTH, window.innerWidth - 2 * GUTTER);
      const left = Math.min(Math.max(r.left, GUTTER), window.innerWidth - GUTTER - width);
      // low on the screen (common on phones): open above the trigger instead
      setPos(r.bottom > window.innerHeight * 0.6 ? { bottom: window.innerHeight - r.top + 6, left } : { top: r.bottom + 6, left });
    };
    place();
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [state.open]);

  useEffect(() => {
    if (!state.open && state.restoreFocus) triggerRef.current?.focus();
  }, [state]);

  useEffect(() => {
    if (!state.open) return;
    const onPointer = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) dispatch({ type: "outside_press" });
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        dispatch({ type: "escape" });
      }
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [state.open]);

  const onBlur = useCallback((e: React.FocusEvent) => {
    const next = e.relatedTarget as Node | null;
    if (next && rootRef.current?.contains(next)) return;
    // relatedTarget is null for a pointer press on non-focusable content; the outside-press handler decides then.
    if (next) dispatch({ type: "focus_left" });
  }, []);

  return (
    <span ref={rootRef} className={cn("relative inline-flex align-middle", className)} onBlur={onBlur}>
      <button
        ref={triggerRef}
        type="button"
        {...helpTriggerAria(state.open, panelId)}
        aria-label={label ?? `What does “${t.title}” mean?`}
        onClick={(e) => {
          // inside clickable cards (point cards select on click): help must not also select
          e.stopPropagation();
          dispatch({ type: "toggle" });
        }}
        className={cn(
          // 24px visual target inside a 32px hit area on touch (WCAG 2.5.8), no layout shift
          "relative inline-flex size-6 items-center justify-center rounded-full text-muted-foreground transition-colors outline-none hover:text-foreground focus-ring before:absolute before:-inset-1 before:content-[''] aria-expanded:text-foreground",
        )}
      >
        <CircleHelp aria-hidden="true" className="size-3.5" />
      </button>
      <span
        id={panelId}
        hidden={!state.open}
        onClick={(e) => e.stopPropagation()}
        style={pos ? { top: pos.top, bottom: pos.bottom, left: pos.left } : undefined}
        className={cn(
          state.open && pos ? "block" : "hidden",
          "fixed z-50 w-72 max-w-[calc(100vw-2rem)] rounded-lg border border-border bg-popover p-3 text-left text-popover-foreground shadow-overlay",
        )}
      >
        <span className="block text-sm font-semibold">{t.title}</span>
        <span className="mt-1 block text-caption leading-relaxed whitespace-normal text-muted-foreground">{t.body}</span>
        {t.action && <span className="mt-1.5 block text-caption leading-relaxed whitespace-normal text-foreground">{t.action}</span>}
      </span>
    </span>
  );
}
