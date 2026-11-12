"use client";

import { useRouter } from "next/navigation";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { AlertCircle, ArrowLeft, ArrowRight, Check, CloudCheck, FileText, Loader2, MessageCircle, RotateCcw, Trash2, Upload, UserCheck, UserX } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { z } from "zod";

import { formatBytes, formatCount, formatDate } from "@/components/handover/format";
import { accessLevelMeta, identityKindLabel, sourceKindLabel } from "@/components/handover/labels";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { MaskedText } from "@/components/shared/masked-text";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAction } from "@/hooks/use-action";
import { ACCESS_LEVELS, MASK_KINDS, type AccessLevel, type DateOrder, type IdentityMatchDecision, type MaskKind, type SourceKind } from "@/lib/contracts/enums";
import type { SourceSummary } from "@/lib/contracts/dto";
import type { SourcePreview } from "@/lib/contracts/parser";
import { MAX_SOURCE_BYTES, createHandoverInput, type AddExclusionInput } from "@/lib/contracts/schemas";
import { createHandover, deleteHandover, startProcessing } from "@/lib/actions/handovers";
import { inviteMember } from "@/lib/actions/members";
import { addExclusion, confirmIdentityMatch, confirmSourceUploaded, createSourceUpload, previewSource, recordSourceConsent, removeSource } from "@/lib/actions/sources";
import { routes } from "@/lib/routes";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

import { blankSource, fromSummary, maxStepFor, signedTarget, type DraftSource } from "./draft-state";
import { CONSENT_STATEMENT_VERSION, ConsentChecklist, GroupNotice, MaskingTable, consentComplete, emptyConsent } from "./consent";

// Consent comes before any upload: the database refuses a preview until consent is recorded for the
// source (§10 steps 2–3; source_preview_target), so each upload records consent right after the server
// has verified the bytes, and only then asks for the preview.
const STEPS = [
  { id: "details", label: "Details" },
  { id: "privacy", label: "Privacy & consent" },
  { id: "sources", label: "Sources" },
  { id: "scope", label: "Scope & access" },
] as const;
const LAST_STEP = STEPS.length - 1;

const MAX_SOURCES = 10; // D15

interface Details {
  title: string;
  teamName: string;
  roleTitle: string;
  creatorRole: "outgoing" | "reviewer" | "";
  outgoingEmail: string;
  incomingEmail: string;
  incomingRole: "incoming" | "lead";
}



/** A draft reopened from the server (dashboard "Continue editing" or a refresh). */
export interface WizardInitial {
  handoverId: string;
  details: Pick<Details, "title" | "teamName" | "roleTitle" | "creatorRole">;
  sources: SourceSummary[];
  step: number;
}

const CHAT_ACCEPT = ".txt,.zip";
const DOC_ACCEPT = ".pdf,.docx,.md,.markdown";

function kindFor(fileName: string, group: "chat" | "doc"): SourceKind | null {
  const ext = fileName.toLowerCase().split(".").pop() ?? "";
  if (group === "chat") return ext === "txt" || ext === "zip" ? "whatsapp_export" : null;
  if (ext === "pdf") return "pdf";
  if (ext === "docx") return "docx";
  if (ext === "md" || ext === "markdown") return "markdown";
  return null;
}

const MIME: Record<SourceKind, string> = {
  whatsapp_export: "text/plain",
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  markdown: "text/markdown",
  text: "text/plain",
};

async function sha256Hex(data: ArrayBuffer) {
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** The browser's zone, used for consent and for every preview of this draft (D33: same parse context). */
function browserTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Kolkata";
  } catch {
    return "Asia/Kolkata";
  }
}


const dateOnly = (iso: string | null | undefined) => (iso ? iso.slice(0, 10) : "");

/** `YYYY-MM-DD` + wall-clock time in `timeZone` → ISO 8601 with that zone's offset (date ranges need an explicit offset). */
function zonedInstant(date: string, time: string, timeZone: string): string {
  const [y, m, d] = date.split("-").map(Number);
  const [hh, mm, ss] = time.split(":").map(Number);
  const guess = Date.UTC(y, m - 1, d, hh, mm, ss);
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" })
      .formatToParts(new Date(guess))
      .map((p) => [p.type, Number(p.value)]),
  );
  const offset = Math.round((Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second) - guess) / 60_000);
  const sign = offset < 0 ? "-" : "+";
  const abs = Math.abs(offset);
  return `${date}T${time}${sign}${String(Math.floor(abs / 60)).padStart(2, "0")}:${String(abs % 60).padStart(2, "0")}`;
}

/** An identity match waiting for the creator's answer (§6.8.1). */
interface PendingMatch {
  sourceLocalId: string;
  sourceId: string;
  sourceName: string;
  exclusionId: string;
  participantLocalId: string;
  label: string;
  kind: SourcePreview["participants"][number]["identityKind"];
}



type SaveState = { kind: "idle" } | { kind: "saving" } | { kind: "saved"; at: Date } | { kind: "error" };

export function NewHandoverWizard({ initial }: { initial?: WizardInitial }) {
  const router = useRouter();
  const reduceMotion = useReducedMotion();
  const { run, isPending } = useAction();
  const resumed = !!initial;
  const initialConsented = !!initial?.sources.some((s) => s.consentRecordedAt);
  const [step, setStep] = useState(() => Math.min(Math.max(initial?.step ?? 0, 0), LAST_STEP));
  const [details, setDetails] = useState<Details>({
    title: initial?.details.title ?? "",
    teamName: initial?.details.teamName ?? "",
    roleTitle: initial?.details.roleTitle ?? "",
    creatorRole: initial?.details.creatorRole ?? "",
    outgoingEmail: "",
    incomingEmail: "",
    incomingRole: "incoming",
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [handoverId, setHandoverId] = useState<string | null>(initial?.handoverId ?? null);
  const [invites, setInvites] = useState<Array<{ label: string; url: string }>>([]);
  const [sources, setSources] = useState<DraftSource[]>(() => (initial?.sources ?? []).map((s) => fromSummary(s, initialConsented)));
  // A consent already recorded for this draft's sources was given on this checklist; re-ask otherwise.
  const [consent, setConsent] = useState(() => (initialConsented ? { informed: true, provider: true, optout: true } : emptyConsent()));
  const [submitting, setSubmitting] = useState(false);
  const [savingScope, setSavingScope] = useState(false);
  const [save, setSave] = useState<SaveState>({ kind: "idle" });
  /** Identity decisions recorded with confirmIdentityMatch in this session (§6.8.1). */
  const [decisions, setDecisions] = useState<Array<PendingMatch & { decision: IdentityMatchDecision }>>([]);
  const timeZone = useRef(browserTimeZone()).current;

  const update = useCallback((id: string, patch: Partial<DraftSource>) => setSources((list) => list.map((s) => (s.localId === id ? { ...s, ...patch } : s))), []);

  /** Wraps a server write so the "Saving… / Saved / Couldn't save" line is truthful. */
  const saving = useCallback(async <R extends { ok: boolean }>(work: () => Promise<R>): Promise<R> => {
    setSave({ kind: "saving" });
    const r = await work();
    setSave(r.ok ? { kind: "saved", at: new Date() } : { kind: "error" });
    return r;
  }, []);

  // The step and the draft live in the URL, so a refresh or the dashboard reopens exactly here. The draft
  // itself (details, sources, consent, exclusions) is already in the database.
  useEffect(() => {
    if (!handoverId) return;
    const url = `${routes.handover.new}?draft=${encodeURIComponent(handoverId)}&step=${step}`;
    if (window.location.pathname + window.location.search !== url) window.history.replaceState(null, "", url);
  }, [handoverId, step]);

  // ── One place that turns a preview result into the source's state (upload, resume, date-order choice) ─
  const applyPreview = useCallback(
    (localId: string, preview: Awaited<ReturnType<typeof previewSource>>) => {
      if (!preview.ok) {
        if (preview.error.details?.parserCode === "date_format_ambiguous") {
          return update(localId, { status: "error", needsDateOrder: true, error: "Baton can't tell whether these dates are day/month or month/day. Which is it?" });
        }
        return update(localId, { status: "error", error: preview.error.message });
      }
      update(localId, { status: "ready", needsDateOrder: false, preview: preview.data, rangeFrom: dateOnly(preview.data.firstMessageAt), rangeTo: dateOnly(preview.data.lastMessageAt) });
    },
    [update],
  );

  // ── Consent + preview for one confirmed source ─────────────
  const consentAndPreview = useCallback(
    async (localId: string, sourceId: string, accessLevel: AccessLevel, dateOrder?: DateOrder) => {
      update(localId, { status: "consent", error: undefined, needsDateOrder: false });
      const c = await saving(() =>
        recordSourceConsent({ sourceId, consentStatementVersion: CONSENT_STATEMENT_VERSION, consentConfirmed: true, accessLevel, timezone: timeZone, dateOrder }),
      );
      if (!c.ok) return update(localId, { status: "error", error: c.error.message });
      update(localId, { status: "previewing", dateOrder });
      applyPreview(localId, await previewSource({ sourceId }));
    },
    [applyPreview, saving, timeZone, update],
  );

  // Reopened draft: preview sources that are uploaded (recording consent first where it is missing).
  const resumedOnce = useRef(false);
  useEffect(() => {
    if (resumedOnce.current || !initial) return;
    resumedOnce.current = true;
    // Every state update below happens after an await (the initial statuses come from fromSummary).
    for (const s of initial.sources) {
      if (s.state !== "uploaded" || (!s.consentRecordedAt && !initialConsented)) continue;
      void (async () => {
        if (!s.consentRecordedAt) {
          await Promise.resolve();
          return consentAndPreview(s.id, s.id, s.accessLevel);
        }
        applyPreview(s.id, await previewSource({ sourceId: s.id }));
      })();
    }
  }, [initial, initialConsented, consentAndPreview, applyPreview]);

  // ── Step 1 ────────────────────────────────────────────────
  async function submitDetails() {
    if (handoverId) return setStep(1);
    const next: Record<string, string> = {};
    const parsed = createHandoverInput.safeParse({
      title: details.title,
      teamName: details.teamName,
      roleTitle: details.roleTitle || undefined,
      creatorRole: details.creatorRole || undefined,
    });
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        const key = String(issue.path[0]);
        next[key] ??=
          key === "title" ? "Give the handover a title (at least 3 characters)." : key === "teamName" ? "Add the team or club name." : key === "creatorRole" ? "Choose who is leaving the role." : issue.message;
      }
    }
    if (details.creatorRole === "reviewer" && details.outgoingEmail && !z.email().safeParse(details.outgoingEmail).success) next.outgoingEmail = "Enter a valid email.";
    if (details.incomingEmail && !z.email().safeParse(details.incomingEmail).success) next.incomingEmail = "Enter a valid email.";
    setErrors(next);
    if (Object.keys(next).length > 0 || !parsed.success) return;

    const created = await saving(() => run(() => createHandover(parsed.data)));
    if (!created.ok) return;
    const id = created.data.id;
    setHandoverId(id); // the URL now carries the draft, so a retry or refresh reopens it instead of creating another
    const made: Array<{ label: string; url: string }> = [];
    if (details.incomingEmail) {
      const r = await run(() => inviteMember({ handoverId: id, email: details.incomingEmail, role: details.incomingRole }));
      if (r.ok) made.push({ label: `${details.incomingRole === "lead" ? "Incoming lead" : "Incoming member"} (${details.incomingEmail})`, url: r.data.url });
    }
    if (details.creatorRole === "reviewer" && details.outgoingEmail) {
      const r = await run(() => inviteMember({ handoverId: id, email: details.outgoingEmail, role: "outgoing" }));
      if (r.ok) made.push({ label: `Outgoing member (${details.outgoingEmail})`, url: r.data.url });
    }
    setInvites(made);
    setStep(1);
  }

  // ── Step 3: real signed upload → server verification → consent → preview ─
  async function uploadSource(localId: string, entry: { name: string; size: number; kind: SourceKind; file: File }) {
    if (!handoverId) return;
    if (entry.size > MAX_SOURCE_BYTES) return update(localId, { status: "error", error: "Files can be up to 25 MB." });
    if (entry.size === 0) return update(localId, { status: "error", error: "This file is empty." });
    update(localId, { status: "hashing", error: undefined });
    let sha: string;
    try {
      sha = await sha256Hex(await entry.file.arrayBuffer());
    } catch {
      return update(localId, { status: "error", error: "Couldn't read this file. Choose it again." });
    }
    update(localId, { status: "uploading" });
    const ticket = await saving(() =>
      createSourceUpload({ handoverId, kind: entry.kind, fileName: entry.name, mimeType: entry.file.type || MIME[entry.kind], sizeBytes: entry.size, sha256: sha }),
    );
    if (!ticket.ok) return update(localId, { status: "error", error: ticket.error.message });
    const { sourceId, signedUploadUrl, token } = ticket.data;
    update(localId, { sourceId });

    // The bytes go straight to the private bucket with the one-time signed URL; they never pass through a
    // server action. Success is reported only after the server re-measures them (confirmSourceUploaded).
    const target = signedTarget(signedUploadUrl);
    let uploadError = !target;
    if (target) {
      try {
        const { error } = await createSupabaseBrowserClient().storage.from(target.bucket).uploadToSignedUrl(target.path, token, entry.file, {
          contentType: entry.file.type || MIME[entry.kind],
          upsert: false,
        });
        uploadError = !!error;
      } catch {
        uploadError = true;
      }
    }
    if (uploadError) {
      await removeSource({ sourceId }); // don't leave a pending row behind; retry starts a fresh upload
      return update(localId, { status: "error", error: "The upload didn't go through. Check your connection and retry.", sourceId: undefined });
    }

    update(localId, { status: "verifying" });
    const confirmed = await saving(() => confirmSourceUploaded({ sourceId }));
    if (!confirmed.ok) {
      await removeSource({ sourceId });
      return update(localId, { status: "error", error: "The uploaded file didn't match what was sent. Retry the upload.", sourceId: undefined });
    }
    await consentAndPreview(localId, sourceId, "everyone");
  }

  function onFiles(files: FileList | null, group: "chat" | "doc") {
    if (!files) return;
    let count = sources.length;
    for (const file of Array.from(files)) {
      if (count >= MAX_SOURCES) break;
      count += 1;
      const localId = crypto.randomUUID();
      const kind = kindFor(file.name, group);
      if (!kind) {
        setSources((list) => [
          ...list,
          blankSource({ localId, name: file.name, size: file.size, kind: "text", status: "error", error: group === "chat" ? "Use a WhatsApp export (.txt or .zip)." : "Use a PDF, DOCX or Markdown file." }),
        ]);
        continue;
      }
      setSources((list) => [...list, blankSource({ localId, name: file.name, size: file.size, kind, status: "hashing", file })]);
      void uploadSource(localId, { name: file.name, size: file.size, kind, file });
    }
  }

  function chooseDateOrder(s: DraftSource, order: DateOrder) {
    if (!s.sourceId) return;
    void consentAndPreview(s.localId, s.sourceId, s.accessLevel, order);
  }

  function retry(s: DraftSource) {
    if (!s.file || s.kind === "text") return;
    void uploadSource(s.localId, { name: s.name, size: s.size, kind: s.kind, file: s.file });
  }

  async function remove(s: DraftSource) {
    if (s.sourceId) {
      const r = await saving(() => run(() => removeSource({ sourceId: s.sourceId! })));
      if (!r.ok) return;
    }
    setSources((list) => list.filter((x) => x.localId !== s.localId));
  }

  async function discard() {
    if (!handoverId) return;
    const r = await run(() => deleteHandover({ handoverId }), { success: "Draft discarded" });
    if (r.ok) router.push(routes.dashboard);
  }

  const ready = sources.filter((s) => s.status === "ready");
  const busy = sources.some((s) => s.status !== "ready" && s.status !== "error");

  // ── Scope: save people left out, then refresh every preview (D33) ─
  // Participant exclusions are saved first, because a handover-wide opt-out changes what the other chats'
  // previews show and may need a "same person?" answer (§6.8.1) before processing can start.
  async function saveParticipantExclusions(): Promise<boolean> {
    const pending = ready.filter((s) => s.excludedParticipants.length > 0);
    if (pending.length === 0) return true;
    setSavingScope(true);
    try {
      for (const s of pending) {
        let saved = 0;
        for (const localId of s.excludedParticipants) {
          const person = s.preview?.participants.find((p) => p.localId === localId);
          if (!person) continue;
          const identity = {
            kind: "participant" as const,
            sourceId: s.sourceId!,
            identityKind: person.identityKind,
            participantIdentityHash: person.identityHash,
            identityPepperVersion: person.identityPepperVersion,
          };
          // Phone numbers are strong identities: one handover-wide rule applies to every chat (§6.8).
          // A saved name is weak: a handover-wide name rule is only DETECTED elsewhere and never applies
          // to any source without that source's own same_person decision (§6.8.1).
          const inputs: AddExclusionInput[] =
            person.identityKind === "phone" ? [{ ...identity, scope: "handover" }] : [{ ...identity, scope: "source" }, { ...identity, scope: "handover" }];
          for (const input of inputs) {
            // conflict = this handover-wide identity is already recorded; nothing to add.
            const r = await saving(() => run(() => addExclusion(input), { onError: (e) => e.code === "conflict" }));
            if (!r.ok && r.error.code !== "conflict") return false;
          }
          saved += 1;
        }
        update(s.localId, { excludedParticipants: [], savedParticipantExclusions: s.savedParticipantExclusions + saved });
      }
      await refreshPreviews();
      return false; // previews changed: let the creator review them (and any matches) before starting
    } finally {
      setSavingScope(false);
    }
  }

  async function refreshPreviews() {
    const current = sources.filter((s) => s.status === "ready" && s.sourceId);
    await Promise.all(
      current.map(async (s) => {
        const r = await previewSource({ sourceId: s.sourceId! });
        if (r.ok) update(s.localId, { preview: r.data });
        else update(s.localId, { status: "error", error: r.error.message });
      }),
    );
  }

  async function answerMatch(m: PendingMatch, decision: IdentityMatchDecision) {
    const r = await saving(() =>
      run(() => confirmIdentityMatch({ sourceId: m.sourceId, exclusionId: m.exclusionId, decision }), {
        success: decision === "same_person" ? `${m.label} will be left out of ${m.sourceName}` : `${m.label} stays in ${m.sourceName}`,
      }),
    );
    if (!r.ok) return;
    setDecisions((list) => [...list.filter((d) => !(d.sourceId === m.sourceId && d.exclusionId === m.exclusionId)), { ...m, decision }]);
    const p = await previewSource({ sourceId: m.sourceId });
    if (p.ok) update(m.sourceLocalId, { preview: p.data });
  }

  // ── Finish: remaining exclusions, final access levels on the consent record, start processing ─
  async function finish() {
    if (!handoverId) return;
    setSubmitting(true);
    try {
      if (!(await saveParticipantExclusions())) return;
      for (const s of ready) {
        const preview = s.preview!;
        // Positional ids are bound to the preview they were chosen on (D32).
        const inputs: AddExclusionInput[] = s.excludedConversations.map((c) => ({ kind: "conversation", sourceId: s.sourceId!, conversationLocalId: c, parseContext: preview.parseContext }));
        const tz = preview.parseContext.timezone;
        const first = dateOnly(preview.firstMessageAt);
        const last = dateOnly(preview.lastMessageAt);
        if (s.rangeFrom && first && s.rangeFrom > first) {
          inputs.push({ kind: "date_range", sourceId: s.sourceId!, scope: "source", rangeStart: preview.firstMessageAt!, rangeEnd: zonedInstant(s.rangeFrom, "00:00:00", tz) });
        }
        if (s.rangeTo && last && s.rangeTo < last) {
          inputs.push({ kind: "date_range", sourceId: s.sourceId!, scope: "source", rangeStart: zonedInstant(s.rangeTo, "23:59:59", tz), rangeEnd: preview.lastMessageAt! });
        }
        for (const input of inputs) {
          const r = await saving(() => run(() => addExclusion(input)));
          if (!r.ok) return;
        }
        // Same statement and zone as at upload; this records the chosen access level and document date.
        const c = await saving(() =>
          run(() =>
            recordSourceConsent({
              sourceId: s.sourceId!,
              consentStatementVersion: CONSENT_STATEMENT_VERSION,
              consentConfirmed: true,
              accessLevel: s.accessLevel,
              timezone: tz,
              dateOrder: s.dateOrder, // keep the creator's choice: the final parse must match the preview (D32)
              documentDate: s.kind !== "whatsapp_export" && s.documentDate ? s.documentDate : undefined,
            }),
          ),
        );
        if (!c.ok) return;
      }
      const started = await run(() => startProcessing({ handoverId }), { success: "Processing started" });
      if (started.ok) router.push(routes.handover.processing(handoverId));
    } finally {
      setSubmitting(false);
    }
  }

  const matches: PendingMatch[] = ready.flatMap((s) =>
    (s.preview?.identityMatches ?? []).flatMap((m) => {
      const person = s.preview!.participants.find((p) => p.localId === m.participantLocalId);
      return m.ruleId && person
        ? [{ sourceLocalId: s.localId, sourceId: s.sourceId!, sourceName: s.name, exclusionId: m.ruleId, participantLocalId: m.participantLocalId, label: person.displayLabel, kind: m.identityKind }]
        : [];
    }),
  );
  const consentGiven = consentComplete(consent);
  const canNext = step === 0 ? true : step === 1 ? consentGiven : step === 2 ? ready.length > 0 && !busy : matches.length === 0 && !busy && !savingScope;
  const detectedMasking = ready.reduce<Partial<Record<MaskKind, number>>>((acc, s) => {
    for (const k of MASK_KINDS) acc[k] = (acc[k] ?? 0) + (s.preview?.masking.counts[k] ?? 0);
    return acc;
  }, {});
  const pendingPeople = ready.some((s) => s.excludedParticipants.length > 0);
  // Never let the step indicator run ahead of what the draft really holds.
  const maxStep = maxStepFor({ hasDraft: !!handoverId, consentGiven, readySources: ready.length }, LAST_STEP);
  const shownStep = Math.min(step, maxStep);

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SaveStatus save={save} hasDraft={!!handoverId} />
        {handoverId && (
          <ConfirmDialog
            trigger={
              <Button size="sm" variant="ghost">
                <Trash2 aria-hidden="true" data-icon="inline-start" />
                Discard draft
              </Button>
            }
            title="Discard this draft?"
            description="The draft and its uploaded files are removed from your workspace. This can't be undone here."
            confirmLabel="Discard draft"
            destructive
            onConfirm={discard}
          />
        )}
      </div>

      <ol aria-label="Steps" className="grid grid-cols-4 gap-2">
        {STEPS.map((s, i) => (
          <li key={s.id} aria-current={i === shownStep ? "step" : undefined} className="space-y-2">
            <div className={cn("h-1 rounded-full transition-colors", i <= shownStep ? "bg-primary" : "bg-muted")} />
            <p className={cn("text-xs font-medium", i === shownStep ? "text-foreground" : "text-muted-foreground")}>
              <span className="font-mono">{i + 1}</span>
              <span className="hidden sm:inline"> · {s.label}</span>
            </p>
          </li>
        ))}
      </ol>
      <p className="text-sm font-medium sm:hidden">{STEPS[shownStep].label}</p>

      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={shownStep}
          initial={reduceMotion ? false : { opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={reduceMotion ? undefined : { opacity: 0, y: -4 }}
          transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
          className="space-y-6"
        >
          {shownStep === 0 && <DetailsStep details={details} setDetails={setDetails} errors={errors} locked={!!handoverId} invites={invites} resumed={resumed} />}
          {shownStep === 1 && (
            <div className="space-y-6">
              <section className="space-y-2">
                <h2 className="font-serif text-2xl">Privacy and consent</h2>
                <p className="text-sm leading-relaxed text-muted-foreground">
                  Before any file is read, confirm how Baton may use it. Baton masks personal and financial details in memory before anything is saved,
                  deletes the raw upload once processing succeeds, and keeps only masked, permitted evidence. Consent is recorded for each file as it is
                  uploaded.
                </p>
              </section>
              <GroupNotice teamName={details.teamName} />
              <ConsentChecklist value={consent} onChange={setConsent} />
              {!consentGiven && <p className="text-xs text-muted-foreground">Tick every statement to continue. Without consent, nothing can be uploaded.</p>}
            </div>
          )}
          {shownStep === 2 && <SourcesStep sources={sources} onFiles={onFiles} onRemove={remove} onRetry={retry} onDateOrder={chooseDateOrder} full={sources.length >= MAX_SOURCES} />}
          {shownStep === 3 && (
            <div className="space-y-6">
              <ScopeStep sources={ready} update={update} />
              {(matches.length > 0 || decisions.length > 0) && (
                <MatchesSection
                  matches={matches}
                  decisions={decisions.filter((d) => ready.some((s) => s.sourceId === d.sourceId))}
                  onAnswer={answerMatch}
                  disabled={isPending}
                />
              )}
              <MaskingTable counts={detectedMasking} />
            </div>
          )}
        </motion.div>
      </AnimatePresence>

      <div className="flex items-center justify-between gap-3 border-t border-border pt-6">
        <Button variant="ghost" onClick={() => setStep(Math.max(0, shownStep - 1))} disabled={shownStep === 0 || submitting}>
          <ArrowLeft aria-hidden="true" data-icon="inline-start" />
          Back
        </Button>
        {shownStep < LAST_STEP ? (
          <Button size="lg" disabled={!canNext || isPending} onClick={() => (shownStep === 0 ? submitDetails() : setStep(shownStep + 1))}>
            {isPending && shownStep === 0 ? "Creating…" : shownStep === 0 && !handoverId ? "Create draft and continue" : "Continue"}
            <ArrowRight aria-hidden="true" data-icon="inline-end" />
          </Button>
        ) : (
          <Button size="lg" disabled={!canNext || submitting} onClick={finish} aria-busy={submitting || savingScope}>
            {submitting || savingScope ? "Saving…" : pendingPeople ? "Save and review" : "Start processing"}
            <ArrowRight aria-hidden="true" data-icon="inline-end" />
          </Button>
        )}
      </div>
    </div>
  );
}

function SaveStatus({ save, hasDraft }: { save: SaveState; hasDraft: boolean }) {
  if (!hasDraft) return <p className="text-xs text-muted-foreground">Nothing is saved until you create the draft.</p>;
  if (save.kind === "saving")
    return (
      <p role="status" className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Loader2 aria-hidden="true" className="size-3.5 animate-spin" /> Saving…
      </p>
    );
  if (save.kind === "error")
    return (
      <p role="status" className="flex items-center gap-1.5 text-xs text-destructive">
        <AlertCircle aria-hidden="true" className="size-3.5" /> Couldn&rsquo;t save the last change. Try that step again.
      </p>
    );
  return (
    <p role="status" className="flex items-center gap-1.5 text-xs text-muted-foreground">
      <CloudCheck aria-hidden="true" className="size-3.5 text-status-sourced" />
      Draft saved{save.kind === "saved" ? ` · ${save.at.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : ""}. You can leave and continue from the dashboard.
    </p>
  );
}

// ── Steps ────────────────────────────────────────────────────────────────────

function Field({ label, htmlFor, hint, error, children }: { label: string; htmlFor: string; hint?: string; error?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {error ? <p className="text-xs text-destructive">{error}</p> : hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

function DetailsStep({ details, setDetails, errors, locked, invites, resumed }: { details: Details; setDetails: (d: Details) => void; errors: Record<string, string>; locked: boolean; invites: Array<{ label: string; url: string }>; resumed: boolean }) {
  const set = <K extends keyof Details>(k: K, v: Details[K]) => setDetails({ ...details, [k]: v });
  return (
    <div className="space-y-6">
      <section className="space-y-2">
        <h2 className="font-serif text-2xl">What is being handed over?</h2>
        <p className="text-sm text-muted-foreground">Name the role and the people involved. You can invite more people later in Settings.</p>
      </section>
      {locked && (
        <div className="space-y-2 rounded-xl border border-status-sourced/25 bg-status-sourced-soft px-4 py-3 text-sm text-status-sourced-fg">
          <p className="flex items-center gap-2 font-medium">
            <Check aria-hidden="true" className="size-4" /> Draft handover saved. Title, team and role can&rsquo;t be edited after creation yet.
          </p>
          {resumed && <p className="text-xs">Invitations sent earlier are listed in Settings once processing starts.</p>}
          {invites.length > 0 && (
            <ul className="space-y-1 text-xs">
              {invites.map((i) => (
                <li key={i.url}>
                  Invite link for {i.label}: <code className="font-mono break-all">{i.url}</code>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      <fieldset disabled={locked} className="grid gap-5 disabled:opacity-70 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <Field label="Handover title" htmlFor="title" error={errors.title} hint="For example, “CodeCell technical lead”.">
            <Input id="title" value={details.title} maxLength={120} onChange={(e) => set("title", e.target.value)} aria-invalid={!!errors.title} />
          </Field>
        </div>
        <Field label="Team or club" htmlFor="team" error={errors.teamName}>
          <Input id="team" value={details.teamName} maxLength={120} onChange={(e) => set("teamName", e.target.value)} aria-invalid={!!errors.teamName} />
        </Field>
        <Field label="Role (optional)" htmlFor="role">
          <Input id="role" value={details.roleTitle} maxLength={120} onChange={(e) => set("roleTitle", e.target.value)} placeholder="Treasurer" />
        </Field>

        <fieldset className="space-y-2 sm:col-span-2">
          <legend className="text-sm font-medium">Are you the person leaving this role?</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {(
              [
                ["outgoing", "Yes, I'm leaving", "You'll review the handover as the outgoing member."],
                ["reviewer", "No, I'm setting it up for someone", "You'll review it; invite the outgoing member below."],
              ] as const
            ).map(([value, title, desc]) => (
              <label key={value} className="flex cursor-pointer items-start gap-3 rounded-lg border border-border bg-card p-3 text-sm has-checked:border-primary/50 has-checked:ring-3 has-checked:ring-primary/10">
                <input type="radio" name="creatorRole" value={value} checked={details.creatorRole === value} onChange={() => set("creatorRole", value)} className="mt-0.5 accent-primary" />
                <span>
                  <span className="block font-medium">{title}</span>
                  <span className="text-xs text-muted-foreground">{desc}</span>
                </span>
              </label>
            ))}
          </div>
          {errors.creatorRole && <p className="text-xs text-destructive">{errors.creatorRole}</p>}
        </fieldset>

        {details.creatorRole === "reviewer" && (
          <div className="sm:col-span-2">
            <Field label="Outgoing member's email (optional)" htmlFor="outgoing" error={errors.outgoingEmail} hint="They get their own sign-in link and can review alongside you.">
              <Input id="outgoing" type="email" value={details.outgoingEmail} onChange={(e) => set("outgoingEmail", e.target.value)} aria-invalid={!!errors.outgoingEmail} />
            </Field>
          </div>
        )}

        <Field label="Incoming member's email" htmlFor="incoming" error={errors.incomingEmail} hint="You can add this later, but you need it before publishing.">
          <Input id="incoming" type="email" value={details.incomingEmail} onChange={(e) => set("incomingEmail", e.target.value)} aria-invalid={!!errors.incomingEmail} />
        </Field>
        <Field label="Their role" htmlFor="incoming-role" hint={details.incomingRole === "lead" ? "Leads see lead-level information." : "Sees everything marked Everyone."}>
          <select
            id="incoming-role"
            value={details.incomingRole}
            onChange={(e) => set("incomingRole", e.target.value as Details["incomingRole"])}
            className="h-8 w-full rounded-lg border border-input bg-card px-2 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            <option value="incoming">Incoming member</option>
            <option value="lead">Incoming lead</option>
          </select>
        </Field>
      </fieldset>
    </div>
  );
}

function DropZone({ id, title, description, accept, icon, onFiles, disabled }: { id: string; title: string; description: string; accept: string; icon: React.ReactNode; onFiles: (f: FileList | null) => void; disabled: boolean }) {
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        if (!disabled) onFiles(e.dataTransfer.files);
      }}
      className={cn(
        "flex flex-col items-center rounded-xl border border-dashed bg-card/60 px-4 py-8 text-center transition-colors",
        over ? "border-primary bg-primary/[0.04]" : "border-border-strong",
        disabled && "opacity-50",
      )}
    >
      <div aria-hidden="true" className="mb-3 flex size-10 items-center justify-center rounded-xl border border-border bg-card text-muted-foreground shadow-soft [&_svg]:size-5">
        {icon}
      </div>
      <p className="text-sm font-medium">{title}</p>
      <p className="mt-1 text-xs text-muted-foreground">{description}</p>
      <input ref={input} id={id} type="file" multiple accept={accept} className="sr-only" onChange={(e) => { onFiles(e.target.files); e.target.value = ""; }} disabled={disabled} />
      <Button size="sm" variant="outline" className="mt-4" onClick={() => input.current?.click()} disabled={disabled}>
        <Upload aria-hidden="true" data-icon="inline-start" />
        Choose files
      </Button>
    </div>
  );
}

function SourcesStep({ sources, onFiles, onRemove, onRetry, onDateOrder, full }: { sources: DraftSource[]; onFiles: (f: FileList | null, g: "chat" | "doc") => void; onRemove: (s: DraftSource) => void; onRetry: (s: DraftSource) => void; onDateOrder: (s: DraftSource, o: DateOrder) => void; full: boolean }) {
  const uid = useId();
  return (
    <div className="space-y-6">
      <section className="space-y-2">
        <h2 className="font-serif text-2xl">Add the team&rsquo;s record</h2>
        <p className="text-sm text-muted-foreground">
          Export WhatsApp chats without media (Chat → More → Export chat → Without media) and add any handbooks or notes. Up to 10 files, 25 MB each.
        </p>
      </section>
      <div className="grid gap-4 sm:grid-cols-2">
        <DropZone id={`${uid}-chat`} title="WhatsApp chat exports" description=".txt or .zip (text only)" accept={CHAT_ACCEPT} icon={<MessageCircle />} onFiles={(f) => onFiles(f, "chat")} disabled={full} />
        <DropZone id={`${uid}-doc`} title="Documents" description="PDF, DOCX or Markdown" accept={DOC_ACCEPT} icon={<FileText />} onFiles={(f) => onFiles(f, "doc")} disabled={full} />
      </div>

      {sources.length > 0 && (
        <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card" aria-label="Added sources">
          {sources.map((s) => (
            <li key={s.localId} className="flex items-center gap-3 px-4 py-3">
              {s.kind === "whatsapp_export" ? <MessageCircle aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" /> : <FileText aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />}
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{s.name}</p>
                <p className={cn("text-xs", s.status === "error" ? "text-destructive" : "text-muted-foreground")}>
                  {s.status === "error"
                    ? s.error
                    : s.status === "ready"
                      ? `${sourceKindLabel[s.kind]} · ${formatBytes(s.size)} · ${s.kind === "whatsapp_export" ? `${formatCount(s.preview?.stats.messagesKept)} messages, ${s.preview?.participants.length ?? 0} people` : `${formatCount(s.preview?.stats.messagesKept)} text blocks`}`
                      : s.status === "hashing"
                        ? "Checking file…"
                        : s.status === "uploading"
                          ? "Uploading to private storage…"
                          : s.status === "verifying"
                            ? "Verifying the upload…"
                            : s.status === "consent"
                              ? "Recording consent…"
                              : "Reading a preview…"}
                </p>
              </div>
              {s.status === "ready" ? (
                <Check aria-label="Ready" className="size-4 text-status-sourced" />
              ) : s.status !== "error" ? (
                <Loader2 aria-label="Working" className="size-4 animate-spin text-primary" />
              ) : null}
              {s.status === "error" && s.needsDateOrder && (
                <span className="flex flex-wrap gap-1" role="group" aria-label={`Date format for ${s.name}`}>
                  <Button size="sm" variant="outline" onClick={() => onDateOrder(s, "dmy")}>Day/Month (31/12)</Button>
                  <Button size="sm" variant="outline" onClick={() => onDateOrder(s, "mdy")}>Month/Day (12/31)</Button>
                </span>
              )}
              {s.status === "error" && !s.needsDateOrder && s.file && s.kind !== "text" && (
                <Button size="sm" variant="ghost" onClick={() => onRetry(s)}>
                  <RotateCcw aria-hidden="true" data-icon="inline-start" />
                  Retry
                </Button>
              )}
              <Button size="icon-sm" variant="ghost" aria-label={`Remove ${s.name}`} onClick={() => onRemove(s)} disabled={s.status !== "ready" && s.status !== "error"}>
                <Trash2 />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ScopeStep({ sources, update }: { sources: DraftSource[]; update: (id: string, patch: Partial<DraftSource>) => void }) {
  const toggle = (list: string[], v: string) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  return (
    <div className="space-y-6">
      <section className="space-y-2">
        <h2 className="font-serif text-2xl">Choose what Baton reads</h2>
        <p className="text-sm text-muted-foreground">
          Narrow each chat to the relevant dates, leave out off-topic conversations and anyone who opted out, and decide who may see evidence from each source.
        </p>
      </section>
      {sources.some((s) => s.excludedParticipants.length > 0) && (
        <p className="rounded-lg border border-status-inferred/25 bg-status-inferred-soft px-3 py-2 text-xs text-status-inferred-fg" role="status">
          People you leave out are saved when you continue, for every chat in this handover. That can&rsquo;t be undone here.
        </p>
      )}
      {sources.map((s) => {
        const p = s.preview;
        const keptConversations = p?.conversations.filter((c) => !s.excludedConversations.includes(c.localId)) ?? [];
        return (
          <section key={s.localId} className="space-y-5 rounded-xl border border-border bg-card p-4 shadow-soft sm:p-5" aria-label={s.name}>
            <div className="flex items-center gap-2">
              {s.kind === "whatsapp_export" ? <MessageCircle aria-hidden="true" className="size-4 text-muted-foreground" /> : <FileText aria-hidden="true" className="size-4 text-muted-foreground" />}
              <h3 className="min-w-0 truncate text-sm font-semibold">{s.name}</h3>
            </div>

            {s.kind === "whatsapp_export" && p ? (
              <>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor={`${s.localId}-from`}>From</Label>
                    <Input id={`${s.localId}-from`} type="date" value={s.rangeFrom} min={dateOnly(p.firstMessageAt)} max={s.rangeTo || dateOnly(p.lastMessageAt)} onChange={(e) => update(s.localId, { rangeFrom: e.target.value })} />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor={`${s.localId}-to`}>To</Label>
                    <Input id={`${s.localId}-to`} type="date" value={s.rangeTo} min={s.rangeFrom || dateOnly(p.firstMessageAt)} max={dateOnly(p.lastMessageAt)} onChange={(e) => update(s.localId, { rangeTo: e.target.value })} />
                  </div>
                  <p className="text-xs text-muted-foreground sm:col-span-2">
                    The export covers {formatDate(p.firstMessageAt)} to {formatDate(p.lastMessageAt)}.
                  </p>
                </div>

                <fieldset className="space-y-2">
                  <legend className="mb-1 text-sm font-medium">
                    Conversations <span className="font-normal text-muted-foreground">· {keptConversations.length} of {p.conversations.length} included</span>
                  </legend>
                  {p.conversations.map((c) => {
                    const included = !s.excludedConversations.includes(c.localId);
                    return (
                      <label key={c.localId} className={cn("flex items-start gap-3 rounded-lg border border-border p-3 text-sm", !included && "bg-muted/50 text-muted-foreground")}>
                        <input type="checkbox" className="mt-0.5 size-4 accent-primary" checked={included} onChange={() => update(s.localId, { excludedConversations: toggle(s.excludedConversations, c.localId) })} />
                        <span className="min-w-0">
                          <MaskedText text={c.preview} className={cn("block font-mono text-xs", !included && "line-through")} />
                          <span className="text-xs text-muted-foreground">
                            {formatDate(c.startedAt)} – {formatDate(c.endedAt)} · {formatCount(c.messageCount)} messages
                          </span>
                        </span>
                      </label>
                    );
                  })}
                </fieldset>

                <fieldset className="space-y-2">
                  <legend className="mb-1 text-sm font-medium">People</legend>
                  <p className="text-xs text-muted-foreground">
                    Untick anyone who asked to be left out. Their messages are dropped before anything is saved, in every chat of this handover, including later uploads.
                    People saved under a name, not a number, are matched in other chats only after you confirm it&rsquo;s the same person.
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {p.participants.map((person) => {
                      const included = !s.excludedParticipants.includes(person.localId);
                      return (
                        <label
                          key={person.localId}
                          title={identityKindLabel[person.identityKind].label}
                          className={cn("inline-flex items-center gap-2 rounded-full border border-border px-3 py-1 text-xs", !included && "bg-muted text-muted-foreground line-through")}
                        >
                          <input type="checkbox" className="size-3.5 accent-primary" checked={included} onChange={() => update(s.localId, { excludedParticipants: toggle(s.excludedParticipants, person.localId) })} />
                          {person.displayLabel}
                          <span className="text-muted-foreground no-underline">{formatCount(person.messageCount)}</span>
                        </label>
                      );
                    })}
                  </div>
                  {(s.savedParticipantExclusions > 0 || p.stats.messagesExcluded > 0) && (
                    <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <UserX aria-hidden="true" className="size-3.5" />
                      {s.savedParticipantExclusions > 0 ? `${s.savedParticipantExclusions === 1 ? "1 person" : `${s.savedParticipantExclusions} people`} left out and saved. ` : ""}
                      {formatCount(p.stats.messagesExcluded)} messages won&rsquo;t be read.
                      {p.warnings.some((w) => w.code === "excluded_mentions_redacted") && " Mentions of them in other messages are removed."}
                    </p>
                  )}
                </fieldset>
              </>
            ) : (
              <div className="max-w-xs space-y-1.5">
                <Label htmlFor={`${s.localId}-date`}>Document date (optional)</Label>
                <Input id={`${s.localId}-date`} type="date" value={s.documentDate} onChange={(e) => update(s.localId, { documentDate: e.target.value })} />
                <p className="text-xs text-muted-foreground">Used to flag points that may be outdated.</p>
              </div>
            )}

            <fieldset className="space-y-2">
              <legend className="mb-1 text-sm font-medium">Who can see evidence from this source?</legend>
              <div className="grid gap-2 sm:grid-cols-3">
                {ACCESS_LEVELS.map((level) => (
                  <label key={level} className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-border p-3 text-sm has-checked:border-primary/50 has-checked:ring-3 has-checked:ring-primary/10">
                    <input type="radio" name={`${s.localId}-access`} className="mt-0.5 accent-primary" checked={s.accessLevel === level} onChange={() => update(s.localId, { accessLevel: level })} />
                    <span>
                      <span className="block font-medium">{accessLevelMeta[level].label}</span>
                      <span className="text-xs text-muted-foreground">{accessLevelMeta[level].description}</span>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
          </section>
        );
      })}
    </div>
  );
}

function MatchesSection({
  matches,
  decisions,
  onAnswer,
  disabled,
}: {
  matches: PendingMatch[];
  decisions: Array<PendingMatch & { decision: IdentityMatchDecision }>;
  onAnswer: (m: PendingMatch, d: IdentityMatchDecision) => void;
  disabled: boolean;
}) {
  return (
    <section aria-labelledby="matches-heading" className="space-y-3 rounded-xl border border-status-inferred/30 bg-status-inferred-soft/60 p-4 sm:p-5">
      <div className="space-y-1">
        <h3 id="matches-heading" className="text-sm font-semibold">
          Is this the same person?
        </h3>
        <p className="text-xs text-muted-foreground">
          Someone who asked to be left out was saved under the same name in another chat. Names can be shared, so Baton never assumes: nobody is left out of a
          chat by name until you say so for that chat. Answer each one before processing.
        </p>
      </div>
      {matches.length > 0 && (
        <ul className="space-y-2" aria-label="Waiting for your answer">
          {matches.map((m) => (
            <li key={`${m.sourceId}-${m.exclusionId}-${m.participantLocalId}`} className="flex flex-col gap-2 rounded-lg border border-border bg-card p-3 sm:flex-row sm:items-center">
              <p className="min-w-0 flex-1 text-sm">
                <span className="font-medium">{m.label}</span> <span className="text-muted-foreground">in {m.sourceName}</span>
                <span className="block text-xs text-muted-foreground">{identityKindLabel[m.kind].label} match · no decision yet</span>
              </p>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" disabled={disabled} onClick={() => onAnswer(m, "different_person")}>
                  <UserCheck aria-hidden="true" data-icon="inline-start" />
                  Different person, keep
                </Button>
                <Button size="sm" disabled={disabled} onClick={() => onAnswer(m, "same_person")}>
                  <UserX aria-hidden="true" data-icon="inline-start" />
                  Same person, leave out
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {decisions.length > 0 && (
        <ul className="space-y-2" aria-label="Your decisions">
          {decisions.map((d) => (
            <li key={`${d.sourceId}-${d.exclusionId}`} className="flex flex-col gap-2 rounded-lg border border-border bg-card/70 p-3 sm:flex-row sm:items-center">
              <p className="min-w-0 flex-1 text-sm">
                <span className="font-medium">{d.label}</span> <span className="text-muted-foreground">in {d.sourceName}</span>
                <span className="block text-xs text-muted-foreground">
                  {d.decision === "same_person" ? "You said: same person. Left out of this chat." : "You said: different person. Kept in this chat."}
                </span>
              </p>
              <Button size="sm" variant="ghost" disabled={disabled} onClick={() => onAnswer(d, d.decision === "same_person" ? "different_person" : "same_person")}>
                Change to {d.decision === "same_person" ? "different person" : "same person"}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
