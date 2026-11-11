/**
 * The account-deletion request the UI may send (§12.9, D25). The prompt is only a safeguard: the
 * server validates `confirm` again with `deleteAccountInput`. The UI sends the word the user actually
 * typed, and nothing at all unless it is exactly `DELETE` (case-sensitive, no trimming).
 */

import { ACCOUNT_DELETION_CONFIRMATION, type DeleteAccountInput } from "@/lib/contracts/schemas";

export function accountDeletionRequest(typed: string, purgeHandoverIds: readonly string[]): DeleteAccountInput | null {
  if (typed !== ACCOUNT_DELETION_CONFIRMATION) return null;
  return { confirm: typed, purgeHandoverIds: [...new Set(purgeHandoverIds)] };
}
