"use client";

import { RouteError } from "@/components/shared/route-error";
import { routes } from "@/lib/routes";

/** Error boundary for sign-in (QA-R3-15). Never shows the raw error message. */
export default function AuthError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <RouteError error={error} reset={reset} homeHref={routes.home} homeLabel="Go to Baton home" />;
}
