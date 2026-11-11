"use server";

/** Account Server Functions (§11.3, §12.9). deleteAccount is fail-closed while D27 is open: lib/actions/core/account.ts. */

import type { Result } from "../contracts/api";
import type { AccountDeletionBlockers } from "../contracts/dto";
import type { DeleteAccountInput } from "../contracts/schemas";
import * as core from "./core/account";
import { actionDeps } from "./deps";

export async function getAccountDeletionBlockers(): Promise<Result<AccountDeletionBlockers>> {
  return core.getAccountDeletionBlockers(actionDeps());
}

export async function deleteAccount(input: DeleteAccountInput): Promise<Result<null>> {
  return core.deleteAccount(actionDeps(), input);
}
