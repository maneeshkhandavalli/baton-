"use client";

import { ArrowRight, MailCheck } from "lucide-react";
import { useState } from "react";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export type MagicLinkResult = { ok: true } | { ok: false; message: string };

interface MagicLinkFormProps {
  /**
   * Sends the magic link. Supplied by the Supabase agent's login page (app/(auth)/login), which owns
   * authentication (§11.2, §12.3). This component is presentational only.
   */
  onSend: (email: string) => Promise<MagicLinkResult>;
  /** Pre-filled and locked, e.g. for an invite that must use the invited address. */
  lockedEmail?: string;
  /** Error from the auth callback (`/login?error=`), shown above the form. */
  initialError?: string;
  title?: string;
  description?: string;
}

const emailSchema = z.email();

/** Email magic-link sign-in: idle → sending → "check your inbox", with resend. */
export function MagicLinkForm({
  onSend,
  lockedEmail,
  initialError,
  title = "Sign in to Baton",
  description = "We'll email you a link. No password needed.",
}: MagicLinkFormProps) {
  const [email, setEmail] = useState(lockedEmail ?? "");
  const [state, setState] = useState<"idle" | "sending" | "sent">("idle");
  const [error, setError] = useState<string | null>(initialError ?? null);

  async function send() {
    if (!emailSchema.safeParse(email.trim()).success) {
      setError("Enter a valid email address.");
      return;
    }
    setError(null);
    setState("sending");
    try {
      const result = await onSend(email.trim());
      if (result.ok) setState("sent");
      else {
        setError(result.message);
        setState("idle");
      }
    } catch {
      setError("We couldn't send the link. Check your connection and try again.");
      setState("idle");
    }
  }

  if (state === "sent") {
    return (
      <section className="rounded-xl border border-border bg-card p-8 shadow-soft" aria-live="polite">
        <MailCheck aria-hidden="true" className="size-8 text-status-sourced" />
        <h1 className="mt-4 type-section-title">Check your inbox</h1>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          We sent a sign-in link to <span className="font-medium text-foreground">{email}</span>. It expires in an hour and works once.
        </p>
        <Button variant="link" className="mt-4 px-0" onClick={() => setState("idle")}>
          Use a different email or resend
        </Button>
      </section>
    );
  }

  return (
    <section className="rounded-xl border border-border bg-card p-8 shadow-soft">
      <h1 className="type-section-title">{title}</h1>
      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{description}</p>
      <form
        className="mt-6 space-y-4"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <div className="space-y-1.5">
          <Label htmlFor="magic-email">Email</Label>
          <Input
            id="magic-email"
            type="email"
            autoComplete="email"
            value={email}
            readOnly={!!lockedEmail}
            onChange={(e) => setEmail(e.target.value)}
            aria-invalid={!!error}
            aria-describedby={error ? "magic-error" : undefined}
            className="h-10"
          />
          {error && (
            <p id="magic-error" role="alert" className="text-xs text-destructive-fg">
              {error}
            </p>
          )}
        </div>
        <Button type="submit" size="lg" className="h-10 w-full" disabled={state === "sending"} aria-busy={state === "sending"}>
          {state === "sending" ? "Sending…" : "Email me a sign-in link"}
          {state !== "sending" && <ArrowRight aria-hidden="true" data-icon="inline-end" />}
        </Button>
      </form>
    </section>
  );
}
