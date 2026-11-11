/**
 * Display labels for canonical enum values (§2: labels live in the UI, never in the database).
 * Evidence-status labels stay in config/status.ts.
 */

import type {
  AccessLevel,
  AccessTokenStatus,
  ExclusionKind,
  GapPriority,
  HandoverState,
  IdentityKind,
  MaskKind,
  MemberRole,
  PipelineStage,
  PointCategory,
  QuoteCheck,
  ReviewState,
  SourceKind,
  SourceState,
  SupportVerdict,
} from "@/lib/contracts/enums";
import type { ReadinessBlocker } from "@/lib/contracts/dto";

export const handoverStateMeta: Record<HandoverState, { label: string; className: string; dot: string }> = {
  draft: { label: "Draft", className: "bg-muted text-muted-foreground border-border", dot: "bg-status-missing" },
  processing: { label: "Processing", className: "bg-primary/8 text-primary border-primary/20", dot: "bg-primary" },
  in_review: { label: "In review", className: "bg-status-inferred-soft text-status-inferred-fg border-status-inferred/25", dot: "bg-status-inferred" },
  approved: { label: "Approved", className: "bg-status-sourced-soft text-status-sourced-fg border-status-sourced/20", dot: "bg-status-sourced" },
  acknowledged: { label: "Acknowledged", className: "bg-foreground text-background border-foreground", dot: "bg-background" },
};

export const reviewStateLabel: Record<ReviewState, string> = {
  pending: "Pending review",
  approved: "Approved",
  rejected: "Rejected",
};

export const accessLevelMeta: Record<AccessLevel, { label: string; short: string; description: string }> = {
  everyone: { label: "Everyone", short: "Everyone", description: "Every member, including the incoming person." },
  leads_only: { label: "Leads only", short: "Leads", description: "Leads and reviewers. Hidden from incoming members unless their clearance is raised." },
  reviewer_only: { label: "Reviewer only", short: "Reviewers", description: "Only the creator, outgoing member and reviewers." },
};

export const memberRoleLabel: Record<MemberRole, string> = {
  outgoing: "Outgoing",
  incoming: "Incoming",
  lead: "Lead",
  reviewer: "Reviewer",
};

export const categoryLabel: Record<PointCategory, string> = {
  decision: "Decision",
  owner: "Owner",
  open_task: "Open task",
  blocker: "Blocker",
  risk: "Risk",
  dependency: "Dependency",
  recurring_problem: "Recurring problem",
  contact: "Contact",
  next_action: "Next action",
  account_access: "Account & access",
};

/** The six handover sections the UI groups the ten categories into. */
export const HANDOVER_SECTIONS = [
  { id: "decisions", label: "Decisions", categories: ["decision"] },
  { id: "ownership", label: "Ownership", categories: ["owner"] },
  { id: "open_work", label: "Open work", categories: ["open_task", "next_action", "blocker"] },
  { id: "risks", label: "Risks & dependencies", categories: ["risk", "dependency", "recurring_problem"] },
  { id: "contacts", label: "Contacts", categories: ["contact"] },
  { id: "access", label: "Accounts & access", categories: ["account_access"] },
] as const satisfies ReadonlyArray<{ id: string; label: string; categories: readonly PointCategory[] }>;

export type HandoverSectionId = (typeof HANDOVER_SECTIONS)[number]["id"];

export function sectionFor(category: PointCategory) {
  return HANDOVER_SECTIONS.find((s) => (s.categories as readonly PointCategory[]).includes(category))!;
}

export const sourceKindLabel: Record<SourceKind, string> = {
  whatsapp_export: "WhatsApp chat",
  pdf: "PDF",
  docx: "Word document",
  markdown: "Markdown",
  text: "Text",
};

export const sourceStateLabel: Record<SourceState, string> = {
  pending_upload: "Waiting for upload",
  uploaded: "Uploaded",
  parsing: "Reading",
  parsed: "Processed",
  failed: "Failed",
  removed: "Removed",
};

export const stageLabel: Record<PipelineStage, { label: string; description: string }> = {
  parse: { label: "Reading sources", description: "Parsing, applying exclusions and masking personal details." },
  extract: { label: "Extracting knowledge", description: "Finding decisions, owners, tasks and risks." },
  verify_quotes: { label: "Checking quotes exist", description: "Every quote must appear word for word in its source." },
  verify_support: { label: "Checking quotes support claims", description: "A separate check that each quote backs its point." },
  analyze: { label: "Finding conflicts and gaps", description: "Merging duplicates, spotting disagreements and missing knowledge." },
  prepare_review: { label: "Preparing your review", description: "Ordering points and drafting Gap Interview questions." },
};

export const quoteCheckLabel: Record<QuoteCheck, string> = {
  pending: "Not checked yet",
  exact: "Exact match in source",
  normalized: "Match after normalising spacing and punctuation",
  not_found: "Not found in the cited message",
};

export const supportVerdictLabel: Record<SupportVerdict, string> = {
  unchecked: "Support not checked yet",
  supports: "Supports the claim",
  partial: "Partly supports the claim",
  contradicts: "Contradicts the claim",
  irrelevant: "Rejected by verification: not relevant",
};

export const maskKindLabel: Record<MaskKind, { label: string; token: string; example: string }> = {
  phone: { label: "Phone numbers", token: "[PHONE_1]", example: "+91 98xxxxxx10" },
  email: { label: "Email addresses", token: "[EMAIL_1]", example: "name@college.edu" },
  upi: { label: "UPI handles", token: "[UPI_1]", example: "club@okaxis" },
  bank_account: { label: "Bank accounts", token: "[BANK_1]", example: "a/c 1234…" },
  ifsc: { label: "IFSC codes", token: "[IFSC_1]", example: "SBIN0001234" },
  card: { label: "Card numbers", token: "[CARD_1]", example: "4111 …" },
  government_id: { label: "Aadhaar and PAN", token: "[ID_1]", example: "ABCDE1234F" },
  password: { label: "Passwords and OTPs", token: "[PASSWORD]", example: "pwd: …" },
  api_key: { label: "API keys", token: "[API_KEY]", example: "sk-…" },
  secret: { label: "Other secrets", token: "[SECRET]", example: "long random strings" },
};

export const gapPriorityLabel: Record<GapPriority, string> = {
  required: "Required",
  optional: "Optional",
};

export const blockerLabel: Record<ReadinessBlocker, (n: number) => string> = {
  processing_incomplete: () => "Processing isn't finished",
  pending_points: (n) => `${n} ${n === 1 ? "point needs" : "points need"} a review decision`,
  unconfirmed_inferred: (n) => `${n} inferred ${n === 1 ? "point needs" : "points need"} confirming`,
  unresolved_conflicts: (n) => `${n} ${n === 1 ? "conflict needs" : "conflicts need"} resolving`,
  open_required_gaps: (n) => `${n} required ${n === 1 ? "gap is" : "gaps are"} unanswered`,
  no_incoming_recipient: () => "No incoming member has been invited",
  no_approved_points: () => "No points have been approved yet",
  privacy_review_required: (n) => `${n} ${n === 1 ? "point needs" : "points need"} a privacy review`,
};

export const identityKindLabel: Record<IdentityKind, { label: string; description: string }> = {
  phone: { label: "Phone number", description: "Matched by phone number in every chat of this handover." },
  name: { label: "Saved name", description: "Matched by the contact name saved on the exporting phone. Names can be shared, so each other chat is confirmed by you." },
};

export const exclusionKindLabel: Record<ExclusionKind, string> = {
  participant: "Person left out",
  conversation: "Conversation left out",
  date_range: "Dates left out",
};

export const tokenStatusMeta: Record<AccessTokenStatus, { label: string; className: string }> = {
  active: { label: "Active", className: "bg-status-sourced-soft text-status-sourced-fg" },
  revoked: { label: "Revoked", className: "bg-muted text-muted-foreground" },
  expired: { label: "Expired", className: "bg-muted text-muted-foreground" },
  exhausted: { label: "Exhausted", className: "bg-muted text-muted-foreground" },
};

/**
 * The status line for a listed link, from the canonical derived status only (§11.6
 * `ACCESS_TOKEN_STATUSES`, precedence revoked → expired → exhausted). A token says nothing about
 * whether an invitation was accepted: people who accepted appear under members instead.
 */
export function tokenStatusDetail(
  t: { status: AccessTokenStatus; expiresAt: string; revokedAt: string | null; useCount: number; maxUses: number },
  formatDate: (iso: string | null) => string,
): string {
  switch (t.status) {
    case "active":
      return `expires ${formatDate(t.expiresAt)} · ${t.useCount} of ${t.maxUses} ${t.maxUses === 1 ? "use" : "uses"}`;
    case "revoked":
      return `revoked ${formatDate(t.revokedAt)}`;
    case "expired":
      return `expired ${formatDate(t.expiresAt)}`;
    case "exhausted":
      return `all ${t.maxUses} ${t.maxUses === 1 ? "use" : "uses"} taken`;
  }
}
