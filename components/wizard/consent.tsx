"use client";

import { Check, Copy, ShieldCheck } from "lucide-react";
import { useState } from "react";

import { maskKindLabel } from "@/components/handover/labels";
import { Button } from "@/components/ui/button";
import { MASK_KINDS, type MaskKind } from "@/lib/contracts/enums";
import { cn } from "@/lib/utils";

/** Version of the consent statement below. Bump it whenever the wording changes (§12.2). */
export const CONSENT_STATEMENT_VERSION = "2026-11-v1";

/**
 * The AI provider is still an open decision (D11), so the statement names it generically.
 * Main replaces this with the configured provider's name before launch.
 */
export const AI_PROVIDER_LABEL = "Baton's configured AI provider";

export const CONSENT_ITEMS = [
  { id: "informed", label: "I told the group (or document owners) that I'm using this content for a Baton handover." },
  {
    id: "provider",
    label: `I understand masked content will be processed by ${AI_PROVIDER_LABEL}. Phone numbers, emails, payment details and secrets are masked first, and the raw file is deleted after processing.`,
  },
  { id: "optout", label: "I told members they can ask to be left out, and I've excluded anyone who did." },
] as const;

export type ConsentItemId = (typeof CONSENT_ITEMS)[number]["id"];

export function ConsentChecklist({ value, onChange, className }: { value: Record<ConsentItemId, boolean>; onChange: (v: Record<ConsentItemId, boolean>) => void; className?: string }) {
  return (
    <fieldset className={cn("space-y-3", className)}>
      <legend className="sr-only">Consent</legend>
      {CONSENT_ITEMS.map((item) => (
        <label key={item.id} className="flex items-start gap-3 rounded-lg border border-border bg-card p-3 text-sm leading-relaxed has-checked:border-primary/40 has-checked:bg-primary/[0.03]">
          <input
            type="checkbox"
            className="mt-1 size-4 shrink-0 accent-primary"
            checked={value[item.id]}
            onChange={(e) => onChange({ ...value, [item.id]: e.target.checked })}
          />
          {item.label}
        </label>
      ))}
      <p className="text-xs text-muted-foreground">Consent statement version {CONSENT_STATEMENT_VERSION}. It is recorded with each source.</p>
    </fieldset>
  );
}

export const emptyConsent = (): Record<ConsentItemId, boolean> => ({ informed: false, provider: false, optout: false });
export const consentComplete = (v: Record<ConsentItemId, boolean>) => CONSENT_ITEMS.every((i) => v[i.id]);

export function MaskingTable({ counts }: { counts?: Partial<Record<MaskKind, number>> }) {
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card">
      <div className="flex items-center gap-2 border-b border-border px-4 py-3">
        <ShieldCheck aria-hidden="true" className="size-4 text-status-sourced" />
        <p className="text-sm font-medium">Masked before anything is stored or sent to AI</p>
      </div>
      <ul className="divide-y divide-border text-sm">
        {MASK_KINDS.map((k) => (
          <li key={k} className="grid grid-cols-[1fr_auto] items-center gap-3 px-4 py-2 sm:grid-cols-[1fr_9rem_5rem]">
            <span>{maskKindLabel[k].label}</span>
            <code className="hidden font-mono text-xs text-muted-foreground sm:block">{maskKindLabel[k].token}</code>
            <span className="text-right font-mono text-xs tabular-nums">
              {counts ? (counts[k] ?? 0) : "—"}
              {counts && <span className="sr-only"> found</span>}
            </span>
          </li>
        ))}
      </ul>
      <p className="border-t border-border px-4 py-2.5 text-xs text-muted-foreground">
        The same value always gets the same token, so threads stay readable. Masked values are never revealed.
      </p>
    </div>
  );
}

export function GroupNotice({ teamName }: { teamName: string }) {
  const text = `Hi all — I'm preparing a handover for ${teamName || "our team"} using Baton. It will read this chat to pull out decisions, owners and open tasks, with quotes as evidence. Phone numbers, emails and payment details are masked first, and the original export is deleted after processing. If you'd rather your messages were left out, reply here or message me in the next few days, before I start processing.`;
  const [copied, setCopied] = useState(false);
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-medium">Group notice</p>
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
          {copied ? "Copied" : "Copy"}
        </Button>
      </div>
      <p className="mt-2 rounded-lg bg-background/70 p-3 font-mono text-xs leading-relaxed text-foreground/85">{text}</p>
      <p className="mt-2 text-xs text-muted-foreground">Post this in the group before you continue, so everyone has a chance to opt out.</p>
    </div>
  );
}
