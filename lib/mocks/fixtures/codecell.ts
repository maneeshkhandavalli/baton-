/**
 * CodeCell: the preloaded demo handover. A fictional college coding club whose technical lead,
 * Priya, is handing over to Neha. Covers every evidence status, a conflict, stale and excluded
 * evidence, an outdated point, restricted sources, gap questions and a v1 publication.
 */

import type { SourcePreview } from "@/lib/contracts/parser";

import { NS, seedId, seedToken } from "../ids";
import type { MockExclusion, MockGapQuestion, MockHandover, MockMember, MockParticipant, MockSource, MockToken } from "../types";
import { buildPoint, type SeedPoint } from "./builders";
import { MOCK_PARSER_VERSION, mockIdentityHash, mockParseContext } from "./preview";
import { PROFILES } from "./profiles";

export const CODECELL_ID = seedId(NS.handover, 1);
const H = CODECELL_ID;

export const CODECELL_GAP_TOKEN = seedToken("codecell_gap_interview_demo");
export const CODECELL_INCOMING_TOKEN = seedToken("codecell_incoming_neha_demo");
export const CODECELL_LEAD_TOKEN = seedToken("codecell_lead_kabir_demo");

export const codecellHandover: MockHandover = {
  id: H,
  title: "CodeCell technical lead",
  teamName: "CodeCell",
  roleTitle: "Technical lead",
  description: "Handover from Priya (2025–26 technical lead) to Neha for the 2026–27 term.",
  state: "in_review",
  createdBy: PROFILES.priya.id,
  currentPublicationId: seedId(NS.publication, 1),
  createdAt: "2026-09-20T06:30:00.000Z",
  updatedAt: "2026-11-09T11:42:00.000Z",
  evidenceAsOf: "2026-10-28T13:10:00.000Z",
  lastError: null,
  deletedAt: null,
  hadSuccessfulRun: true,
  pendingCreatorTransfer: null,
  purgedAt: null,
};

export const codecellMembers: MockMember[] = [
  { id: seedId(NS.member, 1), handoverId: H, profileId: PROFILES.priya.id, displayName: PROFILES.priya.displayName, email: PROFILES.priya.email, role: "outgoing", clearance: "reviewer_only", ackRequired: false, removedAt: null },
  { id: seedId(NS.member, 2), handoverId: H, profileId: PROFILES.arjun.id, displayName: PROFILES.arjun.displayName, email: PROFILES.arjun.email, role: "reviewer", clearance: "reviewer_only", ackRequired: false, removedAt: null },
  { id: seedId(NS.member, 3), handoverId: H, profileId: PROFILES.kabir.id, displayName: PROFILES.kabir.displayName, email: PROFILES.kabir.email, role: "lead", clearance: "leads_only", ackRequired: false, removedAt: null },
  { id: seedId(NS.member, 4), handoverId: H, profileId: PROFILES.neha.id, displayName: PROFILES.neha.displayName, email: PROFILES.neha.email, role: "incoming", clearance: "everyone", ackRequired: true, removedAt: null },
];

const nameId = (label: string) => ({ identityKind: "name" as const, identityHash: mockIdentityHash(`name:${label.toLowerCase()}`), identityPepperVersion: "p1" as const });
const phoneId = (e164: string) => ({ identityKind: "phone" as const, identityHash: mockIdentityHash(`tel:${e164}`), identityPepperVersion: "p1" as const });

/** The member of the core chat who asked to be left out before the first parse (a phone identity). */
const OPTED_OUT = phoneId("+919800000042");

const corePreview: SourcePreview = {
  kind: "whatsapp_export",
  parserVersion: MOCK_PARSER_VERSION,
  parseContext: mockParseContext("whatsapp_export", "Asia/Kolkata"),
  participants: [
    { localId: "p_1", displayLabel: "Priya Raman", ...nameId("Priya Raman"), messageCount: 1412 },
    { localId: "p_2", displayLabel: "Kabir Shah", ...nameId("Kabir Shah"), messageCount: 988 },
    { localId: "p_3", displayLabel: "Ananya Iyer", ...nameId("Ananya Iyer"), messageCount: 731 },
    { localId: "p_4", displayLabel: "Rohan Pillai", ...nameId("Rohan Pillai"), messageCount: 642 },
    { localId: "p_5", displayLabel: "Participant 1", ...phoneId("+919800000117"), messageCount: 117 },
  ],
  conversations: [
    { localId: "c_1", startedAt: "2026-01-08T04:00:00.000Z", endedAt: "2026-03-30T17:20:00.000Z", messageCount: 1604, participantLocalIds: ["p_1", "p_2", "p_3", "p_4"], preview: "DevForge planning kicks off — venue, dates and judging" },
    { localId: "c_2", startedAt: "2026-04-02T05:10:00.000Z", endedAt: "2026-06-28T15:45:00.000Z", messageCount: 1388, participantLocalIds: ["p_1", "p_3", "p_4", "p_5"], preview: "Summer workshops and website refresh" },
    { localId: "c_3", startedAt: "2026-07-01T03:30:00.000Z", endedAt: "2026-10-28T13:10:00.000Z", messageCount: 1820, participantLocalIds: ["p_1", "p_2", "p_3", "p_4", "p_5"], preview: "New semester: recruitment, fees and handover prep" },
  ],
  masking: { counts: { phone: 23, email: 11, upi: 4, bank_account: 1, ifsc: 1, card: 0, government_id: 0, password: 3, api_key: 2, secret: 1 } },
  stats: { totalLines: 5210, messagesKept: 4812, messagesExcluded: 96, systemMessages: 214, mediaOmitted: 184 },
  identityMatches: [],
  firstMessageAt: "2026-01-08T04:00:00.000Z",
  lastMessageAt: "2026-10-28T13:10:00.000Z",
  warnings: [{ code: "excluded_mentions_redacted", message: "Mentions of people who were left out were removed from kept messages." }],
};

function src(n: number, s: Omit<MockSource, "id" | "handoverId" | "state" | "consentRecordedAt" | "rawDeletedAt" | "errorCode" | "timezone" | "removedAt" | "sha256" | "documentDate"> & { documentDate?: string | null }): MockSource {
  return {
    id: seedId(NS.source, n),
    handoverId: H,
    state: "parsed",
    consentRecordedAt: "2026-09-20T07:02:00.000Z",
    rawDeletedAt: "2026-09-20T07:15:00.000Z",
    errorCode: null,
    timezone: "Asia/Kolkata",
    removedAt: null,
    sha256: "0".repeat(63) + n.toString(16),
    ...s,
    documentDate: s.documentDate ?? null,
  };
}

export const codecellSources = {
  core: src(1, {
    kind: "whatsapp_export",
    title: "CodeCell Core Team (WhatsApp)",
    accessLevel: "everyone",
    sizeBytes: 1_284_000,
    firstMessageAt: corePreview.firstMessageAt,
    lastMessageAt: corePreview.lastMessageAt,
    messageCount: 4812,
    maskingCounts: { phone: 23, email: 11, upi: 4, bank_account: 1, ifsc: 1, password: 3, api_key: 2, secret: 1 },
    basePreview: corePreview,
  }),
  leads: src(2, {
    kind: "whatsapp_export",
    title: "CodeCell Leads (WhatsApp)",
    accessLevel: "leads_only",
    sizeBytes: 312_000,
    firstMessageAt: "2026-02-01T04:30:00.000Z",
    lastMessageAt: "2026-10-21T16:05:00.000Z",
    messageCount: 1206,
    maskingCounts: { phone: 6, email: 3, upi: 2 },
    basePreview: null,
  }),
  mou: src(3, {
    kind: "pdf",
    title: "Sponsorship MoU — DevForge 2026.pdf",
    accessLevel: "leads_only",
    sizeBytes: 486_000,
    firstMessageAt: null,
    lastMessageAt: null,
    messageCount: 38,
    maskingCounts: { email: 2, phone: 1, bank_account: 1, ifsc: 1 },
    basePreview: null,
    documentDate: "2026-08-14",
  }),
  runbook: src(4, {
    kind: "docx",
    title: "Hackathon Runbook v3.docx",
    accessLevel: "everyone",
    sizeBytes: 94_000,
    firstMessageAt: null,
    lastMessageAt: null,
    messageCount: 112,
    maskingCounts: { phone: 4 },
    basePreview: null,
    documentDate: "2026-03-02",
  }),
  infra: src(5, {
    kind: "markdown",
    title: "infra-notes.md",
    accessLevel: "reviewer_only",
    sizeBytes: 8_400,
    firstMessageAt: null,
    lastMessageAt: null,
    messageCount: 41,
    maskingCounts: { api_key: 3, password: 2, secret: 1 },
    basePreview: null,
    documentDate: "2026-10-05",
  }),
};

const { core, leads, mou, runbook, infra } = codecellSources;

/** Parsed participants of the core chat (§6.6). The opted-out member was never parsed. */
export const codecellParticipants: MockParticipant[] = corePreview.participants.map((p, i) => ({
  id: seedId(NS.participant, i + 1),
  handoverId: H,
  sourceId: core.id,
  localId: p.localId,
  displayLabel: p.displayLabel,
  identityKind: p.identityKind,
  identityHash: p.identityHash,
  identityPepperVersion: p.identityPepperVersion,
  messageCount: p.messageCount,
}));

/** Exclusions recorded before the first parse (§6.8). */
export const codecellExclusions: MockExclusion[] = [
  {
    id: seedId(NS.exclusion, 1),
    handoverId: H,
    sourceId: null,
    kind: "participant",
    identityKind: OPTED_OUT.identityKind,
    identityHash: OPTED_OUT.identityHash,
    identityPepperVersion: OPTED_OUT.identityPepperVersion,
    conversationLocalId: null,
    parseContext: null,
    rangeStart: null,
    rangeEnd: null,
    reason: "Asked to be left out of the handover.",
    requestedVia: "participant_request",
    requestedBy: PROFILES.priya.id,
    createdAt: "2026-09-20T06:58:00.000Z",
  },
  {
    id: seedId(NS.exclusion, 2),
    handoverId: H,
    sourceId: core.id,
    kind: "date_range",
    identityKind: null,
    identityHash: null,
    identityPepperVersion: null,
    conversationLocalId: null,
    parseContext: null,
    rangeStart: "2025-06-01T00:00:00+05:30",
    rangeEnd: "2026-01-07T23:59:59+05:30",
    reason: null,
    requestedVia: "uploader",
    requestedBy: PROFILES.priya.id,
    createdAt: "2026-09-20T07:00:00.000Z",
  },
];
const P = PROFILES;

const seeds: SeedPoint[] = [
  // ── Decisions ─────────────────────────────────────────────
  {
    n: 1,
    category: "decision",
    title: "DevForge runs as a two-day hackathon",
    statement: "DevForge moved from a 24-hour overnight format to two daytime sessions (Saturday and Sunday), after a 14–3 core team vote.",
    attributes: { decidedAt: "2026-03-12", decidedByLabel: "Core team vote", rationale: "The 24-hour format exhausted volunteers and led to two safety complaints from the hostel warden.", alternativesConsidered: ["Keep 24 hours with shifts", "Single 12-hour day"] },
    evidence: [
      { quote: "reminder for next year's planning: DevForge '27 is sat–sun again, same as this year. don't let anyone push 24h", by: "Kabir Shah", at: "2026-10-12T15:30:00.000Z", source: core, line: 4640, verdict: "supports", why: "Restates the two-day format as standing policy." },
      { quote: "Final call: DevForge runs Sat–Sun this year, 24h was killing everyone. Voting closed 14–3.", by: "Priya Raman", at: "2026-03-12T14:41:00.000Z", source: core, line: 1834, verdict: "supports", why: "States the decision, the format and the vote count." },
      { quote: "Event format: two daytime sessions, 9:00–21:00 on both days. No overnight stay in the labs.", by: null, at: null, source: runbook, line: 12, heading: "1. Event format", verdict: "supports", why: "The runbook describes the same two-day daytime format." },
    ],
    review: "approved",
    updatedAt: "2026-10-01T09:00:00.000Z",
    history: [{ action: "approve", actor: "Priya Raman", at: "2026-10-01T09:00:00.000Z" }],
  },
  {
    n: 2,
    category: "decision",
    title: "Workshop fee for non-members",
    statement: "Non-members pay ₹100 per workshop; members attend free.",
    attributes: { decidedAt: "2026-08-04", decidedByLabel: "Priya Raman", rationale: "Covers snacks and printed handouts.", alternativesConsidered: [] },
    evidence: [
      { quote: "ok so from this sem workshops are free for EVERYONE, we agreed in the leads call. no more 100 rs thing", by: "Kabir Shah", at: "2026-09-18T15:22:00.000Z", source: core, line: 4410, verdict: "contradicts", why: "Says workshops became free for everyone, contradicting the ₹100 fee." },
      { quote: "Non-members pay 100 for workshops, members free. Collect on [UPI_1] and note names in the sheet.", by: "Priya Raman", at: "2026-08-04T12:05:00.000Z", source: core, line: 3982, verdict: "supports", why: "States the fee and who pays it." },
    ],
    updatedAt: "2026-10-28T13:10:00.000Z",
  },
  {
    n: 3,
    category: "decision",
    title: "Club code lives in the codecell-org GitHub organisation",
    statement: "All club repositories, including the judging portal, were moved from personal accounts to the codecell-org GitHub organisation.",
    attributes: { decidedAt: "2026-05-20", decidedByLabel: "Priya Raman", rationale: "Repositories were being lost when members graduated.", alternativesConsidered: ["GitLab group"] },
    evidence: [
      { quote: "all PRs go to codecell-org now, the old personal forks are archived", by: "Ananya Iyer", at: "2026-10-06T09:05:00.000Z", source: core, line: 4580, verdict: "supports", why: "Confirms the organisation is still where code lives." },
      { quote: "moved judging-portal + website repos to codecell-org today. please stop pushing to my personal fork 🙏", by: "Priya Raman", at: "2026-05-20T10:12:00.000Z", source: core, line: 2971, verdict: "supports", why: "Directly describes the move to the organisation." },
    ],
    updatedAt: "2026-10-28T13:10:00.000Z",
  },
  {
    n: 4,
    category: "decision",
    title: "Weekly meeting moved to Thursdays",
    statement: "The weekly core team meeting happens on Thursdays at 6 pm in Lab 3.",
    attributes: { decidedAt: null, decidedByLabel: null, rationale: null, alternativesConsidered: [] },
    evidence: [
      { quote: "can we do thursday this week instead? lab 3 is free after 6", by: "Ananya Iyer", at: "2026-08-27T09:15:00.000Z", source: core, line: 4102, verdict: "partial", why: "Suggests Thursday for one week only; does not show a permanent change." },
    ],
    rationale: "Every meeting reminder after late August mentions Thursday.",
    updatedAt: "2026-10-28T13:10:00.000Z",
  },
  // ── Ownership ─────────────────────────────────────────────
  {
    n: 5,
    category: "owner",
    title: "Kabir owns sponsor relations",
    statement: "Kabir Shah is the single point of contact for all sponsors, including DevForge's title sponsor.",
    attributes: { responsibility: "Sponsor relations", ownerLabel: "Kabir Shah", since: "2026-02" },
    evidence: [
      { quote: "sponsor renewals for next sem — kabir is handling all of them as usual", by: "Priya Raman", at: "2026-10-14T12:10:00.000Z", source: leads, line: 1098, verdict: "supports", why: "Confirms Kabir still owns sponsor relations." },
      { quote: "Kabir is POC for all sponsors from now. Nobody else emails them pls, it confuses them", by: "Priya Raman", at: "2026-02-03T08:40:00.000Z", source: leads, line: 77, verdict: "supports", why: "Assigns sponsor ownership to Kabir explicitly." },
    ],
    review: "approved",
    updatedAt: "2026-10-01T09:05:00.000Z",
    history: [{ action: "approve", actor: "Arjun Mehta", at: "2026-10-01T09:05:00.000Z" }],
  },
  {
    n: 6,
    category: "owner",
    title: "Ananya maintains the club website",
    statement: "Ananya Iyer maintains codecell.dev and deploys updates from the website repository.",
    attributes: { responsibility: "Club website", ownerLabel: "Ananya Iyer", since: "2026-04" },
    evidence: [
      { quote: "website is ananya's baby now, ping her for any changes. she has deploy access", by: "Priya Raman", at: "2026-06-02T07:30:00.000Z", source: core, line: 3311, verdict: "supports", why: "Names Ananya as owner of the website." },
    ],
    updatedAt: "2026-10-28T13:10:00.000Z",
  },
  {
    n: 7,
    category: "owner",
    title: "Who runs the Discord server?",
    statement: "No source says who administers the CodeCell Discord server.",
    attributes: { responsibility: "Discord server administration", ownerLabel: null, since: null },
    evidence: [],
    updatedAt: "2026-10-28T13:10:00.000Z",
  },
  {
    n: 8,
    category: "owner",
    title: "Rohan handles venue bookings",
    statement: "Rohan Pillai books rooms and auditoriums through the Dean's office.",
    attributes: { responsibility: "Venue bookings", ownerLabel: "Rohan Pillai", since: null },
    evidence: [
      { quote: "rohan can you do the auditorium form again, same as last time", by: "Priya Raman", at: "2026-09-02T11:00:00.000Z", source: core, line: 4188, verdict: "partial", why: "Implies Rohan has done this before, but does not assign the role." },
    ],
    rationale: "Rohan submitted every venue request seen in the chat.",
    updatedAt: "2026-10-28T13:10:00.000Z",
  },
  // ── Open work ─────────────────────────────────────────────
  {
    n: 9,
    category: "open_task",
    title: "Renew the codecell.dev domain",
    statement: "The codecell.dev domain must be renewed before it expires on 30 November.",
    attributes: { assigneeLabel: "Priya Raman", dueDate: "2026-11-30", progressNote: "Renewal invoice requested from the treasurer." },
    evidence: [
      { quote: "domain expires 30 nov!! someone remind me to renew, card on file is my personal one so need to switch", by: "Priya Raman", at: "2026-10-21T18:02:00.000Z", source: core, line: 4720, verdict: "supports", why: "States the expiry date and that renewal is pending." },
    ],
    updatedAt: "2026-10-28T13:10:00.000Z",
  },
  {
    n: 10,
    category: "open_task",
    title: "Finish the DevForge judging rubric",
    statement: "The judging rubric for DevForge 2027 is half-written and needs final weights.",
    attributes: { assigneeLabel: null, dueDate: null, progressNote: "Draft in the runbook; weights missing." },
    evidence: [
      { quote: "Judging rubric (DRAFT): innovation, technical depth, presentation — weights TBD", by: null, at: null, source: runbook, line: 88, heading: "6. Judging", verdict: "partial", why: "Shows a draft exists, not that it is unfinished for 2027." },
    ],
    updatedAt: "2026-10-28T13:10:00.000Z",
  },
  {
    n: 11,
    category: "blocker",
    title: "Sponsor payment blocked on GST invoice",
    statement: "The DevForge sponsor will not release the second instalment until the club issues a GST invoice.",
    attributes: { blockingWhat: "Second sponsorship instalment", unblockCondition: "Accounts office issues a GST invoice in the club's name" },
    evidence: [
      { quote: "they won't release the 2nd instalment without a GST invoice. accounts office says 2–3 weeks", by: "Kabir Shah", at: "2026-10-14T12:30:00.000Z", source: leads, line: 1102, verdict: "supports", why: "States the blocker and its cause." },
    ],
    updatedAt: "2026-10-28T13:10:00.000Z",
  },
  {
    n: 12,
    category: "next_action",
    title: "Book the auditorium for January orientation",
    statement: "Submit the auditorium booking form for the January freshers' orientation before the winter break.",
    attributes: { actorLabel: "Incoming technical lead", byWhen: "Before winter break" },
    earlier: [{ title: "Book auditorium for orientation", statement: "Book the auditorium for orientation.", by: "extraction", at: "2026-10-28T13:10:00.000Z" }],
    editedBy: { label: "Priya Raman", reason: "Added the deadline and which orientation." },
    evidence: [
      { quote: "orientation in jan — auditorium form has to go in before winter break or we lose the slot", by: "Rohan Pillai", at: "2026-10-09T10:45:00.000Z", source: core, line: 4602, verdict: "supports", stale: true, why: "Supported the earlier wording; not yet re-checked against the edit." },
    ],
    updatedAt: "2026-11-09T11:42:00.000Z",
    history: [{ action: "edit", actor: "Priya Raman", note: "Added the deadline and which orientation.", at: "2026-11-09T11:42:00.000Z" }],
  },
  // ── Risks & dependencies ──────────────────────────────────
  {
    n: 13,
    category: "risk",
    title: "Only Priya knows how to deploy the judging portal",
    statement: "The judging portal deploy process is undocumented and only Priya has done it.",
    attributes: { likelihood: "high", impact: "high", mitigation: "Pair-deploy with Neha before handover; write the steps into infra-notes.md." },
    evidence: [
      { quote: "deploy is: ssh in, pull, restart pm2. env vars are in the server not the repo. i'll write it down someday 😅", by: "Priya Raman", at: "2026-10-03T16:20:00.000Z", source: core, line: 4561, verdict: "supports", why: "Shows the process lives only with Priya." },
      { quote: "Deploy: see Priya.", by: null, at: null, source: infra, line: 3, heading: "Judging portal", verdict: "supports", why: "The notes defer to Priya rather than documenting steps." },
    ],
    updatedAt: "2026-10-28T13:10:00.000Z",
  },
  {
    n: 14,
    category: "dependency",
    title: "Sponsor logo placement due 15 December",
    statement: "The MoU requires the sponsor's logo on the website and all event posters by 15 December.",
    attributes: { dependsOnLabel: "DevForge title sponsor", dependencyType: "organisation" },
    evidence: [
      { quote: "The Organiser shall display the Sponsor's logo on its website and all promotional material no later than 15 December 2026.", by: null, at: null, source: mou, line: 41, page: 3, heading: "Clause 4.2 Branding", verdict: "supports", why: "States the obligation and the date." },
    ],
    review: "approved",
    updatedAt: "2026-10-02T10:00:00.000Z",
    history: [{ action: "approve", actor: "Priya Raman", at: "2026-10-02T10:00:00.000Z" }],
  },
  {
    n: 15,
    category: "recurring_problem",
    title: "Lab 3 projector cuts out in long sessions",
    statement: "The Lab 3 projector overheats after about 90 minutes. Use the front desk's HDMI extender and the spare projector.",
    attributes: { frequency: "Most workshops over 90 minutes", knownWorkaround: "Borrow the spare projector from the front desk", firstSeenAt: "2026-02" },
    evidence: [
      { quote: "projector died AGAIN at 1.5 hrs. front desk has a spare, [EXCLUDED_PARTICIPANT] knows where the hdmi extender is", by: "Ananya Iyer", at: "2026-07-19T13:05:00.000Z", source: core, line: 3620, verdict: "supports", why: "Describes the recurring failure and the workaround." },
      { quote: "lab 3 projector is fine now, IT replaced the bulb", by: "Rohan Pillai", at: "2026-03-04T09:30:00.000Z", source: core, line: 1760, verdict: "irrelevant", why: "About a bulb replacement before the overheating began." },
    ],
    review: "approved",
    updatedAt: "2026-10-01T09:10:00.000Z",
    history: [{ action: "approve", actor: "Priya Raman", at: "2026-10-01T09:10:00.000Z" }],
  },
  {
    n: 16,
    category: "dependency",
    title: "Guest Wi-Fi for events depends on college IT",
    statement: "Event guest Wi-Fi codes must be requested from college IT a week before each event.",
    attributes: { dependsOnLabel: "College IT services", dependencyType: "organisation" },
    evidence: [
      { quote: "IT took 6 days to send the guest codes last time, ask early", by: "Rohan Pillai", at: "2026-03-10T08:12:00.000Z", source: core, line: 1801, verdict: "partial", why: "Suggests the lead time but does not state the rule." },
    ],
    rationale: "Every event thread includes a request to IT about a week before.",
    review: "approved",
    confirmedBy: { profileId: P.priya.id, at: "2026-10-01T09:20:00.000Z" },
    updatedAt: "2026-10-01T09:20:00.000Z",
    history: [{ action: "approve", actor: "Priya Raman", note: "Confirmed: this is how we have always done it.", at: "2026-10-01T09:20:00.000Z" }],
  },
  // ── Contacts ──────────────────────────────────────────────
  {
    n: 17,
    category: "contact",
    title: "Mr. Desai, Dean's office",
    statement: "Mr. Desai in the Dean's office signs off on venue and event approvals.",
    attributes: { nameLabel: "Mr. Desai", organisation: "Dean's office", roleDescription: "Event and venue approvals", preferredChannel: "in_person", directContact: null },
    evidence: [
      { quote: "desai sir approved it, but he wants the form in person not on email. his number is [PHONE_1] if urgent", by: "Rohan Pillai", at: "2026-10-04T06:50:00.000Z", source: core, line: 4199, verdict: "supports", why: "Identifies Mr. Desai, his role and preferred channel." },
    ],
    review: "approved",
    updatedAt: "2026-10-01T09:30:00.000Z",
    history: [{ action: "approve", actor: "Arjun Mehta", at: "2026-10-01T09:30:00.000Z" }],
  },
  {
    n: 18,
    category: "contact",
    title: "Meera, sponsor partnerships",
    statement: "Meera leads partnerships at the DevForge title sponsor and handles invoices and branding approvals.",
    attributes: { nameLabel: "Meera", organisation: "DevForge title sponsor", roleDescription: "Partnerships lead", preferredChannel: "email", directContact: null },
    evidence: [
      { quote: "Sponsor contact for this Agreement: Meera, Partnerships Lead, [EMAIL_1].", by: null, at: null, source: mou, line: 9, page: 1, heading: "Parties", verdict: "supports", why: "Names the sponsor contact and role." },
    ],
    updatedAt: "2026-10-28T13:10:00.000Z",
  },
  {
    n: 19,
    category: "contact",
    title: "Faculty coordinator",
    statement: "No source names CodeCell's faculty coordinator.",
    attributes: { nameLabel: "Faculty coordinator (unknown)", organisation: null, roleDescription: null, preferredChannel: null, directContact: null },
    evidence: [],
    updatedAt: "2026-10-28T13:10:00.000Z",
  },
  // ── Accounts & access ─────────────────────────────────────
  {
    n: 20,
    category: "account_access",
    title: "GitHub organisation owners",
    statement: "Priya and Kabir are owners of the codecell-org GitHub organisation. Credentials are in the CodeCell Core vault in Bitwarden.",
    attributes: { system: "GitHub (codecell-org)", holderLabel: "Priya Raman, Kabir Shah", accessLocation: "Bitwarden — CodeCell Core vault", recoveryNote: "Recovery codes are in the same vault." },
    evidence: [
      { quote: "re-added kabir as second owner on the github org after the 2FA reset", by: "Priya Raman", at: "2026-10-10T17:45:00.000Z", source: core, line: 4612, verdict: "supports", why: "Confirms both owners after a recent change." },
      { quote: "github org owners are me and kabir. creds in the bitwarden core vault, master password is [PASSWORD]", by: "Priya Raman", at: "2026-05-20T10:20:00.000Z", source: core, line: 2975, verdict: "supports", why: "Names both owners and where credentials live." },
    ],
    review: "approved",
    updatedAt: "2026-10-01T09:40:00.000Z",
    history: [{ action: "approve", actor: "Priya Raman", at: "2026-10-01T09:40:00.000Z" }],
  },
  {
    n: 21,
    category: "account_access",
    title: "Who holds the club bank and UPI account?",
    statement: "No source says who holds the club's bank account and UPI handle.",
    attributes: { system: "Club bank account and UPI", holderLabel: null, accessLocation: null, recoveryNote: null },
    evidence: [],
    updatedAt: "2026-10-28T13:10:00.000Z",
  },
  {
    n: 22,
    category: "account_access",
    title: "AWS account for the judging portal",
    statement: "The judging portal runs on an AWS account registered to the club email. MFA is on Priya's phone.",
    attributes: { system: "AWS (judging portal)", holderLabel: "Priya Raman", accessLocation: "Root login in Bitwarden — Infra vault", recoveryNote: "Move MFA to a shared device before handover." },
    evidence: [
      { quote: "AWS root: club gmail. Key [API_KEY] rotated Oct. MFA = Priya's phone (TODO move to shared device).", by: null, at: null, source: infra, line: 18, heading: "Accounts", verdict: "supports", why: "Describes the account holder and MFA location." },
    ],
    updatedAt: "2026-10-28T13:10:00.000Z",
  },
  // ── A rejected point and one with excluded evidence ───────
  {
    n: 23,
    category: "decision",
    title: "Club T-shirts ordered from PrintBay",
    statement: "Club T-shirts are ordered from PrintBay every August.",
    attributes: { decidedAt: null, decidedByLabel: null, rationale: null, alternativesConsidered: [] },
    evidence: [
      { quote: "printbay delivered the tees, size M ran small", by: "Ananya Iyer", at: "2026-08-22T07:40:00.000Z", source: core, line: 4060, verdict: "partial" },
    ],
    review: "rejected",
    updatedAt: "2026-10-01T09:50:00.000Z",
    history: [{ action: "reject", actor: "Priya Raman", note: "One-off order, not a standing decision.", at: "2026-10-01T09:50:00.000Z" }],
  },
  {
    n: 24,
    category: "owner",
    title: "Treasurer approves reimbursements",
    statement: "Reimbursements under ₹2,000 are approved by the club treasurer; larger ones need the faculty coordinator.",
    attributes: { responsibility: "Reimbursement approvals", ownerLabel: "Club treasurer", since: null },
    evidence: [
      { quote: "anything under 2k treasurer can approve, above that needs faculty sign", by: "Kabir Shah", at: "2026-10-05T11:10:00.000Z", source: core, line: 4480, verdict: "supports", why: "States the approval threshold." },
      { quote: "send me your UPI and I'll reimburse: [UPI_2]", by: "Participant 1", at: "2026-10-06T08:00:00.000Z", source: core, line: 4491, verdict: "supports", excluded: "Contains a member's payment handle and adds nothing beyond the quote above." },
    ],
    updatedAt: "2026-10-28T13:10:00.000Z",
    history: [{ action: "exclude_evidence", actor: "Priya Raman", note: "Contains a member's payment handle and adds nothing beyond the quote above.", at: "2026-11-02T08:00:00.000Z" }],
  },
];

export const codecellPoints = seeds.map((s) => buildPoint(H, 0, s));

/** Points included in the v1 publication (2 Oct), independent of their current review state. */
export const CODECELL_V1_POINT_NUMBERS = [1, 3, 5, 9, 11, 13, 14, 15, 16, 17, 18, 20, 21, 7];
/** v1 published these missing points as known gaps (D7). */
export const CODECELL_V1_KNOWN_GAPS = [7, 21];

export const codecellGapQuestions: MockGapQuestion[] = [
  {
    id: seedId(NS.gapQuestion, 1),
    handoverId: H,
    pointId: seedId(NS.point, 7),
    category: "owner",
    question: "Who administers the CodeCell Discord server, and who else has admin rights?",
    context: "No message or document names a Discord admin. Members link to the server in recruitment posts.",
    priority: "required",
    status: "open",
    accessLevel: "everyone",
    answers: [],
    createdAt: "2026-10-28T13:12:00.000Z",
  },
  {
    id: seedId(NS.gapQuestion, 2),
    handoverId: H,
    pointId: seedId(NS.point, 21),
    category: "account_access",
    question: "Who holds the club's bank account and UPI handle, and how is access passed on?",
    context: "Workshop fees are collected on a UPI handle, but no source says who controls it.",
    priority: "required",
    status: "open",
    accessLevel: "everyone",
    answers: [],
    createdAt: "2026-10-28T13:12:00.000Z",
  },
  {
    id: seedId(NS.gapQuestion, 3),
    handoverId: H,
    pointId: seedId(NS.point, 19),
    category: "contact",
    question: "Who is CodeCell's faculty coordinator, and what do they need to sign off?",
    context: "Large reimbursements need a faculty signature, but the coordinator is never named.",
    priority: "optional",
    status: "answered",
    accessLevel: "everyone",
    answers: [
      {
        id: seedId(NS.gapAnswer, 1),
        answererLabel: "Priya Raman",
        text: "Dr. Lakshmi Menon (CSE dept) is our faculty coordinator. She signs reimbursements above ₹2,000 and all sponsorship MoUs. Best reached in person on Tuesdays.",
        status: "submitted",
        privacyHeld: false,
        createdAt: "2026-11-06T10:30:00.000Z",
        answeredByProfileId: PROFILES.priya.id,
        viaToken: CODECELL_GAP_TOKEN,
      },
    ],
    createdAt: "2026-10-28T13:12:00.000Z",
  },
  {
    id: seedId(NS.gapQuestion, 4),
    handoverId: H,
    pointId: null,
    category: null,
    question: "Is there anything the incoming lead should never do without checking with someone first?",
    context: null,
    priority: "optional",
    status: "open",
    accessLevel: "everyone",
    answers: [],
    createdAt: "2026-11-01T08:00:00.000Z",
  },
];

export const codecellTokens: MockToken[] = [
  {
    id: seedId(NS.token, 1),
    token: CODECELL_GAP_TOKEN,
    purpose: "gap_interview",
    handoverId: H,
    questionIds: [seedId(NS.gapQuestion, 1), seedId(NS.gapQuestion, 2), seedId(NS.gapQuestion, 3), seedId(NS.gapQuestion, 4)],
    maxAccessLevel: "everyone",
    grantRole: null,
    recipientEmail: null,
    sessionProfileId: null,
    redeemedAt: null,
    expiresAt: "2026-12-31T18:29:00.000Z",
    revokedAt: null,
    maxUses: 20,
    useCount: 1,
    createdBy: PROFILES.priya.id,
    createdAt: "2026-11-01T08:05:00.000Z",
  },
  {
    id: seedId(NS.token, 2),
    token: CODECELL_INCOMING_TOKEN,
    purpose: "member_invite",
    handoverId: H,
    questionIds: [],
    maxAccessLevel: "everyone",
    grantRole: "incoming",
    recipientEmail: PROFILES.neha.email,
    sessionProfileId: PROFILES.neha.id,
    redeemedAt: "2026-10-02T12:00:00.000Z",
    expiresAt: "2026-10-09T12:00:00.000Z",
    revokedAt: null,
    maxUses: 1,
    useCount: 1,
    createdBy: PROFILES.priya.id,
    createdAt: "2026-10-02T11:40:00.000Z",
  },
  {
    id: seedId(NS.token, 3),
    token: CODECELL_LEAD_TOKEN,
    purpose: "member_invite",
    handoverId: H,
    questionIds: [],
    maxAccessLevel: "leads_only",
    grantRole: "lead",
    recipientEmail: PROFILES.kabir.email,
    sessionProfileId: PROFILES.kabir.id,
    redeemedAt: "2026-10-02T12:05:00.000Z",
    expiresAt: "2026-10-09T12:05:00.000Z",
    revokedAt: null,
    maxUses: 1,
    useCount: 1,
    createdBy: PROFILES.priya.id,
    createdAt: "2026-10-02T11:41:00.000Z",
  },
  // Pending: the faculty advisor hasn't accepted yet (§12.3). Listed in settings for the creator only.
  {
    id: seedId(NS.token, 4),
    token: seedToken("codecell_lead_advisor_pending"),
    purpose: "member_invite",
    handoverId: H,
    questionIds: [],
    maxAccessLevel: "leads_only",
    grantRole: "lead",
    recipientEmail: "faculty.advisor@example.edu",
    sessionProfileId: null,
    redeemedAt: null,
    expiresAt: "2027-01-31T09:00:00.000Z",
    revokedAt: null,
    maxUses: 1,
    useCount: 0,
    createdBy: PROFILES.priya.id,
    createdAt: "2026-11-09T09:00:00.000Z",
  },
  // An earlier Gap Interview link that was revoked.
  {
    id: seedId(NS.token, 5),
    token: seedToken("codecell_gap_interview_old"),
    purpose: "gap_interview",
    handoverId: H,
    questionIds: [seedId(NS.gapQuestion, 1)],
    maxAccessLevel: "everyone",
    grantRole: null,
    recipientEmail: null,
    sessionProfileId: null,
    redeemedAt: null,
    expiresAt: "2026-11-20T08:00:00.000Z",
    revokedAt: "2026-10-31T10:00:00.000Z",
    maxUses: 20,
    useCount: 0,
    createdBy: PROFILES.arjun.id,
    createdAt: "2026-10-24T08:00:00.000Z",
  },
];
