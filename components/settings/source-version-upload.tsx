"use client";

/**
 * R3 Task 05B: the smallest entry point for a NEW VERSION of a source (creator only). It reuses the existing
 * steps: createSourceVersionUpload → direct upload to the signed URL → confirmSourceUploaded → recordSourceConsent,
 * which activates the version. The current version and its evidence stay as they are; the new version is used
 * the next time the handover is processed.
 */

import { useRouter } from "next/navigation";
import { History } from "lucide-react";
import { useId, useState } from "react";

import { ConsentChecklist, CONSENT_STATEMENT_VERSION, consentComplete, emptyConsent } from "@/components/wizard/consent";
import { signedTarget } from "@/components/wizard/draft-state";
import { accessLevelMeta } from "@/components/handover/labels";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import type { SourceSummary } from "@/lib/contracts/dto";
import { ACCESS_LEVELS, type AccessLevel, type SourceKind } from "@/lib/contracts/enums";
import { confirmSourceUploaded, createSourceVersionUpload, recordSourceConsent } from "@/lib/actions/sources";
import { createSupabaseUploadClient } from "@/lib/supabase/client";

const ACCEPT: Record<SourceKind, string> = {
  whatsapp_export: ".txt,.zip",
  pdf: ".pdf",
  docx: ".docx",
  markdown: ".md,.markdown",
  text: ".txt",
};
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

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export function SourceVersionUpload({ source }: { source: SourceSummary }) {
  const router = useRouter();
  const fileId = useId();
  const accessId = useId();
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [consent, setConsent] = useState(emptyConsent);
  const [access, setAccess] = useState<AccessLevel>(source.accessLevel);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  // a new version may be as strict as the current one, or stricter, never broader
  const levels = ACCESS_LEVELS.filter((l) => ACCESS_LEVELS.indexOf(l) >= ACCESS_LEVELS.indexOf(source.accessLevel));

  function reset(next: boolean) {
    setOpen(next);
    if (!next) {
      setFile(null);
      setConsent(emptyConsent());
      setAccess(source.accessLevel);
      setMessage(null);
    }
  }

  async function submit() {
    if (!file) return;
    setBusy(true);
    setMessage(null);
    try {
      const sha = await sha256Hex(await file.arrayBuffer());
      const started = await createSourceVersionUpload({
        previousSourceId: source.id,
        kind: source.kind,
        fileName: file.name,
        mimeType: file.type || MIME[source.kind],
        sizeBytes: file.size,
        sha256: sha,
      });
      if (!started.ok) return setMessage(started.error.message);
      if (started.data.status === "unchanged") return setMessage("This file is identical to the current version, so there is nothing to add.");

      let sourceId: string;
      if (started.data.status === "upload") {
        const { ticket } = started.data;
        sourceId = ticket.sourceId;
        const target = signedTarget(ticket.signedUploadUrl);
        const uploaded = target
          ? await createSupabaseUploadClient()
              .storage.from(target.bucket)
              .uploadToSignedUrl(target.path, ticket.token, file, { contentType: file.type || MIME[source.kind], upsert: false })
              .then((r) => !r.error)
              .catch(() => false)
          : false;
        if (!uploaded) return setMessage("The upload didn't go through. Check your connection and try again: Baton will reuse this update.");
      } else {
        sourceId = started.data.sourceId;
      }

      if (started.data.status !== "awaiting_consent") {
        // idempotent: a lost response or a transient error is retried briefly before giving up
        let confirmed: Awaited<ReturnType<typeof confirmSourceUploaded>> | null = null;
        for (let attempt = 0; attempt < 3; attempt += 1) {
          if (attempt > 0) await pause(500 * attempt);
          confirmed = await confirmSourceUploaded({ sourceId }).catch(() => null);
          if (confirmed?.ok || (confirmed && !confirmed.error.retryable && confirmed.error.code !== "internal")) break;
        }
        if (!confirmed?.ok) return setMessage(confirmed?.error.message ?? "Couldn't check the uploaded file. Try again.");
      }

      const activated = await recordSourceConsent({
        sourceId,
        consentStatementVersion: CONSENT_STATEMENT_VERSION,
        consentConfirmed: true,
        accessLevel: access,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
      });
      if (!activated.ok) return setMessage(activated.error.message);
      reset(false);
      router.refresh();
    } catch {
      setMessage("Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button size="sm" variant="outline" onClick={() => reset(true)} aria-label={`Upload a new version of ${source.title}`}>
        <History aria-hidden="true" data-icon="inline-start" />
        New version
      </Button>
      <Dialog open={open} onOpenChange={(o) => !busy && reset(o)}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>New version of {source.title}</DialogTitle>
            <DialogDescription>
              Upload a newer export of the same source. The current version and the evidence taken from it are kept. The new version is
              used the next time you process this handover.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-5">
            <div className="space-y-2">
              <Label htmlFor={fileId}>File</Label>
              <input
                id={fileId}
                type="file"
                accept={ACCEPT[source.kind]}
                className="block w-full text-sm file:mr-3 file:rounded-md file:border file:border-border file:bg-card file:px-3 file:py-1.5"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor={accessId}>Who can see it</Label>
              <NativeSelect id={accessId} value={access} onChange={(e) => setAccess(e.target.value as AccessLevel)}>
                {levels.map((l) => (
                  <option key={l} value={l}>
                    {accessLevelMeta[l].label}
                  </option>
                ))}
              </NativeSelect>
              <p className="text-xs text-muted-foreground">The same as the current version, or stricter.</p>
            </div>
            <ConsentChecklist value={consent} onChange={setConsent} />
            {message && (
              <p role="alert" className="text-sm text-destructive">
                {message}
              </p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" disabled={busy} onClick={() => reset(false)}>
              Cancel
            </Button>
            <Button aria-busy={busy} disabled={busy || !file || !consentComplete(consent)} onClick={submit}>
              {busy ? "Adding version…" : "Add new version"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
