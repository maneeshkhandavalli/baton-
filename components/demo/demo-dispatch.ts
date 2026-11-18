/**
 * The demo UI's ONLY bridge to the demo engine's actions (R3 Task 06, frozen contract §2.5 as pinned by A7).
 * Pure and React-free (components/demo/__tests__/demo-dispatch.test.ts). Every action the workspace sends is built
 * here with the real input types, so a contract change lands in one file.
 *
 * A3: the demo UI uses only the published engine API (lib/demo/engine) and the real DTO / schema types; it never
 * imports lib/mocks/store.ts, lib/actions, lib/supabase or lib/db.
 */

import type { AppError, Result } from "@/lib/contracts/api";
import type { ChangeReviewDecision, ChangeReviewItem, DecideChangeReviewInput } from "@/lib/contracts/change-review";
import type { ReviewPointInput } from "@/lib/contracts/schemas";
import type { DemoAction, DemoSession } from "@/lib/demo/engine";

/** The ReviewPointInput actions the demo accepts (A7); any other one is refused by the engine (demo_read_only). */
export const DEMO_REVIEW_ACTIONS = ["approve", "reject", "edit", "confirm_inferred", "resolve_conflict"] as const;

export function isDemoReviewAction(input: Pick<ReviewPointInput, "action">): boolean {
  return (DEMO_REVIEW_ACTIONS as readonly string[]).includes(input.action);
}

export const reviewPoint = (input: ReviewPointInput): DemoAction => ({ type: "reviewPoint", input });

export const publishHandover = (handoverId: string, summary?: string): DemoAction => ({
  type: "publish",
  input: summary && summary.trim() ? { handoverId, summary: summary.trim() } : { handoverId },
});

export const acknowledgePublication = (publicationId: string, statementVersion: string): DemoAction => ({
  type: "acknowledge",
  input: { publicationId, statementVersion },
});

/** A Gap Interview answer typed by the visitor (signed-in shape: no token in the demo). */
export const submitGapAnswer = (gapQuestionId: string, answerText: string, answererLabel: string): DemoAction => ({
  type: "submitGapAnswers",
  input: { answererLabel, answers: [{ gapQuestionId, answerText: answerText.trim() }] },
});

export const reviewGapAnswer = (answerId: string, decision: "accept" | "reject", note?: string): DemoAction => ({
  type: "reviewGapAnswer",
  input: note && note.trim() ? { answerId, decision, note: note.trim() } : { answerId, decision },
});

export const decideChangeReview = (input: DecideChangeReviewInput): DemoAction => ({ type: "decideChangeReview", input });

/**
 * The Task 05E decision input for one change-review item, as the reviewer saw it (expected state and point revision,
 * so a stale view is refused). Per-kind extras: a contradiction accepted is a correction backed by the new message
 * (the whole message unless the item marks a quotation); new information accepted carries what a normal approval of
 * that point would need. Null when the item has no point (nothing to decide here) or is already resolved.
 */
export function changeDecisionInput(
  item: ChangeReviewItem,
  handoverId: string,
  decision: ChangeReviewDecision,
  opts: { note?: string; correction?: { title: string; statement: string } } = {},
): DecideChangeReviewInput | null {
  if (!item.point || (item.state !== "open" && item.state !== "investigating")) return null;
  const note = opts.note?.trim() || undefined;
  const input: DecideChangeReviewInput = {
    handoverId,
    itemId: item.id,
    decision,
    expectedState: item.state,
    expectedPointRevisionId: item.point.currentRevisionId,
    ...(note ? { note } : {}),
  };
  if (decision !== "accept") return input;
  if (item.kind === "possible_contradiction") {
    const body = item.newMessage?.body ?? "";
    const start = item.newMessage?.quoteStart ?? 0;
    const end = item.newMessage?.quoteEnd ?? body.length;
    return {
      ...input,
      correction: {
        title: (opts.correction?.title ?? item.point.title ?? "").trim(),
        statement: (opts.correction?.statement ?? item.point.statement ?? "").trim(),
        attributes: item.point.attributes ?? {},
        evidenceStart: start,
        evidenceEnd: end > start ? end : body.length,
      },
    };
  }
  if (item.kind === "new_information") {
    const s = item.point.evidenceStatus;
    const approval = s === "inferred" ? { confirmInferred: true } : s === "missing" ? { asKnownGap: true } : s === "conflicting" ? { resolutionNote: note ?? "" } : undefined;
    return approval ? { ...input, approval } : input;
  }
  return input;
}

/** What the visitor is told after an action. Never a raw server code; demo refusals say why. */
export function demoResultText(result: Result<unknown>, success: string): { ok: boolean; text: string } {
  if (result.ok) return { ok: true, text: success };
  return { ok: false, text: demoErrorText(result.error) };
}

export function demoErrorText(error: Pick<AppError, "code" | "message" | "details">): string {
  if (error.code === "forbidden" && error.details?.reason === "demo_read_only") {
    return "That isn't part of the demo. Here you can review points, answer and accept gap questions, publish and acknowledge.";
  }
  if (error.code === "validation_failed") return error.message || "Check the highlighted fields.";
  return error.message || "That didn't work. Try again, or reset the demo.";
}

/* ── Session persistence (per-viewer convenience, contract §2.3) ───────────────────────────────────────────── */

export interface SessionCodec {
  serialize: (s: DemoSession) => string;
  parse: (raw: unknown, now?: number) => DemoSession | null;
}

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/** The stored session, or null when storage is unavailable, empty, malformed, expired or from another version. */
export function readStoredSession(storage: StorageLike | null, key: string, codec: SessionCodec, now?: number): DemoSession | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(key);
    return raw === null ? null : codec.parse(raw, now);
  } catch {
    return null;
  }
}

/** Best effort: a private window or blocked storage just means the demo is not remembered across reloads. */
export function writeStoredSession(storage: StorageLike | null, key: string, codec: SessionCodec, session: DemoSession): void {
  if (!storage) return;
  try {
    storage.setItem(key, codec.serialize(session));
  } catch {
    // ignore: the demo still works for this page view
  }
}
