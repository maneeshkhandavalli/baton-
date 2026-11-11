import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { describe, it } from "node:test";

import { IDENTITY_KINDS } from "../enums";
import {
  CURRENT_IDENTITY_PEPPER_VERSION,
  IDENTITY_GOLDEN_TEST_CANARY,
  IDENTITY_GOLDEN_TEST_PEPPER,
  IDENTITY_GOLDEN_VECTORS,
  IDENTITY_HASH_PATTERN,
  IDENTITY_NAMESPACE_PREFIXES,
  IDENTITY_PEPPER_CANARY_MESSAGE,
  MIN_IDENTITY_PEPPER_LENGTH,
  identityKindOfNormalized,
  sameIdentity,
  type IdentityRef,
} from "../identity";

/** The documented derivation (§12.11): UTF-8 key, UTF-8 message, lower-case hex. */
function hmacHex(pepper: string, message: string): string {
  return createHmac("sha256", Buffer.from(pepper, "utf8")).update(Buffer.from(message, "utf8")).digest("hex");
}

describe("identity pepper canary (§12.8 point 9)", () => {
  it("is the HMAC of the fixed canary message under the pepper", () => {
    assert.equal(hmacHex(IDENTITY_GOLDEN_TEST_PEPPER, IDENTITY_PEPPER_CANARY_MESSAGE), IDENTITY_GOLDEN_TEST_CANARY);
  });

  it("uses a canary message outside both identity namespaces", () => {
    assert.equal(identityKindOfNormalized(IDENTITY_PEPPER_CANARY_MESSAGE), null);
  });

  it("uses a golden test pepper that satisfies the pepper rules but is marked as not a secret", () => {
    assert.ok(IDENTITY_GOLDEN_TEST_PEPPER.length >= MIN_IDENTITY_PEPPER_LENGTH);
    assert.equal(IDENTITY_GOLDEN_TEST_PEPPER.trim(), IDENTITY_GOLDEN_TEST_PEPPER);
    assert.match(IDENTITY_GOLDEN_TEST_PEPPER, /NOT-A-SECRET/);
  });

  it("keys the HMAC with the UTF-8 bytes of the pepper string", () => {
    const pepper = "pepper-with-non-ascii-é€-0123456789abcdef";
    const viaString = createHmac("sha256", pepper).update("tel:+919999900001", "utf8").digest("hex");
    assert.equal(hmacHex(pepper, "tel:+919999900001"), viaString);
  });

  it("v1 has exactly one pepper version, p1", () => {
    assert.equal(CURRENT_IDENTITY_PEPPER_VERSION, "p1");
  });
});

describe("identity golden vectors (§12.11)", () => {
  it("covers both identity kinds", () => {
    for (const kind of IDENTITY_KINDS) {
      assert.ok(IDENTITY_GOLDEN_VECTORS.some((v) => v.identityKind === kind), kind);
    }
  });

  for (const v of IDENTITY_GOLDEN_VECTORS) {
    it(`${JSON.stringify(v.raw)} → ${v.normalized} (${v.note})`, () => {
      assert.ok(v.normalized.startsWith(IDENTITY_NAMESPACE_PREFIXES[v.identityKind]));
      assert.equal(identityKindOfNormalized(v.normalized), v.identityKind);
      assert.match(v.hash, IDENTITY_HASH_PATTERN);
      assert.equal(hmacHex(IDENTITY_GOLDEN_TEST_PEPPER, v.normalized), v.hash);
    });
  }

  it("normalizes explicit prefixes to E.164 and never infers +91 for unprefixed numbers", () => {
    for (const v of IDENTITY_GOLDEN_VECTORS.filter((x) => x.identityKind === "phone")) {
      const compact = v.raw.replace(/[^+\p{Nd}]/gu, ""); // digits in any script, and "+"
      const explicit = compact.startsWith("+") || compact.startsWith("00");
      if (explicit) assert.match(v.normalized, /^tel:\+[1-9]\d{6,14}$/, v.raw);
      else assert.match(v.normalized, /^tel:\d{7,15}$/, v.raw);
    }
  });

  it("keeps a local number distinct from the E.164 number it might denote", () => {
    const local = IDENTITY_GOLDEN_VECTORS.find((v) => v.raw === "99999 00001");
    const e164 = IDENTITY_GOLDEN_VECTORS.find((v) => v.raw === "+91 99999 00001");
    assert.ok(local && e164);
    assert.notEqual(local.hash, e164.hash);
  });

  it("is frozen: inputs that must agree produce one hash", () => {
    const same = ["+91 99999 00001", "0091 99999 00001", "+0091 99999 00001", "+91 0 99999 00001"];
    const hashes = new Set(IDENTITY_GOLDEN_VECTORS.filter((v) => same.includes(v.raw)).map((v) => v.hash));
    assert.equal(hashes.size, 1);
  });
});

describe("sameIdentity (§12.11 matching rule)", () => {
  const base: IdentityRef = {
    identityKind: "phone",
    identityHash: "af4742347a119f421b10c4ba9ce402c2bb3c7bc74b7f736718b4c15fffb3f924",
    identityPepperVersion: "p1",
  };

  it("matches when kind, hash and version agree (hash case-insensitive)", () => {
    assert.ok(sameIdentity(base, { ...base }));
    assert.ok(sameIdentity(base, { ...base, identityHash: base.identityHash.toUpperCase() }));
  });

  it("never matches across identity kinds, even with the same hash", () => {
    assert.equal(sameIdentity(base, { ...base, identityKind: "name" }), false);
  });

  it("never matches a different hash or a malformed hash", () => {
    assert.equal(sameIdentity(base, { ...base, identityHash: "0".repeat(64) }), false);
    assert.equal(sameIdentity({ ...base, identityHash: "xyz" }, { ...base, identityHash: "xyz" }), false);
  });
});
