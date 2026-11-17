/**
 * Identity resolution for viewers (Round 3 Task 02, PRIV-1). Stored content carries `[PERSON_n]`
 * placeholders; this returns the names a verified member may see, and nothing else:
 *   1. the verified actor (session, auth.getUser());
 *   2. SQL (`resolve_handover_people`): member of the live handover, and only people who are participants
 *      of a parsed source within the member's clearance; anything else is not_found;
 *   3. decryption on the server with IDENTITY_MAP_KEY. Without a valid key every label is null (fail
 *      closed: the UI shows "Person n").
 * The labels are never logged and never cached across requests. Refresh is off: this is a read.
 */

import type { Result } from "../../contracts/api";
import { handoverIdInput } from "../../contracts/schemas";
import { resolveHandoverPeopleSealed } from "../../db/pipeline";
import { getIdentityMapKey, type IdentityMapKeyResult } from "../../privacy/identity-vault";
import { openPeople } from "../../pipeline/identity";
import { action } from "./run";
import type { ActionDeps } from "./types";

export interface ResolvedPerson {
  ordinal: number;
  /** The masked display label, or null (no usable name, or the key is unavailable). */
  label: string | null;
}

export async function resolveHandoverPeople(
  deps: ActionDeps,
  input: { handoverId: string },
  readKey: () => IdentityMapKeyResult = getIdentityMapKey,
): Promise<Result<ResolvedPerson[]>> {
  return action(
    deps,
    handoverIdInput,
    input,
    async (actor, v) => {
      const sealed = await resolveHandoverPeopleSealed(deps.adminDb(), actor.profileId, v.handoverId);
      const key = readKey();
      const people = openPeople(key.ok ? key.key : null, v.handoverId, sealed);
      return { ok: true, data: people.map((p) => ({ ordinal: p.ordinal, label: p.label })) };
    },
    { refresh: false },
  );
}
