"use client";

import Link from "next/link";
import { useEffect, useId, useState } from "react";

import { ConsentStep } from "@/components/connectors/consent-step";
import { installStatusText, isProvider, PROVIDER_LABEL } from "@/components/connectors/view-model";
import { PageHeader } from "@/components/shared/page-header";
import { Alert } from "@/components/ui/alert";
import { Button, buttonVariants } from "@/components/ui/button";
import { linkFromIntent, readLinkIntent } from "@/lib/actions/connectors";
import type { ConnectorLinkSummary, LinkIntentDto } from "@/lib/contracts/connectors";
import { routes } from "@/lib/routes";

type Step = { kind: "loading" } | { kind: "error"; text: string } | { kind: "choose"; intent: LinkIntentDto } | { kind: "consent"; link: ConnectorLinkSummary; handoverId: string } | { kind: "done"; link: ConnectorLinkSummary; handoverId: string };

const settingsHref = (handoverId: string) => `${routes.handover.settings(handoverId)}#connectors`;

/** The /connect flow: verify the bot's link intent → pick one of your handovers → link → capture consent. */
export function ConnectIntent({ intent, connector, status }: { intent: string | null; connector: string | null; status: string | null }) {
  const [step, setStep] = useState<Step>({ kind: "loading" });
  const notice = installStatusText(isProvider(connector) ? connector : null, status);

  useEffect(() => {
    if (!intent) return;
    let live = true;
    readLinkIntent({ intent })
      .then((r) => {
        if (!live) return;
        if (r.ok) setStep({ kind: "choose", intent: r.data });
        else setStep({ kind: "error", text: r.error.code === "token_invalid" ? "This link has expired or isn't valid. Type /handover in the channel again to get a new one." : r.error.message });
      })
      .catch(() => live && setStep({ kind: "error", text: "Couldn't check this link. Refresh to try again." }));
    return () => {
      live = false;
    };
  }, [intent]);

  if (!intent) {
    return (
      <div className="space-y-6">
        <PageHeader title="Connect a channel" description="Bring messages from a team chat into one of your handovers." />
        {notice && <Alert tone={notice.tone}>{notice.text}</Alert>}
        <p className="text-sm text-muted-foreground">
          Type <span className="font-mono">/handover</span> in the Discord or Telegram channel you want to connect (or in Slack, where the command is turned on), then open the link the bot replies with. You can always
          connect channels from a handover&apos;s settings.
        </p>
        <Link href={routes.dashboard} className={buttonVariants({ variant: "outline", size: "sm" })}>
          Go to your handovers
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Connect a channel" description="Nothing is saved until you choose a handover and confirm." />
      <div aria-live="polite">
        {step.kind === "loading" && <p className="text-sm text-muted-foreground">Checking the link…</p>}
        {step.kind === "error" && <Alert tone="danger">{step.text}</Alert>}
        {step.kind === "done" && (
          <Alert tone="success" title={`Saving messages from ${step.link.channelLabel}`}>
            New messages wait in Baton until you bring them in from the handover&apos;s settings.{" "}
            <Link href={settingsHref(step.handoverId)} className="underline underline-offset-4">
              Open connected channels
            </Link>
          </Alert>
        )}
      </div>
      {step.kind === "choose" && <ChooseHandover intentToken={intent} intent={step.intent} onLinked={(link, handoverId) => setStep({ kind: "consent", link, handoverId })} />}
      {step.kind === "consent" && <ConsentStep link={step.link} onDone={(link) => setStep({ kind: "done", link, handoverId: step.handoverId })} />}
    </div>
  );
}

function ChooseHandover({ intentToken, intent, onLinked }: { intentToken: string; intent: LinkIntentDto; onLinked(link: ConnectorLinkSummary, handoverId: string): void }) {
  const name = useId();
  const [selected, setSelected] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (intent.handovers.length === 0) {
    return (
      <Alert tone="info" title="No handover can take a channel right now">
        Channels can be connected to handovers you created that are a draft or in review.{" "}
        <Link href={routes.dashboard} className="underline underline-offset-4">
          Go to your handovers
        </Link>
      </Alert>
    );
  }

  async function link() {
    setPending(true);
    setError(null);
    try {
      const r = await linkFromIntent({ intent: intentToken, handoverId: selected });
      if (r.ok) onLinked(r.data, selected);
      else setError(r.error.message);
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-4">
      <p className="text-sm">
        {PROVIDER_LABEL[intent.provider]} <span className="font-medium">{intent.channelLabel}</span> in <span className="font-medium">{intent.accountLabel}</span>
      </p>
      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">Which handover should this channel feed?</legend>
        <ul className="space-y-1">
          {intent.handovers.map((h) => (
            <li key={h.id}>
              <label className="flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm hover:bg-muted">
                <input type="radio" name={name} value={h.id} checked={selected === h.id} onChange={() => setSelected(h.id)} className="size-4 accent-[var(--primary)]" />
                {h.title}
              </label>
            </li>
          ))}
        </ul>
      </fieldset>
      {error && (
        <p role="alert" className="text-sm text-destructive-fg">
          {error}
        </p>
      )}
      <Button size="sm" disabled={!selected || pending} onClick={link}>
        {pending ? "Linking…" : "Continue"}
      </Button>
    </div>
  );
}
