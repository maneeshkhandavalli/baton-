// Round 4 (Worker 02): onboarding metadata schema, events and role resolution (lib/onboarding/state.ts, role.ts).
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { resolveGuideRoles, type RoleInput } from "@/lib/onboarding/role";
import {
  EMPTY_ONBOARDING,
  ONBOARDING_METADATA_KEY,
  applyOnboardingEvent,
  onboardingChanged,
  onboardingEventSchema,
  onboardingFromMetadata,
  parseOnboarding,
  shouldShowWelcome,
  tourFinished,
} from "@/lib/onboarding/state";

const T1 = "2026-11-19T10:00:00.000Z";
const T2 = "2026-11-19T11:00:00.000Z";

describe("onboarding metadata", () => {
  it("parses a valid value and treats anything else as nothing seen", () => {
    const valid = { v: 1, welcomeSeenAt: T1, tour: { creator: { status: "completed", at: T1 } } };
    assert.deepEqual(parseOnboarding(valid), valid);
    for (const bad of [undefined, null, "x", 3, {}, { v: 2 }, { v: 1, welcomeSeenAt: "yesterday" }, { v: 1, extra: true }, { v: 1, tour: { lead: { status: "completed", at: T1 } } }]) {
      assert.deepEqual(parseOnboarding(bad), EMPTY_ONBOARDING, JSON.stringify(bad));
    }
  });

  it("reads only its own key of user_metadata", () => {
    assert.deepEqual(onboardingFromMetadata({ full_name: "A", [ONBOARDING_METADATA_KEY]: { v: 1, welcomeSeenAt: T1 } }), { v: 1, welcomeSeenAt: T1 });
    assert.deepEqual(onboardingFromMetadata(null), EMPTY_ONBOARDING);
  });

  it("the welcome shows once; seeing it again keeps the first time", () => {
    assert.equal(shouldShowWelcome(EMPTY_ONBOARDING), true);
    const seen = applyOnboardingEvent(EMPTY_ONBOARDING, { type: "welcome_seen" }, T1);
    assert.equal(shouldShowWelcome(seen), false);
    assert.equal(applyOnboardingEvent(seen, { type: "welcome_seen" }, T2), seen);
  });

  it("a finished tour (completed or dismissed) is remembered per role and also marks the welcome seen", () => {
    const s = applyOnboardingEvent(EMPTY_ONBOARDING, { type: "tour_finished", role: "creator", status: "dismissed" }, T1);
    assert.equal(tourFinished(s, "creator"), true);
    assert.equal(tourFinished(s, "incoming"), false);
    assert.equal(s.welcomeSeenAt, T1);
    const replayed = applyOnboardingEvent(s, { type: "tour_finished", role: "creator", status: "completed" }, T2);
    assert.deepEqual(replayed.tour?.creator, { status: "completed", at: T2 });
  });

  it("checklist dismissal can be undone; reset clears guidance but keeps the 'opened a publication' fact", () => {
    let s = applyOnboardingEvent(EMPTY_ONBOARDING, { type: "checklist_dismissed" }, T1);
    assert.equal(s.checklistDismissedAt, T1);
    s = applyOnboardingEvent(s, { type: "checklist_restored" }, T2);
    assert.equal("checklistDismissedAt" in s, false);
    s = applyOnboardingEvent(s, { type: "published_opened" }, T1);
    s = applyOnboardingEvent(s, { type: "welcome_seen" }, T1);
    s = applyOnboardingEvent(s, { type: "tour_finished", role: "incoming", status: "completed" }, T1);
    const reset = applyOnboardingEvent(s, { type: "reset" }, T2);
    assert.deepEqual(reset, { v: 1, publishedOpenedAt: T1 });
    assert.equal(shouldShowWelcome(reset), true);
    // every result is itself a valid stored value
    for (const v of [s, reset]) assert.deepEqual(parseOnboarding(v), v);
  });

  it("only the listed events are accepted from the browser", () => {
    assert.equal(onboardingEventSchema.safeParse({ type: "welcome_seen" }).success, true);
    assert.equal(onboardingEventSchema.safeParse({ type: "tour_finished", role: "creator", status: "completed" }).success, true);
    for (const bad of [{ type: "set", data: { v: 1 } }, { type: "tour_finished", role: "admin", status: "completed" }, { type: "welcome_seen", at: T1 }, null]) {
      assert.equal(onboardingEventSchema.safeParse(bad).success, false, JSON.stringify(bad));
    }
  });

  it("detects no-op writes", () => {
    assert.equal(onboardingChanged(EMPTY_ONBOARDING, { v: 1 }), false);
    assert.equal(onboardingChanged(EMPTY_ONBOARDING, { v: 1, welcomeSeenAt: T1 }), true);
  });
});

const h = (over: Partial<RoleInput>): RoleInput => ({
  id: "h",
  viewerRole: "outgoing",
  viewerIsCreator: true,
  updatedAt: T1,
  state: "draft",
  currentPublicationId: null,
  ...over,
});

describe("guidance role (from real memberships)", () => {
  it("a user with no handovers gets the creator guidance (anyone can start one)", () => {
    assert.deepEqual(resolveGuideRoles([]), { roles: ["creator"], primary: "creator", focus: {} });
  });

  it("incoming and lead members get only the incoming guidance", () => {
    const r = resolveGuideRoles([h({ id: "a", viewerRole: "incoming", viewerIsCreator: false }), h({ id: "b", viewerRole: "lead", viewerIsCreator: false, currentPublicationId: "p" })]);
    assert.deepEqual(r.roles, ["incoming"]);
    assert.equal(r.primary, "incoming");
    assert.equal(r.focus.incoming, "b", "prefers a published handover");
  });

  it("creators and reviewers get the creator guidance; the focus is a handover they created", () => {
    const r = resolveGuideRoles([h({ id: "rev", viewerRole: "reviewer", viewerIsCreator: false, updatedAt: T2 }), h({ id: "mine" })]);
    assert.deepEqual(r.roles, ["creator"]);
    assert.equal(r.focus.creator, "mine");
  });

  it("someone on both sides gets both, led by their most recent handover", () => {
    const r = resolveGuideRoles([h({ id: "mine", updatedAt: T1 }), h({ id: "in", viewerRole: "incoming", viewerIsCreator: false, updatedAt: T2 })]);
    assert.deepEqual(r.roles, ["creator", "incoming"]);
    assert.equal(r.primary, "incoming");
    assert.deepEqual(r.focus, { creator: "mine", incoming: "in" });
  });
});
