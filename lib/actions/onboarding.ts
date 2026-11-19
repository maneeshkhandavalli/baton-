"use server";

/** Round 4 (Worker 02): first-time guidance events (welcome, tours, checklist, reset). lib/actions/core/onboarding.ts. */

import type { Result } from "../contracts/api";
import { onboardingDeps } from "../onboarding/server";
import type { OnboardingEvent, OnboardingState } from "../onboarding/state";
import * as core from "./core/onboarding";

export async function recordOnboardingEvent(input: OnboardingEvent): Promise<Result<OnboardingState>> {
  return core.recordOnboarding(onboardingDeps(), input);
}
