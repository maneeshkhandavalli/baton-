"use client";

import Link from "next/link";
import { RotateCcw, TriangleAlert } from "lucide-react";

import { Button, buttonVariants } from "@/components/ui/button";

import { EmptyState } from "./empty-state";

interface RouteErrorProps {
  /** Whatever was thrown. Server errors arrive as an Error with a `digest`; client throws may be anything. */
  error: unknown;
  /** Next 16 `retry()`: re-fetches and re-renders the segment. Preferred. */
  retry?: () => void;
  /** Next `reset()`: re-renders without re-fetching. Fallback for boundaries that do not pass `retry` yet. */
  reset?: () => void;
  /** Where "go back" leads, e.g. the dashboard. */
  homeHref: string;
  homeLabel: string;
}

/**
 * Body of an `error.tsx` boundary: says what happened in plain words, offers Retry (re-fetch and re-render the
 * segment) and a safe way out. Never shows the raw error message; the digest helps support.
 */
export function RouteError({ error, retry, reset, homeHref, homeLabel }: RouteErrorProps) {
  const digest = error instanceof Error && "digest" in error && typeof error.digest === "string" ? error.digest : null;
  const tryAgain = retry ?? reset;
  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-12 sm:px-6 lg:py-16">
      <EmptyState
        tone="error"
        icon={<TriangleAlert />}
        title="Something went wrong on this page"
        description={
          <>
            Nothing you saved is lost. Try again, or go back and reopen it.
            {digest && <span className="mt-2 block font-mono text-2xs text-muted-foreground select-text">Reference: {digest}</span>}
          </>
        }
        action={
          <>
            {tryAgain ? (
              <Button onClick={() => tryAgain()}>
                <RotateCcw aria-hidden="true" data-icon="inline-start" />
                Try again
              </Button>
            ) : null}
            <Link href={homeHref} className={buttonVariants({ variant: "outline" })}>
              {homeLabel}
            </Link>
          </>
        }
      />
    </div>
  );
}
