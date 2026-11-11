import "server-only";

/**
 * Verified actors (security fixes H1, N1).
 *
 * Every application mutation runs on the server with the service-role client and an explicit actor. The
 * ONLY way to obtain a VerifiedActor is `getVerifiedActor()`: it asks the Supabase Auth server to validate
 * this request's session (`auth.getUser()`, never `getSession()` or a decoded cookie) and builds the actor
 * from the user it returns. There is no exported function that turns an `{ id }` into an actor.
 *
 * The database still re-validates every actor (`_require_actor`: an existing, non-deleted profile and auth
 * user) and its membership, role, clearance and lifecycle permissions.
 */

import { createSupabaseServerClient } from "../supabase/server";
import type { VerifiedActor } from "./actor-rules";

export type { VerifiedActor } from "./actor-rules";
export { canRedeemInvitation } from "./actor-rules";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The actor for this request, or null when signed out or the session is invalid. */
export async function getVerifiedActor(): Promise<VerifiedActor | null> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.getUser();
  const user = data?.user;
  if (error || !user || typeof user.id !== "string" || !UUID.test(user.id)) return null;
  return Object.freeze({
    profileId: user.id.toLowerCase(),
    email: user.email ?? null,
    emailConfirmed: typeof user.email_confirmed_at === "string" && user.email_confirmed_at.length > 0,
  }) as VerifiedActor;
}
