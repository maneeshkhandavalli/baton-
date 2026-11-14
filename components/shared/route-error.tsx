"use client";

import Link from "next/link";
import { RotateCcw, TriangleAlert } from "lucide-react";

import { Button, buttonVariants } from "@/components/ui/button";

import { EmptyState } from "./empty-state";

interface RouteErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
  /** Where "go back" leads, e.g. the dashboard. */
  homeHref: string;
  homeLabel: string;
}

/**
 * Body of an `error.tsx` boundary: says what happened in plain words, offers Retry (re-render the
 * segment) and a safe way out. Never shows the raw error message; the digest helps support.
 */
export function RouteError({ error, reset, homeHref, homeLabel }: RouteErrorProps) {
  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-12 sm:px-6 lg:py-16">
      <EmptyState
        tone="error"
        icon={<TriangleAlert />}
        title="Something went wrong on this page"
        description={
          <>
            Nothing you saved is lost. Try again, or go back and reopen it.
            {error.digest && <span className="mt-2 block font-mono text-2xs text-muted-foreground">Reference: {error.digest}</span>}
          </>
        }
        action={
          <>
            <Button onClick={reset}>
              <RotateCcw aria-hidden="true" data-icon="inline-start" />
              Try again
            </Button>
            <Link href={homeHref} className={buttonVariants({ variant: "outline" })}>
              {homeLabel}
            </Link>
          </>
        }
      />
    </div>
  );
}
