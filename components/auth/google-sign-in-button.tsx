"use client";

/**
 * "Continue with Google" (Supabase OAuth). The server action returns Supabase's authorize URL (checked to be
 * our own project) and the browser goes there; the return trip lands on /auth/callback. Handles the loading
 * state, a failed start (message shown inline) and the visitor coming back with the browser's Back button
 * (the page is restored from the back-forward cache, so the busy state is reset).
 */

import { Loader2 } from "lucide-react";
import { useEffect, useRef, useState, useTransition } from "react";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { canonicalRestartUrl, type GoogleStartResult } from "@/lib/supabase/oauth-core";
import { cn } from "@/lib/utils";

interface GoogleSignInButtonProps {
  /** Server action that starts the sign-in (login page or invitation). */
  start: () => Promise<GoogleStartResult>;
  label?: string;
  className?: string;
  /** Start immediately on mount: the visitor already chose Google on another address (`?continue=google`). */
  autoStart?: boolean;
  /**
   * The trusted site origin (BATON_SITE_URL), passed by the server page. When this page is open on a different
   * address (a deployment URL, 127.0.0.1…), the visitor is first moved to the same page on the site origin: the
   * PKCE verifier cookie must live on the callback's host or the code exchange can never succeed. Compared in
   * the browser so the server never reads the Host header (audit M1).
   */
  siteOrigin?: string | null;
}

export function GoogleSignInButton({ start, label = "Continue with Google", className, autoStart = false, siteOrigin = null }: GoogleSignInButtonProps) {
  const [pending, startTransition] = useTransition();
  const [redirecting, setRedirecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const reset = (e: PageTransitionEvent) => {
      if (e.persisted) setRedirecting(false);
    };
    window.addEventListener("pageshow", reset);
    return () => window.removeEventListener("pageshow", reset);
  }, []);

  const busy = pending || redirecting;
  const autoStarted = useRef(false);
  useEffect(() => {
    if (!autoStart || autoStarted.current) return;
    autoStarted.current = true;
    const t = window.setTimeout(onClick, 0);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run once for the continued sign-in
  }, [autoStart]);

  function onClick() {
    setError(null);
    const restart = siteOrigin ? canonicalRestartUrl(window.location.host, siteOrigin, window.location.pathname + window.location.search) : null;
    if (restart) {
      setRedirecting(true);
      window.location.assign(restart);
      return;
    }
    startTransition(async () => {
      let result: GoogleStartResult;
      try {
        result = await start();
      } catch {
        result = { status: "error", message: "We couldn't reach Baton. Check your connection and try again." };
      }
      if (result.status === "redirect") {
        setRedirecting(true);
        window.location.assign(result.url);
      } else {
        setError(result.message);
      }
    });
  }

  return (
    <div className={cn("space-y-3", className)}>
      <Button type="button" size="lg" variant="outline" className="w-full gap-3 bg-card text-foreground" onClick={onClick} disabled={busy} aria-busy={busy}>
        {busy ? <Loader2 aria-hidden="true" className="size-4 animate-spin" /> : <GoogleMark />}
        {busy ? "Opening Google…" : label}
      </Button>
      {error ? (
        <Alert tone="danger">
          {error}
        </Alert>
      ) : null}
    </div>
  );
}

/** Google's "G" mark, as Google's sign-in branding guidelines require next to "Continue with Google". */
function GoogleMark() {
  return (
    <svg aria-hidden="true" viewBox="0 0 48 48" className="size-[18px] shrink-0">
      <path fill="#FFC107" d="M43.611 20.083H42V20H24v8h11.303c-1.649 4.657-6.08 8-11.303 8-6.627 0-12-5.373-12-12s5.373-12 12-12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 12.955 4 4 12.955 4 24s8.955 20 20 20 20-8.955 20-20c0-1.341-.138-2.65-.389-3.917z" />
      <path fill="#FF3D00" d="M6.306 14.691l6.571 4.819C14.655 15.108 18.961 12 24 12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 16.318 4 9.656 8.337 6.306 14.691z" />
      <path fill="#4CAF50" d="M24 44c5.166 0 9.86-1.977 13.409-5.192l-6.19-5.238A11.91 11.91 0 0124 36c-5.202 0-9.619-3.317-11.283-7.946l-6.522 5.025C9.505 39.556 16.227 44 24 44z" />
      <path fill="#1976D2" d="M43.611 20.083H42V20H24v8h11.303a12.04 12.04 0 01-4.087 5.571l.003-.002 6.19 5.238C36.971 39.205 44 34 44 24c0-1.341-.138-2.65-.389-3.917z" />
    </svg>
  );
}
