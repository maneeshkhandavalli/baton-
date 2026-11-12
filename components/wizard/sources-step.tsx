"use client";

import { AlertCircle, Check, CopyX, FileText, Loader2, MessageCircle, RotateCcw, Trash2, TriangleAlert, Upload } from "lucide-react";
import { useId, useRef, useState } from "react";

import { formatBytes, formatCount } from "@/components/handover/format";
import { sourceKindLabel } from "@/components/handover/labels";
import { uploadPhaseMeta, uploadProgress, type UploadPhase } from "@/components/shared/upload-status";
import { Button } from "@/components/ui/button";
import type { DateOrder } from "@/lib/contracts/enums";
import { cn } from "@/lib/utils";

import { phaseOf, type DraftSource } from "./draft-state";

const CHAT_ACCEPT = ".txt,.zip";
const DOC_ACCEPT = ".pdf,.docx,.md,.markdown";

interface SourcesStepProps {
  sources: DraftSource[];
  onFiles: (f: FileList | null, g: "chat" | "doc") => void;
  onRemove: (s: DraftSource) => void;
  onRetry: (s: DraftSource) => void;
  onDateOrder: (s: DraftSource, o: DateOrder) => void;
  full: boolean;
}

export function SourcesStep({ sources, onFiles, onRemove, onRetry, onDateOrder, full }: SourcesStepProps) {
  const uid = useId();
  const readyCount = sources.filter((s) => s.status === "ready").length;
  const problems = sources.filter((s) => s.status === "error").length;
  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2">
        <DropZone
          id={`${uid}-chat`}
          title="WhatsApp chat exports"
          description=".txt or .zip, exported without media"
          accept={CHAT_ACCEPT}
          icon={<MessageCircle />}
          onFiles={(f) => onFiles(f, "chat")}
          disabled={full}
        />
        <DropZone
          id={`${uid}-doc`}
          title="Documents"
          description="PDF, DOCX or Markdown"
          accept={DOC_ACCEPT}
          icon={<FileText />}
          onFiles={(f) => onFiles(f, "doc")}
          disabled={full}
        />
      </div>

      {sources.length > 0 && (
        <section aria-labelledby={`${uid}-files`} className="space-y-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 id={`${uid}-files`} className="type-heading">
              Files <span className="font-normal text-muted-foreground tabular-nums">{sources.length}/10</span>
            </h3>
            <p className="text-caption text-muted-foreground" aria-live="polite">
              {readyCount} ready{problems > 0 ? ` · ${problems} need${problems === 1 ? "s" : ""} attention` : ""}
            </p>
          </div>
          <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card shadow-soft" aria-label="Added files">
            {sources.map((s) => (
              <FileRow key={s.localId} s={s} onRemove={onRemove} onRetry={onRetry} onDateOrder={onDateOrder} />
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

const TONE_ICON: Record<UploadPhase, { icon: React.ReactNode; className: string }> = {
  queued: { icon: <Loader2 className="animate-spin" />, className: "text-primary" },
  hashing: { icon: <Loader2 className="animate-spin" />, className: "text-primary" },
  uploading: { icon: <Loader2 className="animate-spin" />, className: "text-primary" },
  verifying: { icon: <Loader2 className="animate-spin" />, className: "text-primary" },
  consent: { icon: <Loader2 className="animate-spin" />, className: "text-primary" },
  previewing: { icon: <Loader2 className="animate-spin" />, className: "text-primary" },
  ready: { icon: <Check />, className: "bg-success-soft text-success-fg" },
  needs_input: { icon: <TriangleAlert />, className: "bg-warning-soft text-warning-fg" },
  failed: { icon: <AlertCircle />, className: "bg-destructive-soft text-destructive-fg" },
  duplicate: { icon: <CopyX />, className: "bg-warning-soft text-warning-fg" },
  too_large: { icon: <AlertCircle />, className: "bg-destructive-soft text-destructive-fg" },
  empty: { icon: <AlertCircle />, className: "bg-destructive-soft text-destructive-fg" },
  unsupported: { icon: <AlertCircle />, className: "bg-destructive-soft text-destructive-fg" },
};

function FileRow({ s, onRemove, onRetry, onDateOrder }: { s: DraftSource; onRemove: SourcesStepProps["onRemove"]; onRetry: SourcesStepProps["onRetry"]; onDateOrder: SourcesStepProps["onDateOrder"] }) {
  const phase = phaseOf(s);
  const meta = uploadPhaseMeta[phase];
  const progress = uploadProgress(phase);
  const visual = TONE_ICON[phase];
  const KindIcon = s.kind === "whatsapp_export" ? MessageCircle : FileText;
  const detail =
    phase === "ready"
      ? `${sourceKindLabel[s.kind]} · ${formatBytes(s.size)} · ${
          s.kind === "whatsapp_export"
            ? `${formatCount(s.preview?.stats.messagesKept)} messages, ${s.preview?.participants.length ?? 0} people`
            : `${formatCount(s.preview?.stats.messagesKept)} text blocks`
        }`
      : meta.busy
        ? `${meta.description}${progress ? ` Step ${progress.step} of ${progress.total}.` : ""}`
        : (s.error ?? meta.description);

  return (
    <li className="flex flex-col gap-3 px-4 py-3.5 sm:flex-row sm:items-center sm:gap-4">
      <div className="flex min-w-0 flex-1 items-start gap-3">
        <span aria-hidden="true" className={cn("mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md [&_svg]:size-4", meta.busy ? "bg-primary-soft" : "", visual.className)}>
          {meta.busy ? visual.icon : phase === "ready" ? <KindIcon /> : visual.icon}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
            <p className="min-w-0 truncate text-sm font-medium" title={s.name}>
              {s.name}
            </p>
            <span
              className={cn(
                "text-2xs font-semibold tracking-wide uppercase",
                meta.tone === "success" && "text-success-fg",
                meta.tone === "warning" && "text-warning-fg",
                meta.tone === "danger" && "text-destructive-fg",
                meta.tone === "progress" && "text-primary-fg",
              )}
            >
              {meta.label}
            </span>
          </div>
          <p className={cn("mt-0.5 text-caption", meta.tone === "danger" ? "text-destructive-fg" : "text-muted-foreground")} role={meta.tone === "danger" ? "alert" : undefined}>
            {detail}
          </p>
          {progress && (
            <div aria-hidden="true" className="mt-2 flex max-w-56 gap-1">
              {Array.from({ length: progress.total }, (_, i) => (
                <span key={i} className={cn("h-1 flex-1 rounded-full transition-colors", i < progress.step ? "bg-primary" : "bg-border")} />
              ))}
            </div>
          )}
        </div>
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-2 pl-11 sm:pl-0">
        {phase === "needs_input" && (
          <span className="flex flex-wrap gap-2" role="group" aria-label={`Date format for ${s.name}`}>
            <Button size="sm" variant="outline" onClick={() => onDateOrder(s, "dmy")}>
              Day/Month (31/12)
            </Button>
            <Button size="sm" variant="outline" onClick={() => onDateOrder(s, "mdy")}>
              Month/Day (12/31)
            </Button>
          </span>
        )}
        {phase === "failed" && s.file && s.kind !== "text" && (
          <Button size="sm" variant="outline" onClick={() => onRetry(s)}>
            <RotateCcw aria-hidden="true" data-icon="inline-start" />
            Retry
          </Button>
        )}
        <Button size="icon-sm" variant="destructive-ghost" aria-label={`Remove ${s.name}`} title="Remove" onClick={() => onRemove(s)} disabled={meta.busy}>
          <Trash2 />
        </Button>
      </div>
    </li>
  );
}

function DropZone({
  id,
  title,
  description,
  accept,
  icon,
  onFiles,
  disabled,
}: {
  id: string;
  title: string;
  description: string;
  accept: string;
  icon: React.ReactNode;
  onFiles: (f: FileList | null) => void;
  disabled: boolean;
}) {
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        if (!disabled) setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        if (!disabled) onFiles(e.dataTransfer.files);
      }}
      className={cn(
        "flex flex-col items-center rounded-xl border border-dashed px-4 py-8 text-center transition-colors duration-150",
        over ? "border-primary bg-primary-soft/60" : "border-border-strong bg-card/50 hover:bg-card",
        disabled && "opacity-50",
      )}
    >
      <div aria-hidden="true" className="mb-3 flex size-10 items-center justify-center rounded-lg border border-border bg-card text-muted-foreground shadow-xs [&_svg]:size-5">
        {icon}
      </div>
      <p className="type-subheading">{title}</p>
      <p className="mt-1 text-caption text-muted-foreground">{description}</p>
      <input
        ref={input}
        id={id}
        type="file"
        multiple
        accept={accept}
        className="sr-only"
        tabIndex={-1}
        onChange={(e) => {
          onFiles(e.target.files);
          e.target.value = "";
        }}
        disabled={disabled}
      />
      <Button size="sm" variant="outline" className="mt-4" onClick={() => input.current?.click()} disabled={disabled}>
        <Upload aria-hidden="true" data-icon="inline-start" />
        Choose files
      </Button>
      <p className="mt-2 hidden text-2xs text-muted-foreground sm:block">or drop them here</p>
    </div>
  );
}
