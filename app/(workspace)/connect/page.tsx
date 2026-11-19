import type { Metadata } from "next";
import { connection } from "next/server";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { ConnectIntent } from "@/components/connectors/connect-intent";
import { PageContainer } from "@/components/layout/page-container";
import { FormSkeleton } from "@/components/shared/skeletons";
import { getVerifiedActor } from "@/lib/db/actor";
import { loginPath } from "@/lib/supabase/redirects";

export const metadata: Metadata = { title: "Connect a channel" };

/**
 * /connect?intent=<signed> (Round 4, Worker 03): opened from the link a bot posts for `/handover`. Signed in only;
 * the creator picks one of their handovers, then confirms capture consent. Opening the link changes nothing.
 */
export default function ConnectPage({ searchParams }: PageProps<"/connect">) {
  return (
    <PageContainer width="narrow" className="lg:py-8">
      <Suspense fallback={<FormSkeleton label="Loading…" fields={2} />}>
        <ConnectContent searchParams={searchParams} />
      </Suspense>
    </PageContainer>
  );
}

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? null;

async function ConnectContent({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await connection();
  const params = await searchParams;
  const intent = first(params.intent);
  const actor = await getVerifiedActor();
  if (!actor) {
    const q = new URLSearchParams();
    for (const k of ["intent", "connector", "status"]) {
      const v = first(params[k]);
      if (v) q.set(k, v);
    }
    redirect(loginPath(`/connect${q.size ? `?${q}` : ""}`));
  }
  return <ConnectIntent intent={intent && intent.length <= 4096 ? intent : null} connector={first(params.connector)} status={first(params.status)} />;
}
