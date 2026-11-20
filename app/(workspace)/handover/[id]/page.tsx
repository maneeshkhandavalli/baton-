import { notFound, redirect } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";

import { DocumentSkeleton } from "@/components/shared/skeletons";
import { getQueries } from "@/lib/data";
import { REVIEW_MEMBER_ROLES } from "@/lib/contracts/enums";
import { routes } from "@/lib/routes";

/**
 * /handover/<id> with no tab: Published when there is a current publication, otherwise Review for review roles
 * (the same roles the tabs use, config/handover-navigation.ts), otherwise Published (which explains it is not
 * published yet). Invisible and unknown handovers are a 404, as on every tab.
 */
export default function HandoverIndexPage({ params }: PageProps<"/handover/[id]">) {
  return (
    <Suspense fallback={<DocumentSkeleton />}>
      <RedirectToTab params={params} />
    </Suspense>
  );
}

async function RedirectToTab({ params }: { params: Promise<{ id: string }> }): Promise<never> {
  const { id } = await params;
  await connection(); // session reads check token expiry against the current time (auth-js); request-time only
  const handover = await getQueries().getHandover(id);
  if (!handover.ok) notFound();
  const { currentPublicationId, viewerRole } = handover.data;
  if (!currentPublicationId && (REVIEW_MEMBER_ROLES as readonly string[]).includes(viewerRole)) redirect(routes.handover.review(id));
  redirect(routes.handover.published(id));
}
