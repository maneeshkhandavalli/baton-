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
import type { DbClient } from "./client";
import { callRpc } from "./rpc";

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

/**
 * Round 4 connectors (docs/round4/connectors-contract.md §5): the actor of a connector FLUSH, which runs without a
 * browser session (scheduled sync or a bot command). It is derived from a LINK ID only, never from a user object:
 * `connector_flush_actor` returns the profile that gave capture consent for that link, and only while the link is
 * not revoked, its installation is active and that profile is still the handover's creator. Every mutation the
 * flush performs re-validates the actor, role and lifecycle in SQL as usual. Never used for invitations
 * (emailConfirmed is false) or for anything other than lib/connectors/source-writer.ts.
 */
export async function getConnectorFlushActor(db: DbClient, linkId: string): Promise<VerifiedActor | null> {
  if (!UUID.test(linkId)) return null;
  const profileId = await callRpc(db, "connector_flush_actor", { p_link_id: linkId }).catch(() => null);
  if (typeof profileId !== "string" || !UUID.test(profileId)) return null;
  return Object.freeze({ profileId: profileId.toLowerCase(), email: null, emailConfirmed: false }) as VerifiedActor;
}
