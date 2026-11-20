"use client";

/**
 * Sign-in: "Continue with Google" (Supabase OAuth) or "Continue with email and password" (Supabase password auth).
 * Both open the same account for the same verified address (Supabase identity linking). The email/password panel
 * has three modes: sign in, create an account, and "forgot or never set a password?" (emails a set-password link,
 * which is also how a Google-only account adds a password). No message says whether an address has an account.
 * The email magic link stays behind EMAIL_LOGIN_ENABLED (lib/supabase/login-options.ts). Callback errors
 * (`?error=`) are shown above everything.
 */

import { useActionState, useId, useState, useTransition } from "react";

import { DemoAccountPanel } from "@/components/auth/demo-account-panel";
import { GoogleSignInButton } from "@/components/auth/google-sign-in-button";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { routes } from "@/lib/routes";
import { EMAIL_LOGIN_ENABLED } from "@/lib/supabase/login-options";
import { SIGN_IN_ERROR_MESSAGES } from "@/lib/supabase/oauth-core";
import type { PasswordResult } from "@/lib/supabase/password-auth";

import {
  sendMagicLink,
  sendPasswordSetupLink,
  signInWithPassword,
  signUpWithPassword,
  startGoogleSignIn,
  type MagicLinkState,
} from "./actions";

type Mode = "signin" | "signup" | "reset";

const OFFLINE: PasswordResult = { status: "error", message: "We couldn't reach Baton. Check your connection and try again." };

export function LoginForm({
  next,
  error,
  autoStartGoogle,
  siteOrigin,
}: {
  next: string | null;
  error: string | null;
  autoStartGoogle: boolean;
  /** BATON_SITE_URL's origin, for the same-host check before Google sign-in (GoogleSignInButton). */
  siteOrigin: string | null;
}) {
  const callbackMessage = error ? (SIGN_IN_ERROR_MESSAGES[error] ?? null) : null;
  const [emailOpen, setEmailOpen] = useState(false);
  return (
    <div className="mt-6 space-y-5">
      {callbackMessage ? (
        <Alert id="login-callback-message" tone="danger">
          {callbackMessage}
        </Alert>
      ) : null}
      <DemoAccountPanel next={next} signIn={signInWithPassword} />
      <GoogleSignInButton start={() => startGoogleSignIn(next)} autoStart={autoStartGoogle} siteOrigin={siteOrigin} />
      <div className="flex items-center gap-3 text-caption text-muted-foreground" aria-hidden="true">
        <span className="h-px flex-1 bg-border" />
        or
        <span className="h-px flex-1 bg-border" />
      </div>
      {emailOpen ? (
        <PasswordPanel next={next} />
      ) : (
        <Button type="button" size="lg" variant="outline" className="w-full" onClick={() => setEmailOpen(true)} aria-expanded={false}>
          Continue with email and password
        </Button>
      )}
      {EMAIL_LOGIN_ENABLED ? <MagicLinkForm next={next} /> : null}
    </div>
  );
}

function PasswordPanel({ next }: { next: string | null }) {
  const id = useId();
  const [mode, setMode] = useState<Mode>("signin");
  const [result, setResult] = useState<PasswordResult | null>(null);
  const [pending, startTransition] = useTransition();
  const [email, setEmail] = useState("");

  const switchTo = (m: Mode) => {
    setMode(m);
    setResult(null);
  };

  const submit = (form: HTMLFormElement) => {
    const f = new FormData(form);
    const value = (k: string) => String(f.get(k) ?? "");
    startTransition(async () => {
      let r: PasswordResult;
      try {
        r =
          mode === "signin"
            ? await signInWithPassword(value("email"), value("password"))
            : mode === "signup"
              ? await signUpWithPassword(value("email"), value("password"), value("confirm"), next)
              : await sendPasswordSetupLink(value("email"));
      } catch {
        r = OFFLINE;
      }
      if (r.status === "ok" && !r.message) {
        // Signed in: the session cookies are set. A full navigation makes every server component see them.
        window.location.assign(next ?? routes.dashboard);
        return; // keep the pending state until the page changes
      }
      setResult(r);
    });
  };

  const err = result?.status === "error" ? result : null;
  const done = result?.status === "ok" ? result.message : null;
  const headings: Record<Mode, string> = {
    signin: "Sign in with email",
    signup: "Create an account",
    reset: "Set a new password",
  };
  const submitLabel: Record<Mode, [idle: string, busy: string]> = {
    signin: ["Sign in", "Signing in…"],
    signup: ["Create account", "Creating account…"],
    reset: ["Email me a link", "Sending…"],
  };

  return (
    <section aria-labelledby={`${id}-h`} className="space-y-4 border-t border-border pt-6">
      <div className="space-y-1">
        <h2 id={`${id}-h`} className="type-heading">
          {headings[mode]}
        </h2>
        {mode === "reset" ? (
          <p className="text-sm text-muted-foreground">
            Forgot your password, or signed up with Google and never set one? We&apos;ll email you a link to set one for the same account.
          </p>
        ) : null}
      </div>

      {done ? (
        <Alert tone="success" title={mode === "reset" ? "Check your inbox" : "Almost there"}>
          {done}
        </Alert>
      ) : (
        <form
          className="space-y-4"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            submit(e.currentTarget);
          }}
        >
          <div className="space-y-2">
            <Label htmlFor={`${id}-email`}>Email</Label>
            <Input
              id={`${id}-email`}
              name="email"
              type="email"
              autoComplete={mode === "signup" ? "email" : "username"}
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              aria-invalid={err?.field === "email" ? true : undefined}
              aria-describedby={err ? `${id}-msg` : undefined}
            />
          </div>
          {mode !== "reset" ? (
            <div className="space-y-2">
              <Label htmlFor={`${id}-password`}>Password</Label>
              <Input
                id={`${id}-password`}
                name="password"
                type="password"
                autoComplete={mode === "signup" ? "new-password" : "current-password"}
                required
                minLength={mode === "signup" ? 8 : undefined}
                aria-invalid={err?.field === "password" ? true : undefined}
                aria-describedby={mode === "signup" ? `${id}-hint` : undefined}
              />
              {mode === "signup" ? (
                <p id={`${id}-hint`} className="text-caption text-muted-foreground">
                  At least 8 characters.
                </p>
              ) : (
                <button
                  type="button"
                  className="text-caption text-muted-foreground underline underline-offset-4 hover:text-foreground"
                  onClick={() => switchTo("reset")}
                >
                  Forgot or never set a password?
                </button>
              )}
            </div>
          ) : null}
          {mode === "signup" ? (
            <div className="space-y-2">
              <Label htmlFor={`${id}-confirm`}>Repeat the password</Label>
              <Input id={`${id}-confirm`} name="confirm" type="password" autoComplete="new-password" required aria-invalid={err?.field === "confirm" ? true : undefined} />
            </div>
          ) : null}
          {err ? (
            <Alert id={`${id}-msg`} tone="danger">
              {err.message}
            </Alert>
          ) : null}
          <Button type="submit" size="lg" className="w-full" disabled={pending} aria-busy={pending}>
            {pending ? submitLabel[mode][1] : submitLabel[mode][0]}
          </Button>
        </form>
      )}

      <p className="text-caption text-muted-foreground">
        {mode === "signin" ? (
          <>
            New to Baton?{" "}
            <ModeLink onClick={() => switchTo("signup")}>Create an account</ModeLink>
          </>
        ) : (
          <>
            {mode === "signup" ? "Already have an account? " : null}
            <ModeLink onClick={() => switchTo("signin")}>Back to sign in</ModeLink>
          </>
        )}
      </p>
    </section>
  );
}

function ModeLink({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} className="font-medium text-foreground underline underline-offset-4 hover:text-primary">
      {children}
    </button>
  );
}

function MagicLinkForm({ next }: { next: string | null }) {
  const [state, action, pending] = useActionState<MagicLinkState, FormData>(sendMagicLink, { status: "idle" });

  if (state.status === "sent") {
    return (
      <Alert tone="success" title="Check your inbox">
        If the address can sign in, we&apos;ve sent a link that signs you in on this device. It can take a minute to arrive.
      </Alert>
    );
  }

  const message = state.status === "error" ? state.message : null;
  return (
    <form action={action} className="space-y-4" noValidate>
      {next ? <input type="hidden" name="next" value={next} /> : null}
      <div className="space-y-2">
        <Label htmlFor="email">Email (sign-in link)</Label>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          aria-invalid={state.status === "error" && state.code === "validation_failed" ? true : undefined}
          aria-describedby={message ? "login-message" : undefined}
        />
      </div>
      {message ? (
        <Alert id="login-message" tone="danger">
          {message}
        </Alert>
      ) : null}
      <Button type="submit" size="lg" variant="secondary" className="w-full" disabled={pending} aria-busy={pending}>
        {pending ? "Sending…" : "Email me a sign-in link"}
      </Button>
    </form>
  );
}
