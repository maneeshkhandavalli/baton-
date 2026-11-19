/**
 * Contextual help copy (R3 Task 06). Pure and React-free (components/shared/__tests__/contextual-help.test.ts).
 *
 * Each topic explains one term the interface shows, in plain language, and says only what the system actually
 * does: the wording follows the rule that produces the label (SQL, lib/contracts/verification.ts, config/status.ts).
 * Keep it short: a title, one or two sentences, and at most one "what to do" line.
 */

export type HelpTopicId =
  | "possibly_outdated"
  | "evidence_sourced"
  | "evidence_inferred"
  | "evidence_conflicting"
  | "evidence_missing"
  | "quote_check"
  | "ai_judgement"
  | "source_coverage"
  | "change_reviews"
  | "readiness"
  // Round 4 (Worker 02): the application journey's key terms
  | "source_connections"
  | "consent"
  | "processing_status"
  | "evidence"
  | "review_decisions"
  | "publishing"
  | "invitations"
  | "living_handover";

export interface HelpTopic {
  title: string;
  body: string;
  /** Optional next step for the reader. */
  action?: string;
}

/** Days between a point's latest supporting quote and the end of the record before it is flagged (lifecycle.sql). */
export const OUTDATED_AFTER_DAYS = 30;

export const HELP_TOPICS: Readonly<Record<HelpTopicId, HelpTopic>> = Object.freeze({
  possibly_outdated: {
    title: "Possibly outdated",
    body: `The newest quote backing this point is more than ${OUTDATED_AFTER_DAYS} days older than the latest message in the record. It may still be true, but the team may have moved on since.`,
    action: "Check the quote's date before relying on it. Reviewers can edit or reject the point if things have changed.",
  },
  evidence_sourced: {
    title: "Sourced",
    body: "A quote was found in the source, and the AI judged that it supports this point. That is not a confirmation: a person still decides.",
  },
  evidence_inferred: {
    title: "Inferred",
    body: "Baton derived this from the sources, but no message states it outright.",
    action: "Confirm it only if you know it is true.",
  },
  evidence_conflicting: {
    title: "Conflicting",
    body: "Sources disagree about this point.",
    action: "Decide what is true now and note why before approving.",
  },
  evidence_missing: {
    title: "Missing",
    body: "Knowledge the handover needs that no source covers yet.",
    action: "Ask the outgoing member in the Gap Interview.",
  },
  quote_check: {
    title: "Quote check",
    body: "An automatic, word-for-word check that the quoted text exists in the cited message. It says nothing about what the text means.",
  },
  ai_judgement: {
    title: "AI judgement",
    body: "A separate AI check of whether the quote backs the point. Models can be wrong, so this is never proof and never counts as a review decision.",
  },
  source_coverage: {
    title: "Source coverage",
    body: "How much of each source Baton read, and how many messages looked relevant. Messages that look relevant but no point uses are listed so nothing is silently dropped.",
  },
  change_reviews: {
    title: "Source changes",
    body: "When a newer version of a source arrives, Baton compares it with the previous one. Every change it finds waits for a reviewer's decision; nothing in the handover changes automatically.",
    action: "Publishing waits until every change is decided.",
  },
  readiness: {
    title: "Readiness",
    body: "What still stands between this handover and publishing: points to decide, required gaps to answer, conflicts, and source updates to check.",
  },
  source_connections: {
    title: "Sources",
    body: "Sources are where the team's knowledge lives: uploaded chat exports and documents, or channels connected from Slack, Discord, Telegram or GitHub. Each source has its own consent and access level.",
    action: "Upload files while setting up; connect channels later in Settings, once the handover exists.",
  },
  consent: {
    title: "Consent",
    body: "Before Baton reads a source, you confirm how it may be used. Consent is recorded per source, with the exact wording you agreed to. Nothing is uploaded or read without it.",
  },
  processing_status: {
    title: "Processing",
    body: "Baton reads each source, drafts points with the quotes they came from, checks those quotes, and looks for gaps. Each stage shows Waiting, In progress, Done, Partly done or Failed.",
    action: "You can leave the page; the review opens when processing finishes.",
  },
  evidence: {
    title: "Evidence",
    body: "The messages a point was drawn from, quoted word for word from the masked source. Quotes and automatic checks help you decide; they never decide for you.",
  },
  review_decisions: {
    title: "Review decisions",
    body: "Approve a point the evidence supports, edit it if it's nearly right (saved as a new revision), or reject it if it's wrong. Rejected points are left out of the handover.",
    action: "Nothing is shared until the creator publishes.",
  },
  publishing: {
    title: "Publishing",
    body: "Publishing makes the approved points readable by the handover's members, at each person's access level. It unlocks only when nothing on the readiness list is left, including an invited incoming person. Only the creator publishes.",
  },
  invitations: {
    title: "Invitations",
    body: "An invitation is a private link for one email address. The person signs in with that address and accepts it to join with the role you chose. Links expire, and you can turn one off in Settings.",
    action: "Publishing needs at least one incoming person invited.",
  },
  living_handover: {
    title: "Source versions",
    body: "When a chat continues, upload the newer export as a new version of the same source. Baton processes only the new version and lists what changed; nothing in the handover changes until a reviewer decides.",
    action: "Publishing waits until every new version is processed and every change is decided.",
  },
});

export function helpTopic(id: HelpTopicId): HelpTopic {
  return HELP_TOPICS[id];
}
