/**
 * Mock implementation of the canonical `BatonQueries` read facade (lib/contracts/queries.ts) over the dev mock store.
 *
 * It emulates RLS (§8.4) for a given viewer: hidden rows are simply absent, and fetching one by id
 * returns `not_found` (§8.5). `lib/data` (main) will switch the app from this to `lib/db`.
 * R3 Task 06 (D2): the implementation lives in ./store-queries.ts, parameterised by its store.
 */

import { connection } from "next/server";

import type { BatonQueries } from "@/lib/contracts/queries";

import { activeMember, isReviewRole, profileLabel } from "./derive";
import { getStore, runStages, tickRuns } from "./store";
import { createStoreQueries } from "./store-queries";

export { fail, ok, openCreatorOffer, toHandoverSummary } from "./store-queries";

/** Request-time read: the mock is in-memory, so tell Next not to prerender it (README, Cache Components). */
async function requestTime() {
  await connection();
}

export function createMockQueries(profileId: string): BatonQueries {
  return createStoreQueries(getStore, profileId, { requestTime, tick: tickRuns, stages: runStages });
}

/** The workspace viewer's queries (mock session). */
export function getMockQueries(): BatonQueries {
  return createMockQueries(getStore().viewerId);
}

/**
 * Mock stand-in for `/h/[token]` invite redemption plus the resulting session (§12.3).
 * Returns the handover and the profile the page should read as, or null for an invalid token.
 */
export async function mockRedeemHandoverLink(token: string): Promise<{ handoverId: string; queries: BatonQueries; viewerLabel: string } | null> {
  await requestTime();
  const store = getStore();
  const t = store.tokens.find((x) => x.token === token && x.purpose === "member_invite");
  if (!t || t.revokedAt || !t.sessionProfileId) return null;
  store.readerSessionId = t.sessionProfileId;
  return {
    handoverId: t.handoverId,
    queries: createMockQueries(t.sessionProfileId),
    viewerLabel: profileLabel(store, t.sessionProfileId),
  };
}

/**
 * A `/h/[token]` link for the published view of a handover: the viewer's own redeemed invite, or,
 * for review roles, the incoming member's (a mock "preview as incoming"). There is no in-workspace
 * route for the published view yet (see the handover report).
 */
export async function mockReaderLinkFor(handoverId: string): Promise<string | null> {
  await requestTime();
  const store = getStore();
  const invites = store.tokens.filter((x) => x.handoverId === handoverId && x.purpose === "member_invite" && x.sessionProfileId && !x.revokedAt);
  const own = invites.find((x) => x.sessionProfileId === store.viewerId);
  if (own) return own.token;
  const me = activeMember(store, handoverId, store.viewerId);
  if (!me || !isReviewRole(me.role)) return null;
  return invites.find((x) => x.grantRole === "incoming")?.token ?? null;
}
