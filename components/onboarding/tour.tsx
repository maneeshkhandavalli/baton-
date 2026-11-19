"use client";

/**
 * Round 4 (Worker 02): the product tour overlay. Non-modal: there is no backdrop and the page stays usable; the
 * current step's real element gets a light ring (pointer-events: none) and a small card sits next to it, never
 * over it nor over anything marked `data-tour-avoid` (the page's primary action bar). Logic lives in
 * lib/onboarding/tour.ts (steps, state machine, placement); this file only measures and renders.
 *
 * Keyboard and screen readers: the card is a labelled, non-modal dialog; each step moves focus to its heading and
 * is announced in a polite live region ("Step 2 of 5: …"); Back/Next/Skip are real buttons; Escape ends the tour;
 * focus returns to where it was when the tour started. Missing anchors are skipped. Reduced motion: no smooth
 * scrolling and no transitions.
 */

import { usePathname, useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, X } from "lucide-react";
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { IDLE_TOUR, currentStep, onStepPage, placeTourCard, stepProgress, type Placement, type Rect, type TourStep } from "@/lib/onboarding/tour";
import { cn } from "@/lib/utils";

import { useGuidance } from "./guidance";

const PAD = 6;
const WAIT_REQUIRED_MS = 10000; // pages stream their content in (and compile in dev); give a required anchor time to appear
const PAUSED_PILL_DELAY_MS = 1500; // a tour-driven navigation is under way: don't flash "paused"
const WAIT_OPTIONAL_MS = 1200;

function visible(el: Element): boolean {
  if (!(el instanceof HTMLElement)) return false;
  if (el.closest("[hidden], [inert]")) return false;
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== "hidden";
}

function findAnchor(anchor: string): HTMLElement | null {
  const all = document.querySelectorAll<HTMLElement>(`[data-tour="${CSS.escape(anchor)}"]`);
  for (const el of all) if (visible(el)) return el;
  return null;
}

const toRect = (r: DOMRect): Rect => ({ top: r.top, left: r.left, width: r.width, height: r.height });
const reducedMotion = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export function TourOverlay() {
  const g = useGuidance();
  const router = useRouter();
  const pathname = usePathname();
  const tour = g?.tour ?? IDLE_TOUR;
  const dispatch = g?.dispatchTour;
  const record = g?.record;
  const step = currentStep(tour);
  const progress = stepProgress(tour);
  const onPage = step ? onStepPage(step, pathname) : false;

  // The element found for a step (keyed by step id, so a new step never shows the previous step's element).
  const [found, setFound] = useState<{ stepId: string; el: HTMLElement } | null>(null);
  const anchorEl = step && onPage && found?.stepId === step.id && found.el.isConnected ? found.el : null;
  const [measured, setMeasured] = useState<{ el: HTMLElement; rect: Rect; place: Placement } | null>(null);
  const rect = measured && measured.el === anchorEl ? measured.rect : null;
  const place = measured && measured.el === anchorEl ? measured.place : null;
  const cardRef = useRef<HTMLDivElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const focusedStep = useRef<string | null>(null);
  // Off the step's page for a moment (navigation in flight) vs. really elsewhere: show "paused" only after a delay.
  const [offPageSince, setOffPageSince] = useState<{ stepId: string; long: boolean } | null>(null);
  const titleId = useId();
  const bodyId = useId();

  // Remember where focus was when the tour started; finishing records the outcome and returns focus there.
  useEffect(() => {
    if (tour.status === "running" && !returnFocus.current) {
      const active = document.activeElement;
      returnFocus.current = active instanceof HTMLElement && active !== document.body ? active : null;
    }
    if (tour.status === "finished") {
      record?.({ type: "tour_finished", role: tour.role, status: tour.outcome });
      dispatch?.({ type: "reset" });
      const back = returnFocus.current;
      returnFocus.current = null;
      focusedStep.current = null;
      requestAnimationFrame(() => {
        if (back && back.isConnected) back.focus();
        else document.getElementById("main")?.focus({ preventScroll: true });
      });
    }
  }, [tour, record, dispatch]);

  // Find the current step's element (waiting while the page streams in); skip the step if it never appears.
  useEffect(() => {
    if (!step || !onPage || !dispatch) return;
    let cancelled = false;
    const deadline = Date.now() + (step.optional ? WAIT_OPTIONAL_MS : WAIT_REQUIRED_MS);
    const look = () => {
      if (cancelled) return;
      const el = findAnchor(step.anchor);
      if (el) {
        const r = el.getBoundingClientRect();
        if (r.top < 64 || r.bottom > window.innerHeight - 64) {
          const behavior = reducedMotion() ? "auto" : "smooth";
          // a tall element starts just below the sticky headers, so its heading stays visible
          if (r.height > window.innerHeight * 0.55) window.scrollTo({ top: window.scrollY + r.top - 120, behavior });
          else el.scrollIntoView({ block: "center", behavior });
        }
        setFound({ stepId: step.id, el });
        return;
      }
      if (Date.now() > deadline) dispatch({ type: "anchor_missing", stepId: step.id });
      else timer = window.setTimeout(look, 120);
    };
    let timer = window.setTimeout(look, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [step, onPage, dispatch]);

  useEffect(() => {
    if (!step || onPage) return;
    const t = window.setTimeout(() => setOffPageSince({ stepId: step.id, long: true }), PAUSED_PILL_DELAY_MS);
    return () => window.clearTimeout(t);
  }, [step, onPage]);

  // Follow the element while the page scrolls or resizes.
  const measure = useCallback(() => {
    if (!anchorEl || !anchorEl.isConnected) return;
    const r = toRect(anchorEl.getBoundingClientRect());
    const card = cardRef.current;
    const size = { width: card?.offsetWidth || Math.min(352, window.innerWidth - 24), height: card?.offsetHeight || 200 };
    const avoid = [...document.querySelectorAll("[data-tour-avoid]")].filter(visible).map((el) => toRect(el.getBoundingClientRect()));
    const padded = { top: r.top - PAD, left: r.left - PAD, width: r.width + 2 * PAD, height: r.height + 2 * PAD };
    setMeasured({ el: anchorEl, rect: r, place: placeTourCard(padded, size, { width: window.innerWidth, height: window.innerHeight }, avoid) });
  }, [anchorEl]);

  useLayoutEffect(() => {
    if (!anchorEl) return;
    let frame = 0;
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    };
    // measure now, then again once the card has its real size
    frame = requestAnimationFrame(() => {
      measure();
      frame = requestAnimationFrame(measure);
    });
    window.addEventListener("scroll", schedule, true);
    window.addEventListener("resize", schedule);
    const ro = new ResizeObserver(schedule);
    ro.observe(anchorEl);
    if (cardRef.current) ro.observe(cardRef.current);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", schedule, true);
      window.removeEventListener("resize", schedule);
      ro.disconnect();
    };
  }, [anchorEl, measure]);

  // Move focus into the step when it appears (keyboard and screen-reader users land on it).
  const shown = !!(anchorEl && place);
  useEffect(() => {
    // once per step (not on every reposition), when the card is actually visible
    if (!shown || !step || focusedStep.current === step.id) return;
    focusedStep.current = step.id;
    headingRef.current?.focus({ preventScroll: true });
  }, [shown, step]);

  // A step whose action IS the highlighted control: pressing it moves the tour on (its own navigation runs).
  useEffect(() => {
    if (!anchorEl || !step?.advanceOnAnchorClick || !dispatch) return;
    const onClick = () => dispatch({ type: "next" });
    anchorEl.addEventListener("click", onClick);
    return () => anchorEl.removeEventListener("click", onClick);
  }, [anchorEl, step, dispatch]);

  // Escape ends the tour (other popups handle their own Escape first and stop it).
  useEffect(() => {
    if (tour.status !== "running" || !dispatch) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      if (document.querySelector("[role=dialog][data-open], [role=menu]")) return; // a modal or menu is open: it closes first
      dispatch({ type: "dismiss" });
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [tour.status, dispatch]);

  const go = useCallback(
    (target: TourStep | undefined, event: "next" | "back") => {
      dispatch?.({ type: event });
      if (target?.href && !onStepPage(target, pathname)) router.push(target.href);
    },
    [dispatch, pathname, router],
  );

  if (tour.status !== "running" || !step || !progress || !dispatch) return null;
  const steps = tour.steps;
  const index = tour.index;
  const last = index === steps.length - 1;
  const announce = `Tour step ${progress.label}: ${step.title}`;

  // On another page than the step: a small, unobtrusive way back (the page stays fully usable).
  if (!onPage) {
    if (!(offPageSince?.stepId === step.id && offPageSince.long)) return null;
    return (
      <div className="fixed bottom-4 left-4 z-[60] flex max-w-[calc(100vw-2rem)] items-center gap-2 rounded-full border border-border bg-popover py-1.5 pr-1.5 pl-4 text-sm shadow-overlay">
        <span className="truncate text-muted-foreground">Tour paused · {progress.label}</span>
        {step.href && (
          <Button size="sm" variant="outline" className="rounded-full" onClick={() => router.push(step.href!)}>
            Continue
          </Button>
        )}
        <Button size="icon-sm" variant="ghost" className="rounded-full" aria-label="End the tour" onClick={() => dispatch({ type: "dismiss" })}>
          <X aria-hidden="true" />
        </Button>
      </div>
    );
  }

  return (
    <>
      <p className="sr-only" aria-live="polite" aria-atomic="true">
        {anchorEl ? announce : ""}
      </p>
      {rect && (
        <div
          aria-hidden="true"
          data-testid="tour-highlight"
          className="pointer-events-none fixed z-[60] rounded-[10px] ring-2 ring-primary shadow-[0_0_0_6px_color-mix(in_srgb,var(--primary)_18%,transparent)] motion-safe:transition-[top,left,width,height] motion-safe:duration-200"
          style={{ top: rect.top - PAD, left: rect.left - PAD, width: rect.width + 2 * PAD, height: rect.height + 2 * PAD }}
        />
      )}
      <div
        ref={cardRef}
        role="dialog"
        aria-modal="false"
        aria-labelledby={titleId}
        aria-describedby={bodyId}
        data-testid="tour-card"
        className={cn(
          "fixed z-[61] w-[22rem] max-w-[calc(100vw-1.5rem)] rounded-xl border border-border bg-popover p-4 text-popover-foreground shadow-overlay",
          !(anchorEl && place) && "invisible",
        )}
        style={place ? { top: place.top, left: place.left } : { top: 0, left: 0 }}
      >
        <div className="flex items-center justify-between gap-3">
          <p className="type-eyebrow text-muted-foreground">
            Tour · <span className="tabular-nums">{progress.label}</span>
          </p>
          <Button size="sm" variant="ghost" className="-mr-2 h-8 text-muted-foreground" onClick={() => dispatch({ type: "dismiss" })}>
            Skip tour
          </Button>
        </div>
        <h2 id={titleId} ref={headingRef} tabIndex={-1} className="mt-1 type-subheading outline-none">
          {step.title}
        </h2>
        <p id={bodyId} className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
          {step.body}
        </p>
        <div className="mt-4 flex items-center justify-between gap-2">
          <Button size="sm" variant="ghost" disabled={index === 0} onClick={() => go(steps[index - 1], "back")}>
            <ArrowLeft aria-hidden="true" data-icon="inline-start" />
            Back
          </Button>
          <div className="flex items-center gap-1.5" aria-hidden="true">
            {steps.map((s, i) => (
              <span key={s.id} className={cn("size-1.5 rounded-full", i === index ? "bg-primary" : "bg-border-strong")} />
            ))}
          </div>
          <Button size="sm" onClick={() => go(steps[index + 1], "next")}>
            {last ? "Done" : (step.nextLabel ?? "Next")}
            {!last && <ArrowRight aria-hidden="true" data-icon="inline-end" />}
          </Button>
        </div>
      </div>
    </>
  );
}
