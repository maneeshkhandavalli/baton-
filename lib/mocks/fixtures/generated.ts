/**
 * Template "extraction output" used for seeded secondary handovers and for any handover created
 * in the wizard once its mock processing run finishes. Real extraction (main workspace) replaces it.
 */

import type { MockPoint, MockSource } from "../types";
import { buildPoint, type SeedPoint } from "./builders";

interface GenerateOptions {
  handoverId: string;
  /** Point id base; must be unique per handover. */
  base: number;
  teamName: string;
  sources: MockSource[];
  /** "approved": every point is decided (for published handovers). */
  mode: "pending" | "approved";
  reviewerProfileId: string;
  reviewerLabel: string;
  at: string;
}

export function generatePoints(o: GenerateOptions): MockPoint[] {
  const chat = o.sources.find((s) => s.kind === "whatsapp_export") ?? o.sources[0] ?? null;
  const doc = o.sources.find((s) => s.kind !== "whatsapp_export") ?? chat;
  const day = (d: number) => new Date(Date.parse(o.at) - d * 86_400_000).toISOString();
  const authorFor = (src: MockSource | null, name: string) => (src?.kind === "whatsapp_export" ? name : null);
  const approved = o.mode === "approved";
  const decided = approved ? ("approved" as const) : ("pending" as const);
  const hist = approved ? [{ action: "approve" as const, actor: o.reviewerLabel, at: o.at }] : [];

  const seeds: SeedPoint[] = [
    {
      n: 1,
      category: "decision",
      title: "Monthly budget review with the faculty advisor",
      statement: `${o.teamName} reviews spending with the faculty advisor in the first week of each month.`,
      attributes: { decidedAt: day(120).slice(0, 10), decidedByLabel: "Core team", rationale: "Keeps the advisor informed before reimbursements are approved.", alternativesConsidered: [] },
      evidence: [{ quote: "from next month we do budget review with sir in the first week, bring the sheet", by: authorFor(chat, "Sana Iqbal"), at: chat?.kind === "whatsapp_export" ? day(120) : null, source: chat, line: 412, verdict: "supports", why: "States the cadence and attendees." }],
      review: decided,
      history: hist,
      updatedAt: o.at,
    },
    {
      n: 2,
      category: "owner",
      title: "Treasurer files the monthly expense sheet",
      statement: "The treasurer updates the shared expense sheet and attaches receipts before each budget review.",
      attributes: { responsibility: "Monthly expense sheet", ownerLabel: "Treasurer", since: null },
      evidence: [{ quote: "Expense sheet: maintained by the treasurer; receipts attached as PDFs, one row per purchase.", by: null, at: null, source: doc, line: 18, heading: "Finance", verdict: "supports", why: "Assigns the sheet to the treasurer." }],
      review: decided,
      history: hist,
      updatedAt: o.at,
    },
    {
      n: 3,
      category: "open_task",
      title: "Collect pending receipts from the last event",
      statement: "Four volunteers still owe receipts for the last event's purchases.",
      attributes: { assigneeLabel: "Treasurer", dueDate: null, progressNote: null },
      evidence: [{ quote: "still waiting on bills from 4 people for the fest stuff", by: authorFor(chat, "Vikram Nair"), at: chat?.kind === "whatsapp_export" ? day(12) : null, source: chat, line: 1980, verdict: "partial", why: "Mentions missing bills but not who owes them." }],
      rationale: "The expense sheet shows four rows without receipts.",
      review: decided,
      confirmedBy: approved ? { profileId: o.reviewerProfileId, at: o.at } : undefined,
      history: hist,
      updatedAt: o.at,
    },
    {
      n: 4,
      category: "risk",
      title: "Single signatory on the club account",
      statement: "Only one person can authorise payments from the club account.",
      attributes: { likelihood: "medium", impact: "high", mitigation: "Add the incoming lead as a second signatory." },
      evidence: [{ quote: "bank says only one signatory is registered, adding another needs the advisor's letter", by: authorFor(chat, "Sana Iqbal"), at: chat?.kind === "whatsapp_export" ? day(40) : null, source: chat, line: 1502, verdict: "supports", why: "States there is a single signatory." }],
      review: decided,
      history: hist,
      updatedAt: o.at,
    },
    {
      n: 5,
      category: "dependency",
      title: "Event approvals go through Student Affairs",
      statement: "Every on-campus event needs a Student Affairs approval at least ten days ahead.",
      attributes: { dependsOnLabel: "Student Affairs office", dependencyType: "organisation" },
      evidence: [{ quote: "All events require Student Affairs approval no less than 10 working days in advance.", by: null, at: null, source: doc, line: 33, heading: "Approvals", verdict: "supports", why: "States the dependency and lead time." }],
      review: decided,
      history: hist,
      updatedAt: o.at,
    },
    {
      n: 6,
      category: "contact",
      title: "Student Affairs coordinator",
      statement: "Ms. Kapoor in Student Affairs processes event approvals.",
      attributes: { nameLabel: "Ms. Kapoor", organisation: "Student Affairs office", roleDescription: "Event approvals", preferredChannel: "email", directContact: null },
      evidence: [{ quote: "send the form to kapoor ma'am at [EMAIL_2], she's quick if you cc the advisor", by: authorFor(chat, "Meghna Das"), at: chat?.kind === "whatsapp_export" ? day(30) : null, source: chat, line: 1640, verdict: "supports", why: "Names the contact and her role." }],
      review: decided,
      history: hist,
      updatedAt: o.at,
    },
    {
      n: 7,
      category: "account_access",
      title: "Who owns the shared Google Drive?",
      statement: "No source says who owns the team's shared Google Drive.",
      attributes: { system: "Shared Google Drive", holderLabel: null, accessLocation: null, recoveryNote: null },
      evidence: [],
      review: decided,
      knownGap: approved,
      history: hist,
      updatedAt: o.at,
    },
    {
      n: 8,
      category: "next_action",
      title: "Introduce the incoming lead to sponsors",
      statement: "Send a short introduction email to each active sponsor in the first two weeks.",
      attributes: { actorLabel: "Outgoing lead", byWhen: "First two weeks" },
      evidence: [{ quote: "Handover: outgoing lead introduces successor to all active sponsors within two weeks.", by: null, at: null, source: doc, line: 51, heading: "Handover", verdict: "supports", why: "States the action and timing." }],
      review: decided,
      history: hist,
      updatedAt: o.at,
    },
    {
      n: 9,
      category: "decision",
      title: "Registration closes 48 hours before events",
      statement: "Online registration closes 48 hours before each event.",
      attributes: { decidedAt: null, decidedByLabel: null, rationale: "Gives time to print badges.", alternativesConsidered: [] },
      evidence: [
        { quote: "lets keep registrations open till the morning of, we lost people last time", by: authorFor(chat, "Vikram Nair"), at: chat?.kind === "whatsapp_export" ? day(8) : null, source: chat, line: 2011, verdict: "contradicts", why: "Proposes keeping registration open until the event day." },
        { quote: "Registration closes 48 hours before the event so badges can be printed.", by: null, at: null, source: doc, line: 27, heading: "Events", verdict: "supports", why: "States the 48-hour rule." },
      ],
      review: decided,
      resolution: approved ? { note: "The 48-hour rule stands; late walk-ins can register at the desk.", profileId: o.reviewerProfileId, at: o.at } : undefined,
      history: hist,
      updatedAt: o.at,
    },
  ];

  return seeds.map((s) => buildPoint(o.handoverId, o.base, s));
}
