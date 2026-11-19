"use client";

import { useEffect, useId, useState } from "react";

import { historyOptions, PROVIDER_LABEL } from "@/components/connectors/view-model";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import type { CaptureConsentDto, ConnectorLinkSummary } from "@/lib/contracts/connectors";
import { useConnectorActions } from "./actions-context";

interface ConsentStepProps {
  link: Pick<ConnectorLinkSummary, "id" | "provider" | "channelLabel">;
  onDone(link: ConnectorLinkSummary): void;
  onCancel?(): void;
}

/**
 * Capture consent for one linked channel. Shows the server's versioned statement VERBATIM (getCaptureConsent) and
 * needs an explicit checkbox before "Start saving messages". Nothing is captured before this is confirmed.
 */
export function ConsentStep({ link, onDone, onCancel }: ConsentStepProps) {
  const actions = useConnectorActions();
  const id = useId();
  const [historyDays, setHistoryDays] = useState(0);
  const [consent, setConsent] = useState<CaptureConsentDto | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [agreed, setAgreed] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    actions.getCaptureConsent({ provider: link.provider, channelLabel: link.channelLabel, historyDays })
      .then((r) => {
        if (!live) return;
        if (r.ok) {
          setConsent(r.data);
          setLoadError(null);
        } else setLoadError(r.error.message);
      })
      .catch(() => live && setLoadError("Couldn't load the consent statement. Try again."));
    return () => {
      live = false;
    };
  }, [actions, link.provider, link.channelLabel, historyDays]);

  async function confirm() {
    if (!consent || !agreed) return;
    setPending(true);
    setError(null);
    try {
      const r = await actions.recordCaptureConsent({ linkId: link.id, consentVersion: consent.version, historyDays });
      if (r.ok) onDone(r.data);
      else setError(r.error.message);
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-4 rounded-lg border border-border bg-card p-4" role="group" aria-labelledby={`${id}-title`}>
      <div className="space-y-1">
        <h4 id={`${id}-title`} className="text-sm font-semibold">
          Start saving messages from {PROVIDER_LABEL[link.provider]} {link.channelLabel}?
        </h4>
        <p className="text-caption text-muted-foreground">Read this before you confirm. It applies to this channel and this handover only.</p>
      </div>

      {loadError && (
        <p role="alert" className="text-sm text-destructive-fg">
          {loadError}
        </p>
      )}

      {consent && (
        <>
          {consent.historyAvailable && (
            <div className="space-y-1.5">
              <Label htmlFor={`${id}-history`}>Also bring in earlier messages</Label>
              <NativeSelect id={`${id}-history`} value={String(historyDays)} onChange={(e) => {
                  setHistoryDays(Number(e.target.value));
                  setAgreed(false); // the statement changes with the history choice: confirm it again
                }} disabled={pending}>
                {historyOptions(consent.maxHistoryDays).map((d) => (
                  <option key={d} value={d}>
                    {d === 0 ? "No, only new messages" : `The last ${d} ${d === 1 ? "day" : "days"}`}
                  </option>
                ))}
              </NativeSelect>
            </div>
          )}
          <ul className="list-disc space-y-1.5 pl-5 text-sm" aria-label="Capture statement">
            {consent.statement.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          <label className="flex items-start gap-2.5 text-sm">
            <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} disabled={pending} className="mt-0.5 size-4 shrink-0 accent-[var(--primary)]" />
            <span>I have read this and agree.</span>
          </label>
        </>
      )}

      {error && (
        <p role="alert" className="text-sm text-destructive-fg">
          {error}
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={confirm} disabled={!consent || !agreed || pending}>
          {pending ? "Starting…" : "Start saving messages"}
        </Button>
        {onCancel && (
          <Button size="sm" variant="ghost" onClick={onCancel} disabled={pending}>
            Not now
          </Button>
        )}
      </div>
    </div>
  );
}
