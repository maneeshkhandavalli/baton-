// R3 Task 02 (PRIV-1): identity-vault cryptography. Synthetic keys and labels only.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { getIdentityMapKey, openLabel, parseIdentityMapKey, personKeyFor, sealLabel } from "../identity-vault";

const HEX = "0f1e2d3c4b5a69788796a5b4c3d2e1f00f1e2d3c4b5a69788796a5b4c3d2e1f0";
const OTHER = "1f1e2d3c4b5a69788796a5b4c3d2e1f00f1e2d3c4b5a69788796a5b4c3d2e1f0";
const H1 = "5a2b3c4d-6e7f-4a81-9b2c-3d4e5f6a7b8c";
const H2 = "7c4d5e6f-8091-4ba3-8c4d-5e6f7a8b9c0d";
const HASH = "ab".repeat(32);

function key(raw = HEX) {
  const k = parseIdentityMapKey(raw, "k1");
  assert.ok(k.ok);
  return k.key;
}

describe("identity map key", () => {
  it("accepts 32 bytes as hex or base64 and refuses anything else, without echoing the value", () => {
    assert.ok(parseIdentityMapKey(HEX, undefined).ok);
    assert.ok(parseIdentityMapKey(Buffer.from(HEX, "hex").toString("base64"), "k1").ok);
    for (const bad of ["abc", HEX.slice(2), HEX + "00", "0".repeat(64), "zz".repeat(32)]) {
      const r = parseIdentityMapKey(bad, "k1");
      assert.equal(r.ok, false, bad);
      assert.equal(JSON.stringify(r).includes(bad), false);
    }
    assert.deepEqual(parseIdentityMapKey("  ", "k1"), { ok: false, reason: "missing" });
    assert.deepEqual(parseIdentityMapKey(HEX, "k9"), { ok: false, reason: "invalid" });
    assert.deepEqual(getIdentityMapKey({}), { ok: false, reason: "missing" });
  });
});

describe("person keys", () => {
  it("are keyed, deterministic, and scoped to one handover (no cross-workspace linkage)", () => {
    const a = personKeyFor(key(), H1, "name", HASH);
    assert.match(a, /^[0-9a-f]{64}$/);
    assert.equal(personKeyFor(key(), H1, "name", HASH), a);
    assert.notEqual(personKeyFor(key(), H2, "name", HASH), a, "another handover");
    assert.notEqual(personKeyFor(key(OTHER), H1, "name", HASH), a, "another server key");
    assert.notEqual(personKeyFor(key(), H1, "phone", HASH), a, "another identity kind");
    assert.notEqual(a, HASH);
  });
});

describe("sealed labels (AES-256-GCM)", () => {
  const pk = () => personKeyFor(key(), H1, "name", HASH);

  it("round-trips, uses a fresh nonce, and the ciphertext holds no plaintext", () => {
    const s1 = sealLabel(key(), H1, pk(), "Ravi Kumar");
    const s2 = sealLabel(key(), H1, pk(), "Ravi Kumar");
    assert.notEqual(s1.sealed, s2.sealed);
    assert.equal(Buffer.from(s1.sealed, "base64").includes(Buffer.from("Ravi")), false);
    assert.equal(openLabel(key(), H1, pk(), s1.sealed, s1.keyVersion), "Ravi Kumar");
    assert.equal(openLabel(key(), H1, pk(), sealLabel(key(), H1, pk(), "रवि कुमार").sealed, "k1"), "रवि कुमार");
  });

  it("fails closed (null, never throws) for a wrong key, handover, person, version or tampered bytes", () => {
    const s = sealLabel(key(), H1, pk(), "Ravi Kumar").sealed;
    assert.equal(openLabel(key(OTHER), H1, pk(), s, "k1"), null);
    assert.equal(openLabel(key(), H2, pk(), s, "k1"), null);
    assert.equal(openLabel(key(), H1, personKeyFor(key(), H1, "name", "cd".repeat(32)), s, "k1"), null);
    assert.equal(openLabel(key(), H1, pk(), s, "k2"), null);
    const t = Buffer.from(s, "base64");
    t[14] ^= 1;
    assert.equal(openLabel(key(), H1, pk(), t.toString("base64"), "k1"), null);
    assert.equal(openLabel(key(), H1, pk(), "AAAA", "k1"), null);
  });
});
