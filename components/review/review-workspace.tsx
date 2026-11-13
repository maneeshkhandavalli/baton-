"use client";

import Link from "next/link";
import { Keyboard, ListFilter, Lock, Plus, SearchX } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { formatDate } from "@/components/handover/format";
import { HANDOVER_SECTIONS } from "@/components/handover/labels";
import { EmptyState } from "@/components/shared/empty-state";
import { StatusBadge } from "@/components/shared/status-badge";
import { Alert } from "@/components/ui/alert";
import { Button, buttonVariants } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Kbd } from "@/components/ui/kbd";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useAction } from "@/hooks/use-action";
import { useHotkeys } from "@/hooks/use-hotkeys";
import type { GapQuestionSummary, HandoverSummary, PointDetail, ReadinessReport, SourceSummary } from "@/lib/contracts/dto";
import { EVIDENCE_STATUSES, type EvidenceStatus, type PointCategory, type ReviewState } from "@/lib/contracts/enums";
import type { ReviewPointInput } from "@/lib/contracts/schemas";
import { createGapQuestion } from "@/lib/actions/gaps";
import { publishHandover } from "@/lib/actions/handovers";
import { reviewPoint } from "@/lib/actions/review";
import { cn } from "@/lib/utils";

import { AddPointDialog } from "./add-point-dialog";
import { PointCard, type PointAction } from "./point-card";
import { PointDetailPanel } from "./point-detail-panel";
import { ReadinessPanel, type SectionFilter } from "./readiness-panel";
import { ReviewDialogs, type ReviewDialogState } from "./review-dialogs";

interface ReviewWorkspaceProps {
  handover: HandoverSummary;
  points: PointDetail[];
  readiness: ReadinessReport | null;
  gapQuestions: GapQuestionSummary[];
  sources: SourceSummary[];
  /** Public demo or a state where review actions aren't allowed. */
  readOnly: boolean;
  readOnlyReason?: string;
  gapsHref: string | null;
  publishedHref: string | null;
  /**
   * Dev-only design preview (/preview/review): every action button is rendered as in a live review,
   * but nothing calls a server action; a toast says so instead.
   */
  preview?: boolean;
}

type ReviewFilter = "all" | ReviewState;

const REQUIRED_GAP_CATEGORIES: PointCategory[] = ["owner", "account_access", "open_task", "blocker"];

export function ReviewWorkspace({ handover, points, readiness, gapQuestions, sources, readOnly, readOnlyReason, gapsHref, publishedHref, preview = false }: ReviewWorkspaceProps) {
  const [section, setSection] = useState<SectionFilter>("all");
  const [status, setStatus] = useState<EvidenceStatus | "all">("all");
  const [review, setReview] = useState<ReviewFilter>("all");
  const [selectedId, setSelectedId] = useState<string | null>(points[0]?.id ?? null);
  const [dialog, setDialog] = useState<ReviewDialogState>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [publishOpen, setPublishOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [summary, setSummary] = useState("");
  const { run, isPending, error, clearError } = useAction();
  const cardRefs = useRef(new Map<string, HTMLElement>());

  const gapByPoint = useMemo(() => new Map(gapQuestions.filter((q) => q.pointId).map((q) => [q.pointId!, q])), [gapQuestions]);

  const visible = useMemo(() => {
    return points.filter((p) => {
      if (section === "conflicts" && p.evidenceStatus !== "conflicting") return false;
      if (section === "gaps" && p.evidenceStatus !== "missing") return false;
      if (section !== "all" && section !== "conflicts" && section !== "gaps") {
        const s = HANDOVER_SECTIONS.find((x) => x.id === section)!;
        if (!(s.categories as readonly PointCategory[]).includes(p.category)) return false;
      }
      if (status !== "all" && p.evidenceStatus !== status) return false;
      if (review !== "all" && p.reviewState !== review) return false;
      return true;
    });
  }, [points, section, status, review]);

  const selected = visible.find((p) => p.id === selectedId) ?? visible[0] ?? null;
  const toReview = points.filter((p) => p.reviewState === "pending").length;

  // Scroll only when the user moved the selection (J/K, click, after approve/reject) — never on
  // mount or filter changes, so the page opens at its header (DEMO-SCROLL).
  const userMoved = useRef(false);
  useEffect(() => {
    if (!userMoved.current || !selected) return;
    userMoved.current = false;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    cardRefs.current.get(selected.id)?.scrollIntoView({ block: "nearest", behavior: reduce ? "auto" : "smooth" });
  }, [selected]);
  const select = (id: string) => {
    userMoved.current = true;
    setSelectedId(id);
  };

  function move(delta: number) {
    if (visible.length === 0) return;
    const i = selected ? visible.findIndex((p) => p.id === selected.id) : -1;
    const next = visible[Math.max(0, Math.min(visible.length - 1, i + delta))];
    select(next.id);
  }

  function advanceFrom(id: string) {
    const i = visible.findIndex((p) => p.id === id);
    const next = visible.slice(i + 1).find((p) => p.reviewState === "pending") ?? visible.find((p) => p.reviewState === "pending" && p.id !== id);
    if (next) {
      select(next.id);
      // Keyboard and screen-reader users continue on the next point instead of a stale control.
      requestAnimationFrame(() => cardRefs.current.get(next.id)?.querySelector<HTMLElement>("button")?.focus({ preventScroll: true }));
    }
  }

  async function submit(input: ReviewPointInput): Promise<boolean> {
    clearError();
    const labels: Partial<Record<ReviewPointInput["action"], string>> = {
      approve: "Point approved",
      reject: "Point rejected",
      reopen: "Point reopened",
      edit: "Saved as a new revision",
      resolve_conflict: "Conflict resolved",
      confirm_inferred: "Inferred point confirmed",
      exclude_evidence: "Evidence excluded",
      restore_evidence: "Evidence restored",
      change_access: "Access updated",
    };
    const result = await run(() => reviewPoint(input), {
      success: labels[input.action],
      onError: (e) => e.code === "validation_failed" && !!e.fieldErrors,
    });
    if (result.ok && (input.action === "approve" || input.action === "reject")) advanceFrom(input.pointId);
    return result.ok;
  }

  function act(point: PointDetail, action: PointAction) {
    if (readOnly && action !== "details") return;
    select(point.id);
    if (preview && action !== "details") {
      toast.info("Preview only: actions are turned off and nothing is saved.");
      return;
    }
    switch (action) {
      case "approve": {
        const needsInput =
          (point.evidenceStatus === "inferred" && !point.inferredConfirmation) ||
          (point.evidenceStatus === "conflicting" && !point.conflictResolution) ||
          point.evidenceStatus === "missing";
        if (needsInput) setDialog({ kind: "approve", point });
        else void submit({ action: "approve", pointId: point.id, expectedRevisionId: point.currentRevisionId });
        break;
      }
      case "reject":
      case "edit":
      case "resolve":
        setDialog({ kind: action, point });
        break;
      case "reopen":
        void submit({ action: "reopen", pointId: point.id });
        break;
      case "ask_gap":
        void run(
          () =>
            createGapQuestion({
              handoverId: handover.id,
              pointId: point.id,
              question: point.title.endsWith("?") ? point.title : `What should the incoming member know about “${point.title}”?`,
              context: point.statement,
              priority: REQUIRED_GAP_CATEGORIES.includes(point.category) ? "required" : "optional",
            }),
          { success: "Added to the Gap Interview" },
        );
        break;
      case "details":
        setSheetOpen(true);
        break;
    }
  }

  const anyModal = dialog !== null || sheetOpen || publishOpen || helpOpen || addOpen;
  useHotkeys(
    {
      j: () => move(1),
      k: () => move(-1),
      a: () => selected && selected.reviewState === "pending" && act(selected, "approve"),
      e: () => selected && selected.reviewState === "pending" && act(selected, "edit"),
      r: () => selected && selected.reviewState === "pending" && act(selected, "reject"),
      "?": () => setHelpOpen(true),
    },
    !anyModal,
  );

  function onBlocker(kind: ReadinessReport["blockers"][number]["kind"]) {
    setStatus("all");
    setReview("all");
    if (kind === "unresolved_conflicts") setSection("conflicts");
    else if (kind === "open_required_gaps") setSection("gaps");
    else if (kind === "unconfirmed_inferred") {
      setSection("all");
      setStatus("inferred");
    } else if (kind === "pending_points") {
      setSection("all");
      setReview("pending");
    }
  }

  const canPublishNow = handover.viewerIsCreator && handover.state === "in_review" && !readOnly;
  // P1-1: review roles add knowledge the AI missed (create_manual_point: in_review only).
  const canAddPoint = !readOnly && handover.state === "in_review";
  function openAddPoint() {
    if (preview) {
      toast.info("Preview only: actions are turned off and nothing is saved.");
      return;
    }
    setAddOpen(true);
  }

  const detail = selected && (
    <PointDetailPanel
      point={selected}
      sources={sources}
      readOnly={readOnly}
      pending={isPending}
      onExclude={(pointEvidenceId) => setDialog({ kind: "exclude", point: selected, pointEvidenceId })}
      onRestore={(pointEvidenceId) => void submit({ action: "restore_evidence", pointId: selected.id, pointEvidenceId })}
      onChangeAccess={(accessOverride) => void submit({ action: "change_access", pointId: selected.id, accessOverride })}
    />
  );

  const panel = (
    <ReadinessPanel
      points={points}
      readiness={readiness}
      section={section}
      onSection={setSection}
      onBlocker={onBlocker}
      gapsHref={gapsHref}
      canPublish={!!readiness?.canPublish}
      onPublish={canPublishNow ? () => (preview ? toast.info("Preview only: publishing is turned off.") : setPublishOpen(true)) : null}
    />
  );

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[15.5rem_minmax(0,1fr)] xl:grid-cols-[15.5rem_minmax(0,1fr)_23rem]">
      {/* Left: readiness, sections, conflicts and gaps */}
      <aside aria-label="Readiness and sections" className="hidden lg:block">
        <div className="sticky top-6 max-h-[calc(100dvh-3rem)] overflow-y-auto pb-6">{panel}</div>
      </aside>
      <details className="group rounded-xl border border-border bg-card shadow-soft lg:hidden">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-sm font-medium">
          <span className="flex items-center gap-2">
            <ListFilter aria-hidden="true" className="size-4 text-muted-foreground" />
            Readiness {readiness ? `${readiness.score}%` : ""} · sections
          </span>
          <span className="text-xs text-muted-foreground group-open:hidden">Show</span>
          <span className="hidden text-xs text-muted-foreground group-open:inline">Hide</span>
        </summary>
        <div className="border-t border-border p-4">{panel}</div>
      </details>

      {/* Centre: evidence cards */}
      <section aria-label="Points" className="min-w-0 space-y-4">
        {(readOnly && readOnlyReason) || publishedHref ? (
          <Alert
            tone={readOnly ? "neutral" : "info"}
            live="none"
            icon={readOnly ? <Lock aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-muted-foreground" /> : undefined}
            action={
              publishedHref && (
                <Link href={publishedHref} className={buttonVariants({ size: "sm", variant: "outline" })}>
                  Open the incoming view
                </Link>
              )
            }
          >
            {readOnly && readOnlyReason ? readOnlyReason : "This handover has a published version."}
          </Alert>
        ) : null}

        <div className="flex flex-wrap items-center gap-2">
          <div role="group" aria-label="Filter by evidence status" className="flex flex-wrap gap-1">
            <FilterChip active={status === "all"} onClick={() => setStatus("all")}>
              All statuses
            </FilterChip>
            {EVIDENCE_STATUSES.map((s) => (
              <FilterChip key={s} active={status === s} onClick={() => setStatus(status === s ? "all" : s)} aria-label={`Show ${s} only`}>
                <StatusBadge status={s} size="sm" className="border-0 bg-transparent px-0" />
              </FilterChip>
            ))}
          </div>
          <span className="hidden h-5 w-px bg-border sm:block" aria-hidden="true" />
          <div role="group" aria-label="Filter by review state" className="flex gap-1">
            {(["all", "pending", "approved", "rejected"] as const).map((r) => (
              <FilterChip key={r} active={review === r} onClick={() => setReview(r)}>
                {r === "all" ? "Any review" : r === "pending" ? "To review" : r === "approved" ? "Approved" : "Rejected"}
              </FilterChip>
            ))}
          </div>
          {canAddPoint && (
            <Button size="sm" variant="outline" className="ml-auto" onClick={openAddPoint}>
              <Plus aria-hidden="true" data-icon="inline-start" />
              Add a point
            </Button>
          )}
          <Button size="sm" variant="ghost" className={cn("hidden sm:inline-flex", !canAddPoint && "ml-auto")} onClick={() => setHelpOpen(true)}>
            <Keyboard aria-hidden="true" data-icon="inline-start" />
            Shortcuts
          </Button>
        </div>

        <p className="text-caption text-muted-foreground" aria-live="polite">
          Showing {visible.length} of {points.length} points
          {toReview > 0 ? ` · ${toReview} still to review` : " · all reviewed"}
        </p>

        {visible.length === 0 ? (
          <EmptyState
            icon={<SearchX />}
            title="Nothing matches these filters"
            description="Try another section or clear the status and review filters."
            action={
              <Button
                variant="outline"
                onClick={() => {
                  setSection("all");
                  setStatus("all");
                  setReview("all");
                }}
              >
                Clear filters
              </Button>
            }
          />
        ) : (
          <ol className="space-y-3">
            {visible.map((p) => (
              <li key={p.id}>
                <PointCard
                  ref={(el) => {
                    if (el) cardRefs.current.set(p.id, el);
                    else cardRefs.current.delete(p.id);
                  }}
                  point={p}
                  selected={selected?.id === p.id}
                  readOnly={readOnly}
                  gapQuestion={gapByPoint.get(p.id)}
                  pending={isPending}
                  onSelect={() => select(p.id)}
                  onAction={(a) => act(p, a)}
                />
              </li>
            ))}
          </ol>
        )}
      </section>

      {/* Right: source context and verification */}
      <aside aria-label="Point details" className="hidden xl:block">
        <div className="sticky top-6 max-h-[calc(100dvh-3rem)] overflow-y-auto rounded-xl border border-border bg-card shadow-soft">
          {detail ?? <p className="p-5 text-sm text-muted-foreground">Select a point to see its evidence.</p>}
        </div>
      </aside>

      <Dialog open={sheetOpen} onOpenChange={setSheetOpen}>
        <DialogContent side="right" aria-label="Point details">
          <DialogTitle className="sr-only">Point details</DialogTitle>
          {detail}
        </DialogContent>
      </Dialog>

      <ReviewDialogs state={dialog} onClose={() => setDialog(null)} onSubmit={submit} pending={isPending} fieldErrors={error?.fieldErrors} />
      {canAddPoint && !preview && (
        <AddPointDialog
          open={addOpen}
          onOpenChange={setAddOpen}
          handoverId={handover.id}
          onCreated={(point) => {
            setSection("all");
            setStatus("all");
            setReview("all");
            select(point.id);
          }}
        />
      )}

      <Dialog open={publishOpen} onOpenChange={(o) => !isPending && setPublishOpen(o)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Publish this handover?</DialogTitle>
            <DialogDescription>
              Approved points become a fixed, versioned handover for the incoming member, who will be asked to acknowledge it. Rejected points and
              unapproved gaps are left out. To change anything later, start a revision.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="publish-summary">Summary (optional)</Label>
            <Textarea
              id="publish-summary"
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              placeholder="A few sentences for the incoming member. Only include information everyone may see."
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPublishOpen(false)} disabled={isPending}>
              Cancel
            </Button>
            <Button
              disabled={isPending}
              onClick={() =>
                run(() => publishHandover({ handoverId: handover.id, summary: summary || undefined }), {
                  success: (d) => `Published version ${d.version} on ${formatDate(d.publishedAt)}`,
                  onSuccess: () => setPublishOpen(false),
                })
              }
            >
              {isPending ? "Publishing…" : "Publish"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={helpOpen} onOpenChange={setHelpOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Keyboard shortcuts</DialogTitle>
          </DialogHeader>
          <dl className="grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-2 text-sm">
            {[
              ["J", "Next point"],
              ["K", "Previous point"],
              ["A", "Approve (asks for confirmation when needed)"],
              ["E", "Edit"],
              ["R", "Reject"],
              ["?", "Show this list"],
            ].map(([k, v]) => (
              <div key={k} className="contents">
                <dt>
                  <Kbd>{k}</Kbd>
                </dt>
                <dd className="text-muted-foreground">{v}</dd>
              </div>
            ))}
          </dl>
          {readOnly && <p className="text-xs text-muted-foreground">Review actions are turned off here, so only J and K work.</p>}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function FilterChip({ active, className, ...props }: React.ComponentProps<"button"> & { active: boolean }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      className={cn(
        "inline-flex h-8 items-center rounded-full border px-3 text-xs font-medium max-sm:h-10 transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/40",
        active ? "border-foreground/25 bg-card text-foreground shadow-xs ring-1 ring-foreground/10" : "border-transparent bg-muted/60 text-muted-foreground hover:bg-muted hover:text-foreground",
        className,
      )}
      {...props}
    />
  );
}
