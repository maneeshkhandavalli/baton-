import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { deleteAccountInput } from "../../../lib/contracts/schemas";
import { accountDeletionRequest } from "../../account/deletion-confirmation";

describe("account deletion request (D25, U10)", () => {
  it("sends nothing unless the user typed exactly DELETE", () => {
    for (const typed of ["", "delete", "Delete", "DELETE ", " DELETE", "DELET", "DELETED", "true"]) {
      assert.equal(accountDeletionRequest(typed, ["a"]), null, JSON.stringify(typed));
    }
  });

  it("sends the typed word, never a boolean, and the schema accepts it", () => {
    const ids = ["00000000-0000-4000-8000-000000000001"];
    const req = accountDeletionRequest("DELETE", ids);
    assert.deepEqual(req, { confirm: "DELETE", purgeHandoverIds: ids });
    assert.notEqual(typeof req?.confirm, "boolean");
    assert.ok(deleteAccountInput.safeParse(req).success);
  });

  it("lists each handover once", () => {
    const id = "00000000-0000-4000-8000-000000000001";
    assert.deepEqual(accountDeletionRequest("DELETE", [id, id])?.purgeHandoverIds, [id]);
  });
});
