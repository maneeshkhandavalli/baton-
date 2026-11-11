import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";

import type { DeleteAccountInput } from "../../contracts/schemas";
import { deleteAccount, deleteHandover, getAccountDeletionBlockers, offerCreatorTransfer, removeMember, respondToCreatorTransfer } from "../actions";
import { CODECELL_ID } from "../fixtures/codecell";
import { LIT_ID, PHOTO_ID } from "../fixtures/others";
import { PROFILES } from "../fixtures/profiles";
import { NS, seedId } from "../ids";
import { createMockQueries } from "../queries";
import { getStore } from "../store";
import { expectError, expectOk, resetStore, signInAs } from "./helpers";

const created = async () => expectOk(await getAccountDeletionBlockers()).createdHandovers;

describe("deleteAccount: typed confirmation (D25, U10)", () => {
  beforeEach(() => resetStore());

  it("rejects the old boolean confirmation on the server", async () => {
    const ids = (await created()).map((h) => h.id);
    const legacy = { confirm: true, purgeHandoverIds: ids } as unknown as DeleteAccountInput;
    const err = expectError(await deleteAccount(legacy), "validation_failed");
    assert.ok(err.fieldErrors?.confirm);
    assert.equal(getStore().viewerId, PROFILES.priya.id, "nothing happened");
  });

  it("rejects anything but the exact, case-sensitive word", async () => {
    const ids = (await created()).map((h) => h.id);
    for (const word of ["delete", "Delete", "DELETE ", " DELETE", "DELET"]) {
      const input = { confirm: word, purgeHandoverIds: ids } as unknown as DeleteAccountInput;
      expectError(await deleteAccount(input), "validation_failed");
    }
    assert.equal(getStore().handovers.find((h) => h.id === CODECELL_ID)?.deletedAt, null);
  });

  it("rejects a purge list that repeats a handover", async () => {
    const ids = (await created()).map((h) => h.id);
    expectError(await deleteAccount({ confirm: "DELETE", purgeHandoverIds: [...ids, ids[0]] }), "validation_failed");
  });

  it("keeps blocking while a created handover is neither transferred nor listed", async () => {
    const err = expectError(await deleteAccount({ confirm: "DELETE", purgeHandoverIds: [] }), "precondition_failed");
    assert.equal(err.details?.blocking, 5);
  });

  it("counts soft-deleted handovers in their grace period as blockers (§12.9 point 2)", async () => {
    expectOk(await deleteHandover({ handoverId: LIT_ID }));
    const list = await created();
    assert.equal(list.find((h) => h.id === LIT_ID)?.deleted, true);
    const notLit = list.filter((h) => h.id !== LIT_ID).map((h) => h.id);
    const err = expectError(await deleteAccount({ confirm: "DELETE", purgeHandoverIds: notLit }), "precondition_failed");
    assert.equal(err.details?.blocking, 1);
  });

  it("refuses to purge a handover the user did not create", async () => {
    const ids = (await created()).map((h) => h.id);
    expectError(await deleteAccount({ confirm: "DELETE", purgeHandoverIds: [...ids, PHOTO_ID] }), "not_found");
  });

  it("deletes with DELETE once every created handover is listed, anonymising the profile", async () => {
    const ids = (await created()).map((h) => h.id);
    expectOk(await deleteAccount({ confirm: "DELETE", purgeHandoverIds: ids }));
    const store = getStore();
    assert.equal(store.profiles.find((p) => p.id === PROFILES.priya.id)?.displayName, "Former member");
    for (const id of ids) assert.ok(store.handovers.find((h) => h.id === id)?.purgedAt);
    assert.notEqual(store.viewerId, PROFILES.priya.id, "signed out");
  });

  it("a transferred handover no longer blocks", async () => {
    // Priya offers CodeCell to Arjun (reviewer); Arjun accepts.
    const arjunMember = getStore().members.find((m) => m.handoverId === CODECELL_ID && m.profileId === PROFILES.arjun.id)!;
    expectOk(await offerCreatorTransfer({ handoverId: CODECELL_ID, toMemberId: arjunMember.id }));
    signInAs(PROFILES.arjun.id);
    expectOk(await respondToCreatorTransfer({ handoverId: CODECELL_ID, accept: true }));
    signInAs(PROFILES.priya.id);
    const list = await created();
    assert.equal(list.length, 4);
    assert.ok(!list.some((h) => h.id === CODECELL_ID));
  });
});

describe("creatorship offers (§12.9, U8)", () => {
  beforeEach(() => resetStore());

  it("lists offers addressed to the signed-in user", async () => {
    const offers = expectOk(await createMockQueries(PROFILES.priya.id).listMyCreatorTransferOffers());
    assert.deepEqual(
      offers.map((o) => [o.handoverId, o.offeredByLabel]),
      [[PHOTO_ID, PROFILES.sana.displayName]],
    );
    assert.deepEqual(expectOk(await createMockQueries(PROFILES.arjun.id).listMyCreatorTransferOffers()), []);
  });

  it("shows pendingCreatorTransfer only to the creator and the offered member", async () => {
    const forPriya = expectOk(await createMockQueries(PROFILES.priya.id).getHandover(PHOTO_ID));
    const forSana = expectOk(await createMockQueries(PROFILES.sana.id).getHandover(PHOTO_ID));
    assert.ok(forPriya.pendingCreatorTransfer);
    assert.deepEqual(forSana.pendingCreatorTransfer, forPriya.pendingCreatorTransfer);
    // Another member of a handover with an offer sees null.
    const arjunMember = getStore().members.find((m) => m.handoverId === CODECELL_ID && m.profileId === PROFILES.arjun.id)!;
    expectOk(await offerCreatorTransfer({ handoverId: CODECELL_ID, toMemberId: arjunMember.id }));
    assert.equal(expectOk(await createMockQueries(PROFILES.kabir.id).getHandover(CODECELL_ID)).pendingCreatorTransfer, null);
    assert.ok(expectOk(await createMockQueries(PROFILES.arjun.id).getHandover(CODECELL_ID)).pendingCreatorTransfer);
  });

  it("accepting makes the offered member the creator and clears the offer", async () => {
    expectOk(await respondToCreatorTransfer({ handoverId: PHOTO_ID, accept: true }));
    const h = expectOk(await createMockQueries(PROFILES.priya.id).getHandover(PHOTO_ID));
    assert.equal(h.viewerIsCreator, true);
    assert.equal(h.pendingCreatorTransfer, null);
    const members = expectOk(await createMockQueries(PROFILES.priya.id).listMembers(PHOTO_ID));
    assert.deepEqual(members.filter((m) => m.isCreator).map((m) => m.displayName), [PROFILES.priya.displayName]);
    assert.deepEqual(expectOk(await createMockQueries(PROFILES.priya.id).listMyCreatorTransferOffers()), []);
  });

  it("declining clears the offer and keeps the creator", async () => {
    expectOk(await respondToCreatorTransfer({ handoverId: PHOTO_ID, accept: false }));
    const h = expectOk(await createMockQueries(PROFILES.sana.id).getHandover(PHOTO_ID));
    assert.equal(h.viewerIsCreator, true);
    assert.equal(h.pendingCreatorTransfer, null);
  });

  it("only the offered member can respond; everyone else gets not_found", async () => {
    signInAs(PROFILES.sana.id);
    expectError(await respondToCreatorTransfer({ handoverId: PHOTO_ID, accept: true }), "not_found");
  });

  it("rejects a self-target with validation_failed and a non-review target with invalid_transition", async () => {
    const priyaMember = getStore().members.find((m) => m.handoverId === CODECELL_ID && m.profileId === PROFILES.priya.id)!;
    expectError(await offerCreatorTransfer({ handoverId: CODECELL_ID, toMemberId: priyaMember.id }), "validation_failed");
    const kabirMember = getStore().members.find((m) => m.handoverId === CODECELL_ID && m.profileId === PROFILES.kabir.id)!;
    expectError(await offerCreatorTransfer({ handoverId: CODECELL_ID, toMemberId: kabirMember.id }), "invalid_transition");
  });

  it("an offer lapses when the offered member is removed", async () => {
    const arjunMember = getStore().members.find((m) => m.handoverId === CODECELL_ID && m.profileId === PROFILES.arjun.id)!;
    expectOk(await offerCreatorTransfer({ handoverId: CODECELL_ID, toMemberId: arjunMember.id }));
    expectOk(await removeMember({ memberId: arjunMember.id }));
    assert.equal(expectOk(await createMockQueries(PROFILES.priya.id).getHandover(CODECELL_ID)).pendingCreatorTransfer, null);
  });

  it("an offer lapses after 14 days", async () => {
    const h = getStore().handovers.find((x) => x.id === PHOTO_ID)!;
    h.pendingCreatorTransfer = { ...h.pendingCreatorTransfer!, offeredAt: new Date(Date.now() - 15 * 86_400_000).toISOString() };
    assert.deepEqual(expectOk(await createMockQueries(PROFILES.priya.id).listMyCreatorTransferOffers()), []);
    expectError(await respondToCreatorTransfer({ handoverId: PHOTO_ID, accept: true }), "not_found");
  });

  it("uses a deterministic member id for the seeded offer", () => {
    assert.equal(getStore().handovers.find((x) => x.id === PHOTO_ID)?.pendingCreatorTransfer?.toMemberId, seedId(NS.member, 200));
  });
});
