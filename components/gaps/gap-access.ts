/**
 * What the UI can know about a gap question's access level (§6.15, §8.4).
 *
 * The stored level is `max(requested accessLevel, linked point's CURRENT access level)`; there is no
 * category-based rule. `GapQuestionSummary` does not carry the level, so the UI can only derive the
 * point side of that maximum: a guaranteed minimum for questions linked to a visible point, and
 * nothing for questions without one. It never assumes "everyone". The server re-checks every link
 * (`createGapInterviewLink` fails with `validation_failed` on `maxAccessLevel`).
 */

import type { GapQuestionSummary, PointSummary } from "@/lib/contracts/dto";
import { ACCESS_LEVELS, type AccessLevel } from "@/lib/contracts/enums";

const rank = (l: AccessLevel) => ACCESS_LEVELS.indexOf(l);
const stricter = (a: AccessLevel, b: AccessLevel) => (rank(b) > rank(a) ? b : a);

/** The least restrictive level the question can have, or null when the UI can't derive any bound. */
export function questionLevelAtLeast(q: Pick<GapQuestionSummary, "pointId">, pointById: ReadonlyMap<string, Pick<PointSummary, "accessLevel">>): AccessLevel | null {
  if (!q.pointId) return null;
  return pointById.get(q.pointId)?.accessLevel ?? null;
}

/**
 * For a set of questions: the lowest `maxAccessLevel` a link could be accepted at, from what the UI
 * can derive, and how many questions have a level the UI cannot see.
 */
export function linkLevelAtLeast(
  questions: ReadonlyArray<Pick<GapQuestionSummary, "pointId">>,
  pointById: ReadonlyMap<string, Pick<PointSummary, "accessLevel">>,
): { atLeast: AccessLevel; underivable: number } {
  let atLeast: AccessLevel = "everyone";
  let underivable = 0;
  for (const q of questions) {
    const level = questionLevelAtLeast(q, pointById);
    if (level === null) underivable += 1;
    else atLeast = stricter(atLeast, level);
  }
  return { atLeast, underivable };
}
