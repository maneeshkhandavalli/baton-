import { connection } from "next/server";

import { getQueries } from "@/lib/data";

import { HandoverNav } from "./handover-nav";

/** R3 Task 06: the handover tabs for the signed-in viewer's role (server side; the client nav does the rest). */
export async function HandoverNavForViewer({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await connection(); // session reads check token expiry against the current time (auth-js); request-time only
  const handover = await getQueries().getHandover(id);
  return <HandoverNav viewerRole={handover.ok ? handover.data.viewerRole : null} />;
}
