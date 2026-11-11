/**
 * Recovery-manifest gate for participant erasure and handover purge (security fixes H2, N4, N5; §12.8, D27).
 *
 * Erasure and purge are irreversible. §12.8 point 2 requires the event to be written to the external,
 * encrypted recovery manifest — and confirmed by the store — BEFORE the database operation runs, failing
 * closed otherwise. The manifest client is main's future `lib/recovery` module; it does not exist yet.
 *
 * Controls, all fail-closed:
 *   1. Database: erase_participant / purge_handover are granted to NO application role. Nothing in this
 *      file can make them executable; that needs a reviewed migration once lib/recovery exists (D27 open).
 *   2. Receipt binding (N4, R8): a receipt authorises exactly one operation — same event id, kind and
 *      handover, and for an erasure the same identity kind, identity hash, pepper version and scope source
 *      (a NAME erasure is limited to one source; a phone erasure has none). A receipt for participant A can
 *      never authorise erasing participant B, nor a name erasure in another source, so the manifest always
 *      names exactly the person and scope actually erased (§12.8 point 2).
 *   3. Verifier registration (N5): one-shot for the life of the process, with no reset or replacement path
 *      in production code. In-process JavaScript cannot authenticate which module calls it, so the
 *      "only lib/recovery may register" rule is enforced by lib/db/__tests__/boundaries.test.ts, which fails
 *      the build if any file outside lib/recovery/** references `registerManifestReceiptVerifier`.
 *
 * Contract proposed for lib/recovery (§13.3, main to review):
 *   * write the manifest entry, wait for the store's confirmation, return a ManifestReceipt;
 *   * at server start-up call `registerManifestReceiptVerifier(verify)` exactly once, where `verify` proves
 *     the receipt came from a confirmed write (e.g. a MAC over every receipt field with a server-only key,
 *     or a read-back from the store) and does not trust the receipt's own fields.
 */

import type { IdentityKind } from "../contracts/enums";
import { DbError } from "./errors";

export type ManifestEventKind = "participant_erasure" | "handover_purge";

interface ReceiptBase {
  /** The manifest entry's eventId; it becomes participant_erasures.id / the purge event id. */
  readonly eventId: string;
  readonly handoverId: string;
  /** When the store confirmed the write (ISO-8601). */
  readonly recordedAt: string;
  /** Opaque proof produced by lib/recovery (e.g. a MAC over all fields); checked only by the verifier. */
  readonly proof: string;
}

export type ManifestReceipt =
  | (ReceiptBase & {
      readonly kind: "participant_erasure";
      /** Hex HMAC identity hash the manifest entry encrypts (N4). */
      readonly identityHashHex: string;
      /** Identity-pepper version recorded in the entry (§12.8 point 9). */
      readonly pepperVersion: "p1";
      /** R8: the identity namespace of the hash (§12.11). */
      readonly identityKind: IdentityKind;
      /** R8: for a NAME erasure the one source it is limited to; null for phone. */
      readonly scopeSourceId: string | null;
    })
  | (ReceiptBase & { readonly kind: "handover_purge" });

export type ManifestReceiptVerifier = (receipt: ManifestReceipt) => boolean | Promise<boolean>;

let verifier: ManifestReceiptVerifier | null = null;

/** Called exactly once, by lib/recovery, at server start-up. Any second call throws. */
export function registerManifestReceiptVerifier(fn: ManifestReceiptVerifier): void {
  if (typeof fn !== "function") throw new TypeError("verifier must be a function");
  if (verifier !== null) throw new Error("A recovery-manifest verifier is already registered.");
  verifier = fn;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HEX = /^[0-9a-f]+$/i;

export type ExpectedManifestOperation =
  | {
      kind: "participant_erasure";
      eventId: string;
      handoverId: string;
      identityKind: IdentityKind;
      identityHashHex: string;
      pepperVersion: string;
      scopeSourceId: string | null;
    }
  | { kind: "handover_purge"; eventId: string; handoverId: string };

function sameId(a: unknown, b: string): boolean {
  return typeof a === "string" && UUID.test(a) && a.toLowerCase() === b.toLowerCase();
}

/**
 * Throws `DbError("precondition_failed")` unless a verifier is registered AND it accepts a receipt that
 * matches exactly the operation about to run. Never logs the receipt or the identity hash.
 */
export async function assertManifestReceipt(
  receipt: ManifestReceipt | null | undefined,
  expected: ExpectedManifestOperation,
): Promise<void> {
  if (!verifier) throw new DbError("precondition_failed"); // D27 open: no manifest, no erasure or purge
  const fail = () => {
    throw new DbError("precondition_failed");
  };

  if (!receipt || receipt.kind !== expected.kind) fail();
  const r = receipt as ManifestReceipt;
  if (!sameId(r.eventId, expected.eventId) || !sameId(r.handoverId, expected.handoverId)) fail();
  if (typeof r.recordedAt !== "string" || Number.isNaN(Date.parse(r.recordedAt))) fail();
  if (typeof r.proof !== "string" || r.proof.length === 0) fail();

  if (expected.kind === "participant_erasure") {
    if (r.kind !== "participant_erasure") fail();
    const e = r as Extract<ManifestReceipt, { kind: "participant_erasure" }>;
    // N4: bound to the exact identity hash and pepper version being erased.
    if (
      typeof e.identityHashHex !== "string" ||
      !HEX.test(e.identityHashHex) ||
      !HEX.test(expected.identityHashHex) ||
      e.identityHashHex.toLowerCase() !== expected.identityHashHex.toLowerCase() ||
      e.pepperVersion !== expected.pepperVersion
    ) {
      fail();
    }
    // R8: same identity kind and scope source; a name erasure names exactly one source, phone none.
    if (e.identityKind !== expected.identityKind || (e.identityKind !== "phone" && e.identityKind !== "name")) fail();
    if (expected.identityKind === "name") {
      if (expected.scopeSourceId === null || !sameId(e.scopeSourceId, expected.scopeSourceId)) fail();
    } else if (e.scopeSourceId !== null || expected.scopeSourceId !== null) {
      fail();
    }
  } else if ("identityHashHex" in r || "identityKind" in r || "scopeSourceId" in r) {
    fail(); // a purge receipt never carries an identity
  }

  let accepted = false;
  try {
    accepted = (await verifier(r)) === true;
  } catch {
    accepted = false;
  }
  if (!accepted) fail();
}
