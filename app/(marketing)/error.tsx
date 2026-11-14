"use client";

import { RouteError } from "@/components/shared/route-error";
import { routes } from "@/lib/routes";

export default function MarketingError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <RouteError error={error} reset={reset} homeHref={routes.home} homeLabel="Go to Baton home" />;
}
