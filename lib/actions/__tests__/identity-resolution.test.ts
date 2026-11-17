// R3 Task 02 (PRIV-1): resolving [PERSON_n] for viewers. The clearance check is SQL's (resolve_handover_people,
// tested in tests/integration/db/sql/it21_identity_vault.sql); here: the verified actor, the decryption, and
// fail-closed behaviour. Synthetic data only.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { parseIdentityMapKey, personKeyFor, sealLabel } from "../../privacy/identity-vault";
import { resolveHandoverPeople } from "../core/identity";
import { ACTOR_ID, H, fakeDeps } from "./helpers";

const KEY_HEX = "0f1e2d3c4b5a69788796a5b4c3d2e1f00f1e2d3c4b5a69788796a5b4c3d2e1f0";
const parsed = parseIdentityMapKey(KEY_HEX, "k1");
assert.ok(parsed.ok);
const KEY = parsed.key;
const readKey = () => parseIdentityMapKey(KEY_HEX, "k1");
const PK = personKeyFor(KEY, H, "name", "ab".repeat(32));
const SEALED = [
  { ordinal: 1, personKey: PK, sealed: sealLabel(KEY, H, PK, "Ravi Kumar").sealed, keyVersion: "k1" },
  { ordinal: 2, personKey: "cd".repeat(32), sealed: null, keyVersion: "k1" },
];

describe("resolveHandoverPeople", () => {
  it("asks SQL with the VERIFIED actor (never a client-supplied id) and decrypts on the server", async () => {
    const f = fakeDeps({ rpc: { resolve_handover_people: { data: SEALED } } });
    const r = await resolveHandoverPeople(f.deps, { handoverId: H }, readKey);
    assert.deepEqual(r, { ok: true, data: [{ ordinal: 1, label: "Ravi Kumar" }, { ordinal: 2, label: null }] });
    const call = f.calls.find((c) => c.fn === "resolve_handover_people")!;
    assert.deepEqual(call.args, { p_actor_profile_id: ACTOR_ID, p_handover_id: H });
    assert.equal(call.client, "admin");
    assert.equal(f.refreshes, 0, "a read never refreshes the page");
  });

  it("unauthorised: SQL's not_found is returned as is, with no names", async () => {
    const f = fakeDeps({ rpc: { resolve_handover_people: { error: { code: "BTNF0", message: "handover not found" } } } });
    const r = await resolveHandoverPeople(f.deps, { handoverId: H }, readKey);
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.error.code, "not_found");
  });

  it("signed out: refused before any database call", async () => {
    const f = fakeDeps({ actor: null });
    const r = await resolveHandoverPeople(f.deps, { handoverId: H }, readKey);
    assert.equal(r.ok, false);
    assert.equal(f.calls.length, 0);
  });

  it("without a valid server key every label is null (fail closed: the UI shows Person n)", async () => {
    const f = fakeDeps({ rpc: { resolve_handover_people: { data: SEALED } } });
    const r = await resolveHandoverPeople(f.deps, { handoverId: H }, () => ({ ok: false, reason: "missing" }));
    assert.deepEqual(r, { ok: true, data: [{ ordinal: 1, label: null }, { ordinal: 2, label: null }] });
  });

  it("validates the handover id", async () => {
    const f = fakeDeps();
    const r = await resolveHandoverPeople(f.deps, { handoverId: "not-a-uuid" }, readKey);
    assert.equal(r.ok, false);
    assert.equal(f.calls.length, 0);
  });
});
