"use client";

import { useRouter } from "next/navigation";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { ArrowLeft, ArrowRight, Link2, Lock, Trash2, UserCheck, UserX } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { z } from "zod";

import { identityKindLabel } from "@/components/handover/labels";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { SaveIndicator } from "@/components/shared/save-indicator";
import type { SaveState } from "@/components/shared/save-state";
import { Stepper } from "@/components/shared/stepper";
import { phaseForError } from "@/components/shared/upload-status";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { ChoiceCard } from "@/components/ui/choice-card";
import { Field, FieldGroup, fieldDescribedBy } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { useAction } from "@/hooks/use-action";
import { MASK_KINDS, type AccessLevel, type DateOrder, type IdentityMatchDecision, type MaskKind, type SourceKind } from "@/lib/contracts/enums";
import type { HandoverSummary, SourceSummary } from "@/lib/contracts/dto";
import type { SourcePreview } from "@/lib/contracts/parser";
import { MAX_SOURCE_BYTES, createHandoverInput, type AddExclusionInput } from "@/lib/contracts/schemas";
import { createHandover, deleteHandover, startProcessing } from "@/lib/actions/handovers";
import { inviteMember } from "@/lib/actions/members";
import { addExclusion, confirmIdentityMatch, confirmSourceUploaded, createSourceUpload, previewSource, recordSourceConsent, removeSource } from "@/lib/actions/sources";
import { routes } from "@/lib/routes";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

import { blankSource, fromSummary, maxStepFor, phaseOf, signedTarget, type DraftSource } from "./draft-state";
import { CONSENT_STATEMENT_VERSION, ConsentChecklist, GroupNotice, MaskingTable, consentComplete, emptyConsent } from "./consent";
import type { DetailsValues } from "./details-save";
import { ScopeStep } from "./scope-step";
import { SourcesStep } from "./sources-step";
import { useDetailsAutosave } from "./use-details-autosave";

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
  /** `undefined` while the stored description isn't known (resumed draft on an older summary). */
  description?: string;
  creatorRole: "outgoing" | "reviewer" | "";
  outgoingEmail: string;
  incomingEmail: string;
  incomingRole: "incoming" | "lead";
}

/** A draft reopened from the server (dashboard "Continue", a refresh, or a reload after a conflict). */
export interface WizardInitial {
  handoverId: string;
  /** HandoverSummary.updatedAt — the version the details editor starts from. */
  updatedAt: string;
  details: Pick<Details, "title" | "teamName" | "roleTitle" | "description" | "creatorRole">;
  sources: SourceSummary[];
  step: number;
}

function kindFor(fileName: string, group: "chat" | "doc"): SourceKind | null {
  const ext = fileName.toLowerCase().split(".").pop() ?? "";
  // A .txt is decided by its contents (looksLikeChatExport); this is only the starting guess.
  if (ext === "txt") return group === "chat" ? "whatsapp_export" : "text";
  if (group === "chat") return ext === "zip" ? "whatsapp_export" : null;
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

/** WhatsApp exports start lines with a date + time stamp ("12/03/24, 9:41 pm - …" or "[12/03/24, 09:41:07] …"). */
const CHAT_LINE = /^\u200e?\[?\d{1,4}[/.-]\d{1,2}[/.-]\d{1,4},?\s+\d{1,2}[:.]\d{2}/m;

async function looksLikeChatExport(file: File): Promise<boolean> {
  try {
    return CHAT_LINE.test(await file.slice(0, 8192).text());
  } catch {
    return true; // can't tell: keep the chat default; the user can switch it on the row
  }
}

const isTxt = (name: string) => name.toLowerCase().endsWith(".txt");

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

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

const valuesOf = (d: Pick<Details, "title" | "teamName" | "roleTitle" | "description">): DetailsValues => ({
  title: d.title,
  teamName: d.teamName,
  roleTitle: d.roleTitle,
  ...(d.description !== undefined ? { description: d.description } : {}),
});

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
    description: initial ? initial.details.description : "",
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
  const [save, setSave] = useState<SaveState>(() => (initial ? { kind: "saved", at: initial.updatedAt } : { kind: "unsaved" }));
  const [skipped, setSkipped] = useState(0);
  /** Identity decisions recorded with confirmIdentityMatch in this session (§6.8.1). */
  const [decisions, setDecisions] = useState<Array<PendingMatch & { decision: IdentityMatchDecision }>>([]);
  const timeZone = useRef(browserTimeZone()).current;

  // Server version of the details: from the reopened draft, the create result, or a reload.
  const [server, setServer] = useState<{ updatedAt: string; values: DetailsValues } | null>(() =>
    initial ? { updatedAt: initial.updatedAt, values: valuesOf(initial.details) } : null,
  );
  const reloadPending = useRef(false);

  const autosave = useDetailsAutosave({
    handoverId,
    serverUpdatedAt: server?.updatedAt ?? null,
    savedValues: server?.values ?? null,
    onState: setSave,
    onFieldErrors: (e) => setErrors((prev) => ({ ...Object.fromEntries(Object.entries(prev).filter(([k]) => !["title", "teamName", "roleTitle", "description"].includes(k))), ...e })),
    onSaved: (h: HandoverSummary, sent) => {
      // The server masks free text: show what was stored if it differs and nothing newer was typed.
      setDetails((d) =>
        d.title === sent.title && d.teamName === sent.teamName && d.roleTitle === sent.roleTitle && d.description === sent.description
          ? { ...d, title: h.title, teamName: h.teamName, roleTitle: h.roleTitle ?? "", description: sent.description === undefined ? d.description : (h.description ?? "") }
          : d,
      );
    },
    onStale: () => {
      reloadPending.current = true;
      router.refresh();
    },
    onNotDraft: () => {
      if (handoverId) router.push(routes.handover.processing(handoverId));
    },
  });

  // A reload (after a conflict, or on returning to Details) brings a newer server version.
  useEffect(() => {
    if (!initial || (server && initial.updatedAt <= server.updatedAt)) return;
    const values = valuesOf(initial.details);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- adopting a newer server version of the draft
    setServer({ updatedAt: initial.updatedAt, values });
    if (reloadPending.current) {
      reloadPending.current = false;
      setDetails((d) => ({ ...d, ...values, description: initial.details.description }));
    }
  }, [initial, server]);

  const update = useCallback((id: string, patch: Partial<DraftSource>) => setSources((list) => list.map((s) => (s.localId === id ? { ...s, ...patch } : s))), []);

  /** Wraps a server write so the save indicator is truthful. */
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
        const parserCode = typeof preview.error.details?.parserCode === "string" ? preview.error.details.parserCode : undefined;
        if (parserCode === "date_format_ambiguous") {
          return update(localId, { status: "error", needsDateOrder: true, errorPhase: "needs_input", error: "Baton can't tell whether these dates are day/month or month/day. Which is it?" });
        }
        return update(localId, { status: "error", errorPhase: phaseForError({ code: preview.error.code, parserCode }), error: preview.error.message });
      }
      update(localId, { status: "ready", needsDateOrder: false, errorPhase: undefined, preview: preview.data, rangeFrom: dateOnly(preview.data.firstMessageAt), rangeTo: dateOnly(preview.data.lastMessageAt) });
    },
    [update],
  );

  // ── Consent + preview for one confirmed source ─────────────
  const consentAndPreview = useCallback(
    async (localId: string, sourceId: string, accessLevel: AccessLevel, dateOrder?: DateOrder) => {
      update(localId, { status: "consent", error: undefined, errorPhase: undefined, needsDateOrder: false });
      const c = await saving(() =>
        recordSourceConsent({ sourceId, consentStatementVersion: CONSENT_STATEMENT_VERSION, consentConfirmed: true, accessLevel, timezone: timeZone, dateOrder }),
      );
      if (!c.ok) return update(localId, { status: "error", errorPhase: "failed", error: c.error.message });
      update(localId, { status: "previewing", dateOrder });
      applyPreview(localId, await previewSource({ sourceId }));
    },
    [applyPreview, saving, timeZone, update],
  );

  // Reopened draft: preview sources that are uploaded (recording consent first where it is missing).
  // A draft created in this session never runs this, even when a reload later supplies `initial`.
  const resumedOnce = useRef(!initial);
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

  // Returning to Details on an existing draft: fetch the latest version so autosave starts from it.
  const prevStep = useRef(step);
  useEffect(() => {
    if (step === 0 && prevStep.current !== 0 && handoverId) router.refresh();
    prevStep.current = step;
  }, [step, handoverId, router]);

  // ── Step 1 ────────────────────────────────────────────────
  function setDetail<K extends keyof Details>(k: K, v: Details[K]) {
    const next = { ...details, [k]: v };
    setDetails(next);
    if (handoverId && (k === "title" || k === "teamName" || k === "roleTitle" || k === "description")) autosave.schedule(valuesOf(next));
  }

  async function submitDetails() {
    if (handoverId) {
      if (await autosave.flush(valuesOf(details))) setStep(1);
      return;
    }
    const next: Record<string, string> = {};
    const parsed = createHandoverInput.safeParse({
      title: details.title,
      teamName: details.teamName,
      roleTitle: details.roleTitle || undefined,
      description: details.description || undefined,
      creatorRole: details.creatorRole || undefined,
    });
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        const key = String(issue.path[0]);
        next[key] ??=
          key === "title"
            ? "Give the handover a title (at least 3 characters)."
            : key === "teamName"
              ? "Add the team or club name."
              : key === "creatorRole"
                ? "Choose who is leaving the role."
                : issue.message;
      }
    }
    if (details.creatorRole === "reviewer" && details.outgoingEmail && !z.email().safeParse(details.outgoingEmail).success) next.outgoingEmail = "Enter a valid email.";
    if (details.incomingEmail && !z.email().safeParse(details.incomingEmail).success) next.incomingEmail = "Enter a valid email.";
    setErrors(next);
    if (Object.keys(next).length > 0 || !parsed.success) {
      const first = Object.keys(next)[0];
      const target: Record<string, string> = { title: "title", teamName: "team", creatorRole: "creator-outgoing", outgoingEmail: "outgoing", incomingEmail: "incoming" };
      if (first && target[first]) document.getElementById(target[first])?.focus();
      return;
    }

    const created = await saving(() => run(() => createHandover(parsed.data)));
    if (!created.ok) return;
    const id = created.data.id;
    setHandoverId(id); // the URL now carries the draft, so a retry or refresh reopens it instead of creating another
    setServer({ updatedAt: created.data.updatedAt, values: valuesOf(details) });
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
    if (entry.size > MAX_SOURCE_BYTES) return update(localId, { status: "error", errorPhase: "too_large", error: "Files can be up to 25 MB. Export the chat without media, or split the document." });
    if (entry.size === 0) return update(localId, { status: "error", errorPhase: "empty", error: "This file is empty." });
    update(localId, { status: "hashing", error: undefined, errorPhase: undefined });
    let sha: string;
    try {
      sha = await sha256Hex(await entry.file.arrayBuffer());
    } catch {
      return update(localId, { status: "error", errorPhase: "failed", error: "Couldn't read this file. Choose it again." });
    }
    update(localId, { status: "uploading" });
    const ticket = await saving(() =>
      createSourceUpload({ handoverId, kind: entry.kind, fileName: entry.name, mimeType: entry.file.type || MIME[entry.kind], sizeBytes: entry.size, sha256: sha }),
    );
    if (!ticket.ok) {
      const reason = typeof ticket.error.details?.reason === "string" ? ticket.error.details.reason : undefined;
      return update(localId, { status: "error", errorPhase: phaseForError({ code: ticket.error.code, reason }), error: ticket.error.message });
    }
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
    if (uploadError) return cleanUp(localId, sourceId, "The upload didn't go through. Check your connection and retry.");

    // confirmSourceUploaded is idempotent: a lost response or a transient error is retried with a short
    // backoff before the upload is given up, so a good upload is never deleted because of the network.
    update(localId, { status: "verifying" });
    let confirmed: Awaited<ReturnType<typeof confirmSourceUploaded>> | null = null;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      if (attempt > 0) await pause(500 * attempt);
      try {
        confirmed = await saving(() => confirmSourceUploaded({ sourceId }));
      } catch {
        confirmed = { ok: false, error: { code: "internal", message: "Couldn't reach Baton.", retryable: true } };
      }
      if (confirmed.ok || !(confirmed.error.retryable || confirmed.error.code === "internal")) break;
    }
    if (!confirmed?.ok) {
      const transient = !!confirmed && (confirmed.error.retryable || confirmed.error.code === "internal");
      return cleanUp(
        localId,
        sourceId,
        transient ? "Baton couldn't confirm the upload. Check your connection and retry." : "The uploaded file didn't match what was sent. Retry the upload.",
      );
    }
    await consentAndPreview(localId, sourceId, "everyone");
  }

  /** A failed upload removes its pending source; if that fails too, the row says so and keeps the id for Remove. */
  async function cleanUp(localId: string, sourceId: string, message: string) {
    let removed = false;
    try {
      removed = (await removeSource({ sourceId })).ok;
    } catch {
      removed = false;
    }
    if (removed) return update(localId, { status: "error", errorPhase: "failed", error: message, sourceId: undefined });
    update(localId, {
      status: "error",
      errorPhase: "failed",
      error: `${message} Baton also couldn't clean up this upload: remove it before adding the file again.`,
      sourceId,
    });
  }

  /** Read a .txt as a WhatsApp chat export or as a plain text document (re-uploads with the other kind). */
  async function switchKind(s: DraftSource, kind: "whatsapp_export" | "text") {
    if (!s.file || s.kind === kind) return;
    if (s.sourceId) {
      const r = await saving(() => run(() => removeSource({ sourceId: s.sourceId! })));
      if (!r.ok) return;
    }
    update(s.localId, { kind, sourceId: undefined, preview: undefined, error: undefined, errorPhase: undefined, needsDateOrder: false, dateOrder: undefined });
    void uploadSource(s.localId, { name: s.name, size: s.size, kind, file: s.file });
  }

  function onFiles(files: FileList | null, group: "chat" | "doc") {
    if (!files) return;
    let count = sources.length;
    let over = 0;
    for (const file of Array.from(files)) {
      if (count >= MAX_SOURCES) {
        over += 1;
        continue;
      }
      count += 1;
      const localId = crypto.randomUUID();
      const kind = kindFor(file.name, group);
      if (!kind) {
        setSources((list) => [
          ...list,
          blankSource({
            localId,
            name: file.name,
            size: file.size,
            kind: "text",
            status: "error",
            errorPhase: "unsupported",
            error: group === "chat" ? "Use a WhatsApp export (.txt or .zip)." : "Use a PDF, DOCX or Markdown file.",
          }),
        ]);
        continue;
      }
      setSources((list) => [...list, blankSource({ localId, name: file.name, size: file.size, kind, status: "hashing", file })]);
      if (isTxt(file.name)) {
        void (async () => {
          const detected: SourceKind = (await looksLikeChatExport(file)) ? "whatsapp_export" : "text";
          if (detected !== kind) update(localId, { kind: detected });
          await uploadSource(localId, { name: file.name, size: file.size, kind: detected, file });
        })();
        continue;
      }
      void uploadSource(localId, { name: file.name, size: file.size, kind, file });
    }
    setSkipped(over);
  }

  function chooseDateOrder(s: DraftSource, order: DateOrder) {
    if (!s.sourceId) return;
    void consentAndPreview(s.localId, s.sourceId, s.accessLevel, order);
  }

  function retry(s: DraftSource) {
    if (!s.file || phaseOf(s) !== "failed" || (s.kind === "text" && !isTxt(s.name))) return;
    void uploadSource(s.localId, { name: s.name, size: s.size, kind: s.kind, file: s.file });
  }

  async function remove(s: DraftSource) {
    if (s.sourceId) {
      const r = await saving(() => run(() => removeSource({ sourceId: s.sourceId! }), { success: `Removed ${s.name}` }));
      if (!r.ok) return;
    }
    setSources((list) => list.filter((x) => x.localId !== s.localId));
    setSkipped(0);
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
        else update(s.localId, { status: "error", errorPhase: "failed", error: r.error.message });
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

  const blockedReason =
    shownStep === 1 && !consentGiven
      ? "Tick every statement to continue. Without consent, nothing can be uploaded."
      : shownStep === 2 && busy
        ? "Wait for uploads to finish."
        : shownStep === 2 && ready.length === 0
          ? "Add at least one file that's ready."
          : shownStep === 3 && matches.length > 0
            ? "Answer each “same person?” question first."
            : null;

  return (
    <div className="space-y-8">
      <div className="space-y-5 border-b border-border pb-6">
        <Stepper steps={STEPS} current={shownStep} onStepClick={submitting ? undefined : (i) => setStep(i)} label="New handover steps" />
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <SaveIndicator
            state={save}
            onRetry={handoverId && shownStep === 0 ? () => void autosave.flush(valuesOf(details)) : undefined}
            className="min-w-0 flex-1"
          />
          {handoverId && (
            <ConfirmDialog
              trigger={
                <Button size="sm" variant="destructive-ghost">
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
        {handoverId && (
          <p className="text-caption text-muted-foreground">Everything is saved as you go. Leave any time and continue from the dashboard.</p>
        )}
      </div>

      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={shownStep}
          initial={reduceMotion ? false : { opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={reduceMotion ? undefined : { opacity: 0, y: -4 }}
          transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
          className="space-y-8"
        >
          {shownStep === 0 && (
            <DetailsStep details={details} setDetail={setDetail} errors={errors} created={!!handoverId} invites={invites} resumed={resumed} />
          )}
          {shownStep === 1 && (
            <div className="space-y-8">
              <StepHeading
                index={1}
                title="Privacy and consent"
                description="Before any file is read, confirm how Baton may use it. Personal and financial details are masked in memory before anything is saved, the raw upload is deleted once processing succeeds, and only masked, permitted evidence is kept."
              />
              <GroupNotice teamName={details.teamName} />
              <ConsentChecklist value={consent} onChange={setConsent} />
            </div>
          )}
          {shownStep === 2 && (
            <div className="space-y-8">
              <StepHeading
                index={2}
                title="Add the team’s record"
                description="Export WhatsApp chats without media (Chat → More → Export chat → Without media) and add any handbooks or notes. Up to 10 files, 25 MB each."
              />
              {skipped > 0 && (
                <Alert tone="warning" title={`${skipped === 1 ? "1 file wasn’t" : `${skipped} files weren’t`} added`}>
                  A handover holds up to {MAX_SOURCES} files. Remove one to add another.
                </Alert>
              )}
              <SourcesStep
                sources={sources}
                onFiles={onFiles}
                onRemove={remove}
                onRetry={retry}
                onDateOrder={chooseDateOrder}
                onSwitchKind={(s, k) => void switchKind(s, k)}
                full={sources.length >= MAX_SOURCES}
              />
            </div>
          )}
          {shownStep === 3 && (
            <div className="space-y-8">
              <StepHeading
                index={3}
                title="Choose what Baton reads"
                description="Narrow each chat to the relevant dates, leave out off-topic conversations and anyone who opted out, and decide who may see evidence from each source."
              />
              {(matches.length > 0 || decisions.length > 0) && (
                <MatchesSection matches={matches} decisions={decisions.filter((d) => ready.some((s) => s.sourceId === d.sourceId))} onAnswer={answerMatch} disabled={isPending} />
              )}
              <ScopeStep sources={ready} update={update} />
              <MaskingTable counts={detectedMasking} />
            </div>
          )}
        </motion.div>
      </AnimatePresence>

      <div className="sticky bottom-0 z-10 -mx-4 border-t border-border bg-background/90 px-4 py-4 backdrop-blur-md supports-backdrop-filter:bg-background/75 sm:mx-0 sm:px-0">
        <div className="flex items-center justify-between gap-3">
          <Button variant="ghost" onClick={() => setStep(Math.max(0, shownStep - 1))} disabled={shownStep === 0 || submitting}>
            <ArrowLeft aria-hidden="true" data-icon="inline-start" />
            Back
          </Button>
          <div className="flex min-w-0 items-center gap-3">
            {blockedReason && <p className="hidden text-right text-caption text-muted-foreground md:block">{blockedReason}</p>}
            {shownStep < LAST_STEP ? (
              <Button size="lg" disabled={!canNext || isPending} aria-busy={isPending} onClick={() => (shownStep === 0 ? submitDetails() : setStep(shownStep + 1))}>
                {isPending && shownStep === 0 ? "Creating…" : shownStep === 0 && !handoverId ? "Create draft" : "Continue"}
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
        {blockedReason && <p className="mt-2 text-caption text-muted-foreground md:hidden">{blockedReason}</p>}
      </div>
    </div>
  );
}

function StepHeading({ index, title, description }: { index: number; title: string; description: string }) {
  return (
    <header className="space-y-2">
      <p className="type-eyebrow text-muted-foreground">
        Step {index + 1} of {STEPS.length}
      </p>
      <h2 className="type-section-title">{title}</h2>
      <p className="max-w-2xl type-body text-muted-foreground">{description}</p>
    </header>
  );
}

// ── Steps ────────────────────────────────────────────────────────────────────

function DetailsStep({
  details,
  setDetail,
  errors,
  created,
  invites,
  resumed,
}: {
  details: Details;
  setDetail: <K extends keyof Details>(k: K, v: Details[K]) => void;
  errors: Record<string, string>;
  created: boolean;
  invites: Array<{ label: string; url: string }>;
  resumed: boolean;
}) {
  const hint = {
    title: "For example, “CodeCell technical lead”.",
    role: "The role being handed over, e.g. Treasurer.",
    description: "A sentence or two of context for reviewers. Shown only inside Baton.",
  };
  return (
    <div className="space-y-8">
      <StepHeading
        index={0}
        title={created ? "Handover details" : "What is being handed over?"}
        description={
          created
            ? "Edit the title, team and role any time while this is a draft. Changes save automatically."
            : "Name the role and the people involved. You can invite more people later in Settings."
        }
      />

      {invites.length > 0 && (
        <Alert tone="success" title="Invitations created" icon={<Link2 aria-hidden="true" className="mt-0.5 size-4 shrink-0" />}>
          <ul className="mt-1 space-y-1.5">
            {invites.map((i) => (
              <li key={i.url} className="min-w-0">
                <span className="font-medium">{i.label}</span>
                <code className="mt-0.5 block font-mono text-2xs break-all opacity-90">{i.url}</code>
              </li>
            ))}
          </ul>
        </Alert>
      )}

      <div className="grid gap-6 sm:grid-cols-2">
        <Field id="title" label="Handover title" hint={hint.title} error={errors.title} className="sm:col-span-2">
          <Input
            id="title"
            value={details.title}
            maxLength={120}
            autoComplete="off"
            onChange={(e) => setDetail("title", e.target.value)}
            aria-invalid={!!errors.title}
            aria-describedby={fieldDescribedBy("title", { hint: hint.title, error: errors.title })}
          />
        </Field>
        <Field id="team" label="Team or club" error={errors.teamName}>
          <Input
            id="team"
            value={details.teamName}
            maxLength={120}
            autoComplete="organization"
            onChange={(e) => setDetail("teamName", e.target.value)}
            aria-invalid={!!errors.teamName}
            aria-describedby={fieldDescribedBy("team", { error: errors.teamName })}
          />
        </Field>
        <Field id="role" label="Role" optional hint={hint.role} error={errors.roleTitle}>
          <Input
            id="role"
            value={details.roleTitle}
            maxLength={120}
            onChange={(e) => setDetail("roleTitle", e.target.value)}
            aria-invalid={!!errors.roleTitle}
            aria-describedby={fieldDescribedBy("role", { hint: hint.role, error: errors.roleTitle })}
          />
        </Field>
        {details.description !== undefined && (
          <Field id="description" label="Description" optional hint={hint.description} error={errors.description} className="sm:col-span-2">
            <Textarea
              id="description"
              value={details.description}
              maxLength={2000}
              rows={3}
              onChange={(e) => setDetail("description", e.target.value)}
              aria-invalid={!!errors.description}
              aria-describedby={fieldDescribedBy("description", { hint: hint.description, error: errors.description })}
            />
          </Field>
        )}
      </div>

      <FieldGroup
        legend="Are you the person leaving this role?"
        description={created ? "Set when the draft was created; it decides your role in the review." : undefined}
        error={errors.creatorRole}
      >
        <div className="grid gap-3 sm:grid-cols-2">
          {(
            [
              ["outgoing", "Yes, I'm leaving", "You'll review the handover as the outgoing member."],
              ["reviewer", "No, I'm setting it up for someone", "You'll review it; invite the outgoing member below."],
            ] as const
          ).map(([value, title, desc]) => (
            <ChoiceCard
              key={value}
              id={`creator-${value}`}
              name="creatorRole"
              value={value}
              checked={details.creatorRole === value}
              onChange={() => setDetail("creatorRole", value)}
              disabled={created}
              title={title}
              description={desc}
              icon={created && details.creatorRole === value ? <Lock /> : undefined}
            />
          ))}
        </div>
      </FieldGroup>

      {created ? (
        <p className="text-caption text-muted-foreground">
          {resumed || invites.length > 0
            ? "Invitations are listed in Settings once processing starts. Invite more people there."
            : "Invite the incoming member from Settings once processing starts."}
        </p>
      ) : (
        <FieldGroup legend="Who receives the handover?" description="You can add this later, but you need it before publishing.">
          <div className="grid gap-6 sm:grid-cols-2">
            {details.creatorRole === "reviewer" && (
              <Field
                id="outgoing"
                label="Outgoing member’s email"
                optional
                hint="They get their own sign-in link and can review alongside you."
                error={errors.outgoingEmail}
                className="sm:col-span-2"
              >
                <Input
                  id="outgoing"
                  type="email"
                  autoComplete="off"
                  value={details.outgoingEmail}
                  onChange={(e) => setDetail("outgoingEmail", e.target.value)}
                  aria-invalid={!!errors.outgoingEmail}
                  aria-describedby={fieldDescribedBy("outgoing", { hint: true, error: errors.outgoingEmail })}
                />
              </Field>
            )}
            <Field id="incoming" label="Incoming member’s email" optional error={errors.incomingEmail}>
              <Input
                id="incoming"
                type="email"
                autoComplete="off"
                value={details.incomingEmail}
                onChange={(e) => setDetail("incomingEmail", e.target.value)}
                aria-invalid={!!errors.incomingEmail}
                aria-describedby={fieldDescribedBy("incoming", { error: errors.incomingEmail })}
              />
            </Field>
            <Field
              id="incoming-role"
              label="Their role"
              hint={details.incomingRole === "lead" ? "Leads see lead-level information." : "Sees everything marked Everyone."}
            >
              <NativeSelect
                id="incoming-role"
                value={details.incomingRole}
                onChange={(e) => setDetail("incomingRole", e.target.value as Details["incomingRole"])}
                aria-describedby="incoming-role-hint"
              >
                <option value="incoming">Incoming member</option>
                <option value="lead">Incoming lead</option>
              </NativeSelect>
            </Field>
          </div>
        </FieldGroup>
      )}
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
    <section aria-labelledby="matches-heading" className="space-y-4 rounded-xl border border-warning/30 bg-warning-soft/60 p-4 sm:p-5">
      <div className="space-y-1">
        <h3 id="matches-heading" className="type-heading text-warning-fg">
          Is this the same person?
        </h3>
        <p className="text-sm leading-relaxed text-foreground/80">
          Someone who asked to be left out was saved under the same name in another chat. Names can be shared, so Baton never assumes: nobody is left out of a
          chat by name until you say so for that chat. Answer each one before processing.
        </p>
      </div>
      {matches.length > 0 && (
        <ul className="space-y-2" aria-label="Waiting for your answer">
          {matches.map((m) => (
            <li key={`${m.sourceId}-${m.exclusionId}-${m.participantLocalId}`} className="flex flex-col gap-3 rounded-lg border border-border bg-card p-3.5 shadow-xs sm:flex-row sm:items-center">
              <p className="min-w-0 flex-1 text-sm">
                <span className="font-medium">{m.label}</span> <span className="text-muted-foreground">in {m.sourceName}</span>
                <span className="block text-caption text-muted-foreground">{identityKindLabel[m.kind].label} match · no decision yet</span>
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
        <ul className="divide-y divide-border rounded-lg border border-border bg-card/80" aria-label="Your decisions">
          {decisions.map((d) => (
            <li key={`${d.sourceId}-${d.exclusionId}`} className="flex flex-col gap-2 p-3.5 sm:flex-row sm:items-center">
              <p className="min-w-0 flex-1 text-sm">
                <span className="font-medium">{d.label}</span> <span className="text-muted-foreground">in {d.sourceName}</span>
                <span className="block text-caption text-muted-foreground">
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
