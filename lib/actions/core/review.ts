/** Review actions (§5, §11.3). */

import type { z } from "zod";

import type { Result } from "../../contracts/api";
import type { PointDetail } from "../../contracts/dto";
import type { PointCategory } from "../../contracts/enums";
import { createManualPointInput, parsePointAttributes, reviewPointInput } from "../../contracts/schemas";
import type { CreateManualPointInput, ReviewPointInput } from "../../contracts/schemas";
import * as mutations from "../../db/mutations";
import { createInputMasker, type InputMasker } from "./mask";
import { action, parseInput, validationFailed, type Failure } from "./run";
import type { ActionDeps } from "./types";

type ReviewPointValues = z.output<typeof reviewPointInput>;
type PrivacyValues = Extract<ReviewPointValues, { action: "resolve_privacy_review" }>;

/** Masks every free-text field of a review action (§12.1). Ids, enums and the digest are never touched. */
function maskReviewInput(m: InputMasker, v: ReviewPointValues): ReviewPointValues {
  switch (v.action) {
    case "approve":
      return { ...v, resolutionNote: m.optional(v.resolutionNote) };
    case "reject":
      return { ...v, reason: m.text(v.reason) };
    case "reopen":
    case "confirm_inferred":
      return { ...v, note: m.optional(v.note) };
    case "edit":
      return {
        ...v,
        title: m.text(v.title),
        statement: m.text(v.statement),
        attributes: m.attributes(v.attributes),
        editReason: m.text(v.editReason),
      };
    case "resolve_conflict":
      return { ...v, resolutionNote: m.text(v.resolutionNote) };
    case "exclude_evidence":
      return { ...v, reason: m.text(v.reason) };
    case "restore_evidence":
    case "change_access":
      return v;
    case "resolve_privacy_review":
      return {
        ...v,
        redacted: v.redacted && {
          ...v.redacted,
          title: m.text(v.redacted.title),
          statement: m.text(v.redacted.statement),
          attributes: m.attributes(v.redacted.attributes),
          inferenceRationale: m.nullable(v.redacted.inferenceRationale),
          conflictResolutionNote: m.nullable(v.redacted.conflictResolutionNote),
        },
        // "Text fields are masked on the server" (§11.5); `attributes` of a revision are masked like any other.
        surfaces: v.surfaces.map((s) => (s.replacement === undefined ? s : { ...s, replacement: m.attributes(s.replacement) })),
      };
  }
}

/** Re-validates attributes for the point's category; the category comes from a server re-read, never the input. */
function validAttributes(category: PointCategory, attributes: unknown): { ok: true; data: Record<string, unknown> } | Failure {
  const parsed = parsePointAttributes(category, attributes);
  if (!parsed.success) return validationFailed(parsed.error);
  return { ok: true, data: parsed.data.attributes as Record<string, unknown> };
}

async function withCheckedAttributes(
  deps: ActionDeps,
  v: ReviewPointValues,
): Promise<{ ok: true; data: ReviewPointValues } | Failure> {
  if (v.action !== "edit" && v.action !== "resolve_privacy_review") return { ok: true, data: v };
  const needsCategory =
    v.action === "edit" ||
    v.redacted !== undefined ||
    v.surfaces.some((s) => s.kind === "revision" && s.replacement !== undefined && "attributes" in s.replacement);
  if (!needsCategory) return { ok: true, data: v };

  const point = await deps.queries.getPoint(v.pointId);
  if (!point.ok) return point;
  const category = point.data.category;

  if (v.action === "edit") {
    const attributes = validAttributes(category, v.attributes);
    return attributes.ok ? { ok: true, data: { ...v, attributes: attributes.data } } : attributes;
  }

  let redacted = v.redacted;
  if (redacted) {
    const attributes = validAttributes(category, redacted.attributes);
    if (!attributes.ok) return attributes;
    redacted = { ...redacted, attributes: attributes.data };
  }
  const surfaces: PrivacyValues["surfaces"] = [];
  for (const s of v.surfaces) {
    if (s.kind !== "revision" || s.replacement === undefined || !("attributes" in s.replacement)) {
      surfaces.push(s);
      continue;
    }
    const attributes = validAttributes(category, s.replacement.attributes);
    if (!attributes.ok) return attributes;
    surfaces.push({ ...s, replacement: { ...s.replacement, attributes: attributes.data } });
  }
  return { ok: true, data: { ...v, redacted, surfaces } };
}

/** While privacyReview = "required" only resolve_privacy_review and change_access succeed (§5.5, enforced in SQL). */
export async function reviewPoint(deps: ActionDeps, input: ReviewPointInput): Promise<Result<PointDetail>> {
  return action(deps, reviewPointInput, input, async (actor, v) => {
    const masked = parseInput(reviewPointInput, maskReviewInput(createInputMasker(), v));
    if (!masked.ok) return masked;
    const checked = await withCheckedAttributes(deps, masked.data);
    if (!checked.ok) return checked;
    await mutations.reviewPoint(deps.adminDb(), actor, checked.data);
    return deps.queries.getPoint(v.pointId);
  });
}

/** Review roles only (SQL). Category and attributes are validated together by the schema, after masking. */
export async function createManualPoint(deps: ActionDeps, input: CreateManualPointInput): Promise<Result<PointDetail>> {
  return action(deps, createManualPointInput, input, async (actor, v) => {
    const m = createInputMasker();
    const masked = parseInput(createManualPointInput, {
      ...v,
      title: m.text(v.title),
      statement: m.text(v.statement),
      inferenceRationale: m.optional(v.inferenceRationale),
      testimony: v.testimony && { ...v.testimony, text: m.text(v.testimony.text) },
      attributes: m.attributes(v.attributes as Record<string, unknown>),
    });
    if (!masked.ok) return masked;
    const pointId = await mutations.createManualPoint(deps.adminDb(), actor, masked.data);
    return deps.queries.getPoint(pointId);
  });
}
