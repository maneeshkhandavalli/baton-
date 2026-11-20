/**
 * Account deletion (§12.9, D25, D26; D27 narrowed by decision 2026-11-14, migration 20261114100100).
 *
 * deleteAccount, for the verified actor only (the identity comes from auth.getUser(), never from the input):
 *   1. validate: the typed word is exactly "DELETE" and each listed handover appears once (deleteAccountInput);
 *   2. check_account_deletion (read-only): every listed handover was created by the actor, and every handover
 *      the actor still created (soft-deleted ones too) is listed. Nothing has changed yet;
 *   3. remove every Storage object under raw/{handover}/ for the listed handovers. A failure stops here, with
 *      the database untouched (raw uploads are transient, and these handovers are being deleted anyway);
 *   4. delete_own_account: ONE transaction purges the listed handovers (runs, jobs, sources, points,
 *      publications cascade) and anonymises the account (memberships ended, tokens revoked, "Former member",
 *      audit row). Any failure rolls it all back;
 *   5. sweep the same Storage folders again for uploads that finished late; anything left is logged;
 *   6. soft-delete the auth user (retried), then end this browser's session.
 * If step 6 fails, the data is already gone and the user is told to try again: the retry finds no live profile
 * for a session the Auth server still accepts, and finishes step 6 only.
 * Handovers the actor did not create are never purged; only the actor's membership of them ends.
 */

import type { Result } from "../../contracts/api";
import type { AccountDeletionBlockers } from "../../contracts/dto";
import { deleteAccountInput } from "../../contracts/schemas";
import type { DeleteAccountInput } from "../../contracts/schemas";
import type { VerifiedActor } from "../../db/actor-rules";
import { isDbError } from "../../db/errors";
import * as mutations from "../../db/mutations";
import { removeHandoverRawPrefix } from "../../db/storage";
import { refuseDemoAccount } from "./demo-guard";
import { action, failWith, ok, withActor } from "./run";
import type { ActionDeps } from "./types";

export const DELETION_STORAGE_FAILED_MESSAGE =
  "We couldn't remove the uploaded files of the handovers you chose to delete, so nothing else was deleted. Please try again.";
export const DELETION_AUTH_FAILED_MESSAGE =
  "Your Baton data was deleted, but we couldn't finish closing your sign-in. Please try again in a minute.";

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
  return action(
    deps,
    deleteAccountInput,
    input,
    async (actor, request) => {
      const demo = refuseDemoAccount(actor); // shared demo accounts can't be deleted (lib/demo-accounts.ts)
      if (demo) return demo;
      const db = deps.adminDb();

      let purgeIds: string[];
      try {
        purgeIds = await mutations.checkAccountDeletion(db, actor, request);
      } catch (error) {
        // The Auth server accepted this session, but the database has no live profile for it: an earlier
        // deletion removed the data and failed only at the auth step. Finish that step.
        if (isDbError(error) && error.code === "unauthenticated") return finishAuthDeletion(deps, actor);
        throw error;
      }

      for (const handoverId of purgeIds) {
        try {
          await removeHandoverRawPrefix(deps.adminStorage(), handoverId);
        } catch {
          return failWith("internal", { message: DELETION_STORAGE_FAILED_MESSAGE, retryable: true, details: { step: "storage" } });
        }
      }

      await mutations.deleteOwnAccount(db, actor, request);

      for (const handoverId of purgeIds) {
        try {
          await removeHandoverRawPrefix(deps.adminStorage(), handoverId);
        } catch {
          deps.logIssue("raw uploads may remain after a purge", { handoverId });
        }
      }

      return finishAuthDeletion(deps, actor);
    },
    { refresh: false },
  );
}

async function finishAuthDeletion(deps: ActionDeps, actor: VerifiedActor): Promise<Result<null>> {
  try {
    await deps.accountAuth.softDeleteUser(actor.profileId);
  } catch {
    deps.logIssue("auth user not deleted after the data was", { profileId: actor.profileId });
    return failWith("internal", { message: DELETION_AUTH_FAILED_MESSAGE, retryable: true, details: { step: "auth" } });
  }
  await deps.accountAuth.endSession();
  return ok(null);
}
