/**
 * Extra preview-only fixtures for /design/dashboard-preview, shaped exactly like the real DTOs. lib/mocks has no
 * drafts, failed runs or incoming handovers waiting for acknowledgement, so these fill the remaining states.
 * Synthetic names only. Not used by production code.
 */
import type { HandoverSummary, MemberSummary, ProcessingStatus } from "@/lib/contracts/dto";
import type { MemberRole } from "@/lib/contracts/enums";
import type { HandoverInput } from "@/components/dashboard/model";

export const WIZARD_STEP_LABELS = ["Details", "Privacy and consent", "Sources", "Scope and start"] as const;

const ago = (now: number, hours: number) => new Date(now - hours * 3_600_000).toISOString();

function summary(id: string, now: number, over: Partial<HandoverSummary> & Pick<HandoverSummary, "title" | "teamName" | "state" | "viewerRole">, hoursAgo: number): HandoverSummary {
  return {
    id,
    roleTitle: null,
    description: null,
    viewerIsCreator: over.viewerRole === "outgoing",
    viewerClearance: "reviewer_only",
    currentPublicationId: null,
    pendingCreatorTransfer: null,
    createdAt: ago(now, hoursAgo + 400),
    updatedAt: ago(now, hoursAgo),
    ...over,
  };
}

function members(list: [string, MemberRole][]): MemberSummary[] {
  return list.map(([displayName, role], i) => ({ id: `m-${displayName}-${i}`, displayName, role, clearance: null, ackRequired: role === "incoming", isCreator: i === 0, isViewer: false }));
}

export function extraInputs(now: number = Date.now()): HandoverInput[] {
  const failedRun: ProcessingStatus = {
    handoverState: "processing",
    run: {
      id: "run-failed-1",
      status: "failed",
      startedAt: ago(now, 3.4),
      finishedAt: ago(now, 3.1),
      stages: [
        { stage: "parse", status: "partial", done: 2, total: 3 },
        { stage: "extract", status: "failed", done: 0, total: 1 },
      ],
      error: { code: "parse_failed", message: "One source could not be read." },
    },
    sources: [],
  };
  return [
    {
      summary: summary("00000000-0000-4000-8000-0000000000d1", now, { title: "Treasurer handover 2026–27", teamName: "Robotics Society", state: "draft", viewerRole: "outgoing" }, 0.6),
      draft: { step: 4, steps: WIZARD_STEP_LABELS, sources: 3 },
      members: members([["Priya Raman", "outgoing"], ["Dev Patel", "incoming"]]),
    },
    {
      summary: summary("00000000-0000-4000-8000-0000000000d2", now, { title: "Events lead", teamName: "Literary Club", state: "draft", viewerRole: "outgoing" }, 30),
      draft: { step: 2, steps: WIZARD_STEP_LABELS, sources: 0 },
      members: members([["Priya Raman", "outgoing"]]),
    },
    {
      summary: summary("00000000-0000-4000-8000-0000000000f1", now, { title: "Hackathon logistics", teamName: "DevForge", state: "processing", viewerRole: "outgoing" }, 3.1),
      processing: failedRun,
      members: members([["Priya Raman", "outgoing"], ["Kabir Shah", "reviewer"], ["Sana Iqbal", "incoming"]]),
    },
    {
      summary: summary("00000000-0000-4000-8000-0000000000a1", now, { title: "Outreach coordinator", teamName: "NSS Volunteer Cell", state: "approved", viewerRole: "incoming", viewerIsCreator: false, currentPublicationId: "pub-a1" }, 20),
      members: members([["Arjun Mehta", "outgoing"], ["Neha Kulkarni", "reviewer"]]),
    },
    {
      summary: summary("00000000-0000-4000-8000-0000000000a2", now, { title: "Website maintainer", teamName: "CodeCell", state: "acknowledged", viewerRole: "incoming", viewerIsCreator: false, currentPublicationId: "pub-a2" }, 300),
      members: members([["Kabir Shah", "outgoing"]]),
    },
  ];
}
