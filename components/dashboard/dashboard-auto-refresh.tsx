"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** How often the dashboard re-reads its data while a handover is processing (Round 4 audit F10). */
export const DASHBOARD_REFRESH_MS = 10_000;

/**
 * Keeps the dashboard's processing status current: while `active` (some handover is processing), it re-renders the
 * server data on an interval and when the tab becomes visible again. Renders nothing.
 */
export function DashboardAutoRefresh({ active }: { active: boolean }) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    const tick = () => {
      if (document.visibilityState === "visible") router.refresh();
    };
    const t = setInterval(tick, DASHBOARD_REFRESH_MS);
    document.addEventListener("visibilitychange", tick);
    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [active, router]);
  return null;
}
