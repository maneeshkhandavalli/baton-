"use client";

import { CheckCircle2, CircleAlert, CircleDashed, CircleSlash, History, RotateCcw, ShieldCheck, Trash2 } from "lucide-react";

import { AccessBadge } from "@/components/handover/badges";
import { attributeRows } from "@/components/handover/attributes";
import { formatDate, formatDateRange, formatDateTime, formatCount } from "@/components/handover/format";
import { accessLevelMeta, categoryLabel, maskKindLabel, quoteCheckLabel, sourceKindLabel, supportVerdictLabel } from "@/components/handover/labels";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { MaskedText } from "@/components/shared/masked-text";
import { statusConfig } from "@/config/status";
import type { EvidenceItem, PointDetail, SourceSummary } from "@/lib/contracts/dto";
import { ACCESS_LEVELS, type AccessLevel, type MaskKind } from "@/lib/contracts/enums";
import { cn } from "@/lib/utils";

import { EvidenceQuote } from "./evidence-quote";

interface PointDetailPanelProps {
  point: PointDetail;
  sources: SourceSummary[];
  readOnly: boolean;
  pending: boolean;
  onExclude: (pointEvidenceId: string) => void;
  onRestore: (pointEvidenceId: string) => void;
  onChangeAccess: (level: AccessLevel | null) => void;
}

const reviewActionLabel: Record<string, string> = {
  approve: "Approved",
  reject: "Rejected",
  reopen: "Reopened",
  edit: "Edited",
  confirm_inferred: "Confirmed inferred point",
  resolve_conflict: "Resolved conflict",
  exclude_evidence: "Excluded evidence",
  restore_evidence: "Restored evidence",
  change_access: "Changed access",
  auto_reopen: "Reopened automatically",
  privacy_hold: "Privacy hold",
  resolve_privacy_review: "Resolved privacy review",
};

function Section({ title, children, className }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={cn("space-y-3 border-t border-border px-5 py-4", className)}>
      <h3 className="text-xs font-semibold tracking-[0.12em] text-muted-foreground uppercase">{title}</h3>
      {children}
    </section>
  );
}

function CheckRow({ ok, warn, children }: { ok: boolean; warn?: boolean; children: React.ReactNode }) {
  const Icon = ok ? CheckCircle2 : warn ? CircleAlert : CircleSlash;
  return (
    <li className="flex items-start gap-2 text-xs">
      <Icon
        aria-hidden="true"
        className={cn("mt-px size-3.5 shrink-0", ok ? "text-status-sourced" : warn ? "text-status-inferred" : "text-status-conflicting")}
      />
      <span className="text-foreground/85">{children}</span>
    </li>
  );
}

function Verification({ e }: { e: EvidenceItem }) {
  const quoteOk = e.quoteCheck === "exact" || e.quoteCheck === "normalized";
  return (
    <ul className="space-y-1.5" aria-label="Verification">
      {e.kind === "testimony" ? (
        <CheckRow ok>Statement by {e.authorLabel ?? "a member"}, accepted by a reviewer</CheckRow>
      ) : (
        <CheckRow ok={quoteOk} warn={e.quoteCheck === "pending"}>
          {quoteCheckLabel[e.quoteCheck]}
        </CheckRow>
      )}
      <CheckRow
        ok={e.supportVerdict === "supports"}
        warn={e.supportVerdict === "partial" || e.supportVerdict === "unchecked"}
      >
        {supportVerdictLabel[e.supportVerdict]}
        {e.verdictRationale && <MaskedText className="block text-muted-foreground" text={e.verdictRationale} />}
      </CheckRow>
      {!e.isCurrentRevisionVerdict && e.supportVerdict !== "unchecked" && (
        <CheckRow ok={false} warn>
          Checked against an earlier wording; re-checking the current revision
        </CheckRow>
      )}
    </ul>
  );
}

export function PointDetailPanel({ point, sources, readOnly, pending, onExclude, onRestore, onChangeAccess }: PointDetailPanelProps) {
  const rows = attributeRows(point.category, point.attributes);
  const sourceTitles = new Set(point.evidence.map((e) => e.sourceTitle).filter(Boolean));
  const relatedSources = sources.filter((s) => sourceTitles.has(s.title));
  const floorRank = Math.max(...point.evidence.map((e) => ACCESS_LEVELS.indexOf(e.accessLevel)), 0);

  return (
    <div className="flex flex-col">
      <div className="space-y-2 px-5 pt-5 pb-4">
        <div className="flex flex-wrap items-center gap-1.5">
          <StatusBadge status={point.evidenceStatus} size="sm" />
          <span className="text-xs text-muted-foreground">{categoryLabel[point.category]}</span>
          <span className="text-xs text-muted-foreground">· Revision {point.revisionNumber}</span>
        </div>
        <h2 className="font-serif text-2xl leading-tight tracking-tight"><MaskedText text={point.title} /></h2>
        <p className="text-sm leading-relaxed text-muted-foreground"><MaskedText text={point.statement} /></p>
        <p className="text-xs text-muted-foreground">{statusConfig[point.evidenceStatus].description}</p>
      </div>

      {rows.length > 0 && (
        <Section title="Details">
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
            {rows.map(([k, v]) => (
              <div key={k} className="contents">
                <dt className="text-muted-foreground">{k}</dt>
                <dd className="text-foreground">{v}</dd>
              </div>
            ))}
          </dl>
        </Section>
      )}

      {point.inferenceRationale && (
        <Section title="Inference">
          <p className="rounded-lg bg-status-inferred-soft px-3 py-2 text-sm text-status-inferred-fg"><MaskedText text={point.inferenceRationale} /></p>
          {point.inferredConfirmation && (
            <p className="text-xs text-muted-foreground">
              Confirmed by {point.inferredConfirmation.by} on {formatDate(point.inferredConfirmation.at)}
            </p>
          )}
        </Section>
      )}

      <Section title={`Evidence (${point.evidence.length})`}>
        {point.evidence.length === 0 ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <CircleDashed aria-hidden="true" className="size-4" />
            Nothing in the sources covers this point.
          </p>
        ) : (
          <ol className="space-y-4">
            {point.evidence.map((e) => {
              const rejected = e.quoteCheck === "not_found" || e.supportVerdict === "irrelevant";
              return (
                <li key={e.pointEvidenceId} className="space-y-2">
                  <EvidenceQuote
                    {...e}
                    tone={e.excluded || rejected ? "muted" : e.supportVerdict === "contradicts" ? "contradicts" : e.supportVerdict === "supports" ? "supports" : "default"}
                  />
                  <Verification e={e} />
                  <div className="flex flex-wrap items-center gap-1.5">
                    <AccessBadge level={e.accessLevel} />
                    {e.excluded && (
                      <span className="text-xs text-muted-foreground">
                        Excluded{e.exclusionReason && (
                          <>
                            : <MaskedText text={e.exclusionReason} />
                          </>
                        )}
                      </span>
                    )}
                    {!readOnly && (
                      <span className="ml-auto">
                        {e.excluded ? (
                          <Button size="xs" variant="ghost" disabled={pending} onClick={() => onRestore(e.pointEvidenceId)}>
                            <RotateCcw aria-hidden="true" data-icon="inline-start" />
                            Restore
                          </Button>
                        ) : (
                          !rejected && (
                            <Button size="xs" variant="ghost" disabled={pending} onClick={() => onExclude(e.pointEvidenceId)}>
                              <Trash2 aria-hidden="true" data-icon="inline-start" />
                              Exclude
                            </Button>
                          )
                        )}
                      </span>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </Section>

      {relatedSources.length > 0 && (
        <Section title="Source context">
          <ul className="space-y-3">
            {relatedSources.map((s) => {
              const masked = Object.entries(s.maskingCounts ?? {}).filter(([, n]) => (n ?? 0) > 0) as Array<[MaskKind, number]>;
              return (
                <li key={s.id} className="rounded-lg border border-border bg-background/60 p-3">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm font-medium">{s.title}</p>
                    <AccessBadge level={s.accessLevel} />
                  </div>
                  <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
                    <dt className="text-muted-foreground">Type</dt>
                    <dd>{sourceKindLabel[s.kind]}</dd>
                    {s.firstMessageAt && (
                      <>
                        <dt className="text-muted-foreground">Covers</dt>
                        <dd>{formatDateRange(s.firstMessageAt, s.lastMessageAt)}</dd>
                      </>
                    )}
                    <dt className="text-muted-foreground">{s.kind === "whatsapp_export" ? "Messages" : "Blocks"}</dt>
                    <dd>{formatCount(s.messageCount)}</dd>
                    <dt className="text-muted-foreground">Raw file</dt>
                    <dd>{s.rawDeletedAt ? `Deleted ${formatDate(s.rawDeletedAt)}` : "Kept until processed"}</dd>
                  </dl>
                  {masked.length > 0 && (
                    <p className="mt-2 flex flex-wrap gap-1 text-[0.6875rem] text-muted-foreground">
                      <ShieldCheck aria-hidden="true" className="size-3.5 text-status-sourced" />
                      Masked:
                      {masked.map(([k, n]) => (
                        <span key={k} className="rounded bg-muted px-1">
                          {n} {maskKindLabel[k].label.toLowerCase()}
                        </span>
                      ))}
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
          <p className="text-xs text-muted-foreground">
            Surrounding messages are not shown here yet; the read contract has no source-context query.
          </p>
        </Section>
      )}

      <Section title="Access">
        <p className="text-sm">
          Visible to <span className="font-medium">{accessLevelMeta[point.accessLevel].label.toLowerCase()}</span>.{" "}
          <span className="text-muted-foreground">{accessLevelMeta[point.accessLevel].description}</span>
        </p>
        {!readOnly && (
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Change access">
            {ACCESS_LEVELS.map((level, rank) => {
              const belowFloor = rank < floorRank;
              const current = point.accessLevel === level;
              return (
                <Button
                  key={level}
                  size="xs"
                  variant={current ? "secondary" : "outline"}
                  disabled={pending || belowFloor || current}
                  title={belowFloor ? "Can't be less restricted than its evidence" : undefined}
                  onClick={() => onChangeAccess(rank === floorRank ? null : level)}
                >
                  {accessLevelMeta[level].label}
                </Button>
              );
            })}
          </div>
        )}
      </Section>

      {point.revisions.length > 1 && (
        <Section title={`Revisions (${point.revisions.length})`}>
          <ol className="space-y-2.5">
            {point.revisions.map((r) => (
              <li key={r.id} className="text-sm">
                <p className="flex items-baseline gap-2">
                  <span className="font-mono text-xs text-muted-foreground">v{r.number}</span>
                  <span className={cn(r.number !== point.revisionNumber && "text-muted-foreground line-through decoration-border")}>
                    <MaskedText text={r.title} />
                  </span>
                </p>
                <p className="pl-6 text-xs text-muted-foreground">
                  {r.authorLabel ?? "Extracted by Baton"} · {formatDateTime(r.createdAt)}
                  {r.editReason && (
                    <>
                      {" · “"}
                      <MaskedText text={r.editReason} />”
                    </>
                  )}
                </p>
              </li>
            ))}
          </ol>
        </Section>
      )}

      <Section title="History" className="pb-6">
        {point.reviewHistory.length === 0 ? (
          <p className="text-sm text-muted-foreground">No review actions yet.</p>
        ) : (
          <ol className="space-y-2.5">
            {point.reviewHistory.map((h, i) => (
              <li key={i} className="flex gap-2.5 text-sm">
                <History aria-hidden="true" className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                <div>
                  <p>
                    <span className="font-medium">{reviewActionLabel[h.action] ?? h.action}</span>
                    <span className="text-muted-foreground"> · {h.actorLabel ?? "Baton"}</span>
                  </p>
                  {h.note && <p className="text-xs text-muted-foreground"><MaskedText text={h.note} /></p>}
                  <p className="text-xs text-muted-foreground">{formatDateTime(h.createdAt)}</p>
                </div>
              </li>
            ))}
          </ol>
        )}
      </Section>
    </div>
  );
}
