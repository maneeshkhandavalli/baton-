/**
 * Round 4 (Worker 02): first-time guidance state, stored in the signed-in user's Supabase Auth `user_metadata`
 * under ONE key (no database migration). Pure and React-free (components/shared/__tests__/onboarding-state.test.ts).
 *
 *   baton_onboarding: { v: 1, welcomeSeenAt?, tour?: { creator?: { status, at }, incoming?: … },
 *                       checklistDismissedAt?, publishedOpenedAt? }
 *
 * The browser never sends this object. It sends one small, validated EVENT ("welcome_seen", "tour_finished", …)
 * and the server applies it to the stored value (applyOnboardingEvent). Reading is lenient: anything that doesn't
 * parse is treated as "nothing seen yet", so a broken or hand-edited value can only ever show guidance again,
 * never hide something or break a page. This is guidance only: it never grants or checks access.
 */

import { z } from "zod";

export const ONBOARDING_METADATA_KEY = "baton_onboarding";
export const ONBOARDING_VERSION = 1;

export const GUIDE_ROLES = ["creator", "incoming"] as const;
export type GuideRole = (typeof GUIDE_ROLES)[number];

const isoTime = z.iso.datetime({ offset: true });

const tourRecord = z.object({ status: z.enum(["completed", "dismissed"]), at: isoTime }).strict();
export type TourRecord = z.infer<typeof tourRecord>;

export const onboardingStateSchema = z
  .object({
    v: z.literal(ONBOARDING_VERSION),
    welcomeSeenAt: isoTime.optional(),
    tour: z.object({ creator: tourRecord.optional(), incoming: tourRecord.optional() }).strict().optional(),
    checklistDismissedAt: isoTime.optional(),
    /** First time this user opened a published handover (the incoming checklist's "Read it" item). */
    publishedOpenedAt: isoTime.optional(),
  })
  .strict();

export type OnboardingState = z.infer<typeof onboardingStateSchema>;

export const EMPTY_ONBOARDING: OnboardingState = Object.freeze({ v: ONBOARDING_VERSION }) as OnboardingState;

/** Events the browser may send. Nothing else can be written. */
export const onboardingEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("welcome_seen") }).strict(),
  z.object({ type: z.literal("tour_finished"), role: z.enum(GUIDE_ROLES), status: z.enum(["completed", "dismissed"]) }).strict(),
  z.object({ type: z.literal("checklist_dismissed") }).strict(),
  z.object({ type: z.literal("checklist_restored") }).strict(),
  z.object({ type: z.literal("published_opened") }).strict(),
  z.object({ type: z.literal("reset") }).strict(),
]);
export type OnboardingEvent = z.infer<typeof onboardingEventSchema>;

/** The stored value, or EMPTY_ONBOARDING for anything missing, old, newer or malformed. */
export function parseOnboarding(raw: unknown): OnboardingState {
  const r = onboardingStateSchema.safeParse(raw);
  return r.success ? r.data : EMPTY_ONBOARDING;
}

/** The value under ONBOARDING_METADATA_KEY of a user's metadata object (or EMPTY_ONBOARDING). */
export function onboardingFromMetadata(meta: Record<string, unknown> | null | undefined): OnboardingState {
  return parseOnboarding(meta?.[ONBOARDING_METADATA_KEY]);
}

/**
 * The new state after one event. `now` is an ISO timestamp from the server. First-time facts keep their first
 * timestamp (seeing the welcome twice, opening a second publication); a tour's latest outcome wins.
 */
export function applyOnboardingEvent(state: OnboardingState, event: OnboardingEvent, now: string): OnboardingState {
  switch (event.type) {
    case "welcome_seen":
      return state.welcomeSeenAt ? state : { ...state, welcomeSeenAt: now };
    case "tour_finished":
      return { ...state, welcomeSeenAt: state.welcomeSeenAt ?? now, tour: { ...state.tour, [event.role]: { status: event.status, at: now } } };
    case "checklist_dismissed":
      return state.checklistDismissedAt ? state : { ...state, checklistDismissedAt: now };
    case "checklist_restored": {
      if (!state.checklistDismissedAt) return state;
      const { checklistDismissedAt: _dropped, ...rest } = state;
      void _dropped;
      return rest;
    }
    case "published_opened":
      return state.publishedOpenedAt ? state : { ...state, publishedOpenedAt: now };
    case "reset":
      // Guidance only: the record of having opened a publication is a fact about the user's work, kept.
      return state.publishedOpenedAt ? { v: ONBOARDING_VERSION, publishedOpenedAt: state.publishedOpenedAt } : EMPTY_ONBOARDING;
  }
}

/** Whether `next` differs from `prev` (skip a write that would change nothing). */
export function onboardingChanged(prev: OnboardingState, next: OnboardingState): boolean {
  return JSON.stringify(prev) !== JSON.stringify(next);
}

/** The welcome shows once per user, until "Reset guidance". */
export const shouldShowWelcome = (state: OnboardingState): boolean => !state.welcomeSeenAt;

/** A tour that was completed or dismissed never starts by itself again (Help can replay it). */
export const tourFinished = (state: OnboardingState, role: GuideRole): boolean => !!state.tour?.[role];
