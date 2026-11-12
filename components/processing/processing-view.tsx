"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, ArrowRight, Check, CircleDashed, FileText, Loader2, MessageCircle, ShieldCheck, X } from "lucide-react";
import { useEffect, useState } from "react";

import { AccessBadge } from "@/components/handover/badges";
import { formatBytes, formatCount, formatDateRange, formatDateTime } from "@/components/handover/format";
import { maskKindLabel, sourceKindLabel, sourceStateLabel, stageLabel } from "@/components/handover/labels";
import { Button, buttonVariants } from "@/components/ui/button";
import { CONSENT_STATEMENT_VERSION, ConsentChecklist, consentComplete, emptyConsent } from "@/components/wizard/consent";
import { useAction } from "@/hooks/use-action";
import type { ProcessingStatus, SourceSummary } from "@/lib/contracts/dto";
import type { MaskKind } from "@/lib/contracts/enums";
import { cancelProcessing, startProcessing } from "@/lib/actions/handovers";
import { recordSourceConsent } from "@/lib/actions/sources";
import { routes } from "@/lib/routes";
import { cn } from "@/lib/utils";

const POLL_MS = 3_000; // D10

interface ProcessingViewProps {
  handoverId: string;
  status: ProcessingStatus;
  canStart: boolean;
  canCancel: boolean;
}

export function ProcessingView({ handoverId, status, canStart, canCancel }: ProcessingViewProps) {
  const router = useRouter();
  const { run, isPending } = useAction();
  const [consent, setConsent] = useState(emptyConsent());
  const { run: r, handoverState, sources } = status;
  const active = r?.status === "queued" || r?.status === "running";

  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => router.refresh(), POLL_MS);
    return () => clearInterval(t);
  }, [active, router]);

  const stages = r?.stages ?? [];
  const weights = stages.map((s) => (s.total ? s.done / s.total : 0));
  const percent = stages.length ? Math.round((weights.reduce((a, b) => a + b, 0) / stages.length) * 100) : 0;
  const totalMessages = sources.reduce((n, s) => n + (s.messageCount ?? 0), 0);
  const masking = sources.reduce<Partial<Record<MaskKind, number>>>((acc, s) => {
    for (const [k, v] of Object.entries(s.maskingCounts ?? {})) acc[k as MaskKind] = (acc[k as MaskKind] ?? 0) + (v ?? 0);
    return acc;
  }, {});
  const totalMasked = Object.values(masking).reduce((a, b) => a + (b ?? 0), 0);
  const needsConsent = sources.filter((s) => !s.consentRecordedAt);

  async function start() {
    for (const s of needsConsent) {
      const res = await run(() =>
        recordSourceConsent({
          sourceId: s.id,
          consentStatementVersion: CONSENT_STATEMENT_VERSION,
          consentConfirmed: true,
          accessLevel: s.accessLevel,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Kolkata",
        }),
      );
      if (!res.ok) return;
    }
    await run(() => startProcessing({ handoverId }), { success: "Processing started" });
  }

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
      <section aria-labelledby="run-heading" className="space-y-5 rounded-xl border border-border bg-card p-5 shadow-soft sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 id="run-heading" className="font-serif text-2xl">
              {active ? "Processing your sources" : r?.status === "succeeded" ? "Processing complete" : r?.status === "failed" ? "Processing failed" : r?.status === "cancelled" ? "Processing cancelled" : "Ready to process"}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {active
                ? "You can leave this page. Baton keeps working and the review opens when it's done."
                : r?.status === "succeeded"
                  ? `Finished ${formatDateTime(r.finishedAt)}. Every point is ready for your review.`
                  : r?.status === "failed"
                    ? r.error?.message ?? "Something went wrong. Your sources are safe; try again."
                    : handoverState === "draft"
                      ? "Add consent for every source, then start processing."
                      : "Start processing to extract source-backed points."}
            </p>
          </div>
          {active && canCancel && (
            <Button size="sm" variant="ghost" disabled={isPending} onClick={() => run(() => cancelProcessing({ handoverId }), { success: "Processing cancelled" })}>
              <X aria-hidden="true" data-icon="inline-start" />
              Cancel
            </Button>
          )}
        </div>

        {r && (
          <div className="space-y-2">
            <div className="flex items-baseline justify-between text-sm">
              <span className="font-medium">Overall</span>
              <span className="font-mono text-xs tabular-nums text-muted-foreground" aria-live="polite">
                {percent}%
              </span>
            </div>
            <div role="progressbar" aria-label="Overall progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} className="h-1.5 overflow-hidden rounded-full bg-muted">
              <div className={cn("h-full rounded-full transition-[width] duration-700 ease-out motion-reduce:transition-none", r.status === "failed" ? "bg-destructive" : r.status === "succeeded" ? "bg-status-sourced" : "bg-primary")} style={{ width: `${percent}%` }} />
            </div>
          </div>
        )}

        {r && (
          <ol className="space-y-1" aria-label="Pipeline stages">
            {stages.map((s) => {
              const Icon = s.status === "succeeded" ? Check : s.status === "running" ? Loader2 : s.status === "failed" ? AlertTriangle : CircleDashed;
              return (
                <li key={s.stage} aria-current={s.status === "running" ? "step" : undefined} className={cn("flex items-start gap-3 rounded-lg px-2 py-2.5", s.status === "running" && "bg-primary/[0.04]")}>
                  <span
                    aria-hidden="true"
                    className={cn(
                      "mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full border",
                      s.status === "succeeded" && "border-primary bg-primary text-primary-foreground",
                      s.status === "running" && "border-primary text-primary",
                      (s.status === "queued" || s.status === "cancelled") && "border-input text-muted-foreground",
                      s.status === "failed" && "border-destructive text-destructive",
                    )}
                  >
                    <Icon className={cn("size-3.5", s.status === "running" && "animate-spin")} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className={cn("text-sm", s.status === "queued" ? "text-muted-foreground" : "font-medium")}>{stageLabel[s.stage].label}</p>
                    <p className="text-xs text-muted-foreground">{stageLabel[s.stage].description}</p>
                  </div>
                  <span className="shrink-0 font-mono text-xs tabular-nums text-muted-foreground">
                    {s.done}/{s.total}
                  </span>
                </li>
              );
            })}
          </ol>
        )}

        {!active && canStart && (handoverState === "draft" || handoverState === "in_review") && r?.status !== "succeeded" && (
          <div className="space-y-4 border-t border-border pt-5">
            {needsConsent.length > 0 && (
              <>
                <p className="text-sm">
                  {needsConsent.length === 1 ? "1 source has" : `${needsConsent.length} sources have`} no consent recorded yet.
                </p>
                <ConsentChecklist value={consent} onChange={setConsent} />
              </>
            )}
            <Button disabled={isPending || sources.length === 0 || (needsConsent.length > 0 && !consentComplete(consent))} onClick={start}>
              {isPending ? "Starting…" : r ? "Try again" : "Start processing"}
            </Button>
            {sources.length === 0 && <p className="text-xs text-muted-foreground">This handover has no sources yet.</p>}
            {handoverState === "draft" && (
              <Link href={`${routes.handover.new}?draft=${encodeURIComponent(handoverId)}`} className={buttonVariants({ variant: "outline", size: "sm" })}>
                Add or change sources
              </Link>
            )}
          </div>
        )}

        {r?.status === "succeeded" && (
          <div className="flex flex-wrap gap-2 border-t border-border pt-5">
            <Link href={routes.handover.review(handoverId)} className={buttonVariants({ size: "lg" })}>
              Open the review
              <ArrowRight aria-hidden="true" data-icon="inline-end" />
            </Link>
            <Link href={routes.handover.gaps(handoverId)} className={buttonVariants({ size: "lg", variant: "outline" })}>
              See knowledge gaps
            </Link>
          </div>
        )}
      </section>

      <aside className="space-y-4">
        <div className="grid grid-cols-3 gap-2 rounded-xl border border-border bg-card p-4 shadow-soft">
          <Stat label="Sources" value={formatCount(sources.length)} />
          <Stat label="Messages" value={totalMessages ? formatCount(totalMessages) : "—"} />
          <Stat label="Masked" value={totalMasked ? formatCount(totalMasked) : "—"} />
        </div>

        <section aria-labelledby="sources-heading" className="rounded-xl border border-border bg-card shadow-soft">
          <h2 id="sources-heading" className="border-b border-border px-4 py-3 text-sm font-semibold">
            Sources
          </h2>
          <ul className="divide-y divide-border">
            {sources.map((s) => (
              <SourceRow key={s.id} s={s} />
            ))}
          </ul>
        </section>

        {totalMasked > 0 && (
          <section className="rounded-xl border border-border bg-card p-4 shadow-soft">
            <p className="flex items-center gap-2 text-sm font-semibold">
              <ShieldCheck aria-hidden="true" className="size-4 text-status-sourced" />
              Masked before storage
            </p>
            <ul className="mt-2 space-y-1 text-xs">
              {(Object.entries(masking) as Array<[MaskKind, number]>)
                .filter(([, n]) => n > 0)
                .map(([k, n]) => (
                  <li key={k} className="flex justify-between">
                    <span className="text-muted-foreground">{maskKindLabel[k].label}</span>
                    <span className="font-mono tabular-nums">{n}</span>
                  </li>
                ))}
            </ul>
          </section>
        )}
      </aside>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="text-center">
      <p className="font-serif text-2xl tabular-nums">{value}</p>
      <p className="text-[0.6875rem] tracking-wide text-muted-foreground uppercase">{label}</p>
    </div>
  );
}

function SourceRow({ s }: { s: SourceSummary }) {
  const Icon = s.kind === "whatsapp_export" ? MessageCircle : FileText;
  return (
    <li className="space-y-1.5 px-4 py-3">
      <div className="flex items-start gap-2">
        <Icon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        <p className="min-w-0 flex-1 truncate text-sm font-medium">{s.title}</p>
        <AccessBadge level={s.accessLevel} showEveryone={false} />
      </div>
      <p className="pl-6 text-xs text-muted-foreground">
        {sourceKindLabel[s.kind]} · {formatBytes(s.sizeBytes)} ·{" "}
        <span className={cn(s.state === "failed" && "text-destructive", s.state === "parsing" && "text-primary")}>{sourceStateLabel[s.state]}</span>
        {s.messageCount !== null && ` · ${formatCount(s.messageCount)} ${s.kind === "whatsapp_export" ? "messages" : "blocks"}`}
      </p>
      {s.firstMessageAt && <p className="pl-6 text-xs text-muted-foreground">{formatDateRange(s.firstMessageAt, s.lastMessageAt)}</p>}
      <p className="pl-6 text-xs text-muted-foreground">
        {s.consentRecordedAt ? "Consent recorded" : <span className="text-status-inferred-fg">Consent needed</span>}
        {s.rawDeletedAt ? " · raw file deleted" : ""}
      </p>
    </li>
  );
}
