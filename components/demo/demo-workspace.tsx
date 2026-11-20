"use client";

import Link from "next/link";
import { ArrowLeft, ArrowRight, Info, Lightbulb, RotateCcw, Sparkles } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { WorkspaceSkeleton } from "@/components/shared/skeletons";
import { Button, buttonVariants } from "@/components/ui/button";
import type { Result } from "@/lib/contracts/api";
import {
  applyDemoAction,
  demoQueries,
  jumpToStep,
  parseDemoSession,
  resetDemoSession,
  serializeDemoSession,
  startDemoSession,
  type DemoAction,
  type DemoSession,
} from "@/lib/demo/engine";
import { DEMO_STEPS, type DemoStepId } from "@/lib/demo/scenario/journey";
import { routes } from "@/lib/routes";
import { cn } from "@/lib/utils";

import { demoResultText, readStoredSession, writeStoredSession } from "./demo-dispatch";
import { adjacentStep, DEMO_FRAMING, DEMO_FRAMING_DETAIL, DEMO_STEP_GUIDE, DEMO_STORAGE_KEY, stepNumber } from "./demo-guide";
import { DemoScreenView } from "./demo-screens";
import { loadDemoView, type DemoViewResult } from "./demo-view-model";

const CODEC = { serialize: serializeDemoSession, parse: parseDemoSession };

function sessionStore(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

/**
 * The interactive demo (R3 Task 06, frozen contract §2). Its whole state is a DemoSession in this tab: built by the
 * pure engine (lib/demo/engine), changed only through `applyDemoAction`, `resetDemoSession` and `jumpToStep`, and
 * remembered in sessionStorage (`baton.demo.v1`) as a per-viewer convenience. Nothing is sent anywhere: no account,
 * database, email or AI (A1, A3).
 */
export function DemoWorkspace({ initialStep }: { initialStep: DemoStepId | null }) {
  const [session, setSession] = useState<DemoSession | null>(null);
  const [view, setView] = useState<DemoViewResult | null>(null);
  const [pending, setPending] = useState(false);

  // First mount: resume this tab's demo, unless the link asks for a specific step.
  useEffect(() => {
    const stored = readStoredSession(sessionStore(), DEMO_STORAGE_KEY, CODEC);
    const next = stored ? (initialStep && initialStep !== stored.step ? jumpToStep(stored, initialStep) : stored) : startDemoSession(initialStep ? { step: initialStep } : undefined);
    setSession(next);
  }, [initialStep]);

  // Every session change: remember it and read the step's screen through the engine's queries.
  useEffect(() => {
    if (!session) return;
    writeStoredSession(sessionStore(), DEMO_STORAGE_KEY, CODEC, session);
    const guide = DEMO_STEP_GUIDE[session.step];
    let live = true;
    void loadDemoView(guide.screen, demoQueries(session, guide.viewer), demoQueries(session, "priya")).then((v) => {
      if (live) setView(v);
    });
    return () => {
      live = false;
    };
  }, [session]);

  // Keep the address bar in step with the demo, so a reload or a shared link opens the same step.
  useEffect(() => {
    if (!session) return;
    const url = new URL(window.location.href);
    if (url.searchParams.get("step") !== session.step) {
      url.searchParams.set("step", session.step);
      window.history.replaceState(null, "", url);
    }
  }, [session]);

  const dispatch = useCallback(
    async (action: DemoAction, success: string): Promise<Result<unknown>> => {
      if (!session) return { ok: false, error: { code: "internal", message: "The demo isn't ready yet.", retryable: true } };
      setPending(true);
      try {
        const { session: next, result } = applyDemoAction(session, action);
        const msg = demoResultText(result, success);
        if (msg.ok) toast.success(msg.text);
        else toast.error(msg.text);
        setSession(next);
        return result;
      } finally {
        setPending(false);
      }
    },
    [session],
  );

  const go = useCallback((step: DemoStepId) => {
    setView(null);
    setSession((s) => (s ? jumpToStep(s, step) : s));
  }, []);

  const reset = useCallback(() => {
    setView(null);
    setSession((s) => (s ? resetDemoSession(s) : s));
    toast.success("Demo reset to the start of this step");
  }, []);

  const step = session?.step ?? initialStep ?? DEMO_STEPS[0].id;
  const guide = DEMO_STEP_GUIDE[step];
  const prev = adjacentStep(step, -1);
  const next = adjacentStep(step, 1);
  const changed = (session?.log.length ?? 0) > 0;

  const nav = useMemo(
    () => (
      <nav aria-label="Demo steps" className="-mx-4 overflow-x-auto px-4 [scrollbar-width:none] sm:mx-0 sm:px-0">
        <ol className="flex min-w-max gap-1.5 sm:min-w-0 sm:flex-wrap">
          {DEMO_STEPS.map((s) => {
            const current = s.id === step;
            return (
              <li key={s.id}>
                <button
                  type="button"
                  aria-current={current ? "step" : undefined}
                  onClick={() => go(s.id)}
                  className={cn(
                    "inline-flex min-h-9 items-center gap-2 rounded-full border px-3 text-sm whitespace-nowrap transition-colors focus-ring",
                    current ? "border-primary bg-primary-soft font-medium text-primary-fg" : "border-border bg-card text-foreground/85 hover:bg-muted",
                  )}
                >
                  <span aria-hidden="true" className="type-numeric text-caption text-muted-foreground">
                    {s.n}
                  </span>
                  {s.label}
                </button>
              </li>
            );
          })}
        </ol>
      </nav>
    ),
    [step, go],
  );

  return (
    <div className="space-y-6">
      {/* The framing is on every screen: this is a sandbox, nothing leaves the tab. */}
      <div role="note" className="flex flex-col gap-3 rounded-xl border border-info/25 bg-info-soft/60 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="flex items-start gap-2 text-sm">
          <Info aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-info-fg" />
          <span>
            <span className="font-semibold text-info-fg">{DEMO_FRAMING}.</span> <span className="text-foreground/80">{DEMO_FRAMING_DETAIL}</span>
          </span>
        </p>
        <div className="flex shrink-0 gap-2">
          <Button type="button" size="sm" variant="outline" onClick={reset} disabled={!session || !changed}>
            <RotateCcw aria-hidden="true" data-icon="inline-start" />
            Reset this step
          </Button>
          <Link href={routes.handover.new} className={buttonVariants({ size: "sm", variant: "ghost" })}>
            Start your own
          </Link>
        </div>
      </div>

      {nav}

      <section aria-labelledby="demo-step-title" className="grid gap-4 rounded-xl border border-border bg-card p-4 shadow-soft sm:p-6 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] lg:gap-8">
        <div className="space-y-2">
          <p className="type-eyebrow text-muted-foreground">
            Step {stepNumber(step)} of {DEMO_STEPS.length} · as {guide.as}
          </p>
          <h2 id="demo-step-title" className="type-section-title">
            {guide.title}
          </h2>
          <p className="text-sm leading-relaxed text-pretty text-muted-foreground">{guide.what}</p>
        </div>
        <div className="space-y-3 border-t border-border pt-4 lg:border-t-0 lg:border-l lg:pt-0 lg:pl-8">
          <p className="flex items-start gap-2 text-sm">
            <Sparkles aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-primary" />
            <span>
              <span className="font-medium">Try this: </span>
              {guide.tryThis}
            </span>
          </p>
          <p className="flex items-start gap-2 text-sm text-muted-foreground">
            <Lightbulb aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
            <span>
              <span className="font-medium text-foreground">Why it matters: </span>
              {guide.why}
            </span>
          </p>
        </div>
      </section>

      <div aria-live="polite" aria-busy={!view}>
        {!session || !view ? (
          <WorkspaceSkeleton label="Opening the demo…" />
        ) : !view.ok ? (
          <p className="rounded-xl border border-border bg-card p-6 text-sm text-muted-foreground">{view.message}</p>
        ) : (
          <DemoScreenView screen={guide.screen} view={view.view} pending={pending} dispatch={dispatch} onNext={next ? () => go(next) : null} />
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-5">
        {prev ? (
          <Button type="button" variant="ghost" onClick={() => go(prev)}>
            <ArrowLeft aria-hidden="true" data-icon="inline-start" />
            {DEMO_STEPS[stepNumber(prev) - 1].label}
          </Button>
        ) : (
          <span />
        )}
        {next ? (
          <Button type="button" onClick={() => go(next)}>
            Next: {DEMO_STEPS[stepNumber(next) - 1].label}
            <ArrowRight aria-hidden="true" data-icon="inline-end" />
          </Button>
        ) : (
          <Link href={routes.handover.new} className={buttonVariants()}>
            Start your own handover
            <ArrowRight aria-hidden="true" data-icon="inline-end" />
          </Link>
        )}
      </div>
    </div>
  );
}
