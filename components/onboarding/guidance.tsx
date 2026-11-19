"use client";

/**
 * Round 4 (Worker 02): the first-time guidance controller for the workspace shell. One provider per AppShell
 * (it lives in the layout, so a running tour survives client navigation between pages). It starts EMPTY: the
 * server streams the signed-in user's guidance data in through <GuidanceInit> (inside Suspense), so nothing is
 * shown until the real state is known, and signed-out or preview shells without data show no guidance at all.
 *
 * Writes go through one Server Function (recordOnboardingEvent) that validates a small event and stores it in the
 * user's own Auth metadata; the UI applies the same event locally first (lib/onboarding/state.ts), so it never
 * waits on the network. Previews pass `persist: false`.
 */

import { usePathname, useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useLayoutEffect, useMemo, useReducer, useRef, useState } from "react";
import { toast } from "sonner";

import { recordOnboardingEvent } from "@/lib/actions/onboarding";
import type { GuideRoles } from "@/lib/onboarding/role";
import { applyOnboardingEvent, shouldShowWelcome, type GuideRole, type OnboardingEvent, type OnboardingState } from "@/lib/onboarding/state";
import { IDLE_TOUR, onStepPage, tourReducer, type TourEvent, type TourState, type TourStep } from "@/lib/onboarding/tour";

import { TourOverlay } from "./tour";
import { WelcomeDialog } from "./welcome";

export interface GuidanceInitData {
  state: OnboardingState;
  roles: GuideRoles;
  tours: Partial<Record<GuideRole, TourStep[]>>;
  firstName: string | null;
  /** Where "Getting started" lives (the dashboard), for the Help menu. */
  checklistHref: string;
  /** false in dev previews: nothing is saved. */
  persist: boolean;
}

interface GuidanceValue {
  data: GuidanceInitData | null;
  state: OnboardingState | null;
  tour: TourState;
  dispatchTour: (e: TourEvent) => void;
  startTour: (role: GuideRole) => void;
  record: (event: OnboardingEvent) => void;
  welcomeOpen: boolean;
  openWelcome: () => void;
  closeWelcome: () => void;
  init: (data: GuidanceInitData) => void;
}

const GuidanceContext = createContext<GuidanceValue | null>(null);

export function useGuidance(): GuidanceValue | null {
  return useContext(GuidanceContext);
}

export function GuidanceProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [data, setData] = useState<GuidanceInitData | null>(null);
  const [state, setState] = useState<OnboardingState | null>(null);
  const [tour, dispatchTour] = useReducer(tourReducer, IDLE_TOUR);
  const [welcomeOpen, setWelcomeOpen] = useState(false);
  const welcomeDecided = useRef(false);
  const persist = data?.persist ?? false;

  const init = useCallback((next: GuidanceInitData) => {
    setData(next);
    setState(next.state);
    // The welcome opens by itself once, on the first page that knows the state (never again in this tab).
    if (!welcomeDecided.current) {
      welcomeDecided.current = true;
      if (shouldShowWelcome(next.state)) setWelcomeOpen(true);
    }
  }, []);

  const record = useCallback(
    (event: OnboardingEvent) => {
      setState((s) => (s ? applyOnboardingEvent(s, event, new Date().toISOString()) : s));
      if (!persist) return;
      void recordOnboardingEvent(event)
        .then((r) => {
          if (!r.ok) toast.error("Couldn't save your guidance settings. They'll apply in this tab only.");
          else if (event.type === "checklist_dismissed" || event.type === "checklist_restored" || event.type === "reset") router.refresh();
        })
        .catch(() => toast.error("Couldn't save your guidance settings. They'll apply in this tab only."));
    },
    [persist, router],
  );

  const startTour = useCallback(
    (role: GuideRole) => {
      const steps = data?.tours[role] ?? [];
      setWelcomeOpen(false);
      dispatchTour({ type: "start", role, steps });
      // Started from another page (Help): go to where the first step is.
      if (steps[0]?.href && !onStepPage(steps[0], pathname)) router.push(steps[0].href);
    },
    [data, pathname, router],
  );

  const value = useMemo<GuidanceValue>(
    () => ({
      data,
      state,
      tour,
      dispatchTour,
      startTour,
      record,
      welcomeOpen,
      openWelcome: () => setWelcomeOpen(true),
      closeWelcome: () => setWelcomeOpen(false),
      init,
    }),
    [data, state, tour, startTour, record, welcomeOpen, init],
  );

  return (
    <GuidanceContext.Provider value={value}>
      {children}
      {data && <WelcomeDialog />}
      {data && <TourOverlay />}
    </GuidanceContext.Provider>
  );
}

/** Streams the server's guidance data into the shell's provider (rendered inside Suspense by the layout). */
export function GuidanceInit({ data }: { data: GuidanceInitData }) {
  const ctx = useGuidance();
  const init = ctx?.init;
  // Layout effect: the welcome decision is made before the browser paints this commit.
  useLayoutEffect(() => {
    init?.(data);
  }, [init, data]);
  return null;
}

/** Records the first time this user opens a published handover (the incoming checklist's "Read it"). */
export function PublishedOpenedSignal() {
  const ctx = useGuidance();
  const already = !!ctx?.state?.publishedOpenedAt;
  const ready = !!ctx?.state;
  const record = ctx?.record;
  const sent = useRef(false);
  useLayoutEffect(() => {
    if (!ready || already || sent.current || !record) return;
    sent.current = true;
    record({ type: "published_opened" });
  }, [ready, already, record]);
  return null;
}
