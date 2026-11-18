/**
 * The demo's bounded write operations (R3 Task 06, contract A1) over ONE visitor's demo store. They follow the same
 * rules and error codes as the real actions (and the dev mock), with the scenario clock instead of the real one, and
 * deterministic ids, so a session can be rebuilt exactly by replaying its log. Pure: no I/O, no network, no globals.
 *
 * Supported: review a point (approve / reject / edit), answer a gap question and accept the answer, decide a
 * change-review item (accept / reject / investigate), publish, acknowledge as the incoming member. Plus the internal
 * steps the canonical journey needs to build later steps (resolve a conflict, confirm an inferred point, exclude
 * evidence, a Gap Interview link, start a revision); visitors cannot call those directly.
 */

import type { AppError, Result } from "@/lib/contracts/api";
import {
  decideChangeReviewInput,
  decisionProblems,
  isUnresolvedChangeReview,
  type ChangeReviewItem,
  type DecideChangeReviewInput,
} from "@/lib/contracts/change-review";
import type { PointDetail, PublicationSummary } from "@/lib/contracts/dto";
import type { AccessLevel, SupportVerdict } from "@/lib/contracts/enums";
import { parsePointAttributes, type ReviewPointInput } from "@/lib/contracts/schemas";
import {
  activeMember,
  canSee,
  computeReadiness,
  currentRevision,
  gapQuestionAccessLevel,
  isReviewRole,
  pointAccessLevel,
  pointStatus,
  profileLabel,
  snapshotPoint,
  toPointDetail,
} from "@/lib/mocks/derive";
import { mockMaskText } from "@/lib/mocks/mask";
import type { MockLink, MockPoint } from "@/lib/mocks/types";

import { DEMO_HANDOVER_ID, DEMO_INFRA_V2_SOURCE_ID, demoProfileId, nextDemoId, type DemoStore } from "./seed";

export type Fail = { ok: false; error: AppError };
export const ok = <T>(data: T): Result<T> => ({ ok: true, data });
export const fail = (code: AppError["code"], message: string, extra: Partial<AppError> = {}): Fail => ({
  ok: false,
  error: { code, message, retryable: false, ...extra },
});
const notFound = () => fail("not_found", "We couldn't find that.");

/** The scenario time an action is stamped with (never the visitor's clock). */
export interface DemoClock {
  at: string;
}

const PRIYA = () => demoProfileId("priya");

function handover(store: DemoStore) {
  return store.handovers.find((h) => h.id === DEMO_HANDOVER_ID)!;
}

function touch(store: DemoStore, clock: DemoClock) {
  handover(store).updatedAt = clock.at;
}

function reviewerContext(store: DemoStore, pointId: string, profileId: string) {
  const p = store.points.find((x) => x.id === pointId && x.handoverId === DEMO_HANDOVER_ID);
  if (!p) return null;
  const member = activeMember(store, DEMO_HANDOVER_ID, profileId);
  if (!member || !isReviewRole(member.role) || !canSee(pointAccessLevel(p), member.clearance)) return null;
  return { p, member };
}

function history(store: DemoStore, p: MockPoint, clock: DemoClock, action: PointDetail["reviewHistory"][number]["action"], note: string | null, actor: string | null = profileLabel(store, PRIYA())) {
  p.reviewHistory.push({ action, actorLabel: actor, note, createdAt: clock.at });
}

/** §4.3: if an approved point's evidence status changes, it goes back to pending (auto_reopen). */
function withAutoReopen(store: DemoStore, p: MockPoint, clock: DemoClock, mutate: () => void) {
  const before = pointStatus(p);
  mutate();
  if (p.reviewState === "approved" && pointStatus(p) !== before) {
    p.reviewState = "pending";
    history(store, p, clock, "auto_reopen", `Evidence status changed from ${before} to ${pointStatus(p)}.`, null);
  }
}

// ── review ─────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Scripted re-verification of an edit: the canonical edits carry their verdicts (lib/demo/scenario/journey.ts). Any
 * other edit keeps the earlier verdicts against the new wording and says so: the demo cannot re-check with AI.
 */
export interface Reverify {
  verdicts: Record<number, SupportVerdict>;
  why: Record<number, string>;
}

export const NOT_RECHECKED = "Not re-checked in the demo: the real product checks every quote against the new wording.";

export function reviewPoint(
  store: DemoStore,
  a: Extract<ReviewPointInput, { action: "approve" | "reject" | "edit" | "confirm_inferred" | "resolve_conflict" | "exclude_evidence" }>,
  clock: DemoClock,
  options: { reverify?: Reverify } = {},
): Result<PointDetail> {
  const rc = reviewerContext(store, a.pointId, PRIYA());
  if (!rc) return notFound();
  const { p, member } = rc;
  const rev = currentRevision(p);
  const status = pointStatus(p);
  const me = PRIYA();

  switch (a.action) {
    case "approve": {
      if (a.expectedRevisionId !== rev.id) return fail("conflict", "This point changed since you opened it. Review the latest version.");
      if (p.reviewState === "approved") return fail("invalid_transition", "Already approved.");
      if (status === "inferred" && !p.inferredConfirmation && !a.confirmInferred) {
        return fail("validation_failed", "Confirm the inferred point before approving.", { fieldErrors: { confirmInferred: ["Required for inferred points"] } });
      }
      if (status === "conflicting" && !p.conflictResolution && !a.resolutionNote) {
        return fail("validation_failed", "Add a resolution note before approving.", { fieldErrors: { resolutionNote: ["Required for conflicting points"] } });
      }
      if (status === "missing" && !a.asKnownGap) {
        return fail("validation_failed", "Missing points can only be approved as a known gap.", { fieldErrors: { asKnownGap: ["Required for missing points"] } });
      }
      if (status === "inferred" && a.confirmInferred && !p.inferredConfirmation) p.inferredConfirmation = { by: me, at: clock.at };
      if (status === "conflicting" && a.resolutionNote && !p.conflictResolution) p.conflictResolution = { note: mockMaskText(a.resolutionNote), by: me, at: clock.at };
      p.approvedAsKnownGap = status === "missing";
      p.reviewState = "approved";
      history(store, p, clock, "approve", a.resolutionNote ? mockMaskText(a.resolutionNote) : status === "missing" ? "Approved as a known gap." : null);
      break;
    }
    case "reject":
      if (p.reviewState === "rejected") return fail("invalid_transition", "Already rejected.");
      p.reviewState = "rejected";
      history(store, p, clock, "reject", mockMaskText(a.reason));
      break;
    case "edit": {
      if (a.expectedRevisionId !== rev.id) return fail("conflict", "Someone else edited this point. Reload to see their changes.");
      const attrs = parsePointAttributes(p.category, a.attributes);
      if (!attrs.success) return fail("validation_failed", "Some details are invalid.", { fieldErrors: { attributes: [attrs.error.issues[0]?.message ?? "Invalid"] } });
      const id = nextDemoId(store);
      p.revisions.push({
        id,
        number: rev.number + 1,
        title: mockMaskText(a.title),
        statement: mockMaskText(a.statement),
        attributes: attrs.data.attributes,
        editReason: mockMaskText(a.editReason),
        authorLabel: profileLabel(store, me),
        createdAt: clock.at,
        redaction: null,
      });
      p.links.forEach((l, i) => {
        if (l.excluded || l.quoteCheck === "not_found" || l.supportVerdict === "irrelevant") return;
        const scripted = options.reverify?.verdicts[i];
        if (scripted) {
          l.supportVerdict = scripted;
          l.verdictRationale = options.reverify?.why[i] ?? l.verdictRationale;
        } else {
          l.verdictRationale = NOT_RECHECKED;
        }
        l.verifiedRevisionId = id;
      });
      p.reviewState = "pending";
      history(store, p, clock, "edit", mockMaskText(a.editReason));
      break;
    }
    case "confirm_inferred":
      if (status !== "inferred") return fail("invalid_transition", "Only inferred points can be confirmed.");
      p.inferredConfirmation = { by: me, at: clock.at };
      history(store, p, clock, "confirm_inferred", a.note ? mockMaskText(a.note) : null);
      break;
    case "resolve_conflict":
      if (status !== "conflicting") return fail("invalid_transition", "This point has no conflict to resolve.");
      p.conflictResolution = { note: mockMaskText(a.resolutionNote), by: me, at: clock.at };
      history(store, p, clock, "resolve_conflict", mockMaskText(a.resolutionNote));
      break;
    case "exclude_evidence": {
      const link = p.links.find((l) => l.pointEvidenceId === a.pointEvidenceId);
      if (!link) return notFound();
      if (link.excluded) return fail("invalid_transition", "Already excluded.");
      withAutoReopen(store, p, clock, () => {
        link.excluded = true;
        link.exclusionReason = mockMaskText(a.reason);
      });
      history(store, p, clock, "exclude_evidence", mockMaskText(a.reason));
      break;
    }
  }
  p.updatedAt = clock.at;
  touch(store, clock);
  return ok(toPointDetail(store, p, member.clearance));
}

// ── publish, revision, acknowledge ───────────────────────────────────────────────────────────────────────

export function publish(store: DemoStore, summary: string | undefined, clock: DemoClock): Result<PublicationSummary> {
  const h = handover(store);
  if (h.state !== "in_review") return fail("invalid_transition", "Only a handover in review can be published.");
  const member = activeMember(store, h.id, PRIYA())!;
  const readiness = computeReadiness(store, h.id, member.clearance);
  if (!readiness.canPublish) {
    return fail("precondition_failed", "Resolve the readiness blockers before publishing.", { details: { blockers: readiness.blockers.length } });
  }
  const points = store.points.filter((p) => p.handoverId === h.id && p.reviewState === "approved" && (pointStatus(p) !== "missing" || p.approvedAsKnownGap));
  const version = store.publications.reduce((n, p) => Math.max(n, p.version), 0) + 1;
  const id = nextDemoId(store);
  store.publications.push({
    id,
    handoverId: h.id,
    version,
    publishedAt: clock.at,
    publishedBy: PRIYA(),
    summary: summary?.trim() ? mockMaskText(summary.trim()) : null,
    points: points.map((p) => snapshotPoint(store, p, (pid) => profileLabel(store, pid))),
    acknowledgements: [],
  });
  h.currentPublicationId = id;
  h.state = "approved";
  touch(store, clock);
  return ok({ publicationId: id, handoverId: h.id, version, publishedAt: clock.at, handoverState: h.state });
}

export function startRevision(store: DemoStore, clock: DemoClock): Result<null> {
  const h = handover(store);
  if (h.state !== "approved" && h.state !== "acknowledged") return fail("invalid_transition", "Only a published handover can be revised.");
  h.state = "in_review";
  touch(store, clock);
  return ok(null);
}

export function acknowledge(store: DemoStore, publicationId: string, clock: DemoClock): Result<null> {
  const neha = demoProfileId("neha");
  const pub = store.publications.find((p) => p.id === publicationId);
  if (!pub) return notFound();
  const h = handover(store);
  if (h.currentPublicationId !== pub.id) return fail("conflict", "A newer version of this handover was published.");
  if (pub.acknowledgements.some((a) => a.profileId === neha)) return fail("invalid_transition", "Already acknowledged.");
  pub.acknowledgements.push({ profileId: neha, at: clock.at });
  const required = store.members.filter((m) => m.handoverId === h.id && m.ackRequired && !m.removedAt);
  if (h.state === "approved" && required.every((m) => pub.acknowledgements.some((a) => a.profileId === m.profileId))) h.state = "acknowledged";
  touch(store, clock);
  return ok(null);
}

// ── gaps ─────────────────────────────────────────────────────────────────────────────────────────────────

/** A Gap Interview link for the canonical journey (no real token: the demo never issues one). */
export function createGapLink(store: DemoStore, questionIds: string[], clock: DemoClock): Result<{ tokenId: string }> {
  const id = nextDemoId(store);
  store.tokens.push({
    id,
    token: `demo-gap-interview-link-${store.seq}`.padEnd(43, "x").slice(0, 43),
    purpose: "gap_interview",
    handoverId: DEMO_HANDOVER_ID,
    questionIds,
    maxAccessLevel: "everyone",
    grantRole: null,
    recipientEmail: null,
    sessionProfileId: null,
    redeemedAt: null,
    expiresAt: new Date(Date.parse(clock.at) + 7 * 86_400_000).toISOString(),
    revokedAt: null,
    maxUses: 20,
    useCount: 0,
    createdBy: PRIYA(),
    createdAt: clock.at,
  });
  return ok({ tokenId: id });
}

export function answerGap(store: DemoStore, input: { gapQuestionId: string; answerText: string; answererLabel?: string }, clock: DemoClock): Result<{ submitted: number }> {
  const q = store.gapQuestions.find((x) => x.id === input.gapQuestionId && x.handoverId === DEMO_HANDOVER_ID);
  if (!q || q.status === "waived") return notFound();
  q.answers.push({
    id: nextDemoId(store),
    answererLabel: mockMaskText(input.answererLabel?.trim() || "Ananya Iyer"),
    text: mockMaskText(input.answerText.trim()),
    status: "submitted",
    privacyHeld: false,
    createdAt: clock.at,
    answeredByProfileId: null,
    viaToken: null,
  });
  q.status = "answered";
  const link = store.tokens.find((t) => t.purpose === "gap_interview" && t.questionIds.includes(q.id) && !t.revokedAt);
  if (link) link.useCount = Math.min(link.maxUses, link.useCount + 1);
  touch(store, clock);
  return ok({ submitted: 1 });
}

export function acceptGapAnswer(store: DemoStore, answerId: string, clock: DemoClock): Result<null> {
  const q = store.gapQuestions.find((x) => x.answers.some((a) => a.id === answerId));
  if (!q) return notFound();
  const answer = q.answers.find((a) => a.id === answerId)!;
  if (answer.status !== "submitted") return fail("invalid_transition", "This answer was already reviewed.");
  answer.status = "accepted";
  const p = q.pointId ? store.points.find((x) => x.id === q.pointId) : undefined;
  if (p) {
    const link: MockLink = {
      pointEvidenceId: nextDemoId(store),
      evidenceId: nextDemoId(store),
      kind: "testimony",
      quote: answer.text,
      authorLabel: answer.answererLabel,
      sentAt: answer.createdAt,
      sourceId: null,
      location: null,
      quoteCheck: "exact",
      supportVerdict: "supports",
      verdictRationale: "Gap Interview answer accepted by a reviewer.",
      verifiedRevisionId: currentRevision(p).id,
      excluded: false,
      exclusionReason: null,
      accessLevel: gapQuestionAccessLevel(store, q),
    };
    withAutoReopen(store, p, clock, () => p.links.unshift(link));
    p.updatedAt = clock.at;
  }
  touch(store, clock);
  return ok(null);
}

// ── change reviews (Task 05E semantics, bounded) ─────────────────────────────────────────────────────────

/** Items appear once a version is published (they describe an update received after the first publication). */
export function changeReviewItems(store: DemoStore, clearance: AccessLevel): ChangeReviewItem[] {
  const first = store.publications.find((p) => p.version === 1);
  if (!first) return [];
  return store.changeReviews.flatMap(({ pointId, item }) => {
    const p = store.points.find((x) => x.id === pointId);
    if (!p || !canSee(pointAccessLevel(p), clearance)) return [];
    const rev = currentRevision(p);
    const baseRev = p.revisions[0];
    const old = p.links.find((l) => l.kind === "source_quote" && !l.excluded) ?? null;
    return [{
      ...item,
      basePublicationId: first.id,
      point: {
        id: p.id,
        category: p.category,
        reviewState: p.reviewState,
        evidenceStatus: pointStatus(p),
        currentRevisionId: rev.id,
        title: rev.title,
        statement: rev.statement,
        attributes: rev.attributes as Record<string, unknown>,
      },
      base: { revisionId: baseRev.id, revisionNumber: baseRev.number, title: baseRev.title, statement: baseRev.statement },
      oldEvidence: old
        ? { id: old.evidenceId, quote: old.quote, authorLabel: old.authorLabel, sentAt: old.sentAt, verdict: old.supportVerdict, rationale: old.verdictRationale, sourceTitle: store.sources.find((s) => s.id === old.sourceId)?.title ?? null }
        : null,
    }];
  });
}

const QUOTE_MIN_CHARS = 12;
const QUOTE_MIN_WORDS = 3;
const meetsQuoteMinimum = (q: string) => q.trim().length >= QUOTE_MIN_CHARS && q.trim().split(/\s+/).length >= QUOTE_MIN_WORDS;

export function decideChangeReview(
  store: DemoStore,
  raw: DecideChangeReviewInput,
  clock: DemoClock,
): Result<{ outcome: "decided" | "unchanged"; state: string; item: ChangeReviewItem | null }> {
  const parsed = decideChangeReviewInput.safeParse(raw);
  if (!parsed.success) return fail("validation_failed", "Some fields need attention.");
  const v = parsed.data;
  const member = activeMember(store, DEMO_HANDOVER_ID, PRIYA())!;
  if (v.handoverId !== DEMO_HANDOVER_ID) return notFound();
  const visible = changeReviewItems(store, member.clearance).find((i) => i.id === v.itemId);
  const entry = store.changeReviews.find((c) => c.id === v.itemId);
  if (!visible || !entry || !visible.point) return notFound();

  const target = v.decision === "investigate" ? "investigating" : v.decision === "accept" ? "accepted" : "rejected";
  const last = entry.item.decisions[entry.item.decisions.length - 1];
  if (!isUnresolvedChangeReview(entry.item.state) || entry.item.state !== v.expectedState) {
    if (entry.item.state === target && last?.decision === v.decision) return ok({ outcome: "unchanged", state: entry.item.state, item: visible });
    return fail("conflict", "This change was decided in the meantime. Reload to see the current state.");
  }
  if (visible.point.currentRevisionId !== v.expectedPointRevisionId) {
    return fail("conflict", "The point changed since you opened it. Reload to see the current state.");
  }
  const problems = decisionProblems(entry.item.kind, v);
  if (problems) {
    return fail("validation_failed", Object.values(problems)[0], { fieldErrors: Object.fromEntries(Object.entries(problems).map(([k, m]) => [k, [m]])) });
  }

  const p = store.points.find((x) => x.id === visible.point!.id)!;
  if (v.decision === "accept") {
    const body = entry.item.newMessage?.body ?? "";
    if (entry.item.kind === "evidence_moved") {
      const start = entry.item.newMessage?.quoteStart ?? 0;
      const end = entry.item.newMessage?.quoteEnd ?? body.length;
      p.links.push(newSourceLink(store, p, body.slice(start, end), "The quoted words, in their new place in the updated notes."));
    } else if (entry.item.kind === "possible_contradiction") {
      const c = v.correction!;
      const quote = body.slice(c.evidenceStart, c.evidenceEnd);
      if (c.evidenceEnd > body.length || !meetsQuoteMinimum(quote)) {
        const msg = "Choose at least 12 characters and 3 words from the new message as the supporting quotation.";
        return fail("validation_failed", msg, { fieldErrors: { correction: [msg] } });
      }
      const edited = reviewPoint(store, { action: "edit", pointId: p.id, expectedRevisionId: v.expectedPointRevisionId, title: c.title, statement: c.statement, attributes: c.attributes, editReason: v.note ?? "" }, clock);
      if (!edited.ok) return edited;
      const link = newSourceLink(store, p, quote, "Chosen by the reviewer from the updated notes.");
      link.verifiedRevisionId = currentRevision(p).id;
      p.links.push(link);
    }
    // evidence_missing / support_changed: a recorded re-attestation only; new_information is not part of the demo.
  }
  entry.item = {
    ...entry.item,
    state: target,
    decidedAt: target === "investigating" ? null : clock.at,
    decisions: [...entry.item.decisions, { decision: v.decision, fromState: entry.item.state, toState: target, note: v.note ? mockMaskText(v.note) : null, actorProfileId: PRIYA(), createdAt: clock.at }],
  };
  history(store, p, clock, "change_review", `${v.decision}: ${v.note ? mockMaskText(v.note) : ""}`.trim());
  touch(store, clock);
  const item = changeReviewItems(store, member.clearance).find((i) => i.id === v.itemId) ?? null;
  return ok({ outcome: "decided", state: target, item });
}

function newSourceLink(store: DemoStore, p: MockPoint, quote: string, why: string): MockLink {
  return {
    pointEvidenceId: nextDemoId(store),
    evidenceId: nextDemoId(store),
    kind: "source_quote",
    quote,
    authorLabel: null,
    sentAt: null,
    sourceId: DEMO_INFRA_V2_SOURCE_ID,
    location: null,
    quoteCheck: "exact",
    supportVerdict: "supports",
    verdictRationale: why,
    verifiedRevisionId: currentRevision(p).id,
    excluded: false,
    exclusionReason: null,
    accessLevel: "everyone",
  };
}
