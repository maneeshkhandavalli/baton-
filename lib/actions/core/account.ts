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
 * Revocation (audit 3.9a, S7):
 *   - before step 4, the live connector installations the actor connected are listed and their per-installation
 *     credentials (Slack bot token) are read into memory; nothing is revoked yet, so a refused or failed
 *     deletion leaves every connection working;
 *   - after step 4 committed (its trigger already deleted the credentials, links and buffered messages locally),
 *     each installation is revoked AT THE PROVIDER with the existing adapter (Slack auth.revoke, Discord leave
 *     guild, Telegram leave chat, GitHub nothing), best effort, each bounded by a timeout. A failure never blocks
 *     the deletion; it is logged with the provider, a short installation reference and an error class only;
 *   - after the auth user is soft-deleted, every session of the account on every device is ended
 *     (revoke_deleted_account_sessions: refresh tokens and sessions), then this browser's cookies.
 * If step 6 fails, the data is already gone and the user is told to try again: the retry finds no live profile
 * for a session the Auth server still accepts, and finishes step 6 only.
 * Handovers the actor did not create are never purged; only the actor's membership of them ends.
 */

import type { Result } from "../../contracts/api";
import type { AccountDeletionBlockers } from "../../contracts/dto";
import { deleteAccountInput } from "../../contracts/schemas";
import type { DeleteAccountInput } from "../../contracts/schemas";
import type { InstallationRecord } from "../../connectors/types";
import type { VerifiedActor } from "../../db/actor-rules";
import { isDbError } from "../../db/errors";
import * as mutations from "../../db/mutations";
import { removeHandoverRawPrefix } from "../../db/storage";
import type { ConnectorDeps } from "./connectors";
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

/** The connector side of account deletion: the existing store and provider adapters (lib/connectors). */
export type AccountConnectorDeps = Pick<ConnectorDeps, "store" | "adapter" | "adapterContext"> & {
  /** Per provider call; PROVIDER_REVOKE_TIMEOUT_MS when absent (tests pass a short one). */
  revokeTimeoutMs?: number;
};

/** Upper bound for one provider call during deletion; the deletion never waits longer than this per connection. */
export const PROVIDER_REVOKE_TIMEOUT_MS = 8_000;

export async function deleteAccount(deps: ActionDeps, input: DeleteAccountInput, connectors?: AccountConnectorDeps): Promise<Result<null>> {
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

      // Read what is needed to revoke at the provider BEFORE the purge deletes the credentials. Nothing is revoked yet.
      const pending = connectors ? await prepareProviderRevocations(deps, connectors, actor.profileId) : [];

      await mutations.deleteOwnAccount(db, actor, request);

      if (connectors) await revokeAtProviders(deps, connectors, pending);

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
  await revokeAllSessions(deps, actor.profileId);
  await deps.accountAuth.endSession();
  return ok(null);
}

/** Ends the account's sessions on every device (refresh tokens and sessions). Logged, never thrown: the data is gone. */
async function revokeAllSessions(deps: ActionDeps, profileId: string): Promise<void> {
  try {
    const { error } = await deps.adminDb().rpc("revoke_deleted_account_sessions", { p_actor_profile_id: profileId });
    if (error) deps.logIssue("sessions on other devices not revoked", { profileId, error: errorClass(error) });
  } catch (error) {
    deps.logIssue("sessions on other devices not revoked", { profileId, error: errorClass(error) });
  }
}

interface PendingRevocation {
  installation: InstallationRecord;
  credentials: string | null;
}

/**
 * The actor's live installations and, for each, its decrypted per-installation credentials (null when it has none or
 * they cannot be read). Read-only. A failure here is logged and never stops the deletion: the purge still deletes
 * the credentials locally.
 */
async function prepareProviderRevocations(deps: ActionDeps, c: AccountConnectorDeps, profileId: string): Promise<PendingRevocation[]> {
  let installations: InstallationRecord[];
  try {
    installations = (await withTimeout(c.store().listInstallationsForProfile(profileId), timeoutOf(c))).filter(
      (i) => i.status !== "revoked" && i.installedByProfileId === profileId,
    );
  } catch (error) {
    deps.logIssue("connector installations not listed before account deletion", { error: errorClass(error) });
    return [];
  }
  const ctx = c.adapterContext();
  return Promise.all(
    installations.map(async (installation) => {
      let credentials: string | null = null;
      if (installation.hasCredentials) {
        try {
          credentials = await withTimeout(ctx.credentials(installation), timeoutOf(c));
        } catch (error) {
          deps.logIssue("connector credentials not readable before account deletion", {
            provider: installation.provider,
            installation: shortRef(installation.id),
            error: errorClass(error),
          });
        }
      }
      return { installation, credentials };
    }),
  );
}

/**
 * Revokes each prepared installation at its provider, in parallel, each bounded by PROVIDER_REVOKE_TIMEOUT_MS. The
 * adapters read credentials through the context, so the context serves the copies read before the purge. Failures
 * are logged (provider, short reference, error class); no token, email or name is ever logged.
 */
async function revokeAtProviders(deps: ActionDeps, c: AccountConnectorDeps, pending: PendingRevocation[]): Promise<void> {
  if (pending.length === 0) return;
  const held = new Map(pending.map((p) => [p.installation.id, p.credentials]));
  try {
    const ctx = { ...c.adapterContext(), credentials: async (i: InstallationRecord) => held.get(i.id) ?? null };
    await Promise.all(
      pending.map(async ({ installation }) => {
        try {
          const adapter = await c.adapter(installation.provider);
          if (!adapter.revokeAtProvider) return;
          await withTimeout(adapter.revokeAtProvider(ctx, installation), timeoutOf(c));
        } catch (error) {
          deps.logIssue("connector not revoked at the provider after account deletion", {
            provider: installation.provider,
            installation: shortRef(installation.id),
            error: errorClass(error),
          });
        }
      }),
    );
  } finally {
    held.clear();
  }
}

function timeoutOf(c: AccountConnectorDeps): number {
  return c.revokeTimeoutMs && c.revokeTimeoutMs > 0 ? c.revokeTimeoutMs : PROVIDER_REVOKE_TIMEOUT_MS;
}

class RevocationTimeout extends Error {
  constructor() {
    super("timeout");
    this.name = "RevocationTimeout";
  }
}

function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new RevocationTimeout()), ms);
  });
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
}

/** The first 8 characters of an id: enough to find the row in the database, never a secret. */
function shortRef(id: string): string {
  return id.slice(0, 8);
}

/** A safe error class for logs: a provider or database code, "timeout", or the error's name. Never a message. */
function errorClass(error: unknown): string {
  if (error instanceof RevocationTimeout) return "timeout";
  if (error && typeof error === "object") {
    const code = (error as { code?: unknown }).code;
    if (typeof code === "string" && /^[A-Za-z0-9_.-]{1,40}$/.test(code)) return code;
    const name = (error as { name?: unknown }).name;
    if (typeof name === "string" && /^[A-Za-z0-9_]{1,40}$/.test(name)) return name;
  }
  return "unknown";
}
