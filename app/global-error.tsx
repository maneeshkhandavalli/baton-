"use client";

import { fontVariables } from "@/lib/fonts";

import "./globals.css";

/**
 * Last-resort boundary when the root layout itself fails (QA-R3-15). It replaces the whole
 * document, so it renders its own <html>/<body> and loads the tokens itself. It never shows the
 * raw error message; the digest is a support reference only.
 */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en" className={`${fontVariables} h-full`}>
      <body className="min-h-full bg-background font-sans text-foreground">
        <main id="main" className="flex min-h-dvh flex-col items-center justify-center px-4 py-16 text-center">
          <p className="type-eyebrow text-muted-foreground">Baton</p>
          <h1 className="mt-3 type-page-title">Something went wrong</h1>
          <p className="mt-3 max-w-md type-body text-muted-foreground">
            Baton couldn&rsquo;t load this page. Nothing you saved is lost. Try again, or go back to the start.
          </p>
          {error.digest && <p className="mt-3 font-mono text-2xs text-muted-foreground">Reference: {error.digest}</p>}
          <div className="mt-8 flex flex-wrap justify-center gap-2">
            <button
              type="button"
              onClick={reset}
              className="inline-flex h-10 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground shadow-xs transition-colors outline-none hover:bg-primary-hover focus-visible:ring-3 focus-visible:ring-ring/40"
            >
              Try again
            </button>
            {/* A plain anchor: the router may be the thing that failed. */}
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- full reload is intended here */}
            <a
              href="/"
              className="inline-flex h-10 items-center rounded-md border border-border-strong bg-card px-4 text-sm font-medium shadow-xs transition-colors outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/40"
            >
              Baton home
            </a>
          </div>
        </main>
      </body>
    </html>
  );
}
