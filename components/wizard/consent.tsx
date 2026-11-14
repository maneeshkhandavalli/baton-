"use client";

import { Check, Copy, ShieldCheck } from "lucide-react";
import { useState } from "react";

import { maskKindLabel } from "@/components/handover/labels";
import { Button } from "@/components/ui/button";
import { MASK_KINDS, type MaskKind } from "@/lib/contracts/enums";
import { cn } from "@/lib/utils";

/** Version of the consent statement below. Bump it whenever the wording changes (§12.2). */
export const CONSENT_STATEMENT_VERSION = "gemini-paid-2026-11-14-v1";

/**
 * D11 (2026-11-14): the configured provider is the Google Gemini Developer API on the paid tier
 * (lib/ai/providers/gemini.ts, GEMINI_DISPLAY_NAME). The server records the configured provider id with
 * each consent, and processing refuses a source whose consent names a different provider.
 */
export const AI_PROVIDER_LABEL = "Google Gemini (Gemini Developer API, paid tier)";

export const CONSENT_ITEMS = [
  { id: "informed", label: "I told the group (or document owners) that I'm using this content for a Baton handover." },
  {
    id: "provider",
    label: `I understand masked content will be sent to ${AI_PROVIDER_LABEL} for processing. Phone numbers, emails, payment details and secrets are masked before anything is sent. On the paid tier, Google does not use this content to train its models, but may keep it for a limited time to detect abuse. The raw file is deleted after processing.`,
  },
  { id: "optout", label: "I told members they can ask to be left out, and I've excluded anyone who did." },
] as const;

export type ConsentItemId = (typeof CONSENT_ITEMS)[number]["id"];

export function ConsentChecklist({ value, onChange, className }: { value: Record<ConsentItemId, boolean>; onChange: (v: Record<ConsentItemId, boolean>) => void; className?: string }) {
  return (
    <fieldset className={cn("space-y-3", className)}>
      <legend className="sr-only">Consent</legend>
      {CONSENT_ITEMS.map((item) => (
        <label
          key={item.id}
          className="flex cursor-pointer items-start gap-3 rounded-lg border border-border bg-card p-3.5 text-sm leading-relaxed shadow-xs transition-colors hover:border-border-strong has-checked:border-success/40 has-checked:bg-success-soft/50 has-focus-visible:ring-3 has-focus-visible:ring-ring/35"
        >
          <input
            type="checkbox"
            className="mt-1 size-4 shrink-0 accent-primary outline-none"
            checked={value[item.id]}
            onChange={(e) => onChange({ ...value, [item.id]: e.target.checked })}
          />
          {item.label}
        </label>
      ))}
      <p className="text-caption text-muted-foreground">
        {CONSENT_ITEMS.filter((i) => value[i.id]).length} of {CONSENT_ITEMS.length} confirmed · statement version {CONSENT_STATEMENT_VERSION}, recorded with each source.
      </p>
    </fieldset>
  );
}

export const emptyConsent = (): Record<ConsentItemId, boolean> => ({ informed: false, provider: false, optout: false });
export const consentComplete = (v: Record<ConsentItemId, boolean>) => CONSENT_ITEMS.every((i) => v[i.id]);

export function MaskingTable({ counts }: { counts?: Partial<Record<MaskKind, number>> }) {
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card shadow-soft">
      <div className="flex items-center gap-2 border-b border-border bg-muted/40 px-4 py-3">
        <ShieldCheck aria-hidden="true" className="size-4 text-success" />
        <p className="type-subheading">Masked before anything is stored or sent to AI</p>
      </div>
      <ul className="divide-y divide-border text-sm">
        {MASK_KINDS.map((k) => (
          <li key={k} className="grid grid-cols-[1fr_auto] items-center gap-3 px-4 py-2 sm:grid-cols-[1fr_9rem_5rem]">
            <span>{maskKindLabel[k].label}</span>
            <code className="hidden font-mono text-2xs text-muted-foreground sm:block">{maskKindLabel[k].token}</code>
            <span className="text-right font-mono text-xs tabular-nums">
              {counts ? (counts[k] ?? 0) : "—"}
              {counts && <span className="sr-only"> found</span>}
            </span>
          </li>
        ))}
      </ul>
      <p className="border-t border-border px-4 py-2.5 text-caption text-muted-foreground">
        The same value always gets the same token, so threads stay readable. Masked values are never revealed.
      </p>
    </div>
  );
}

export function GroupNotice({ teamName }: { teamName: string }) {
  const text = `Hi all — I'm preparing a handover for ${teamName || "our team"} using Baton. It will read this chat to pull out decisions, owners and open tasks, with quotes as evidence. Phone numbers, emails and payment details are masked first, and the original export is deleted after processing. If you'd rather your messages were left out, reply here or message me in the next few days, before I start processing.`;
  const [copied, setCopied] = useState(false);
  return (
    <div className="rounded-xl border border-border bg-card p-4 shadow-soft sm:p-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="type-subheading">Tell the group first</p>
          <p className="text-caption text-muted-foreground">Post this in the chat so everyone can opt out before you process it.</p>
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(text);
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            } catch {
              setCopied(false);
            }
          }}
        >
          {copied ? <Check aria-hidden="true" data-icon="inline-start" /> : <Copy aria-hidden="true" data-icon="inline-start" />}
          <span aria-live="polite">{copied ? "Copied" : "Copy"}</span>
        </Button>
      </div>
      <p className="mt-3 rounded-lg border border-border bg-muted/50 p-3 type-quote text-foreground/85">{text}</p>
    </div>
  );
}
