import "server-only";

/**
 * Server-side auth helpers (§12.3). Always verify with the Auth server (getUser), never trust a cookie
 * or getSession(). The verified actor for mutations comes only from lib/db/actor.ts (N1).
 */

import { redirect } from "next/navigation";

import { getVerifiedActor } from "../db/actor";
import type { VerifiedActor } from "../db/actor-rules";
import { loginPath } from "./redirects";

export { loginPath, safeNextPath } from "./redirects";
export { getVerifiedActor } from "../db/actor";

export interface SessionUser {
  id: string;
  email: string | null;
}

export async function getSessionUser(): Promise<SessionUser | null> {
  const actor = await getVerifiedActor();
  return actor ? { id: actor.profileId, email: actor.email } : null;
}

/** For protected pages and Server Functions; proxy.ts redirects too, but is not relied on. */
export async function requireSessionUser(nextPath?: string): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) redirect(loginPath(nextPath));
  return user;
}

/** For Server Functions: the verified actor, or null so the action can return `unauthenticated`. */
export async function requireVerifiedActor(): Promise<VerifiedActor | null> {
  return getVerifiedActor();
}
