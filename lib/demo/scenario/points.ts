/**
 * DEMO SCENARIO: what Baton's (pre-generated) draft contains for the CodeCell handover, and the
 * reviewers' decisions. NO AI produced this at runtime: it is a hand-written stand-in for an
 * extraction run, and the demo must say so.
 *
 * Every quote is the MASKED text, word for word as the real parser and masker produce it from
 * ./sources.ts; lib/demo/__tests__/scenario.test.ts enforces that, and that each quote's author,
 * time and line match the parsed message. Attributes are validated against the canonical
 * category schemas there too.
 * Pure data: no React, no I/O.
 */

import type { PointCategory, SupportVerdict } from "@/lib/contracts/enums";

import type { DemoPersonKey } from "./cast";
import type { DemoSourceKey } from "./sources";

export interface DemoEvidenceSeed {
  source: DemoSourceKey;
  /** Masked text exactly as Baton stores it: a substring of the parsed message body. */
  quote: string;
  /** WhatsApp: a unique substring of the RAW line (defaults to `quote`). */
  find?: string;
  /** Markdown: the parsed block's lines and heading (the parser groups adjacent list items). */
  block?: { lineStart: number; lineEnd: number; heading: string };
  /** Chat author; null for documents. */
  by: DemoPersonKey | null;
  verdict: SupportVerdict;
  /** Why the support check gave this verdict (shown in the point detail panel). */
  why: string;
}

export type DemoPointKey =
  | "devforge_format"
  | "workshop_fee"
  | "github_org"
  | "weekly_meeting"
  | "tshirts"
  | "sponsor_owner"
  | "website_owner"
  | "discord_admin"
  | "reimbursements"
  | "domain_renewal"
  | "judging_rubric"
  | "gst_blocker"
  | "auditorium_booking"
  | "deploy_risk"
  | "guest_wifi"
  | "projector"
  | "contact_desai"
  | "contact_farah"
  | "contact_menon"
  | "github_owners"
  | "instagram_account";

export interface DemoPointSeed {
  /** Stable order (1-based); also the seed id number. */
  n: number;
  key: DemoPointKey;
  category: PointCategory;
  title: string;
  statement: string;
  /** Raw attributes for the category; parsed with the canonical schema. */
  attributes: Record<string, unknown>;
  evidence: DemoEvidenceSeed[];
  /** Inferred points: why Baton inferred it. */
  rationale?: string;
  /**
   * Review state when the visitor reaches the review step. Priya (reviewer) approved the
   * straightforward points on the evening of 11 Nov; the visitor, as Kabir, handles the rest.
   */
  atReviewStart: "pending" | "approved";
}

export const DEMO_POINTS: readonly DemoPointSeed[] = [
  // ── Decisions ─────────────────────────────────────────────
  {
    n: 1,
    key: "devforge_format",
    category: "decision",
    title: "DevForge 2027 runs on two days, daytime only",
    statement: "DevForge 2027 runs on Saturday 30 and Sunday 31 January 2027, 9 am to 9 pm both days, with no overnight session in the labs. The core team voted 11–2 for it.",
    attributes: { decidedAt: "2026-08-21", decidedByLabel: "Core team vote (11–2)", rationale: "The 24-hour format was hard on the volunteers.", alternativesConsidered: ["24-hour overnight hackathon"] },
    evidence: [
      { source: "core", quote: "vote closed 11–2. DevForge '27 is Sat 30 – Sun 31 Jan, 9am to 9pm both days. no overnight in the labs this time", by: "kabir", verdict: "supports", why: "States the vote, the dates and the daytime-only format." },
      { source: "core", quote: "good call, last year's 24h format was rough on the volunteers", by: "priya", verdict: "supports", why: "Gives the reason for dropping the 24-hour format." },
      { source: "core", quote: "registrations page now says 30–31 jan, daytime only", by: "arjun", verdict: "supports", why: "Shows the decision is still current in November." },
    ],
    atReviewStart: "approved",
  },
  {
    n: 2,
    key: "workshop_fee",
    category: "decision",
    title: "Workshop fee for non-members",
    statement: "Non-members pay ₹100 per workshop; members attend free.",
    attributes: { decidedAt: "2026-08-04", decidedByLabel: "Kabir Shah", rationale: null, alternativesConsidered: [] },
    evidence: [
      { source: "core", quote: "workshop fee for this sem: non-members pay ₹100 per workshop, members free. collect it at the door and note names in the sheet", by: "kabir", verdict: "supports", why: "States the fee and who pays it." },
      { source: "core", quote: "from this sem workshops are free for everyone, we agreed in the leads call. no more ₹100 at the door", by: "priya", verdict: "contradicts", why: "Says workshops became free for everyone, which contradicts the ₹100 fee." },
    ],
    atReviewStart: "pending",
  },
  {
    n: 3,
    key: "github_org",
    category: "decision",
    title: "Club code lives in the codecell-org GitHub organisation",
    statement: "All club repositories, including the judging portal and the website, moved from personal accounts to the codecell-org GitHub organisation in October 2026.",
    attributes: { decidedAt: "2026-10-12", decidedByLabel: "Kabir Shah", rationale: null, alternativesConsidered: [] },
    evidence: [
      { source: "core", quote: "moved judging-portal and codecell-site to the codecell-org github org today. please stop pushing to my personal account", by: "kabir", verdict: "supports", why: "Describes the move to the organisation." },
      { source: "infra", quote: "All club repositories live in the codecell-org GitHub organisation. Personal forks are archived.", block: { lineStart: 7, lineEnd: 7, heading: "Code" }, by: null, verdict: "supports", why: "The infrastructure notes say the same." },
    ],
    atReviewStart: "approved",
  },
  {
    n: 4,
    key: "weekly_meeting",
    category: "decision",
    title: "The weekly meeting is on Thursdays",
    statement: "The core team meets every Thursday at 6 pm in Lab 3.",
    attributes: { decidedAt: null, decidedByLabel: null, rationale: null, alternativesConsidered: [] },
    evidence: [
      { source: "core", quote: "can we do thursday this week instead? lab 3 is free after 6", by: "ananya", verdict: "partial", why: "Asks for Thursday for one week only." },
      { source: "core", quote: "thursday again? same lab 3 at 6", by: "priya", verdict: "partial", why: "Suggests Thursday again, without calling it a rule." },
      { source: "core", quote: "see you all thursday, 6pm, lab 3", by: "ananya", verdict: "partial", why: "A meeting reminder, not a decision." },
    ],
    rationale: "Every meeting message since late September names Thursday, 6 pm and Lab 3, but nobody states it as a rule.",
    atReviewStart: "pending",
  },
  {
    n: 5,
    key: "tshirts",
    category: "decision",
    title: "Club T-shirts come from the campus print shop",
    statement: "Club T-shirts were ordered from the campus print shop in August 2026.",
    attributes: { decidedAt: "2026-08-22", decidedByLabel: null, rationale: null, alternativesConsidered: [] },
    evidence: [{ source: "core", quote: "print shop delivered the tees, size M ran small", by: "ananya", verdict: "supports", why: "Confirms an order from the print shop." }],
    atReviewStart: "pending",
  },
  // ── Ownership ─────────────────────────────────────────────
  {
    n: 6,
    key: "sponsor_owner",
    category: "owner",
    title: "Arjun owns sponsor relations",
    statement: "Arjun Mehta is the only point of contact for sponsors, including Orbitstack, DevForge 2027's title sponsor. The sponsor side stays with him after the handover.",
    attributes: { responsibility: "Sponsor relations", ownerLabel: "Arjun Mehta", since: "September 2026" },
    evidence: [
      { source: "leads", quote: "orbitstack signed as DevForge title sponsor 🎉 i'm the point of contact for them, nobody else emails them please", by: "arjun", verdict: "supports", why: "Arjun names himself as the sponsor's contact." },
      { source: "leads", quote: "amazing. arjun owns all sponsor comms from now", by: "priya", verdict: "supports", why: "The president assigns sponsor communication to Arjun." },
      { source: "leads", quote: "for the handover: neha won't be in this group, the sponsor side stays with arjun", by: "kabir", verdict: "supports", why: "Confirms the ownership does not move to the incoming lead." },
    ],
    atReviewStart: "approved",
  },
  {
    n: 7,
    key: "website_owner",
    category: "owner",
    title: "Ananya maintains the club website",
    statement: "Ananya Iyer maintains codecell.example.org and deploys it from the codecell-site repository.",
    attributes: { responsibility: "Club website", ownerLabel: "Ananya Iyer", since: null },
    evidence: [
      { source: "infra", quote: "codecell.example.org is built from the codecell-site repository. Ananya Iyer deploys it.", block: { lineStart: 11, lineEnd: 12, heading: "Website" }, by: null, verdict: "supports", why: "Names Ananya as the person who deploys the website." },
    ],
    atReviewStart: "approved",
  },
  {
    n: 8,
    key: "discord_admin",
    category: "owner",
    title: "Who runs the Discord server?",
    statement: "No source says who administers the CodeCell Discord server.",
    attributes: { responsibility: "Discord server administration", ownerLabel: null, since: null },
    evidence: [],
    atReviewStart: "pending",
  },
  {
    n: 9,
    key: "reimbursements",
    category: "owner",
    title: "The treasurer approves small reimbursements",
    statement: "Rohan Pillai, the treasurer, approves reimbursements under ₹2,000. Larger amounts need Dr. Menon's signature.",
    attributes: { responsibility: "Reimbursement approvals", ownerLabel: "Rohan Pillai (treasurer)", since: null },
    evidence: [
      { source: "core", quote: "reimbursements: anything under ₹2,000 i can approve, above that needs dr. menon's signature", by: "rohan", verdict: "supports", why: "States the approval limit and who signs above it." },
      { source: "core", quote: "i paid 1,850 for the workshop snacks, please reimburse me on [PHONE_2]", find: "i paid 1,850 for the workshop snacks", by: "ishaan", verdict: "partial", why: "A reimbursement request under the limit; it does not state the rule." },
    ],
    atReviewStart: "pending",
  },
  // ── Open work ─────────────────────────────────────────────
  {
    n: 10,
    key: "domain_renewal",
    category: "open_task",
    title: "Renew the club domain",
    statement: "The codecell.example.org domain renews on 12 December. It is still billed to Kabir's personal card and has to move to the club card.",
    attributes: { assigneeLabel: "Kabir Shah", dueDate: "2026-12-12", progressNote: "Still on Kabir's personal card." },
    evidence: [
      { source: "core", quote: "domain renews on 12 dec and it's still on my personal card. need to move it to the club card before i leave", by: "kabir", verdict: "supports", why: "States the renewal date and the billing problem." },
      { source: "infra", quote: "The domain renews on 12 December every year.", block: { lineStart: 11, lineEnd: 12, heading: "Website" }, by: null, verdict: "supports", why: "The notes give the same renewal date." },
    ],
    atReviewStart: "pending",
  },
  {
    n: 11,
    key: "judging_rubric",
    category: "open_task",
    title: "Finish the DevForge judging rubric",
    statement: "Arjun Mehta is finishing the DevForge 2027 judging rubric. The draft is in the shared drive; the scoring weights are still pending.",
    attributes: { assigneeLabel: "Arjun Mehta", dueDate: "2026-12-15", progressNote: "Draft in the shared drive; weights pending." },
    evidence: [{ source: "core", quote: "judging rubric draft is in the drive. weights still pending, i'll finish it by 15 dec", by: "arjun", verdict: "supports", why: "States the owner, the progress and the date." }],
    atReviewStart: "approved",
  },
  {
    n: 12,
    key: "gst_blocker",
    category: "blocker",
    title: "Sponsor's second instalment waits for a GST invoice",
    statement: "Orbitstack will not release its second sponsorship instalment until the college accounts office issues a GST invoice.",
    attributes: { blockingWhat: "Orbitstack's second sponsorship instalment", unblockCondition: "The accounts office issues a GST invoice in the club's name" },
    evidence: [
      { source: "leads", quote: "orbitstack won't release the 2nd instalment without a GST invoice. accounts office says 2–3 weeks", by: "arjun", verdict: "supports", why: "States the blocker and its cause." },
      { source: "leads", quote: "i'll chase the accounts office every monday", by: "rohan", verdict: "supports", why: "Shows who is following it up." },
    ],
    atReviewStart: "approved",
  },
  {
    n: 13,
    key: "auditorium_booking",
    category: "next_action",
    title: "Book the auditorium for January orientation",
    statement: "Submit the auditorium booking form for the January freshers' orientation before the winter break, or the slot is lost.",
    attributes: { actorLabel: "Incoming technical lead", byWhen: "Before the winter break" },
    evidence: [{ source: "core", quote: "orientation is in jan, the auditorium form has to go in before winter break or we lose the slot", by: "rohan", verdict: "supports", why: "States the deadline and the consequence." }],
    atReviewStart: "approved",
  },
  // ── Risks & dependencies ──────────────────────────────────
  {
    n: 14,
    key: "deploy_risk",
    category: "risk",
    title: "Only Kabir knows how to deploy the judging portal",
    statement: "The judging portal's deploy steps are not written down, and only Kabir has done a deploy.",
    attributes: { likelihood: "high", impact: "high", mitigation: "Write the deploy steps into the infrastructure notes before Kabir leaves on 30 November." },
    evidence: [
      { source: "core", quote: "judging portal deploy is: ssh in, pull, restart pm2. config lives on the server, not in the repo. i'll write it down someday 😅", by: "kabir", verdict: "supports", why: "Shows the steps exist only in Kabir's head." },
      { source: "infra", quote: "Deploy: ask Kabir.", block: { lineStart: 16, lineEnd: 17, heading: "Judging portal" }, by: null, verdict: "supports", why: "The notes point to Kabir instead of listing steps." },
    ],
    atReviewStart: "approved",
  },
  {
    n: 15,
    key: "guest_wifi",
    category: "dependency",
    title: "Guest Wi-Fi depends on college IT",
    statement: "Guest Wi-Fi for events has to be requested from college IT a week before each event; it took 6 days last time.",
    attributes: { dependsOnLabel: "College IT", dependencyType: "organisation" },
    evidence: [{ source: "core", quote: "IT took 6 days to set up guest wifi for the last event. ask them a week before every event", by: "rohan", verdict: "supports", why: "States the lead time and the rule of thumb." }],
    atReviewStart: "approved",
  },
  {
    n: 16,
    key: "projector",
    category: "recurring_problem",
    title: "The Lab 3 projector cuts out in long sessions",
    statement: "The Lab 3 projector dies about 90 minutes into a session. The front desk has a spare.",
    attributes: { frequency: "Sessions longer than about 90 minutes", knownWorkaround: "Borrow the spare projector from the front desk", firstSeenAt: "March 2026" },
    evidence: [
      { source: "core", quote: "projector in lab 3 died 1.5 hrs into the git workshop. front desk has a spare one, used that", by: "ananya", verdict: "supports", why: "Describes the failure and the workaround." },
      { source: "core", quote: "same thing happened in march", by: "rohan", verdict: "supports", why: "Shows it has happened before." },
      { source: "core", quote: "projector died again at 1.5 hrs. got the spare from the front desk", by: "kabir", verdict: "supports", why: "Shows it still happens in September." },
    ],
    atReviewStart: "approved",
  },
  // ── Contacts ──────────────────────────────────────────────
  {
    n: 17,
    key: "contact_desai",
    category: "contact",
    title: "Mr. Desai, Dean's office",
    statement: "Mr. Desai in the Dean's office approves venues. He wants forms handed in person, not by email.",
    attributes: { nameLabel: "Mr. Desai", organisation: "Dean's office", roleDescription: "Approves venues and events", preferredChannel: "in_person", directContact: null },
    evidence: [{ source: "core", quote: "desai sir approved the workshop venue but he wants the form in person, not on email. his number is [PHONE_1] if it's urgent", find: "desai sir approved the workshop venue", by: "rohan", verdict: "supports", why: "Names Mr. Desai, what he approves and how he wants forms." }],
    atReviewStart: "approved",
  },
  {
    n: 18,
    key: "contact_farah",
    category: "contact",
    title: "Farah Khan, Orbitstack",
    statement: "Farah Khan, partnerships manager at Orbitstack, is the sponsor's contact. Arjun talks to her; nobody else should email Orbitstack.",
    attributes: { nameLabel: "Farah Khan", organisation: "Orbitstack", roleDescription: "Partnerships manager", preferredChannel: "email", directContact: null },
    evidence: [{ source: "leads", quote: "our contact at orbitstack is farah khan, partnerships manager. [EMAIL_1], office line [PHONE_1]", find: "our contact at orbitstack is farah khan", by: "arjun", verdict: "supports", why: "Names the contact and her role." }],
    atReviewStart: "approved",
  },
  {
    n: 19,
    key: "contact_menon",
    category: "contact",
    title: "Dr. Menon, faculty coordinator",
    statement: "Dr. Menon (CSE department) is CodeCell's faculty coordinator. She signs the sponsor MoU and any spending above ₹2,000.",
    attributes: { nameLabel: "Dr. Menon", organisation: "CSE department", roleDescription: "Faculty coordinator; signs the sponsor MoU and spending above ₹2,000", preferredChannel: null, directContact: null },
    evidence: [
      { source: "core", quote: "dr. menon (CSE) stays our faculty coordinator this year. she signs the sponsor MoU and anything above ₹2,000", by: "kabir", verdict: "supports", why: "Names her role and what she signs." },
      { source: "core", quote: "reimbursements: anything under ₹2,000 i can approve, above that needs dr. menon's signature", by: "rohan", verdict: "supports", why: "Confirms in October that she signs spending above ₹2,000." },
    ],
    atReviewStart: "approved",
  },
  // ── Accounts & access ─────────────────────────────────────
  {
    n: 20,
    key: "github_owners",
    category: "account_access",
    title: "GitHub organisation owners",
    statement: "Kabir Shah and Priya Raman own the codecell-org GitHub organisation. Recovery codes are in the club password manager. Kabir adds Neha as an owner before he leaves.",
    attributes: { system: "GitHub (codecell-org)", holderLabel: "Kabir Shah, Priya Raman", accessLocation: "Club password manager (recovery codes)", recoveryNote: "Kabir adds Neha as an owner before he leaves." },
    evidence: [
      { source: "core", quote: "github org owners are me and priya. recovery codes are in the club password manager, not in chat. i'll add neha as owner before i go", by: "kabir", verdict: "supports", why: "Names both owners, where recovery codes are and the plan for Neha." },
      { source: "infra", quote: "Owners of codecell-org: Kabir Shah, Priya Raman.", block: { lineStart: 21, lineEnd: 22, heading: "Access" }, by: null, verdict: "supports", why: "The notes list the same owners." },
    ],
    atReviewStart: "approved",
  },
  {
    n: 21,
    key: "instagram_account",
    category: "account_access",
    title: "Who controls the Instagram account?",
    statement: "No source says who holds the login for the club's Instagram account or who can post.",
    attributes: { system: "Club Instagram account", holderLabel: null, accessLocation: null, recoveryNote: null },
    evidence: [],
    atReviewStart: "pending",
  },
];

/** The two gaps Baton asks about. Both are optional, so they do not block publishing (see scenario.md §5). */
export const DEMO_GAP_QUESTIONS = [
  {
    n: 1,
    point: "discord_admin" as DemoPointKey,
    question: "Who administers the CodeCell Discord server, and who else has admin rights?",
    context: "Members are told to join the Discord, but no message or document names an admin.",
    priority: "optional" as const,
  },
  {
    n: 2,
    point: "instagram_account" as DemoPointKey,
    question: "Who has the login for the club's Instagram account, and who can post?",
    context: "The Discord link is in the Instagram bio, but no source says who controls the account.",
    priority: "optional" as const,
  },
] as const;

/** Ananya's Gap Interview answer (journey step 6). She skips the Instagram question. */
export const DEMO_GAP_ANSWER = {
  question: 1,
  answererLabel: "Ananya Iyer",
  text: "I set the server up in 2025 and I'm its only admin. Kabir has moderator rights. I'll make Neha an admin on 1 December.",
} as const;
