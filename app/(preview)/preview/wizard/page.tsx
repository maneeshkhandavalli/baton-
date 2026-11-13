import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";

import { PageContainer } from "@/components/layout/page-container";
import { WizardPreview } from "@/components/preview/wizard-preview";
import { PageHeader } from "@/components/shared/page-header";
import { FormSkeleton } from "@/components/shared/skeletons";
import { blankSource, type DraftSource } from "@/components/wizard/draft-state";
import type { MaskKind } from "@/lib/contracts/enums";
import { mockPreview } from "@/lib/mocks/fixtures/preview";

// Titles only in development: a production 404 for this route must not name it.
export const metadata: Metadata = { ...(process.env.NODE_ENV === "development" ? { title: "Preview · New handover" } : {}), robots: { index: false, follow: false } };

const NOW = Date.parse("2026-11-01T09:00:00Z");
const TZ = "Asia/Kolkata";

/** Dev-only: the new-handover wizard, one step per `?step=1..4`, from synthetic state. */
export default function PreviewWizardPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  if (process.env.NODE_ENV !== "development") notFound();
  return (
    <PageContainer width="narrow" className="space-y-8 pb-0 lg:pb-0">
      <PageHeader
        back={{ href: "/preview/dashboard", label: "Dashboard" }}
        eyebrow="New handover"
        title="Start a handover"
        description="Who is involved, consent, the chats and documents that hold the knowledge, and what Baton may read. Your draft saves as you go."
        divider={false}
      />
      <Suspense fallback={<FormSkeleton label="Opening your draft…" />}>
        <Content searchParams={searchParams} />
      </Suspense>
    </PageContainer>
  );
}

/** Request-time clock for the "Draft saved · 2 min ago" line. */
function minutesAgo(n: number): string {
  return new Date(Date.now() - n * 60_000).toISOString();
}

function ready(localId: string, name: string, kind: DraftSource["kind"], size: number): DraftSource {
  const preview = mockPreview(kind, name, size, TZ, NOW);
  return blankSource({
    localId,
    sourceId: `00000000-0000-4000-8000-00000000${localId.padStart(4, "0")}`,
    name,
    size,
    kind,
    status: "ready",
    preview,
    rangeFrom: preview.firstMessageAt?.slice(0, 10) ?? "",
    rangeTo: preview.lastMessageAt?.slice(0, 10) ?? "",
  });
}

async function Content({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  // Request-time only: the "saved 2 min ago" clock must not run during prerendering (Cache Components).
  await connection();
  const q = await searchParams;
  const n = Number(typeof q.step === "string" ? q.step : "1");
  const step = Number.isInteger(n) && n >= 1 && n <= 4 ? n - 1 : 0;

  const chat = ready("1", "WhatsApp Chat with CodeCell Core Team.txt", "whatsapp_export", 184_320);
  const doc = ready("2", "Hackathon runbook 2026.pdf", "pdf", 1_048_576);
  const files: Array<DraftSource & { withFile?: boolean }> = [
    { ...blankSource({ localId: "a", name: "WhatsApp Chat with Sponsors (very long export name from the phone).zip", size: 2_400_000, kind: "whatsapp_export", status: "hashing" }) },
    { ...blankSource({ localId: "b", name: "Infra notes.md", size: 12_000, kind: "markdown", status: "uploading" }) },
    chat,
    { ...blankSource({ localId: "c", name: "WhatsApp Chat with Volunteers.txt", size: 90_000, kind: "whatsapp_export", status: "error", needsDateOrder: true, errorPhase: "needs_input", error: "Baton can't tell whether these dates are day/month or month/day. Which is it?" }), withFile: true },
    { ...blankSource({ localId: "d", name: "Treasury handbook.docx", size: 300_000, kind: "docx", status: "error", errorPhase: "failed", error: "The upload didn't go through. Check your connection and retry." }), withFile: true },
    { ...blankSource({ localId: "e", name: "Hackathon runbook 2026 (copy).pdf", size: 1_048_576, kind: "pdf", status: "error", errorPhase: "duplicate", error: "This file is already in this handover. If an earlier upload of it did not finish, remove that one and try again." }) },
    { ...blankSource({ localId: "f", name: "WhatsApp Chat with media.zip", size: 48_000_000, kind: "whatsapp_export", status: "error", errorPhase: "too_large", error: "Files can be up to 25 MB. Export the chat without media, or split the document." }) },
    { ...blankSource({ localId: "g", name: "empty-notes.md", size: 0, kind: "markdown", status: "error", errorPhase: "empty", error: "This file is empty." }) },
    { ...blankSource({ localId: "h", name: "budget.xlsx", size: 40_000, kind: "text", status: "error", errorPhase: "unsupported", error: "Use a PDF, DOCX or Markdown file." }) },
    { ...blankSource({ localId: "i", name: "MoU signed.pdf", size: 220_000, kind: "pdf", status: "error", errorPhase: "unsupported", error: "This file isn't a valid PDF. Choose the right file." }) },
  ];
  const masking: Partial<Record<MaskKind, number>> = {};
  for (const s of [chat, doc]) for (const [k, v] of Object.entries(s.preview!.masking.counts)) masking[k as MaskKind] = (masking[k as MaskKind] ?? 0) + v;
  const person = chat.preview!.participants[0];

  return (
    <WizardPreview
      step={step}
      savedAt={minutesAgo(2)}
      details={{
        title: "CodeCell technical lead",
        teamName: "CodeCell",
        roleTitle: "Technical lead",
        description: "Handing over infrastructure, the hackathon and sponsor relationships to Neha.",
        creatorRole: "outgoing",
        outgoingEmail: "",
        incomingEmail: "",
        incomingRole: "incoming",
      }}
      files={files}
      scopeSources={[chat, doc]}
      masking={masking}
      matches={
        person
          ? [{ sourceLocalId: chat.localId, sourceId: chat.sourceId!, sourceName: chat.name, exclusionId: "x", participantLocalId: person.localId, label: person.displayLabel, kind: person.identityKind }]
          : []
      }
    />
  );
}
