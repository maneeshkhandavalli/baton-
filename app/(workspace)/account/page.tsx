import type { Metadata } from "next";
import { Suspense } from "react";

import { AccountDeletion, type OutgoingOffer } from "@/components/account/account-deletion";
import { CreatorOffers } from "@/components/account/creator-offers";
import { PageContainer } from "@/components/layout/page-container";
import { LoadingState } from "@/components/shared/loading-state";
import { PageHeader } from "@/components/shared/page-header";
import { getAccountDeletionBlockers } from "@/lib/actions/account";
import { getQueries } from "@/lib/data";

export const metadata: Metadata = { title: "Account" };

export default function AccountPage() {
  return (
    <PageContainer width="narrow" className="space-y-8">
      <PageHeader eyebrow="Workspace" title="Account" description="Creatorship offers and account deletion." />
      <Suspense fallback={<LoadingState label="Loading your account…" />}>
        <AccountContent />
      </Suspense>
    </PageContainer>
  );
}

async function AccountContent() {
  const queries = getQueries(); // per-request: everything here depends on the signed-in user
  const [offers, handovers] = await Promise.all([queries.listMyCreatorTransferOffers(), queries.listMyHandovers()]);
  const blockers = await getAccountDeletionBlockers();

  // Offers the viewer has made on handovers they created, so the deletion list can say "waiting for X".
  const outgoing: Record<string, OutgoingOffer> = {};
  if (handovers.ok) {
    await Promise.all(
      handovers.data
        .filter((h) => h.viewerIsCreator && h.pendingCreatorTransfer)
        .map(async (h) => {
          const members = await queries.listMembers(h.id);
          const to = members.ok ? members.data.find((m) => m.id === h.pendingCreatorTransfer!.toMemberId) : undefined;
          outgoing[h.id] = { toLabel: to?.displayName ?? "a member", offeredAt: h.pendingCreatorTransfer!.offeredAt };
        }),
    );
  }

  return (
    <div className="space-y-6">
      {offers.ok ? (
        <CreatorOffers offers={offers.data} />
      ) : (
        <p className="text-sm text-muted-foreground">Creatorship offers couldn&rsquo;t be loaded: {offers.error.message}</p>
      )}
      {blockers.ok ? (
        <AccountDeletion blockers={blockers.data} offers={outgoing} />
      ) : (
        <p className="text-sm text-muted-foreground">Account deletion couldn&rsquo;t be loaded: {blockers.error.message}</p>
      )}
    </div>
  );
}
