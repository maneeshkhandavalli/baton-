/**
 * PROTOTYPE SAMPLE DATA — the single home of Baton's CodeCell demo content (see lib/prototype/flags.ts).
 *
 * Entirely invented: a student coding club ("CodeCell") handing over its technical-lead role from
 * Kabir Shah to Neha Kulkarni, the same cast as the read-only /demo. Phone numbers use the synthetic
 * `99999 0000N` pattern and email addresses use example.org, so masking can be seen working. There are no
 * passwords, keys, tokens or other credential-like strings anywhere in this file, on purpose.
 *
 * Two uses, both going through Baton's normal paths:
 *   1. CODECELL_SAMPLE_SOURCES are turned into real browser `File`s and uploaded through the wizard's
 *      normal upload → confirm → consent → preview → processing pipeline (no backend shortcut).
 *   2. CODECELL_SAMPLE_POINTS prefill the review workspace's "Add a point" form (createManualPoint), one
 *      per category, matching the editable attributes in components/review/manual-point.ts.
 * Pure data and helpers: no React, no I/O, safe to import from client components.
 */

import type { PointCategory, SourceKind } from "@/lib/contracts/enums";

import { missingByName, SAMPLE_SOURCE_FILE_NAMES } from "./identity";

export { isSampleFileName, SAMPLE_FILE_PREFIX, SAMPLE_POINT_TITLE_PREFIX, SAMPLE_SOURCE_FILE_NAMES } from "./identity";

// ── 1. Sample source files ────────────────────────────────────────────────────

export interface SampleSourceFile {
  /** Stable id, used to avoid adding the same sample twice. */
  id: string;
  /** Upload file name; also how a reloaded draft recognises the row as sample data. */
  fileName: string;
  kind: Extract<SourceKind, "whatsapp_export" | "markdown">;
  mimeType: string;
  /** One line shown in the UI. */
  description: string;
  content: string;
}

const CORE_TEAM_CHAT = `13/11/2026, 18:00 - Messages and calls are end-to-end encrypted. No one outside of this chat, not even WhatsApp, can read or listen to them. Tap to learn more.
13/11/2026, 18:01 - Kabir Shah created group "CodeCell Core Team"
13/11/2026, 18:02 - Kabir Shah added Neha Kulkarni
13/11/2026, 18:02 - Kabir Shah added Priya Raman
13/11/2026, 18:03 - Kabir Shah added Arjun Mehta
13/11/2026, 18:05 - Kabir Shah: Neha is taking over as technical lead after DevForge, so let's keep the handover notes in this group.
13/11/2026, 18:07 - Priya Raman: We decided to run DevForge 2026 as a 24-hour hackathon instead of 36 hours because the lab is only booked for one night.
13/11/2026, 18:09 - Kabir Shah: We also agreed to move the club website from the old shared hosting to the college's static hosting, because the hosting bill doubled this year.
13/11/2026, 18:11 - Arjun Mehta: Priya is responsible for the sponsor relationship with DevForge Labs and for every invoice they send.
13/11/2026, 18:13 - Kabir Shah: Arjun will finish the hackathon judging rubric by 25 November 2026.
13/11/2026, 18:14 - Priya Raman: Neha Kulkarni will send the mentor invitations by 28/11/2026.
13/11/2026, 18:16 - Kabir Shah: The registration page still needs a form for team names at some point.
14/11/2026, 09:20 - Arjun Mehta: The prize budget is blocked until the faculty coordinator signs the expense approval.
14/11/2026, 09:22 - Priya Raman: Wi-Fi for the hackathon depends on the college IT cell setting up the guest network before the event.
14/11/2026, 09:25 - Kabir Shah: There is a risk that we lose the lab booking if the attendance list is not sent to the department office by Friday.
14/11/2026, 09:27 - Arjun Mehta: The projector in Lab 2 disconnects every time someone plugs in a laptop, it keeps happening.
14/11/2026, 09:30 - Priya Raman: Our contact at DevForge Labs is Ms. Farah Khan, the community manager who approves the sponsorship.
14/11/2026, 09:31 - Priya Raman: For invoices you can reach the DevForge office on 99999 00003 or sponsors@example.org
14/11/2026, 09:34 - Kabir Shah: Kabir Shah and Priya Raman are the owners of the CodeCell GitHub organisation; the recovery codes are kept in the club's shared password manager, not in chat.
14/11/2026, 09:36 - Neha Kulkarni: Next step is for me to book a handover call with Kabir before the hackathon.
14/11/2026, 09:38 - Arjun Mehta: Who is going to collect the participation certificates from the printer?
14/11/2026, 09:40 - Kabir Shah: <Media omitted>
14/11/2026, 09:41 - Neha Kulkarni: Thanks everyone, I'll keep this group updated.
`;

const INFRA_NOTES = `# CodeCell infrastructure notes

Maintained by the technical lead. Last reviewed in November 2026.

## Website
- The club website is built from the \`codecell-site\` repository in the CodeCell GitHub organisation.
- The \`codecell.example.org\` domain renews every year on 12 January; Priya Raman pays the renewal from the club account.

## Hackathon tooling
- Team registrations are collected in the shared "DevForge 2026 registrations" spreadsheet, owned by Arjun Mehta.
- The judging rubric lives in the same shared drive folder as the registrations.

## Access
- New maintainers are added to the GitHub organisation by an existing owner; never share accounts.
- Recovery codes are stored only in the club's shared password manager.
`;

export const CODECELL_SAMPLE_SOURCES: readonly SampleSourceFile[] = [
  {
    id: "codecell-core-team-chat",
    fileName: SAMPLE_SOURCE_FILE_NAMES[0],
    kind: "whatsapp_export",
    mimeType: "text/plain",
    description: "WhatsApp export of the CodeCell core team group (invented)",
    content: CORE_TEAM_CHAT,
  },
  {
    id: "codecell-infra-notes",
    fileName: SAMPLE_SOURCE_FILE_NAMES[1],
    kind: "markdown",
    mimeType: "text/markdown",
    description: "The technical lead's infrastructure notes (invented)",
    content: INFRA_NOTES,
  },
];

/** Sample files not already present in a list of names (extension-insensitive): the duplicate guard. */
export function missingSampleSources(existingNames: readonly string[]): SampleSourceFile[] {
  return missingByName(CODECELL_SAMPLE_SOURCES, existingNames);
}

// ── 2. Sample review points (prefill for "Add a point") ───────────────────────

export interface SamplePoint {
  title: string;
  statement: string;
  /** Raw form values keyed by attribute (see MANUAL_FIELDS); lists are comma-separated. */
  fields: Record<string, string>;
}

export const CODECELL_SAMPLE_POINTS: Readonly<Record<PointCategory, SamplePoint>> = {
  decision: {
    title: "Sample: DevForge runs for 24 hours",
    statement: "DevForge 2026 runs as a 24-hour hackathon instead of 36 hours, because the lab can only be booked for one night.",
    fields: { decidedAt: "November 2026", decidedByLabel: "CodeCell core team", rationale: "The lab is only booked for one night", alternativesConsidered: "36-hour hackathon, Two-day event" },
  },
  owner: {
    title: "Sample: Priya owns the DevForge sponsorship",
    statement: "Priya Raman looks after the sponsor relationship with DevForge Labs and handles every invoice they send.",
    fields: { responsibility: "Sponsor relationship and invoices with DevForge Labs", ownerLabel: "Priya Raman", since: "August 2026" },
  },
  open_task: {
    title: "Sample: Finish the judging rubric",
    statement: "Arjun Mehta still has to finish the hackathon judging rubric before the mentors are briefed.",
    fields: { assigneeLabel: "Arjun Mehta", dueDate: "2026-11-25", progressNote: "Draft criteria agreed; scoring weights pending" },
  },
  blocker: {
    title: "Sample: Prize budget waiting for approval",
    statement: "The prize budget cannot be released until the faculty coordinator signs the expense approval.",
    fields: { blockingWhat: "Releasing the prize budget", unblockCondition: "Faculty coordinator signs the expense approval" },
  },
  risk: {
    title: "Sample: Lab booking could lapse",
    statement: "The lab booking may be cancelled if the attendance list does not reach the department office by Friday.",
    fields: { likelihood: "medium", impact: "high", mitigation: "Send the attendance list to the department office on Thursday" },
  },
  dependency: {
    title: "Sample: Guest Wi-Fi from the IT cell",
    statement: "Hackathon Wi-Fi depends on the college IT cell setting up the guest network before the event.",
    fields: { dependsOnLabel: "College IT cell", dependencyType: "organisation" },
  },
  recurring_problem: {
    title: "Sample: Lab 2 projector drops out",
    statement: "The projector in Lab 2 disconnects whenever a laptop is plugged in.",
    fields: { frequency: "Every session", knownWorkaround: "Connect the laptop before switching the projector on", firstSeenAt: "September 2026" },
  },
  contact: {
    title: "Sample: DevForge community manager",
    statement: "Ms. Farah Khan at DevForge Labs approves the sponsorship and is the first person to contact about it.",
    fields: { nameLabel: "Farah Khan", organisation: "DevForge Labs", roleDescription: "Community manager, approves the sponsorship", preferredChannel: "email" },
  },
  next_action: {
    title: "Sample: Book the handover call",
    statement: "Neha Kulkarni books a handover call with Kabir Shah before the hackathon.",
    fields: { actorLabel: "Neha Kulkarni", byWhen: "Before the hackathon" },
  },
  account_access: {
    title: "Sample: GitHub organisation owners",
    statement: "Kabir Shah and Priya Raman own the CodeCell GitHub organisation; new maintainers are added by an existing owner.",
    fields: { system: "CodeCell GitHub organisation", holderLabel: "Kabir Shah and Priya Raman", accessLocation: "Club shared password manager (recovery codes)", recoveryNote: "Ask an existing owner to add you; never share accounts" },
  },
};
