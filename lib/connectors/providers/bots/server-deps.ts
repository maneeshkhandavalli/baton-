import "server-only";

/** Real dependencies for the bot connector routes (Worker 03): the database store, real fetch, the verified session. */

import { getVerifiedActor } from "../../../db/actor";
import { adapterContext } from "../../server";
import type { BotRouteDeps } from "./shared";

export function botRouteDeps(): BotRouteDeps {
  return {
    ...adapterContext(),
    async getActor() {
      const actor = await getVerifiedActor();
      return actor ? { profileId: actor.profileId, email: actor.email } : null; // email: F3 demo-account check only
    },
  };
}
