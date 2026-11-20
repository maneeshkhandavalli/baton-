/**
 * The demo engine (R3 Task 06, docs/history/round3/task06-contract.md §2, D1, A1): an isolated, per-visitor, database-free
 * demo workspace. Pure: no React, no I/O, no network, no environment, no global state. It runs in the browser (and in
 * server components for the first paint) and can never reach Supabase, the database, email or an AI provider
 * (lib/demo/__tests__/engine-boundaries.test.ts).
 *
 *   state = replay(seed(scenario), canonical actions before the session's step, the visitor's own log)
 *
 * The session is a small, serialisable value the UI keeps in sessionStorage (`baton.demo.v1`); nothing is stored on a
 * server, so there is nothing to clean up. Same session → same state; two sessions never share anything.
 */

import type { Result } from "@/lib/contracts/api";
import { decideChangeReviewInput } from "@/lib/contracts/change-review";
import type { CreatedInvitation } from "@/lib/contracts/dto";
import type { BatonQueries } from "@/lib/contracts/queries";
import {
  acknowledgePublicationInput,
  inviteMemberInput,
  publishHandoverInput,
  reviewGapAnswerInput,
  reviewPointInput,
  submitGapAnswersInput,
} from "@/lib/contracts/schemas";
import { runStages } from "@/lib/mocks/run-stages";
import { createStoreQueries } from "@/lib/mocks/store-queries";
import { z } from "zod";

import {
  DEMO_CANONICAL_ACTIONS,
  DEMO_GAP_QUESTIONS,
  DEMO_STEP_CLOCK,
  DEMO_STEPS,
  type DemoAction as ScenarioAction,
  type DemoPersonKey,
  type DemoStepId,
} from "../scenario/index";
import * as ops from "./reducer";
import { DEMO_HANDOVER_ID, demoPointId, demoProfileId, seedDemoStore, type DemoStore } from "./seed";

export { DEMO_HANDOVER_ID, demoPointId, demoProfileId } from "./seed";
export { NOT_RECHECKED } from "./reducer";

export const DEMO_ENGINE_VERSION = 1;
export const DEMO_SESSION_MAX_AGE_MS = 24 * 60 * 60 * 1000;
/** A visitor's log is bounded, so a stored session stays small. */
export const DEMO_LOG_MAX = 200;
/** sessionStorage key the UI uses (per tab, per browser). */
export const DEMO_STORAGE_KEY = "baton.demo.v1";

export type { DemoStepId } from "../scenario/index";

export interface DemoSession {
  id: string;
  version: typeof DEMO_ENGINE_VERSION;
  /** Real ISO time, used only for expiry. */
  startedAt: string;
  step: DemoStepId;
  /** Visitor actions since the step's canonical state. */
  log: DemoAction[];
}

// ── the visitor's actions (contract A1, union pinned by A7: the real input schemas only) ─────────────────

const demoActionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("reviewPoint"), input: reviewPointInput }),
  z.object({ type: z.literal("submitGapAnswers"), input: submitGapAnswersInput }),
  z.object({ type: z.literal("reviewGapAnswer"), input: reviewGapAnswerInput }),
  z.object({ type: z.literal("decideChangeReview"), input: decideChangeReviewInput }),
  z.object({ type: z.literal("publish"), input: publishHandoverInput }),
  z.object({ type: z.literal("acknowledge"), input: acknowledgePublicationInput }),
  z.object({ type: z.literal("inviteMember"), input: inviteMemberInput }),
]);

export type DemoAction = z.input<typeof demoActionSchema>;
export type DemoActionType = DemoAction["type"];
const DEMO_ACTION_TYPES = new Set<string>(["reviewPoint", "submitGapAnswers", "reviewGapAnswer", "decideChangeReview", "publish", "acknowledge", "inviteMember"]);
/** A7: the review actions a visitor may take; every other ReviewPointInput action is demo_read_only. */
const REVIEW_ACTIONS = new Set<string>(["approve", "reject", "edit", "confirm_inferred", "resolve_conflict"]);

/** Who the visitor reads the demo as. */
export type DemoViewer = Extract<DemoPersonKey, "priya" | "neha" | "kabir" | "arjun">;

export type DemoQueries = Pick<
  BatonQueries,
  | "listMyHandovers"
  | "getHandover"
  | "listMembers"
  | "listSources"
  | "listPoints"
  | "getPoint"
  | "getSourceMessageContext"
  | "listGapQuestions"
  | "getReadiness"
  | "getPublishedHandover"
  | "getProcessingStatus"
  | "getExtractionReport"
  | "getChangeReviews"
  | "listAccessTokens"
>;

const readOnly = () =>
  ops.fail("forbidden", "That isn't available in the demo. Start your own handover to try it.", { details: { reason: "demo_read_only" } });

// ── building a state ─────────────────────────────────────────────────────────────────────────────────────

const STEP_ORDER = DEMO_STEPS.map((s) => s.id);
const stepIndex = (step: DemoStepId) => STEP_ORDER.indexOf(step);
const minutes = (iso: string, n: number) => new Date(Date.parse(iso) + n * 60_000).toISOString();

const gapQuestionId = (store: DemoStore, n: number) => {
  const q = DEMO_GAP_QUESTIONS.find((x) => x.n === n);
  return store.gapQuestions.find((x) => x.pointId === (q ? demoPointId(q.point) : null))?.id ?? "";
};

/** One canonical journey action (lib/demo/scenario/journey.ts). Throws if the scenario and the engine disagree. */
function applyCanonical(store: DemoStore, a: ScenarioAction, clock: ops.DemoClock): void {
  const point = "point" in a ? store.points.find((p) => p.id === demoPointId(a.point)) : undefined;
  const rev = point ? point.revisions[point.revisions.length - 1].id : "";
  let r: Result<unknown>;
  switch (a.action) {
    case "approve":
      r = ops.reviewPoint(store, { action: "approve", pointId: point!.id, expectedRevisionId: rev, confirmInferred: a.confirmInferred, resolutionNote: a.resolutionNote, asKnownGap: a.asKnownGap }, clock);
      break;
    case "reject":
      r = ops.reviewPoint(store, { action: "reject", pointId: point!.id, reason: a.reason }, clock);
      break;
    case "edit":
      r = ops.reviewPoint(store, { action: "edit", pointId: point!.id, expectedRevisionId: rev, title: a.title, statement: a.statement, attributes: a.attributes, editReason: a.editReason }, clock, { reverify: a.reverify });
      break;
    case "confirm_inferred":
      r = ops.reviewPoint(store, { action: "confirm_inferred", pointId: point!.id, note: a.note }, clock);
      break;
    case "resolve_conflict":
      r = ops.reviewPoint(store, { action: "resolve_conflict", pointId: point!.id, resolutionNote: a.resolutionNote }, clock);
      break;
    case "exclude_evidence":
      r = ops.reviewPoint(store, { action: "exclude_evidence", pointId: point!.id, pointEvidenceId: point!.links[a.evidenceIndex].pointEvidenceId, reason: a.reason }, clock);
      break;
    case "publish":
      r = ops.publish(store, a.summary, clock);
      break;
    case "acknowledge":
      r = ops.acknowledge(store, store.handovers[0].currentPublicationId ?? "", clock);
      break;
    case "create_gap_link":
      r = ops.createGapLink(store, a.questions.map((n) => gapQuestionId(store, n)), clock);
      break;
    case "submit_gap_answer":
      r = ops.submitGapAnswers(store, { answererLabel: a.answererLabel, answers: [{ gapQuestionId: gapQuestionId(store, a.question), answerText: a.text }] }, clock);
      break;
    case "accept_gap_answer": {
      const q = store.gapQuestions.find((x) => x.id === gapQuestionId(store, a.question));
      const answer = q?.answers.filter((x) => x.status === "submitted").pop();
      r = ops.reviewGapAnswer(store, answer?.id ?? "", "accept", clock);
      break;
    }
    case "start_revision":
      r = ops.startRevision(store, clock);
      break;
  }
  if (!r.ok) throw new Error(`demo scenario: canonical ${a.action} failed (${r.error.code})`);
}

/** One visitor action on a store (already validated). */
function applyVisitor(store: DemoStore, action: z.output<typeof demoActionSchema>, clock: ops.DemoClock): Result<unknown> {
  switch (action.type) {
    case "reviewPoint": {
      const a = action.input;
      if (a.action !== "approve" && a.action !== "reject" && a.action !== "edit" && a.action !== "confirm_inferred" && a.action !== "resolve_conflict") {
        return readOnly();
      }
      return ops.reviewPoint(store, a, clock);
    }
    case "submitGapAnswers":
      return ops.submitGapAnswers(store, action.input, clock);
    case "reviewGapAnswer":
      return ops.reviewGapAnswer(store, action.input.answerId, action.input.decision, clock);
    case "decideChangeReview":
      return ops.decideChangeReview(store, action.input, clock);
    case "publish":
      if (action.input.handoverId !== DEMO_HANDOVER_ID) return ops.fail("not_found", "We couldn't find that.");
      return ops.publish(store, action.input.summary, clock);
    case "acknowledge":
      return ops.acknowledge(store, action.input.publicationId, clock);
    case "inviteMember":
      return readOnly(); // handled before a state is built (simulated, never logged)
  }
}

function canonicalBefore(step: DemoStepId): ScenarioAction[] {
  return DEMO_CANONICAL_ACTIONS.filter((a) => stepIndex(a.step) < stepIndex(step));
}

const built = new WeakMap<DemoSession, DemoStore>();

/** The store for a session: the seed, the canonical actions before its step, then its own log. */
function buildStore(session: DemoSession): DemoStore {
  const store = seedDemoStore();
  const counts = new Map<DemoStepId, number>();
  for (const a of canonicalBefore(session.step)) {
    const i = counts.get(a.step) ?? 0;
    counts.set(a.step, i + 1);
    applyCanonical(store, a, { at: minutes(DEMO_STEP_CLOCK[a.step], i) });
  }
  session.log.forEach((entry, i) => {
    const parsed = demoActionSchema.safeParse(entry);
    if (parsed.success) applyVisitor(store, parsed.data, visitorClock(session, i));
  });
  return store;
}

const visitorClock = (session: DemoSession, i: number): ops.DemoClock => ({ at: minutes(DEMO_STEP_CLOCK[session.step], 30 + i) });

function storeFor(session: DemoSession): DemoStore {
  let store = built.get(session);
  if (!store) {
    store = buildStore(session);
    built.set(session, store);
  }
  return store;
}

// ── the public API (contract §2.5) ───────────────────────────────────────────────────────────────────────

const randomId = (): string => crypto.randomUUID();

export function startDemoSession(opts: { step?: DemoStepId } = {}): DemoSession {
  return { id: randomId(), version: DEMO_ENGINE_VERSION, startedAt: new Date().toISOString(), step: opts.step ?? "sources", log: [] };
}

/** Fresh state at the session's current step (same id, empty log). Idempotent. */
export function resetDemoSession(session: DemoSession): DemoSession {
  return { ...session, log: [] };
}

/** The canonical state of a step (the visitor's own changes are dropped). Idempotent. */
export function jumpToStep(session: DemoSession, step: DemoStepId): DemoSession {
  if (stepIndex(step) < 0) return resetDemoSession(session);
  return { ...session, step, log: [] };
}

/**
 * Applies one visitor action. On success the action is appended to the log (a new session object); on failure the
 * session is returned unchanged with the same error the real product would give. Never throws.
 */
export function applyDemoAction(session: DemoSession, action: unknown): { session: DemoSession; result: Result<unknown> } {
  const type = typeof action === "object" && action !== null ? (action as { type?: unknown }).type : undefined;
  if (typeof type !== "string" || !DEMO_ACTION_TYPES.has(type)) return { session, result: readOnly() };
  if (type === "reviewPoint") {
    const reviewAction = ((action as { input?: { action?: unknown } }).input ?? {}).action;
    if (typeof reviewAction === "string" && !REVIEW_ACTIONS.has(reviewAction)) return { session, result: readOnly() }; // before validation (A7)
  }
  const parsed = demoActionSchema.safeParse(action);
  if (!parsed.success) {
    return { session, result: ops.fail("validation_failed", "Some fields need attention.", { fieldErrors: z.flattenError(parsed.error).fieldErrors as Record<string, string[]> }) };
  }
  const a = parsed.data;
  if (a.type === "reviewPoint" && !REVIEW_ACTIONS.has(a.input.action)) return { session, result: readOnly() };
  if (a.type === "inviteMember") {
    // Simulated: no token, no email, nothing stored (contract A1).
    const invitation: CreatedInvitation = {
      tokenId: "00000000-0000-4000-8000-000000000000",
      url: "/demo/workspace?step=receive",
      expiresAt: minutes(DEMO_STEP_CLOCK[session.step], 7 * 24 * 60),
      delivery: { status: "not_sent", reason: "demo" },
    };
    return { session, result: ops.ok(invitation) };
  }
  if (session.log.length >= DEMO_LOG_MAX) {
    return { session, result: ops.fail("precondition_failed", "The demo has reached its limit. Reset it to start again.", { details: { reason: "demo_limit_reached" } }) };
  }
  let result: Result<unknown>;
  const store = buildStore(session); // a private copy: a failed action leaves the session's state untouched
  try {
    result = applyVisitor(store, a, visitorClock(session, session.log.length));
  } catch {
    result = ops.fail("internal", "Something went wrong in the demo. Reset it to start again.");
  }
  if (!result.ok) return { session, result };
  const next: DemoSession = { ...session, log: [...session.log, action as DemoAction] };
  built.set(next, store);
  return { session: next, result };
}

function queriesOver(store: DemoStore, viewer: DemoViewer): DemoQueries {
  return createStoreQueries(() => store, demoProfileId(viewer), {
    requestTime: async () => {},
    tick: () => {},
    stages: runStages,
    changeReviews: (s, _handoverId, clearance) => ops.changeReviewItems(s as DemoStore, clearance),
  });
}

/** The real read facade (same DTOs, same visibility rules) over this session's own demo store. */
export function demoQueries(session: DemoSession, viewer: DemoViewer): DemoQueries {
  return queriesOver(storeFor(session), viewer);
}

/** The canonical state of a step, for a read-only server render (no JavaScript needed). */
export function demoSnapshot(step: DemoStepId, viewer: DemoViewer): DemoQueries {
  return queriesOver(buildStore({ id: "snapshot", version: DEMO_ENGINE_VERSION, startedAt: new Date(0).toISOString(), step, log: [] }), viewer);
}

export function serializeDemoSession(session: DemoSession): string {
  return JSON.stringify({ id: session.id, version: session.version, startedAt: session.startedAt, step: session.step, log: session.log });
}

const sessionSchema = z.object({
  id: z.uuid(),
  version: z.literal(DEMO_ENGINE_VERSION),
  startedAt: z.iso.datetime(),
  step: z.enum(STEP_ORDER as [DemoStepId, ...DemoStepId[]]),
  log: z.array(z.unknown()).max(DEMO_LOG_MAX),
});

/**
 * A stored session, or null for anything malformed, from another engine version, older than 24 hours or dated in the
 * future (the UI then starts a fresh one). Log entries that are not valid actions are dropped.
 */
export function parseDemoSession(raw: unknown, now: number = Date.now()): DemoSession | null {
  let value = raw;
  if (typeof raw === "string") {
    if (raw.length > 200_000) return null;
    try {
      value = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  const parsed = sessionSchema.safeParse(value);
  if (!parsed.success) return null;
  const started = Date.parse(parsed.data.startedAt);
  if (!(started <= now + 5 * 60_000) || now - started > DEMO_SESSION_MAX_AGE_MS) return null;
  const log = parsed.data.log.filter((e): e is DemoAction => demoActionSchema.safeParse(e).success && (e as DemoAction).type !== "inviteMember");
  return { id: parsed.data.id, version: DEMO_ENGINE_VERSION, startedAt: parsed.data.startedAt, step: parsed.data.step, log };
}
