/**
 * Secondary handovers so the dashboard shows every lifecycle state and several viewer roles.
 */

import { NS, seedId, seedToken } from "../ids";
import type { MockHandover, MockMember, MockRun, MockSource, MockToken } from "../types";
import { PROFILES } from "./profiles";

export const ROBOTICS_ID = seedId(NS.handover, 2);
export const TEDX_ID = seedId(NS.handover, 3);
export const NSS_ID = seedId(NS.handover, 4);
export const LIT_ID = seedId(NS.handover, 5);
export const ECELL_ID = seedId(NS.handover, 6);
/** Created by Sana, who has offered creatorship to Priya (the mock viewer) so `/account` shows an offer. */
export const PHOTO_ID = seedId(NS.handover, 7);
const PHOTO_PRIYA_MEMBER_ID = seedId(NS.member, 200);

export const ECELL_VIEWER_TOKEN = seedToken("ecell_incoming_priya_demo");
export const ROBOTICS_INCOMING_TOKEN = seedToken("robotics_incoming_vikram_demo");

const base = {
  description: null,
  currentPublicationId: null,
  lastError: null,
  deletedAt: null,
  hadSuccessfulRun: true,
  pendingCreatorTransfer: null,
  purgedAt: null,
} as const;

export function otherHandovers(now: number): MockHandover[] {
  return [
    { ...base, id: ROBOTICS_ID, title: "Robotics Society treasurer", teamName: "Robotics Society", roleTitle: "Treasurer", state: "approved", createdBy: PROFILES.priya.id, currentPublicationId: seedId(NS.publication, 2), createdAt: "2026-08-02T05:00:00.000Z", updatedAt: "2026-10-30T09:15:00.000Z", evidenceAsOf: "2026-08-20T12:00:00.000Z" },
    { ...base, id: TEDX_ID, title: "TEDx Campus speaker relations", teamName: "TEDx Campus", roleTitle: "Speaker relations lead", state: "acknowledged", createdBy: PROFILES.priya.id, currentPublicationId: seedId(NS.publication, 3), createdAt: "2026-06-10T05:00:00.000Z", updatedAt: "2026-07-22T14:00:00.000Z", evidenceAsOf: "2026-06-30T12:00:00.000Z" },
    { ...base, id: NSS_ID, title: "NSS volunteer events", teamName: "NSS Volunteer Cell", roleTitle: "Events coordinator", state: "processing", createdBy: PROFILES.priya.id, createdAt: new Date(now - 3_600_000).toISOString(), updatedAt: new Date(now - 60_000).toISOString(), evidenceAsOf: null, hadSuccessfulRun: false },
    { ...base, id: LIT_ID, title: "Literary Club magazine editor", teamName: "Literary Club", roleTitle: "Magazine editor", state: "draft", createdBy: PROFILES.priya.id, createdAt: "2026-11-08T10:00:00.000Z", updatedAt: "2026-11-08T10:20:00.000Z", evidenceAsOf: null, hadSuccessfulRun: false },
    { ...base, id: PHOTO_ID, title: "Photography Club secretary", teamName: "Photography Club", roleTitle: "Secretary", state: "draft", createdBy: PROFILES.sana.id, createdAt: new Date(now - 6 * 86_400_000).toISOString(), updatedAt: new Date(now - 2 * 86_400_000).toISOString(), evidenceAsOf: null, hadSuccessfulRun: false, pendingCreatorTransfer: { toMemberId: PHOTO_PRIYA_MEMBER_ID, offeredAt: new Date(now - 2 * 86_400_000).toISOString(), offeredBy: PROFILES.sana.id } },
    { ...base, id: ECELL_ID, title: "E-Cell sponsorship lead", teamName: "E-Cell", roleTitle: "Sponsorship lead", state: "approved", createdBy: PROFILES.rohit.id, currentPublicationId: seedId(NS.publication, 4), createdAt: "2026-09-01T05:00:00.000Z", updatedAt: "2026-11-04T08:00:00.000Z", evidenceAsOf: "2026-09-28T12:00:00.000Z" },
  ];
}

let memberN = 100;
function member(handoverId: string, p: { id: string; displayName: string; email: string }, role: MockMember["role"], ackRequired = false): MockMember {
  const clearance = role === "outgoing" || role === "reviewer" ? "reviewer_only" : role === "lead" ? "leads_only" : "everyone";
  return { id: seedId(NS.member, memberN++), handoverId, profileId: p.id, displayName: p.displayName, email: p.email, role, clearance, ackRequired, removedAt: null };
}

export function otherMembers(): MockMember[] {
  memberN = 100;
  return [
    member(ROBOTICS_ID, PROFILES.priya, "reviewer"),
    member(ROBOTICS_ID, PROFILES.sana, "outgoing"),
    member(ROBOTICS_ID, PROFILES.vikram, "incoming", true),
    member(TEDX_ID, PROFILES.priya, "outgoing"),
    member(TEDX_ID, PROFILES.meghna, "incoming", true),
    member(NSS_ID, PROFILES.priya, "outgoing"),
    member(LIT_ID, PROFILES.priya, "reviewer"),
    member(ECELL_ID, PROFILES.rohit, "outgoing"),
    member(ECELL_ID, PROFILES.priya, "incoming", true),
    member(PHOTO_ID, PROFILES.sana, "outgoing"),
    { ...member(PHOTO_ID, PROFILES.priya, "reviewer"), id: PHOTO_PRIYA_MEMBER_ID },
  ];
}

let sourceN = 100;
function source(handoverId: string, s: Partial<MockSource> & Pick<MockSource, "kind" | "title">): MockSource {
  const n = sourceN++;
  return {
    id: seedId(NS.source, n),
    handoverId,
    state: "parsed",
    accessLevel: "everyone",
    sizeBytes: 240_000,
    sha256: "1".repeat(62) + n.toString(16).padStart(2, "0"),
    consentRecordedAt: "2026-08-02T05:30:00.000Z",
    rawDeletedAt: "2026-08-02T05:40:00.000Z",
    firstMessageAt: null,
    lastMessageAt: null,
    messageCount: 640,
    maskingCounts: { phone: 7, email: 2 },
    errorCode: null,
    timezone: "Asia/Kolkata",
    documentDate: null,
    basePreview: null,
    removedAt: null,
    ...s,
  };
}

export function otherSources(): MockSource[] {
  sourceN = 100;
  return [
    source(ROBOTICS_ID, { kind: "whatsapp_export", title: "RoboSoc Committee (WhatsApp)", firstMessageAt: "2026-01-10T04:00:00.000Z", lastMessageAt: "2026-08-20T12:00:00.000Z", messageCount: 2210 }),
    source(ROBOTICS_ID, { kind: "pdf", title: "Treasurer guidelines.pdf", messageCount: 24 }),
    source(TEDX_ID, { kind: "whatsapp_export", title: "TEDx Speakers (WhatsApp)", firstMessageAt: "2026-02-01T04:00:00.000Z", lastMessageAt: "2026-06-30T12:00:00.000Z", messageCount: 980 }),
    source(TEDX_ID, { kind: "markdown", title: "speaker-playbook.md", messageCount: 31 }),
    source(NSS_ID, { kind: "whatsapp_export", title: "NSS Core (WhatsApp)", state: "parsing", rawDeletedAt: null, consentRecordedAt: "2026-11-11T04:00:00.000Z", messageCount: null, maskingCounts: null, sizeBytes: 2_480_000 }),
    source(NSS_ID, { kind: "docx", title: "Volunteer SOP 2026.docx", state: "uploaded", rawDeletedAt: null, consentRecordedAt: "2026-11-11T04:00:00.000Z", messageCount: null, maskingCounts: null, sizeBytes: 180_000 }),
    source(LIT_ID, { kind: "docx", title: "Magazine style guide.docx", state: "uploaded", rawDeletedAt: null, consentRecordedAt: null, messageCount: null, maskingCounts: null, sizeBytes: 64_000 }),
    source(ECELL_ID, { kind: "whatsapp_export", title: "E-Cell Sponsorship (WhatsApp)", firstMessageAt: "2026-03-01T04:00:00.000Z", lastMessageAt: "2026-09-28T12:00:00.000Z", messageCount: 1430 }),
    source(ECELL_ID, { kind: "pdf", title: "Sponsor deck 2026.pdf", messageCount: 18 }),
  ];
}

export function otherRuns(now: number): MockRun[] {
  return [
    { id: seedId(NS.run, 4), handoverId: NSS_ID, status: "running", startedAt: new Date(now - 30_000).toISOString(), durationMs: 150_000, finishedAt: null, error: null },
  ];
}

export function otherTokens(): MockToken[] {
  return [
    { id: seedId(NS.token, 100), token: ECELL_VIEWER_TOKEN, purpose: "member_invite", handoverId: ECELL_ID, questionIds: [], maxAccessLevel: "everyone", grantRole: "incoming", recipientEmail: PROFILES.priya.email, sessionProfileId: PROFILES.priya.id, redeemedAt: "2026-10-01T10:00:00.000Z", expiresAt: "2026-10-08T10:00:00.000Z", revokedAt: null, maxUses: 1, useCount: 1, createdBy: PROFILES.rohit.id, createdAt: "2026-10-01T09:00:00.000Z" },
    { id: seedId(NS.token, 101), token: ROBOTICS_INCOMING_TOKEN, purpose: "member_invite", handoverId: ROBOTICS_ID, questionIds: [], maxAccessLevel: "everyone", grantRole: "incoming", recipientEmail: PROFILES.vikram.email, sessionProfileId: PROFILES.vikram.id, redeemedAt: "2026-10-30T10:00:00.000Z", expiresAt: "2026-11-06T10:00:00.000Z", revokedAt: null, maxUses: 1, useCount: 1, createdBy: PROFILES.priya.id, createdAt: "2026-10-30T09:30:00.000Z" },
  ];
}
