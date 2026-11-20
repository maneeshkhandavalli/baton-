"use client";

/** Main (integration): Worker 02's GitHub family settings in the panel's provider slot, saved through Main's action. */

import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";

import type { ProviderSettingsProps } from "../provider-settings";
import { GithubSettings } from "./github-settings";
import { useConnectorActions } from "../actions-context";

export function GithubLinkSettings({ link, onSaved }: ProviderSettingsProps) {
  const actions = useConnectorActions();
  const [settings, setSettings] = useState<Record<string, unknown>>(link.settings);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const dirty = JSON.stringify(settings) !== JSON.stringify(link.settings);
  const disabled = pending || link.state === "revoked";

  return (
    <div className="space-y-3">
      <GithubSettings settings={settings} onChange={setSettings} disabled={disabled} />
      <div className="flex items-center gap-3">
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={disabled || !dirty}
          onClick={() =>
            start(async () => {
              const r = await actions.updateConnectorLinkSettings({ linkId: link.id, settings });
              setMessage(r.ok ? "Saved." : r.error.message);
              if (r.ok) onSaved();
            })
          }
        >
          {pending ? "Saving…" : "Save"}
        </Button>
        <p className="text-sm text-muted-foreground" aria-live="polite">
          {message}
        </p>
      </div>
    </div>
  );
}
