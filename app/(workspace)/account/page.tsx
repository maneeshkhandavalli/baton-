import type { Metadata } from "next";
import { Suspense } from "react";

import { AccountDeletion, type OutgoingOffer } from "@/components/account/account-deletion";
import { AccountDetails } from "@/components/account/account-details";
import { CreatorOffers } from "@/components/account/creator-offers";
import { PageContainer } from "@/components/layout/page-container";
import { ListSkeleton } from "@/components/shared/skeletons";
import { PageHeader } from "@/components/shared/page-header";
import { getAccountDeletionBlockers } from "@/lib/actions/account";
import { getQueries } from "@/lib/data";
import { getAccountOverview } from "@/lib/supabase/account-auth";
import { connection } from "next/server";

export const metadata: Metadata = { title: "Account" };

export default function AccountPage() {
  return (
    <PageContainer width="narrow" className="space-y-8">
      <PageHeader eyebrow="Workspace" title="Account" description="Your sign-in details, creatorship offers and account deletion." />
      <Suspense fallback={<ListSkeleton label="Loading your account…" rows={3} />}>
        <AccountContent />
      </Suspense>
    </PageContainer>
  );
}

async function AccountContent() {
  await connection(); // session reads check token expiry against the current time (auth-js); request-time only
  const queries = getQueries(); // per-request: everything here depends on the signed-in user
  const [offers, handovers, overview] = await Promise.all([queries.listMyCreatorTransferOffers(), queries.listMyHandovers(), getAccountOverview()]);
  const blockers = await getAccountDeletionBlockers();
  const counts = handovers.ok
    ? { created: handovers.data.filter((h) => h.viewerIsCreator).length, memberOf: handovers.data.filter((h) => !h.viewerIsCreator).length }
    : null;

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
      {overview ? (
        <AccountDetails overview={overview} handovers={counts} />
      ) : (
        <p className="text-sm text-muted-foreground">Your account details couldn&rsquo;t be loaded. Try signing in again.</p>
      )}
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
