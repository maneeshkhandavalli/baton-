/**
 * The ONE copy deck every concept renders, taken from the live landing page (app/(marketing)/page.tsx,
 * components/marketing/for-the-nerds.tsx) and the fictional CodeCell demo. Only the visual direction changes
 * between concepts. Nothing here describes a capability Baton does not have.
 */

export const nav = {
  links: [
    { href: "#how", label: "How it works" },
    { href: "#evidence", label: "Evidence" },
    { href: "#privacy", label: "Privacy" },
    { href: "#nerds", label: "For the nerds" },
  ],
  primary: { href: "/handover/new", label: "Start a handover" },
  secondary: { href: "/demo", label: "Try the demo" },
} as const;

export const hero = {
  headlineA: "Hand over a project",
  headlineB: "without losing what matters.",
  sub: "Baton turns WhatsApp exports and documents into a handover where every point links to the message it came from.",
  demoNote: "The demo is a fictional college coding club. No sign-in needed.",
} as const;

export const intro = {
  statement: "When someone leaves a club role or project team, what they know usually leaves with them.",
  body: "Baton reads the record your team already has and pulls out what the next person needs.",
  extracts: ["Decisions", "Owners", "Open tasks", "Deadlines", "Blockers", "Risks", "Contacts", "Account access"],
} as const;

/** One real point from the CodeCell demo, exactly as the review screen shows it. */
export const samplePoint = {
  handover: "CodeCell · Technical lead handover",
  state: "In review",
  category: "Account & access",
  title: "GitHub organisation owners",
  summary: "Priya and Kabir own codecell-org. Credentials live in the club vault.",
  quoteBefore: "github org owners are me and kabir. creds in the bitwarden core vault, master password is ",
  quoteMask: "[PASSWORD]",
  author: "Priya Raman",
  sentAt: "20 May 2026, 15:50",
  source: "Core Team (WhatsApp)",
  conflict: { title: "Workshop fee for non-members", a: "Non-members pay 100 for workshops…", b: "workshops are free for EVERYONE…" },
  gap: "Who holds the club bank account?",
} as const;

/** Lines from the synthetic CodeCell chat (lib/prototype/sample-data/codecell.ts). */
export const chat = [
  { t: "13/11/2026, 18:05", who: "Kabir Shah", text: "Neha is taking over as technical lead after DevForge, so let's keep the handover notes in this group." },
  { t: "13/11/2026, 18:07", who: "Priya Raman", text: "We decided to run DevForge 2026 as a 24-hour hackathon instead of 36 hours because the lab is only booked for one night." },
  { t: "13/11/2026, 18:11", who: "Arjun Mehta", text: "Priya is responsible for the sponsor relationship with DevForge Labs and for every invoice they send." },
  { t: "13/11/2026, 18:13", who: "Kabir Shah", text: "Arjun will finish the hackathon judging rubric by 25 November 2026." },
  { t: "14/11/2026, 09:20", who: "Arjun Mehta", text: "The prize budget is blocked until the faculty coordinator signs the expense approval." },
  { t: "14/11/2026, 09:25", who: "Kabir Shah", text: "There is a risk that we lose the lab booking if the attendance list is not sent to the department office by Friday." },
  { t: "14/11/2026, 09:31", who: "Priya Raman", text: "For invoices you can reach the DevForge office on 99999 00003 or sponsors@example.org" },
  { t: "14/11/2026, 09:38", who: "Arjun Mehta", text: "Who is going to collect the participation certificates from the printer?" },
] as const;

/** The same message after masking, as Baton stores it. */
export const masked = {
  raw: "For invoices you can reach the DevForge office on 99999 00003 or sponsors@example.org",
  parts: [
    { text: "For invoices you can reach the DevForge office on " },
    { mask: "[PHONE_1]", hidden: "99999 00003" },
    { text: " or " },
    { mask: "[EMAIL_1]", hidden: "sponsors@example.org" },
  ],
} as const;

export const steps = [
  {
    verb: "Bring",
    title: "Bring the real record",
    body: "Export the team's WhatsApp groups and add handbooks, MoUs and notes. Choose the dates, conversations and who may see each source.",
    detail: "WhatsApp .txt or .zip, PDF, Word, Markdown, text",
  },
  {
    verb: "Draft",
    title: "Baton drafts, with receipts",
    body: "Personal details are masked first. AI drafts the handover, and every quote it cites is matched against the original and checked separately.",
  },
  {
    verb: "Review",
    title: "People review every claim",
    body: "The outgoing member and reviewers approve, edit or reject each point. Whatever no source covers goes to a short Gap Interview.",
  },
  {
    verb: "Hand over",
    title: "Hand over with confidence",
    body: "The incoming person gets a clear handover and a first-week checklist, and acknowledges that they have read it.",
  },
] as const;

export const evidence = {
  headline: "Every point shows how sure you can be.",
  body: "Baton never presents a guess as a fact. Each point carries one of four labels, worked out from the evidence.",
  statuses: [
    { key: "sourced", label: "Sourced", body: "A quote that exists word for word in the source, checked separately to make sure it backs the claim." },
    { key: "inferred", label: "Inferred", body: "A reasonable reading with no quote that states it outright. A reviewer must confirm it first." },
    { key: "conflicting", label: "Conflicting", body: "Sources disagree. Both sides stay visible, newest first, until a person records what's true now." },
    { key: "missing", label: "Missing", body: "Something a handover should cover that nobody wrote down. It becomes a Gap Interview question." },
  ],
  gates: "Nothing is published while a point waits for review, an inferred point is unconfirmed, a conflict is unresolved, or a required gap question is unanswered.",
} as const;

export const privacy = {
  headline: "Built for group chats full of phone numbers.",
  body: "Sharing a team's chats for a handover shouldn't mean sharing everyone's details. You confirm the group was told, and anyone can ask to be left out.",
  points: [
    { title: "Masked first", body: "Phone numbers, emails, UPI handles, bank details, IDs and passwords are masked before anything is stored or sent to AI." },
    { title: "Raw files deleted", body: "Uploads are deleted as soon as processing succeeds. Only masked, permitted evidence is kept." },
    { title: "Access by source", body: "Mark a chat as leads-only or reviewer-only, and every point drawn from it inherits that restriction." },
  ],
} as const;

export const nerds = {
  headline: "How Baton keeps AI honest.",
  body: "The model drafts; it never decides. Deterministic checks, database rules and people sit between every AI output and what the incoming person reads.",
  flow: [
    { step: "Parse", where: "server", body: "Exports and documents become messages with authors, times and stable IDs." },
    { step: "Mask", where: "server", body: "Personal details are replaced before storage or AI." },
    { step: "Extract", where: "Gemini", body: "Structured JSON against a schema, validated with Zod." },
    { step: "Quote check", where: "deterministic", body: "Each quote must exist in the cited message." },
    { step: "Support check", where: "second model", body: "A separate call judges whether the quote backs the claim." },
    { step: "Human review", where: "people", body: "Approve, edit or reject, settle conflicts, then publish." },
  ],
  details: [
    { title: "Postgres does the enforcing", body: "Row-level security for every read. Every write is a checked database function; browser roles have no write grants." },
    { title: "Roles and clearance", body: "Outgoing, incoming, lead and reviewer roles. A point inherits the strictest access level of the sources behind it." },
    { title: "Chats are data, never instructions", body: "Messages that read like instructions to the model can't raise a point's status. A person decides." },
    { title: "Evidence you can check", body: "Quotes must match on whole characters and be at least 12 characters and 3 words long." },
  ],
  stack: ["Next.js 16", "Supabase Postgres, Auth, Storage", "Vercel", "Gemini", "Zod", "TypeScript"],
} as const;

export const closing = {
  headline: "The next person shouldn't have to start from scratch.",
  body: "See it working first: the CodeCell demo shows the review workspace and the handover the incoming lead receives.",
} as const;

export const footer = {
  tagline: "Source-backed knowledge handovers",
  links: [
    { href: "/demo", label: "Demo" },
    { href: "/login", label: "Sign in" },
    { href: "#privacy", label: "Privacy" },
  ],
} as const;

/** Real photographs (Unsplash licence) used by the concepts, by photo id. */
export const photo = (id: string, w: number, extra = "") =>
  `https://images.unsplash.com/photo-${id}?w=${w}&q=72&auto=format&fit=crop${extra}`;
export const PHOTOS = {
  ridges: "1500534314209-a25ddb2bd429",
  peakInFog: "1505765050516-f72dcac9c60e",
  fogForest: "1418065460487-3e41a6c84dc5",
  pen: "1455390582262-044cdead277a",
  teamTable: "1519389950473-47ba0277781c",
} as const;
