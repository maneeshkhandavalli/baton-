/**
 * Account deletion (§12.9, D25, D26, D27).
 *
 * `deleteAccount` is FULLY fail-closed (I3 amendment 4): account erasure and the immediate purge it may need
 * both depend on the recovery manifest (D27, open). After validation (the typed word "DELETE" is checked
 * here, D25) and the verified actor it refuses with precondition_failed before ANY database call or write.
 * `getAccountDeletionBlockers` is a read and keeps working.
 */

import type { Result } from "../../contracts/api";
import type { AccountDeletionBlockers } from "../../contracts/dto";
import { deleteAccountInput } from "../../contracts/schemas";
import type { DeleteAccountInput } from "../../contracts/schemas";
import * as mutations from "../../db/mutations";
import { RECOVERY_MANIFEST_UNAVAILABLE } from "./privacy";
import { action, failWith, ok, withActor } from "./run";
import type { ActionDeps } from "./types";

/** The caller's own created handovers that have not been purged, read under RLS. */
export async function getAccountDeletionBlockers(deps: ActionDeps): Promise<Result<AccountDeletionBlockers>> {
  return withActor(
    deps,
    async () => {
      const rows = await mutations.getAccountDeletionBlockers(await deps.userDb());
      if (!Array.isArray(rows)) return failWith("internal");
      return ok({
        createdHandovers: rows.map((r) => ({ id: String(r.id), title: String(r.title), deleted: r.deleted === true })),
      });
    },
    { refresh: false },
  );
}

export async function deleteAccount(deps: ActionDeps, input: DeleteAccountInput): Promise<Result<null>> {
  return action(deps, deleteAccountInput, input, async () =>
    failWith("precondition_failed", {
      message: "Account deletion isn't available yet. Nothing was changed.",
      details: { reason: RECOVERY_MANIFEST_UNAVAILABLE },
    }),
  );
}
