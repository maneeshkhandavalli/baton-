/**
 * The D35 pipeline shared by every server action:
 *   Zod-parse the input → verified actor (null → unauthenticated) → lib/db mutation with the service-role
 *   client → DTO re-read through the user-scoped RLS queries → errors mapped with toAppError.
 *
 * Ids, roles, creator identity and membership never come from the browser: the actor comes only from
 * `deps.getActor()`, ids only from the parsed input, and the database re-checks everything (§8.3).
 * Error codes pass through unchanged; messages are fixed, safe strings (§3.2).
 */

import { z } from "zod";

import type { AppError, ErrorCode, Result } from "../../contracts/api";
import type { VerifiedActor } from "../../db/actor-rules";
import { fail, toAppError } from "../../db/errors";
import type { ActionDeps } from "./types";

export type Failure = { ok: false; error: AppError };

export const VALIDATION_MESSAGE = "Some fields need attention.";

export function validationFailed(error: z.ZodError): Failure {
  const flat = z.flattenError(error);
  return {
    ok: false,
    error: {
      code: "validation_failed",
      message: VALIDATION_MESSAGE,
      retryable: false,
      fieldErrors: flat.fieldErrors as Record<string, string[]>,
    },
  };
}

export function parseInput<S extends z.ZodType>(schema: S, input: unknown): { ok: true; data: z.output<S> } | Failure {
  const r = schema.safeParse(input);
  return r.success ? { ok: true, data: r.data } : validationFailed(r.error);
}

/** A typed failure with optional non-sensitive details and an optional safe message. */
export function failWith(
  code: ErrorCode,
  options: { details?: Record<string, string | number | boolean>; message?: string; retryable?: boolean } = {},
): Failure {
  const base = (fail(code) as Failure).error;
  return {
    ok: false,
    error: {
      ...base,
      ...(options.message ? { message: options.message } : {}),
      ...(options.retryable !== undefined ? { retryable: options.retryable } : {}),
      ...(options.details ? { details: options.details } : {}),
    },
  };
}

export const ok = <T>(data: T): Result<T> => ({ ok: true, data });

/** Runs `work` and maps anything thrown by lib/db (or anything unexpected) to a safe AppError. */
export async function guarded<T>(work: () => Promise<Result<T>>): Promise<Result<T>> {
  try {
    return await work();
  } catch (error) {
    return { ok: false, error: toAppError(error) };
  }
}

function refreshQuietly(deps: ActionDeps): void {
  try {
    deps.revalidate();
  } catch {
    // A failed router refresh never turns a committed write into an error.
  }
}

/**
 * The standard action: validate, require the verified actor, then run `work`. Nothing in `work` runs for
 * invalid input or a missing session, so no database call is made in either case.
 */
export async function action<S extends z.ZodType, T>(
  deps: ActionDeps,
  schema: S,
  input: unknown,
  work: (actor: VerifiedActor, values: z.output<S>) => Promise<Result<T>>,
  options: { refresh?: boolean } = {},
): Promise<Result<T>> {
  const parsed = parseInput(schema, input);
  if (!parsed.ok) return parsed;
  return withActor(deps, (actor) => work(actor, parsed.data), options);
}

/** Requires the verified actor, then runs `work` (for actions without input). */
export async function withActor<T>(
  deps: ActionDeps,
  work: (actor: VerifiedActor) => Promise<Result<T>>,
  options: { refresh?: boolean } = {},
): Promise<Result<T>> {
  return guarded(async () => {
    const actor = await deps.getActor();
    if (!actor) return fail<T>("unauthenticated");
    const result = await work(actor);
    if (result.ok && options.refresh !== false) refreshQuietly(deps);
    return result;
  });
}

/** For the token path of submitGapAnswers, which has no session actor (D8). */
export async function withoutActor<T>(deps: ActionDeps, work: () => Promise<Result<T>>): Promise<Result<T>> {
  return guarded(async () => {
    const result = await work();
    if (result.ok) refreshQuietly(deps);
    return result;
  });
}

/**
 * The trusted site origin, checked BEFORE a token is created so a misconfiguration leaves no orphan token
 * (I3 amendment 6). Fails closed with `internal`; the configuration problem is not described to the client.
 */
export function siteOriginOrFail(deps: ActionDeps): { ok: true; origin: string } | Failure {
  try {
    return { ok: true, origin: deps.siteOrigin() };
  } catch {
    return failWith("internal", { details: { reason: "site_url_not_configured" } });
  }
}

/** Absolute link for a raw token path built with lib/routes. */
export function absoluteUrl(origin: string, path: string): string {
  return new URL(path, origin).toString();
}
