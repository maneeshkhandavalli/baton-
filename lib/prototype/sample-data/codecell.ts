/**
 * PROTOTYPE SAMPLE DATA — the single home of Baton's CodeCell demo content (see lib/prototype/flags.ts).
 *
 * Entirely invented: a student coding club ("CodeCell") handing over its technical-lead role from
 * Priya Raman to Neha Kulkarni. The source files ARE the public demo's scenario sources
 * (lib/demo/scenario/sources.ts) and the sample points fit the same story. Phone numbers use the synthetic
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

import { DEMO_SOURCES } from "../../demo/scenario/sources";

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

// The sample files are the demo scenario's own sources (lib/demo/scenario), so "Use sample data" and the
// public /demo tell the same story. The leads-only chat is not offered as a sample.
const CORE_TEAM_CHAT = DEMO_SOURCES.core.raw;
const INFRA_NOTES = DEMO_SOURCES.infra.raw;

export const CODECELL_SAMPLE_SOURCES: readonly SampleSourceFile[] = [
  {
    id: "codecell-core-team-chat",
    fileName: SAMPLE_SOURCE_FILE_NAMES[0],
    kind: "whatsapp_export",
    mimeType: "text/plain",
    description: "WhatsApp export of the CodeCell core team group, July to November 2026 (invented)",
    content: CORE_TEAM_CHAT,
  },
  {
    id: "codecell-infra-notes",
    fileName: SAMPLE_SOURCE_FILE_NAMES[1],
    kind: "markdown",
    mimeType: "text/markdown",
    description: "Priya's infrastructure notes, last edited on 3 November 2026 (invented)",
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
    title: "Sample: Mixed judging panel for DevForge",
    statement: "DevForge 2027 is judged by a panel of three faculty members and two alumni, not by students or the sponsor.",
    fields: { decidedAt: "October 2026", decidedByLabel: "Priya Raman and Arjun Mehta", rationale: "Mixed panels gave fairer scores last year", alternativesConsidered: "Student judges only, Sponsor judges only" },
  },
  owner: {
    title: "Sample: Ananya runs the Discord server",
    statement: "Ananya Iyer is the only admin of the CodeCell Discord server; Priya Raman is a moderator.",
    fields: { responsibility: "Discord server administration", ownerLabel: "Ananya Iyer", since: "2025" },
  },
  open_task: {
    title: "Sample: Write down the judging portal deploy",
    statement: "Priya Raman writes the judging portal's deploy steps into the infrastructure notes before she leaves.",
    fields: { assigneeLabel: "Priya Raman", dueDate: "2026-11-28", progressNote: "Steps known; not yet in the infrastructure notes" },
  },
  blocker: {
    title: "Sample: Prize money waits for a signature",
    statement: "The DevForge prize money cannot be released until Dr. Menon signs the expense approval, because it is above ₹2,000.",
    fields: { blockingWhat: "Releasing the DevForge prize money", unblockCondition: "Dr. Menon signs the expense approval" },
  },
  risk: {
    title: "Sample: The orientation slot could be lost",
    statement: "The auditorium slot for January orientation is lost if the booking form does not reach the Dean's office before the winter break.",
    fields: { likelihood: "medium", impact: "high", mitigation: "Hand the booking form to Mr. Desai in person in the first week of December" },
  },
  dependency: {
    title: "Sample: Certificates depend on the print shop",
    statement: "DevForge participation certificates are printed by the campus print shop, which needs the final list a week before the event.",
    fields: { dependsOnLabel: "Campus print shop", dependencyType: "organisation" },
  },
  recurring_problem: {
    title: "Sample: Spam sign-ups before hackathons",
    statement: "The registration form gets spam sign-ups in the weeks before every hackathon.",
    fields: { frequency: "Before every hackathon", knownWorkaround: "Turn on the form's email confirmation", firstSeenAt: "January 2026" },
  },
  contact: {
    title: "Sample: College IT help desk",
    statement: "The college IT help desk sets up guest Wi-Fi for events and needs a week's notice.",
    fields: { nameLabel: "College IT help desk", organisation: "College IT", roleDescription: "Sets up guest Wi-Fi for events", preferredChannel: "email" },
  },
  next_action: {
    title: "Sample: Pair on the next portal deploy",
    statement: "Neha Kulkarni does the next judging portal deploy together with Priya Raman before she leaves on 30 November.",
    fields: { actorLabel: "Neha Kulkarni", byWhen: "Before 30 November 2026" },
  },
  account_access: {
    title: "Sample: Discord admin rights",
    statement: "Ananya Iyer holds the Discord server's admin role and makes Neha Kulkarni an admin on 1 December.",
    fields: { system: "CodeCell Discord server", holderLabel: "Ananya Iyer", accessLocation: "Discord server settings (admin role)", recoveryNote: "Ananya makes Neha an admin on 1 December" },
  },
};
