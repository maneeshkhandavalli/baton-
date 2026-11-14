"use client";

/**
 * Minimal magic-link form, built only from shared primitives. When the UI agent ships
 * components/auth/**, this file can render those instead; the action contract stays the same.
 */

import { useActionState } from "react";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import { sendMagicLink, type MagicLinkState } from "./actions";

const CALLBACK_ERRORS: Record<string, string> = {
  auth_callback_failed: "That sign-in link has expired or was already used. Request a new one.",
};

export function LoginForm({ next, error }: { next: string | null; error: string | null }) {
  const [state, action, pending] = useActionState<MagicLinkState, FormData>(sendMagicLink, { status: "idle" });

  if (state.status === "sent") {
    return (
      <Alert tone="success" title="Check your inbox" className="mt-6">
        If the address can sign in, we&apos;ve sent a link that signs you in on this device. It can take a minute to arrive.
      </Alert>
    );
  }

  const message = state.status === "error" ? state.message : error ? CALLBACK_ERRORS[error] ?? null : null;

  return (
    <form action={action} className="mt-6 space-y-4" noValidate>
      {next ? <input type="hidden" name="next" value={next} /> : null}
      <div className="space-y-2">
        <Label htmlFor="email">Email</Label>
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
      <Button type="submit" size="lg" className="w-full" disabled={pending} aria-busy={pending}>
        {pending ? "Sending…" : "Email me a sign-in link"}
      </Button>
    </form>
  );
}
