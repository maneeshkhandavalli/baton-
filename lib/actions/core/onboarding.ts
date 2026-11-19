/**
 * Round 4 (Worker 02): record one first-time-guidance event for the signed-in user (lib/onboarding/state.ts).
 *
 * Validate the event (Zod) → verified actor (null → unauthenticated, nothing read or written) → read the CURRENT
 * stored value for that same user → apply the event → write it back only when it changed. The browser never sends
 * the stored object, only the event, so it can't write anything else into the user's metadata. This state is
 * guidance only; nothing reads it to grant or check access.
 */

import type { Result } from "../../contracts/api";
import type { VerifiedActor } from "../../db/actor-rules";
import { applyOnboardingEvent, onboardingChanged, onboardingEventSchema, type OnboardingState } from "../../onboarding/state";
import { failWith, guarded, ok, parseInput } from "./run";

export interface OnboardingStore {
  /** The verified session's user and their stored onboarding value (parsed leniently), or null when signed out. */
  read(): Promise<{ userId: string; state: OnboardingState } | null>;
  /** Writes the value for the session's own user (Supabase auth.updateUser({ data })). Throws on failure. */
  write(state: OnboardingState): Promise<void>;
}

export interface OnboardingDeps {
  getActor(): Promise<VerifiedActor | null>;
  store: OnboardingStore;
  now(): string;
}

export async function recordOnboarding(deps: OnboardingDeps, input: unknown): Promise<Result<OnboardingState>> {
  const parsed = parseInput(onboardingEventSchema, input);
  if (!parsed.ok) return parsed;
  return guarded(async () => {
    const actor = await deps.getActor();
    if (!actor) return failWith("unauthenticated");
    const current = await deps.store.read();
    // The stored value must belong to the same verified user (never another session's).
    if (!current || current.userId.toLowerCase() !== actor.profileId) return failWith("unauthenticated");
    const next = applyOnboardingEvent(current.state, parsed.data, deps.now());
    if (onboardingChanged(current.state, next)) await deps.store.write(next);
    return ok(next);
  });
}
