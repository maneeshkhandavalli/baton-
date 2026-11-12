"use client";

import Link from "next/link";
import { ArrowLeft, ArrowRight, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";

import { SaveIndicator } from "@/components/shared/save-indicator";
import { Stepper } from "@/components/shared/stepper";
import { Alert } from "@/components/ui/alert";
import { Button, buttonVariants } from "@/components/ui/button";
import { CONSENT_STATEMENT_VERSION, ConsentChecklist, GroupNotice, MaskingTable, emptyConsent } from "@/components/wizard/consent";
import type { DraftSource } from "@/components/wizard/draft-state";
import { DetailsStep, MatchesSection, STEPS, StepHeading, type Details, type PendingMatch } from "@/components/wizard/new-handover-wizard";
import { ScopeStep } from "@/components/wizard/scope-step";
import { SourcesStep } from "@/components/wizard/sources-step";
import type { MaskKind } from "@/lib/contracts/enums";

/**
 * Dev-only (/preview/wizard?step=1..4): the wizard's real step components with synthetic state and
 * no-op handlers. Nothing here calls a server action. `files` is the Sources step showcase: one row
 * per upload state; rows marked `withFile` get an in-memory File so Retry / the .txt toggle render.
 */
export function WizardPreview({
  step,
  details: initialDetails,
  files,
  scopeSources,
  masking,
  matches,
  savedAt,
}: {
  step: number;
  details: Details;
  files: Array<DraftSource & { withFile?: boolean }>;
  scopeSources: DraftSource[];
  masking: Partial<Record<MaskKind, number>>;
  matches: PendingMatch[];
  /** ISO time of the last save (from the server, so render stays pure). */
  savedAt: string;
}) {
  const [details, setDetails] = useState(initialDetails);
  const [consent, setConsent] = useState(() => ({ ...emptyConsent(), informed: true, provider: true }));
  const [scope, setScope] = useState(scopeSources);
  const sources = useMemo(
    () => files.map(({ withFile, ...s }) => (withFile ? { ...s, file: new File(["preview"], s.name, { type: "text/plain" }) } : s)),
    [files],
  );
  const noop = () => undefined;
  const href = (n: number) => `/preview/wizard?step=${n + 1}`;

  return (
    <div className="space-y-8">
      <div className="space-y-5 border-b border-border pb-6">
        <Stepper steps={STEPS} current={step} label="New handover steps" />
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <SaveIndicator state={{ kind: "saved", at: savedAt }} className="min-w-0 flex-1" />
          <Button size="sm" variant="destructive-ghost" disabled>
            <Trash2 aria-hidden="true" data-icon="inline-start" />
            Discard draft
          </Button>
        </div>
        <p className="text-caption text-muted-foreground">Everything is saved as you go. Leave any time and continue from the dashboard.</p>
      </div>

      {step === 0 && (
        <DetailsStep
          details={details}
          setDetail={(k, v) => setDetails((d) => ({ ...d, [k]: v }))}
          errors={{}}
          created
          invites={[{ label: "Incoming member (neha.kulkarni@example.edu)", url: "http://localhost:3000/h/preview-invite-link-not-real" }]}
          resumed={false}
        />
      )}
      {step === 1 && (
        <div className="space-y-8">
          <StepHeading
            index={1}
            title="Privacy and consent"
            description="Before any file is read, confirm how Baton may use it. Personal and financial details are masked in memory before anything is saved, the raw upload is deleted once processing succeeds, and only masked, permitted evidence is kept."
          />
          <GroupNotice teamName={details.teamName} />
          <ConsentChecklist value={consent} onChange={setConsent} />
          <p className="sr-only">Statement {CONSENT_STATEMENT_VERSION}</p>
        </div>
      )}
      {step === 2 && (
        <div className="space-y-8">
          <StepHeading
            index={2}
            title="Add the team’s record"
            description="Export WhatsApp chats without media (Chat → More → Export chat → Without media) and add any handbooks or notes. Up to 10 files, 25 MB each."
          />
          <Alert tone="warning" title="1 file wasn’t added">
            A handover holds up to 10 files. Remove one to add another.
          </Alert>
          <SourcesStep sources={sources} onFiles={noop} onRemove={noop} onRetry={noop} onDateOrder={noop} onSwitchKind={noop} full />
        </div>
      )}
      {step === 3 && (
        <div className="space-y-8">
          <StepHeading
            index={3}
            title="Choose what Baton reads"
            description="Narrow each chat to the relevant dates, leave out off-topic conversations and anyone who opted out, and decide who may see evidence from each source."
          />
          <MatchesSection matches={matches} decisions={[]} onAnswer={noop} disabled />
          <ScopeStep sources={scope} update={(id, patch) => setScope((list) => list.map((s) => (s.localId === id ? { ...s, ...patch } : s)))} />
          <MaskingTable counts={masking} />
        </div>
      )}

      <div className="sticky bottom-0 z-10 -mx-4 border-t border-border bg-background/90 px-4 pt-4 pb-[max(1rem,env(safe-area-inset-bottom))] backdrop-blur-md supports-backdrop-filter:bg-background/75 sm:mx-0 sm:px-0">
        <div className="flex items-center justify-between gap-3">
          {step > 0 ? (
            <Link href={href(step - 1)} className={buttonVariants({ variant: "ghost" })}>
              <ArrowLeft aria-hidden="true" data-icon="inline-start" />
              Back
            </Link>
          ) : (
            <Button variant="ghost" disabled>
              <ArrowLeft aria-hidden="true" data-icon="inline-start" />
              Back
            </Button>
          )}
          <div className="flex min-w-0 items-center gap-3">
            {step === 3 && <p className="hidden text-right text-caption text-muted-foreground md:block">Answer each “same person?” question first.</p>}
            {step < 3 ? (
              <Link href={href(step + 1)} className={buttonVariants({ size: "lg" })}>
                Continue
                <ArrowRight aria-hidden="true" data-icon="inline-end" />
              </Link>
            ) : (
              <Button size="lg" disabled>
                Start processing
                <ArrowRight aria-hidden="true" data-icon="inline-end" />
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
