import type { Metadata } from "next";
import Link from "next/link";
import { KeyRound } from "lucide-react";
import { Suspense } from "react";

import { AccountDeletion, type OutgoingOffer } from "@/components/account/account-deletion";
import { CreatorOffers } from "@/components/account/creator-offers";
import { PageContainer } from "@/components/layout/page-container";
import { ListSkeleton } from "@/components/shared/skeletons";
import { PageHeader } from "@/components/shared/page-header";
import { buttonVariants } from "@/components/ui/button";
import { getAccountDeletionBlockers } from "@/lib/actions/account";
import { getQueries } from "@/lib/data";
import { connection } from "next/server";

export const metadata: Metadata = { title: "Account" };

export default function AccountPage() {
  return (
    <PageContainer width="narrow" className="space-y-8">
      <PageHeader eyebrow="Workspace" title="Account" description="Sign-in methods, creatorship offers and account deletion." />
      <section aria-labelledby="signin-methods" className="flex flex-col gap-4 rounded-xl border border-border bg-card p-5 shadow-soft sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 gap-3">
          <KeyRound aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
          <div className="space-y-1">
            <h2 id="signin-methods" className="type-heading">
              Sign-in methods
            </h2>
            <p className="text-sm text-muted-foreground">
              You can sign in with Google and, once you set one, with your email and password. Both open the same account.
            </p>
          </div>
        </div>
        <Link href="/account/password" className={buttonVariants({ variant: "outline", size: "sm" })}>
          Set or change password
        </Link>
      </section>
      <Suspense fallback={<ListSkeleton label="Loading your account…" rows={2} />}>
        <AccountContent />
      </Suspense>
    </PageContainer>
  );
}

async function AccountContent() {
  await connection(); // session reads check token expiry against the current time (auth-js); request-time only
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
