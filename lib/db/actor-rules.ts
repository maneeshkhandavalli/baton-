/**
 * The VerifiedActor type and rules that apply to it (pure; safe to import from tests and lib/db modules).
 *
 * A VerifiedActor can only be CREATED in lib/db/actor.ts (server-only), from the user the Supabase Auth
 * server returns for the current request's session. Nothing exported anywhere accepts an arbitrary
 * `{ id }` object. lib/db/__tests__/boundaries.test.ts fails the build if any non-test module outside
 * lib/db/actor.ts casts a value to VerifiedActor.
 */

declare const verifiedActorBrand: unique symbol;

export interface VerifiedActor {
  readonly profileId: string;
  readonly email: string | null;
  readonly emailConfirmed: boolean;
  readonly [verifiedActorBrand]: true;
}

/**
 * H3: an invitation may only be redeemed by an actor whose email address is confirmed. The database
 * enforces the same rule from auth.users; this matching check refuses before any database call.
 */
export function canRedeemInvitation(actor: VerifiedActor | null): actor is VerifiedActor {
  return actor !== null && actor.emailConfirmed && typeof actor.email === "string" && actor.email.length > 0;
}
