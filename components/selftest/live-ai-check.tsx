"use client";

import { Loader2 } from "lucide-react";
import { useState, useTransition } from "react";

import { SectionHeading } from "@/components/shared/section-heading";
import { Button } from "@/components/ui/button";
import { runLiveAiCheckAction } from "@/lib/selftest/actions";
import type { LiveAiResult } from "@/lib/selftest/live-ai";

import { StatusBadge } from "./selftest-report";

/** Opt-in, paid: one synthetic verification through the configured provider, only when the owner presses the button. */
export function LiveAiCheck() {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<LiveAiResult | null>(null);

  function run() {
    startTransition(async () => {
      try {
        setResult(await runLiveAiCheckAction());
      } catch {
        setResult({ ok: false, message: "The check could not be started. Try again.", ranAt: new Date().toISOString() });
      }
    });
  }

  return (
    <section aria-labelledby="selftest-live-ai" className="space-y-3">
      <SectionHeading
        id="selftest-live-ai"
        title="Live AI check"
        description="Sends one tiny synthetic claim and quote through the configured provider. It uses paid tokens, so it runs only when you press the button (at most once a minute)."
        actions={
          <Button type="button" variant="outline" onClick={run} disabled={pending} aria-busy={pending}>
            {pending ? (
              <>
                <Loader2 aria-hidden="true" data-icon="inline-start" className="animate-spin motion-reduce:animate-none" />
                Running…
              </>
            ) : (
              "Run live AI check"
            )}
          </Button>
        }
      />
      <div aria-live="polite">
        {result ? (
          <ul className="divide-y divide-border border-y border-border">
            <Row name="Result" status={result.ok ? "ok" : "fail"} detail={result.message} />
            {result.provider ? <Row name="Provider" detail={`${result.provider}${result.displayName ? ` (${result.displayName})` : ""}`} /> : null}
            {result.requestedModel ? <Row name="Requested model" detail={result.requestedModel} /> : null}
            {result.requestedModel ? (
              <Row
                name="Reported model"
                status={result.reportedModel ? (result.reportedModel === result.requestedModel ? "ok" : "warn") : undefined}
                detail={result.reportedModel ?? "not reported"}
              />
            ) : null}
            {result.verdict ? <Row name="Verdict" detail={result.verdict} /> : null}
            {typeof result.latencyMs === "number" ? <Row name="Latency" detail={`${result.latencyMs} ms`} /> : null}
            <Row name="Ran at" detail={result.ranAt} />
          </ul>
        ) : null}
      </div>
    </section>
  );
}

function Row({ name, status, detail }: { name: string; status?: "ok" | "warn" | "fail"; detail: string }) {
  return (
    <li className="grid gap-1 py-2.5 sm:grid-cols-[14rem_4.5rem_1fr] sm:items-baseline sm:gap-4">
      <span className="text-sm font-medium text-foreground">{name}</span>
      <span>{status ? <StatusBadge status={status} /> : null}</span>
      <span className="text-sm break-words text-muted-foreground">{detail}</span>
    </li>
  );
}
