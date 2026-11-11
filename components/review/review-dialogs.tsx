"use client";

import { useState } from "react";

import { attributeLabel, enumOptions } from "@/components/handover/attributes";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { MaskedText } from "@/components/shared/masked-text";
import type { PointDetail } from "@/lib/contracts/dto";
import type { ReviewPointInput } from "@/lib/contracts/schemas";

import { EvidenceQuote } from "./evidence-quote";

export type ReviewDialogState =
  | { kind: "approve" | "reject" | "edit" | "resolve"; point: PointDetail }
  | { kind: "exclude"; point: PointDetail; pointEvidenceId: string }
  | null;

interface ReviewDialogsProps {
  state: ReviewDialogState;
  onClose: () => void;
  onSubmit: (input: ReviewPointInput) => Promise<boolean>;
  pending: boolean;
  fieldErrors?: Record<string, string[]>;
}

export function ReviewDialogs({ state, onClose, onSubmit, pending, fieldErrors }: ReviewDialogsProps) {
  return (
    <Dialog open={state !== null} onOpenChange={(open) => !open && !pending && onClose()}>
      <DialogContent>
        {state && (
          <DialogBody
            key={`${state.kind}-${state.point.id}-${state.point.currentRevisionId}`}
            state={state}
            onClose={onClose}
            onSubmit={onSubmit}
            pending={pending}
            fieldErrors={fieldErrors}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function FieldError({ messages }: { messages?: string[] }) {
  if (!messages?.length) return null;
  return <p className="text-xs text-destructive">{messages[0]}</p>;
}

function DialogBody({ state, onClose, onSubmit, pending, fieldErrors }: ReviewDialogsProps & { state: NonNullable<ReviewDialogState> }) {
  const { point } = state;
  const status = point.evidenceStatus;

  const [note, setNote] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [title, setTitle] = useState(point.title);
  const [statement, setStatement] = useState(point.statement);
  const [attributes, setAttributes] = useState<Record<string, unknown>>({ ...(point.attributes as Record<string, unknown>) });

  async function submit(input: ReviewPointInput) {
    const ok = await onSubmit(input);
    if (ok) onClose();
  }

  const footer = (label: string, input: ReviewPointInput | null, variant: "default" | "destructive" = "default") => (
    <DialogFooter>
      <Button variant="outline" onClick={onClose} disabled={pending}>
        Cancel
      </Button>
      <Button variant={variant} disabled={pending || input === null} aria-busy={pending} onClick={() => input && submit(input)}>
        {pending ? "Saving…" : label}
      </Button>
    </DialogFooter>
  );

  if (state.kind === "approve") {
    const supports = point.evidence.filter((e) => !e.excluded && e.supportVerdict === "supports");
    const contradicts = point.evidence.filter((e) => !e.excluded && e.supportVerdict === "contradicts");
    const base = { action: "approve" as const, pointId: point.id, expectedRevisionId: point.currentRevisionId };
    let input: ReviewPointInput | null = base;
    let body: React.ReactNode = null;
    let heading = "Approve this point?";
    let description = "It will be included in the published handover.";

    if (status === "inferred" && !point.inferredConfirmation) {
      heading = "Confirm and approve";
      description = "No quote states this outright. Approving records that you confirm it is true. It will still be shown as inferred.";
      input = confirmed ? { ...base, confirmInferred: true } : null;
      body = (
        <>
          {point.inferenceRationale && (
            <p className="rounded-lg bg-status-inferred-soft px-3 py-2 text-sm text-status-inferred-fg">
              <span className="font-medium">Why Baton inferred this: </span>
              <MaskedText text={point.inferenceRationale} />
            </p>
          )}
          <label className="flex items-start gap-2.5 text-sm">
            <input type="checkbox" className="mt-0.5 size-4 accent-primary" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
            I know this to be true and confirm it for the incoming member.
          </label>
          <FieldError messages={fieldErrors?.confirmInferred} />
        </>
      );
    } else if (status === "conflicting" && !point.conflictResolution) {
      heading = "Resolve and approve";
      description = "Sources disagree. Both sides stay visible, newest first. Explain what is true now.";
      input = note.trim() ? { ...base, resolutionNote: note.trim() } : null;
      body = (
        <>
          <ConflictSides supports={supports} contradicts={contradicts} />
          <div className="space-y-1.5">
            <Label htmlFor="resolution">Resolution note</Label>
            <Textarea id="resolution" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. The September decision replaced the August one: workshops are now free." />
            <FieldError messages={fieldErrors?.resolutionNote} />
          </div>
        </>
      );
    } else if (status === "missing") {
      heading = "Approve as a known gap";
      description = "There is no evidence for this. It will be published under Open questions, never as fact.";
      input = { ...base, asKnownGap: true };
    }

    return (
      <>
        <DialogHeader>
          <div className="flex items-center gap-2">
            <StatusBadge status={status} size="sm" />
          </div>
          <DialogTitle>{heading}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <p className="rounded-lg border border-border bg-background/60 px-3 py-2 text-sm">
          <MaskedText className="font-medium" text={`${point.title}.`} /> <MaskedText className="text-muted-foreground" text={point.statement} />
        </p>
        {body}
        {footer(status === "missing" ? "Approve as known gap" : "Approve", input)}
      </>
    );
  }

  if (state.kind === "resolve") {
    const supports = point.evidence.filter((e) => !e.excluded && e.supportVerdict === "supports");
    const contradicts = point.evidence.filter((e) => !e.excluded && e.supportVerdict === "contradicts");
    return (
      <>
        <DialogHeader>
          <DialogTitle>Resolve conflict</DialogTitle>
          <DialogDescription>
            Baton never picks a winner. Record what is true now; both sides remain visible. To drop one side instead, exclude that evidence from the details panel.
          </DialogDescription>
        </DialogHeader>
        <ConflictSides supports={supports} contradicts={contradicts} />
        <div className="space-y-1.5">
          <Label htmlFor="resolve-note">Resolution note</Label>
          <Textarea id="resolve-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="What should the incoming member treat as true?" />
          <FieldError messages={fieldErrors?.resolutionNote} />
        </div>
        {footer("Save resolution", note.trim() ? { action: "resolve_conflict", pointId: point.id, resolutionNote: note.trim() } : null)}
      </>
    );
  }

  if (state.kind === "reject") {
    return (
      <>
        <DialogHeader>
          <DialogTitle>Reject this point?</DialogTitle>
          <DialogDescription>Rejected points are never published. The evidence and history are kept, and you can reopen it later.</DialogDescription>
        </DialogHeader>
        <p className="text-sm font-medium"><MaskedText text={point.title} /></p>
        <div className="space-y-1.5">
          <Label htmlFor="reject-reason">Reason</Label>
          <Textarea id="reject-reason" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. A one-off, not a standing decision." />
          <FieldError messages={fieldErrors?.reason} />
        </div>
        {footer("Reject point", note.trim() ? { action: "reject", pointId: point.id, reason: note.trim() } : null, "destructive")}
      </>
    );
  }

  if (state.kind === "exclude") {
    const item = point.evidence.find((e) => e.pointEvidenceId === state.pointEvidenceId);
    return (
      <>
        <DialogHeader>
          <DialogTitle>Exclude this evidence?</DialogTitle>
          <DialogDescription>
            Excluded evidence no longer counts towards the point&rsquo;s status, but it is never deleted and stays visible to reviewers. The reason is recorded in the audit log.
          </DialogDescription>
        </DialogHeader>
        {item && <EvidenceQuote {...item} tone="muted" />}
        <div className="space-y-1.5">
          <Label htmlFor="exclude-reason">Reason</Label>
          <Textarea id="exclude-reason" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Superseded by a later decision." />
          <FieldError messages={fieldErrors?.reason} />
        </div>
        {footer(
          "Exclude evidence",
          note.trim() ? { action: "exclude_evidence", pointId: point.id, pointEvidenceId: state.pointEvidenceId, reason: note.trim() } : null,
          "destructive",
        )}
      </>
    );
  }

  // edit
  const editable = Object.entries(attributes).filter(([k]) => k !== "directContact");
  const input: ReviewPointInput | null =
    title.trim() && statement.trim() && note.trim()
      ? { action: "edit", pointId: point.id, expectedRevisionId: point.currentRevisionId, title: title.trim(), statement: statement.trim(), attributes, editReason: note.trim() }
      : null;

  return (
    <>
      <DialogHeader>
        <DialogTitle>Edit point</DialogTitle>
        <DialogDescription>
          Edits create a new revision. The original text and all evidence are kept. The point returns to pending, and shows as inferred until Baton re-checks its quotes against the new wording.
        </DialogDescription>
      </DialogHeader>
      <div className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="edit-title">Title</Label>
          <Input id="edit-title" value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="edit-statement">Statement</Label>
          <Textarea id="edit-statement" value={statement} maxLength={1000} onChange={(e) => setStatement(e.target.value)} />
        </div>
        {editable.length > 0 && (
          <fieldset className="grid gap-3 rounded-lg border border-border p-3 sm:grid-cols-2">
            <legend className="px-1 text-xs font-medium text-muted-foreground">Details</legend>
            {editable.map(([key, value]) => {
              const id = `attr-${key}`;
              const options = enumOptions(key);
              const label = attributeLabel(key);
              if (options) {
                return (
                  <div key={key} className="space-y-1.5">
                    <Label htmlFor={id}>{label}</Label>
                    <select
                      id={id}
                      value={(value as string | null) ?? ""}
                      onChange={(e) => setAttributes((a) => ({ ...a, [key]: e.target.value || null }))}
                      className="h-8 w-full rounded-lg border border-input bg-card px-2 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                    >
                      <option value="">Not set</option>
                      {Object.entries(options).map(([v, l]) => (
                        <option key={v} value={v}>
                          {l}
                        </option>
                      ))}
                    </select>
                  </div>
                );
              }
              if (Array.isArray(value)) {
                return (
                  <div key={key} className="space-y-1.5 sm:col-span-2">
                    <Label htmlFor={id}>{label} (comma-separated)</Label>
                    <Input
                      id={id}
                      value={(value as string[]).join(", ")}
                      onChange={(e) => setAttributes((a) => ({ ...a, [key]: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) }))}
                    />
                  </div>
                );
              }
              return (
                <div key={key} className="space-y-1.5">
                  <Label htmlFor={id}>{label}</Label>
                  <Input
                    id={id}
                    type={key === "dueDate" ? "date" : "text"}
                    value={(value as string | null) ?? ""}
                    onChange={(e) => setAttributes((a) => ({ ...a, [key]: e.target.value === "" ? null : e.target.value }))}
                  />
                </div>
              );
            })}
            <FieldError messages={fieldErrors?.attributes} />
          </fieldset>
        )}
        <div className="space-y-1.5">
          <Label htmlFor="edit-reason">Why are you changing it?</Label>
          <Input id="edit-reason" value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Added the deadline" />
          <FieldError messages={fieldErrors?.editReason} />
        </div>
      </div>
      {footer("Save revision", input)}
    </>
  );
}

function ConflictSides({ supports, contradicts }: { supports: PointDetail["evidence"]; contradicts: PointDetail["evidence"] }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <div className="space-y-2">
        <p className="text-xs font-medium text-status-sourced-fg">Supports ({supports.length})</p>
        {supports.map((e) => (
          <EvidenceQuote key={e.pointEvidenceId} {...e} tone="supports" clamp />
        ))}
      </div>
      <div className="space-y-2">
        <p className="text-xs font-medium text-status-conflicting-fg">Contradicts ({contradicts.length})</p>
        {contradicts.map((e) => (
          <EvidenceQuote key={e.pointEvidenceId} {...e} tone="contradicts" clamp />
        ))}
      </div>
    </div>
  );
}
