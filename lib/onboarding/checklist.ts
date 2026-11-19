/**
 * Round 4 (Worker 02): the Getting Started checklist, derived ONLY from real application state that the existing
 * BatonQueries return (never from clicking through a tour). Pure (components/shared/__tests__/onboarding-checklist.test.ts).
 *
 * Rule: an item is "done" only when the data proves it. Missing or failed reads never count as done; they leave
 * the item to do. Each item says where it stands in one plain sentence and, when the viewer can act on it, links
 * to the real page that does it. The first item the viewer can act on is the one "next" action.
 *
 * Creator items follow the order the product enforces: publishing needs every point decided, nothing outstanding
 * (conflicts, required gaps, privacy checks, source updates, change decisions) AND an incoming person invited
 * (readiness blocker no_incoming_recipient), so Invite comes before Publish.
 */

import type { AccessTokenSummary, HandoverSummary, MemberSummary, ProcessingStatus, PublishedHandover, ReadinessBlocker, ReadinessReport, SourceSummary } from "../contracts/dto";
import { isCurrentSourceVersion } from "../contracts/source-versions";
import type { GuideRole } from "./state";

export type ChecklistStatus = "done" | "in_progress" | "attention" | "todo" | "waiting" | "locked";

export interface ChecklistItem {
  id: string;
  label: string;
  /** Where this stands now, in one plain sentence. */
  detail: string;
  status: ChecklistStatus;
  /** The real page that does it (only when the viewer can act now). */
  href?: string;
  cta?: string;
}

export interface Checklist {
  role: GuideRole;
  items: ChecklistItem[];
  done: number;
  total: number;
  complete: boolean;
  /** The one thing to do next: the first item the viewer can act on (todo or attention), else null. */
  next: ChecklistItem | null;
}

export interface ChecklistLinks {
  newHandover: string;
  draft: (id: string) => string;
  processing: (id: string) => string;
  review: (id: string) => string;
  gaps: (id: string) => string;
  changes: (id: string) => string;
  settings: (id: string) => string;
  published: (id: string) => string;
}

export interface CreatorChecklistInput {
  /** The handover the guidance is about (resolveGuideRoles focus), or null when the user has none. */
  handover: HandoverSummary | null;
  sources?: SourceSummary[] | null;
  processing?: ProcessingStatus | null;
  readiness?: ReadinessReport | null;
  members?: MemberSummary[] | null;
  /** member_invite tokens (creator only). */
  invites?: AccessTokenSummary[] | null;
}

export interface IncomingChecklistInput {
  handover: HandoverSummary | null;
  /** getPublishedHandover for the current publication, or null when not published or not loaded. */
  published?: PublishedHandover | null;
  /** onboarding state: the first time this user opened a published handover. */
  publishedOpenedAt?: string | null;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const count = (r: ReadinessReport | null | undefined, kind: ReadinessBlocker) => r?.blockers.find((b) => b.kind === kind)?.count ?? 0;
const RECEIVING = new Set(["incoming", "lead"]);

function finish(role: GuideRole, items: ChecklistItem[]): Checklist {
  const done = items.filter((i) => i.status === "done").length;
  const next = items.find((i) => (i.status === "todo" || i.status === "attention") && !!i.href) ?? null;
  return { role, items, done, total: items.length, complete: done === items.length, next };
}

export function creatorChecklist(input: CreatorChecklistInput, links: ChecklistLinks): Checklist {
  const h = input.handover;
  const items: ChecklistItem[] = [];

  // 1. Create a handover
  items.push(
    h
      ? { id: "create", label: "Create a handover", detail: `“${h.title}” is saved.`, status: "done" }
      : { id: "create", label: "Create a handover", detail: "Name what is being handed over and who is involved.", status: "todo", href: links.newHandover, cta: "Start a handover" },
  );

  if (!h) {
    const later = (id: string, label: string, detail: string): ChecklistItem => ({ id, label, detail, status: "locked" });
    items.push(
      later("sources", "Add a source", "Chat exports, documents or a connected channel."),
      later("process", "Give consent and process", "Baton reads only what you consent to."),
      later("review", "Review the extracted points", "Approve, edit or reject each point using its evidence."),
      later("resolve", "Resolve what's outstanding", "Conflicts, required gaps and source changes."),
      later("invite", "Invite the incoming person", "Publishing needs someone to hand over to."),
      later("publish", "Publish the handover", "Members can read it once it's published."),
    );
    return finish("creator", items);
  }

  const id = h.id;
  const creator = h.viewerIsCreator;
  const processed = h.state === "in_review" || h.state === "approved" || h.state === "acknowledged";
  const published = !!h.currentPublicationId || h.state === "approved" || h.state === "acknowledged";
  const live = (input.sources ?? []).filter((s) => s.state !== "removed" && isCurrentSourceVersion(s));
  const read = live.some((s) => s.state === "parsed" || s.state === "parsing");
  const setupHref = read ? links.processing(id) : links.draft(id);
  const run = input.processing?.run ?? null;
  const r = input.readiness ?? null;

  // 2. Add a source
  const added = live.filter((s) => s.state === "uploaded" || s.state === "parsing" || s.state === "parsed");
  if (processed || added.length > 0) {
    const n = added.length || live.length;
    items.push({ id: "sources", label: "Add a source", detail: n ? `${plural(n, "source")} added.` : "Sources were added and read.", status: "done" });
  } else if (live.some((s) => s.state === "pending_upload")) {
    items.push({ id: "sources", label: "Add a source", detail: "An upload hasn't finished yet.", status: "in_progress", href: setupHref, cta: "Finish uploading" });
  } else if (live.length > 0 && live.every((s) => s.state === "failed")) {
    items.push({ id: "sources", label: "Add a source", detail: "No source could be read. Add or replace one.", status: "attention", href: setupHref, cta: "Fix sources" });
  } else {
    items.push({ id: "sources", label: "Add a source", detail: "Upload chat exports or documents. Channels can be connected later in Settings.", status: "todo", href: setupHref, cta: "Add sources" });
  }
  const hasSources = items[1].status === "done";

  // 3. Give consent and process
  if (processed) {
    items.push({ id: "process", label: "Give consent and process", detail: "Processing finished.", status: "done" });
  } else if (h.state === "processing" || run?.status === "queued" || run?.status === "running") {
    items.push({ id: "process", label: "Give consent and process", detail: "Baton is reading your sources. You can leave the page.", status: "in_progress", href: links.processing(id), cta: "View progress" });
  } else if (run?.status === "failed") {
    items.push({ id: "process", label: "Give consent and process", detail: "Processing stopped before it finished.", status: "attention", href: links.processing(id), cta: "See what failed" });
  } else if (hasSources) {
    const consented = added.length > 0 && added.every((s) => !!s.consentRecordedAt);
    items.push({
      id: "process",
      label: "Give consent and process",
      detail: consented ? "Consent recorded. Choose what Baton reads, then start processing." : "Confirm consent for each source, then start processing.",
      status: "todo",
      href: setupHref,
      cta: "Continue setup",
    });
  } else {
    items.push({ id: "process", label: "Give consent and process", detail: "After a source is added.", status: "locked" });
  }

  // 4. Review the extracted points
  if (published) {
    items.push({ id: "review", label: "Review the extracted points", detail: "Reviewed and published.", status: "done" });
  } else if (!processed) {
    items.push({ id: "review", label: "Review the extracted points", detail: "Opens when processing finishes.", status: "locked" });
  } else if (!r) {
    items.push({ id: "review", label: "Review the extracted points", detail: "Approve, edit or reject each point using its evidence.", status: "todo", href: links.review(id), cta: "Open review" });
  } else {
    const pending = count(r, "pending_points");
    const inferred = count(r, "unconfirmed_inferred");
    const decided = r.counts.byReviewState.approved + r.counts.byReviewState.rejected;
    if (pending === 0 && inferred === 0 && decided > 0) {
      items.push({ id: "review", label: "Review the extracted points", detail: `All ${plural(decided, "point")} decided.`, status: "done" });
    } else {
      const left = [pending && `${plural(pending, "point")} to decide`, inferred && `${inferred} inferred to confirm`].filter(Boolean).join(", ");
      items.push({
        id: "review",
        label: "Review the extracted points",
        detail: left ? `${left}.` : "No points to decide yet.",
        status: decided > 0 ? "in_progress" : "todo",
        href: links.review(id),
        cta: decided > 0 ? "Continue review" : "Start review",
      });
    }
  }

  // 5. Resolve what's outstanding (conflicts, required gaps, privacy checks, source updates, change decisions)
  const conflicts = count(r, "unresolved_conflicts");
  const gaps = count(r, "open_required_gaps");
  const privacy = count(r, "privacy_review_required");
  const updates = count(r, "source_updates_pending");
  const changes = count(r, "change_reviews_open");
  const outstanding = conflicts + gaps + privacy + updates + changes;
  if (!processed) {
    items.push({ id: "resolve", label: "Resolve what's outstanding", detail: "Conflicts, required gaps and source changes appear after processing.", status: "locked" });
  } else if (r && outstanding > 0) {
    const parts = [
      conflicts && plural(conflicts, "conflict"),
      gaps && `${plural(gaps, "required gap")} unanswered`,
      privacy && `${plural(privacy, "privacy check")}`,
      updates && `${plural(updates, "source update")} to process`,
      changes && `${plural(changes, "source change")} to decide`,
    ].filter(Boolean);
    const href = changes ? links.changes(id) : updates ? links.processing(id) : conflicts || privacy ? links.review(id) : links.gaps(id);
    items.push({ id: "resolve", label: "Resolve what's outstanding", detail: `${parts.join(", ")}.`, status: "attention", href, cta: "Resolve" });
  } else if (r || published) {
    items.push({ id: "resolve", label: "Resolve what's outstanding", detail: "Nothing outstanding.", status: "done" });
  } else {
    items.push({ id: "resolve", label: "Resolve what's outstanding", detail: "Check conflicts, required gaps and source changes.", status: "todo", href: links.review(id), cta: "Open review" });
  }

  if (!creator) return finish("creator", items); // only the creator invites and publishes

  // 6. Invite the incoming person
  const joined = (input.members ?? []).filter((m) => !m.isViewer && RECEIVING.has(m.role));
  const pendingInvite = (input.invites ?? []).some((t) => t.purpose === "member_invite" && t.status === "active" && !!t.grantRole && RECEIVING.has(t.grantRole));
  // the database's own gate: no blocker means an incoming member or a pending incoming invitation exists
  const gateSatisfied = h.state === "in_review" && !!r && count(r, "no_incoming_recipient") === 0;
  if (joined.length > 0) {
    items.push({ id: "invite", label: "Invite the incoming person", detail: `${joined[0].displayName}${joined.length > 1 ? ` and ${joined.length - 1} more` : ""} joined.`, status: "done" });
  } else if (pendingInvite || gateSatisfied || published) {
    items.push({ id: "invite", label: "Invite the incoming person", detail: published ? "An incoming person has access." : "Invitation sent. It counts until it expires or is turned off.", status: "done" });
  } else {
    items.push({ id: "invite", label: "Invite the incoming person", detail: "Publishing needs someone to hand over to. Invite them by email.", status: "todo", href: `${links.settings(id)}#members`, cta: "Invite" });
  }

  // 7. Publish
  if (published) {
    items.push({ id: "publish", label: "Publish the handover", detail: "Published. Members can read it now.", status: "done", href: links.published(id), cta: "Open" });
  } else if (h.state === "in_review" && r?.canPublish) {
    items.push({ id: "publish", label: "Publish the handover", detail: "Everything is ready.", status: "todo", href: links.review(id), cta: "Publish" });
  } else {
    items.push({ id: "publish", label: "Publish the handover", detail: "Unlocks when everything above is done.", status: "locked" });
  }

  return finish("creator", items);
}

export function incomingChecklist(input: IncomingChecklistInput, links: ChecklistLinks): Checklist {
  const h = input.handover;
  const items: ChecklistItem[] = [];
  if (!h) {
    items.push({ id: "join", label: "Join your handover", detail: "Open the invitation link you were sent and accept it.", status: "waiting" });
    return finish("incoming", items);
  }
  const isPublished = !!h.currentPublicationId;
  const p = input.published ?? null;
  const acked = !!p?.viewerAcknowledgedAt;
  items.push({ id: "join", label: "Join your handover", detail: `You're a member of “${h.title}”.`, status: "done" });
  items.push(
    isPublished
      ? { id: "published", label: "The team publishes it", detail: p ? `Version ${p.version} is published.` : "It's published.", status: "done" }
      : { id: "published", label: "The team publishes it", detail: "The team is still reviewing it. It appears here once it's published.", status: "waiting" },
  );
  if (!isPublished) {
    items.push({ id: "read", label: "Read the handover", detail: "After it's published.", status: "locked" });
  } else if (input.publishedOpenedAt || acked) {
    items.push({ id: "read", label: "Read the handover", detail: "Opened. Come back to it any time.", status: "done", href: links.published(h.id), cta: "Open" });
  } else {
    items.push({ id: "read", label: "Read the handover", detail: "Start with the summary and your first 7 days.", status: "todo", href: links.published(h.id), cta: "Read it" });
  }
  // Only incoming members acknowledge (lead members read only): never show guidance for something they can't do.
  if (h.viewerRole === "incoming") {
    if (!isPublished) items.push({ id: "acknowledge", label: "Acknowledge it", detail: "After it's published.", status: "locked" });
    else if (acked) items.push({ id: "acknowledge", label: "Acknowledge it", detail: "Acknowledged. A new version will ask again.", status: "done" });
    else items.push({ id: "acknowledge", label: "Acknowledge it", detail: "Confirm you've read it, so the outgoing team knows you have it.", status: "todo", href: `${links.published(h.id)}#acknowledge`, cta: "Acknowledge" });
  }
  return finish("incoming", items);
}
