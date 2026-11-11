import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { describe, it } from "node:test";

import {
  CURRENT_IDENTITY_PEPPER_VERSION,
  IDENTITY_GOLDEN_TEST_CANARY,
  IDENTITY_GOLDEN_TEST_PEPPER,
  IDENTITY_GOLDEN_VECTORS,
  IDENTITY_HASH_PATTERN,
  IDENTITY_PEPPER_CANARY_MESSAGE,
  MIN_IDENTITY_PEPPER_LENGTH as CONTRACT_MIN_PEPPER_LENGTH,
  identityKindOfNormalized,
} from "../../contracts/identity";
import { ParserInputError } from "../../parsers/errors";
import {
  IDENTITY_PEPPER_VERSION,
  MIN_IDENTITY_PEPPER_LENGTH,
  assertIdentityPepper,
  computeIdentityHash,
  computeIdentityPepperCanary,
  identityKindOf,
  isPhoneLikeSender,
  normalizeSenderIdentity,
} from "../identity";

const PEPPER = "test-only-pepper-0123456789abcdef0123456789";

describe("identity hashing", () => {
  it("is HMAC-SHA256(pepper, normalized sender) in hex", () => {
    const expected = createHmac("sha256", PEPPER).update("name:asha rao").digest("hex");
    assert.equal(computeIdentityHash("Asha Rao", PEPPER), expected);
    assert.match(expected, /^[0-9a-f]{64}$/);
  });
  it("pepper version is p1", () => {
    assert.equal(IDENTITY_PEPPER_VERSION, "p1");
  });
  it("normalizes case, whitespace, NFKC and invisible marks for names", () => {
    assert.equal(normalizeSenderIdentity("  Asha\u00A0 RAO\u200E "), "name:asha rao");
    assert.equal(computeIdentityHash("asha rao", PEPPER), computeIdentityHash("\u200EAsha  Rao", PEPPER));
  });
  it("normalizes phone senders to digits regardless of formatting", () => {
    assert.equal(normalizeSenderIdentity("\u202A+91 99999-00001\u202C"), "tel:+919999900001");
    assert.equal(computeIdentityHash("+91 99999 00001", PEPPER), computeIdentityHash("+919999900001", PEPPER));
    assert.ok(isPhoneLikeSender("+91 99999 00001"));
    assert.ok(!isPhoneLikeSender("Asha 2"));
  });
  it("different peppers give different hashes", () => {
    assert.notEqual(computeIdentityHash("Asha", PEPPER), computeIdentityHash("Asha", PEPPER + "x"));
  });
  it("fails closed without a usable pepper (no fallback)", () => {
    for (const bad of [undefined, null, "", "short", " " + PEPPER, 42]) {
      assert.throws(() => assertIdentityPepper(bad), ParserInputError);
    }
    assert.throws(() => computeIdentityHash("Asha", ""), ParserInputError);
  });
});

describe("canonical p1 contract (D28–D30, P10): lib/contracts/identity.ts", () => {
  it("uses the contract's version and pepper minimum", () => {
    assert.equal(IDENTITY_PEPPER_VERSION, CURRENT_IDENTITY_PEPPER_VERSION);
    assert.equal(MIN_IDENTITY_PEPPER_LENGTH, CONTRACT_MIN_PEPPER_LENGTH);
  });
  it(`reproduces all ${IDENTITY_GOLDEN_VECTORS.length} golden vectors exactly`, () => {
    assert.equal(IDENTITY_GOLDEN_VECTORS.length, 20);
    for (const v of IDENTITY_GOLDEN_VECTORS) {
      assert.equal(normalizeSenderIdentity(v.raw), v.normalized, `normalized: ${v.note}`);
      assert.equal(identityKindOf(v.raw), v.identityKind, `kind: ${v.note}`);
      assert.equal(computeIdentityHash(v.raw, IDENTITY_GOLDEN_TEST_PEPPER), v.hash, `hash: ${v.note}`);
    }
  });
  it("includes the +91 landline trunk-zero vector (P1)", () => {
    const v = IDENTITY_GOLDEN_VECTORS.find((x) => x.raw === "+91 022 1234 5678");
    assert.ok(v);
    assert.equal(normalizeSenderIdentity(v.raw), "tel:+912212345678");
  });
  it("reproduces the pepper canary", () => {
    assert.equal(computeIdentityPepperCanary(IDENTITY_GOLDEN_TEST_PEPPER), IDENTITY_GOLDEN_TEST_CANARY);
    // The canary message has no namespace prefix, so it can never be a participant identity.
    assert.equal(identityKindOfNormalized(IDENTITY_PEPPER_CANARY_MESSAGE), null);
  });
  it("the canary fails closed with an invalid pepper", () => {
    assert.throws(() => computeIdentityPepperCanary("short"), ParserInputError);
  });
  it("every hash matches the contract's stored form", () => {
    for (const raw of ["Asha", "+91 99999 00001", "99999 00001"]) {
      assert.match(computeIdentityHash(raw, PEPPER), IDENTITY_HASH_PATTERN);
    }
  });
  it("a pepper of exactly 32 characters is accepted; 31 or padded is identity_pepper_invalid", () => {
    assertIdentityPepper("a".repeat(32));
    for (const bad of ["a".repeat(31), " " + "a".repeat(32), "a".repeat(32) + "\n", "\t" + "a".repeat(32)]) {
      assert.throws(
        () => assertIdentityPepper(bad),
        (e: unknown) => e instanceof ParserInputError && e.inputCode === "identity_pepper_invalid" && e.field === "identityPepper",
      );
    }
  });
  it("pepper errors never contain the pepper", () => {
    const pepper = " secret-pepper-value-that-must-not-leak-0123";
    try {
      assertIdentityPepper(pepper);
      assert.fail("expected a failure");
    } catch (e) {
      assert.ok(e instanceof ParserInputError);
      assert.ok(!e.message.includes("secret-pepper"));
      assert.ok(!JSON.stringify(e.failure).includes("secret-pepper"));
    }
  });
});
