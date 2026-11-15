/**
 * DEMO SCENARIO: the cast of the CodeCell technical-lead handover (Priya Raman → Neha Kulkarni).
 *
 * Everyone here is invented. Email addresses use example.org and phone numbers use the synthetic
 * `99999 0000N` pattern, so Baton's masking can be seen working on them. See
 * docs/design/collab/demo/scenario.md in the lead worktree for the full story.
 * Pure data: no React, no I/O, safe in client and server code.
 */

import type { AccessLevel, MemberRole } from "@/lib/contracts/enums";

export interface DemoPerson {
  /** Stable key used throughout lib/demo. */
  key: DemoPersonKey;
  displayName: string;
  /** What they do in the club (shown in the demo's cast list). */
  clubRole: string;
  email: string;
  /** Synthetic number in the `99999 0000N` pattern; only ever appears masked in sources. */
  phone: string;
  /** Membership of the handover, or null for people who only appear in the chats. */
  member: { role: MemberRole; clearance: AccessLevel } | null;
}

export type DemoPersonKey = "priya" | "neha" | "kabir" | "arjun" | "ananya" | "rohan" | "ishaan";

export const DEMO_CAST: Readonly<Record<DemoPersonKey, DemoPerson>> = {
  priya: {
    key: "priya",
    displayName: "Priya Raman",
    clubRole: "Technical lead 2025–26, final year. Leaves on 30 November 2026 for an internship.",
    email: "priya.raman@example.org",
    phone: "99999 00001",
    member: { role: "outgoing", clearance: "reviewer_only" },
  },
  neha: {
    key: "neha",
    displayName: "Neha Kulkarni",
    clubRole: "Incoming technical lead from 1 December 2026, third year.",
    email: "neha.kulkarni@example.org",
    phone: "99999 00002",
    member: { role: "incoming", clearance: "everyone" },
  },
  kabir: {
    key: "kabir",
    displayName: "Kabir Shah",
    clubRole: "Club president. Reviews the handover.",
    email: "kabir.shah@example.org",
    phone: "99999 00003",
    member: { role: "reviewer", clearance: "reviewer_only" },
  },
  arjun: {
    key: "arjun",
    displayName: "Arjun Mehta",
    clubRole: "Events and sponsorship lead. Runs DevForge.",
    email: "arjun.mehta@example.org",
    phone: "99999 00004",
    member: { role: "lead", clearance: "leads_only" },
  },
  ananya: {
    key: "ananya",
    displayName: "Ananya Iyer",
    clubRole: "Web and design lead. Maintains the website. Answers a Gap Interview question.",
    email: "ananya.iyer@example.org",
    phone: "99999 00005",
    member: null,
  },
  rohan: {
    key: "rohan",
    displayName: "Rohan Pillai",
    clubRole: "Treasurer. Handles venue forms and reimbursements.",
    email: "rohan.pillai@example.org",
    phone: "99999 00006",
    member: null,
  },
  ishaan: {
    key: "ishaan",
    displayName: "Ishaan Rao",
    clubRole: "Second-year volunteer on the design team.",
    email: "ishaan.rao@example.org",
    phone: "99999 00011",
    member: null,
  },
};

/**
 * A core-team member who asked to be left out before the first parse. They appear in the raw export
 * only as an unsaved number (they are never named anywhere), and Baton drops their messages.
 */
export const OPTED_OUT_SENDER = "+91 99999 00007";

/** People and organisations who are mentioned in the sources but are not chat participants. */
export const DEMO_MENTIONED = {
  menon: { label: "Dr. Menon", note: "CSE department, CodeCell's faculty coordinator" },
  desai: { label: "Mr. Desai", note: "Dean's office, approves venues and events", phone: "99999 00008" },
  farah: { label: "Farah Khan", note: "Partnerships manager at Orbitstack (fictional), DevForge's title sponsor", email: "farah.khan@example.org", phone: "99999 00010" },
  orbitstack: { label: "Orbitstack", note: "Fictional company, DevForge 2027's title sponsor" },
} as const;

/** The club's own invented identifiers. */
export const DEMO_CLUB = {
  name: "CodeCell",
  college: "an engineering college in Pune (unnamed)",
  website: "codecell.example.org",
  githubOrg: "codecell-org",
  hackathon: "DevForge 2027",
  hackathonDates: "Saturday 30 and Sunday 31 January 2027",
  handoverEffective: "2026-12-01",
} as const;
