"use client";

import { Hash, Pause, Play, RefreshCw, Unplug } from "lucide-react";
import { useCallback, useEffect, useId, useState } from "react";

import { ConsentStep } from "@/components/connectors/consent-step";
import { PROVIDER_SETTINGS } from "@/components/connectors/provider-settings";
import {
  ACCOUNT_NOUN,
  CHANNEL_NOUN,
  blockedReasonText,
  groupSummary,
  installationStatus,
  installStatusText,
  isProvider,
  linkStatus,
  plural,
  providerGroups,
  PULL_BASED,
  type ProviderGroup,
} from "@/components/connectors/view-model";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import type { Result } from "@/lib/contracts/api";
import type { ChannelChoiceDto, ConnectorInstallationSummary, ConnectorLinkSummary, HandoverConnectorsView } from "@/lib/contracts/connectors";
import { useConnectorActions } from "./actions-context";

type Announce = { tone: "success" | "danger" | "info"; text: string } | null;


interface PanelApi {
  handoverId: string;
  busy: string | null;
  /** Runs one action (one at a time), announces the result in the live region and reloads the view. */
  act<T>(key: string, work: () => Promise<Result<T>>, success: (data: T) => string): Promise<Result<T> | null>;
  reload(): void;
}

/**
 * "Connected channels" (Round 4, Worker 03): the handover creator connects Slack / Discord / Telegram (and GitHub,
 * whose settings Worker 02 provides) channels, gives capture consent, sees what is actually happening and can bring
 * messages in, pause, resume or disconnect. Renders nothing for anyone who is not the creator.
 */
export function ConnectedChannels({ handoverId }: { handoverId: string }) {
  const actions = useConnectorActions();
  const [view, setView] = useState<HandoverConnectorsView | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [announce, setAnnounce] = useState<Announce>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const [installNotice, setInstallNotice] = useState<Announce>(null);

  useEffect(() => {
    let live = true;
    actions.listHandoverConnectors({ handoverId })
      .then((r) => {
        if (!live) return;
        if (r.ok) {
          setView(r.data);
          setLoadError(null);
        } else setLoadError(r.error.message);
      })
      .catch(() => live && setLoadError("Couldn't load connected channels. Refresh to try again."))
      .finally(() => {
        if (!live || version > 0) return;
        // after an install round trip (?connector=<p>&status=<code>)
        const q = new URLSearchParams(window.location.search);
        const p = q.get("connector");
        setInstallNotice(installStatusText(isProvider(p) ? p : null, q.get("status")));
      });
    return () => {
      live = false;
    };
  }, [actions, handoverId, version]);

  const reload = useCallback(() => setVersion((v) => v + 1), []);

  const act = useCallback(
    async function act<T>(key: string, work: () => Promise<Result<T>>, success: (data: T) => string): Promise<Result<T> | null> {
      setBusy(key);
      setAnnounce(null);
      try {
        const r = await work();
        setAnnounce(r.ok ? { tone: "success", text: success(r.data) } : { tone: "danger", text: r.error.message });
        reload();
        return r;
      } catch {
        setAnnounce({ tone: "danger", text: "Something went wrong. Please try again." });
        return null;
      } finally {
        setBusy(null);
      }
    },
    [reload],
  );

  if (loadError) return <Alert tone="danger">{loadError}</Alert>;
  if (!view) return <p className="text-sm text-muted-foreground">Loading connected channels…</p>;
  // Not the creator: the server returns no providers. A server with no provider configured returns all four as "not
  // set up" with canManage false; those cards are still shown (honest state, nothing to act on).
  if (!view.canManage && view.providers.length === 0) return null;

  const api: PanelApi = { handoverId, busy, act, reload };
  return (
    <div className="space-y-4">
      <div aria-live="polite" className="empty:hidden">
        {installNotice && <Alert tone={installNotice.tone}>{installNotice.text}</Alert>}
        {announce && <Alert tone={announce.tone} className="mt-2">{announce.text}</Alert>}
      </div>
      <p className="text-caption text-muted-foreground">
        Messages are saved only from channels you link here and confirm. New messages wait in Baton until you bring them in; they then appear in Sources, where you give the usual consent before anything is processed.
      </p>
      <ul className="divide-y divide-border border-y border-border">
        {providerGroups(view).map((g) => (
          <li key={g.provider} className="py-4">
            <ProviderCard group={g} api={api} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function ProviderCard({ group: g, api }: { group: ProviderGroup; api: PanelApi }) {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 id={headingId} className="text-sm font-medium">
            {g.name}
          </h3>
          <p className="text-caption text-muted-foreground">{groupSummary(g)}</p>
        </div>
        {g.installHref && g.provider !== "telegram" && (
          <a href={g.installHref} className={buttonVariants({ variant: "outline", size: "sm" })}>
            {g.installations.length > 0 ? `Add to another ${ACCOUNT_NOUN[g.provider]}` : `Add to ${g.name}`}
          </a>
        )}
      </div>

      {g.configured && g.provider === "telegram" && <TelegramSteps href={g.installHref} />}
      {g.configured && g.provider === "slack" && (
        <p className="text-caption text-muted-foreground">
          {g.privateChannels ? "Public and private channels the Baton app was added to can be linked." : "Public channels only: private channels aren't turned on for this server."} Messages keep their author&apos;s Slack display name, and the app posts a notice in the channel when saving starts, pauses or stops.
        </p>
      )}
      {g.configured && (g.provider === "slack" || g.provider === "discord") && g.slashCommand && g.installations.length > 0 && (
        <p className="text-caption text-muted-foreground">You can also type /handover in a channel to get a link to connect it.</p>
      )}

      {g.installations.map((inst) => (
        <InstallationBlock key={inst.id} inst={inst} api={api} />
      ))}
    </section>
  );
}

function TelegramSteps({ href }: { href: string | null }) {
  return (
    <ol className="list-decimal space-y-1 pl-5 text-caption text-muted-foreground">
      <li>
        {href ? (
          <a href={href} target="_blank" rel="noopener noreferrer" className="text-foreground underline decoration-foreground/30 underline-offset-4 hover:decoration-foreground">
            Add the Baton bot to your group
          </a>
        ) : (
          "Add the Baton bot to your group"
        )}{" "}
        (a group admin does this).
      </li>
      <li>Open a private chat with the bot and press Start (once), then send /handover in the group (group admins only, not anonymous).</li>
      <li>Open the link the bot sends you privately, choose this handover and confirm.</li>
    </ol>
  );
}

function InstallationBlock({ inst, api }: { inst: ConnectorInstallationSummary & { links: ConnectorLinkSummary[] }; api: PanelApi }) {
  const actions = useConnectorActions();
  const status = installationStatus(inst);
  const [picking, setPicking] = useState(false);
  const [consentFor, setConsentFor] = useState<ConnectorLinkSummary | null>(null);
  const noun = ACCOUNT_NOUN[inst.provider];
  const waiting = inst.links.reduce((n, l) => n + l.bufferedCount, 0);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium">{inst.accountLabel}</span>
          {status.tone === "info" ? (
            <span className="text-caption text-muted-foreground">{status.label}</span>
          ) : (
            <Badge tone={status.tone} size="sm">
              {status.label}
            </Badge>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          {inst.status === "active" && inst.provider !== "telegram" && (
            <Button size="sm" className="max-sm:h-10" variant="outline" aria-expanded={picking} onClick={() => setPicking((p) => !p)}>
              <Hash aria-hidden="true" /> {picking ? "Close" : `Link a ${CHANNEL_NOUN[inst.provider]}`}
            </Button>
          )}
          {inst.status !== "revoked" && (
            <ConfirmDialog
              trigger={
                <Button size="sm" className="max-sm:h-10" variant="destructive-ghost" disabled={api.busy !== null}>
                  <Unplug aria-hidden="true" /> Disconnect {noun}
                </Button>
              }
              title={`Disconnect ${inst.accountLabel}?`}
              description={`Baton removes its app from this ${noun} and stops every channel linked from it, in all your handovers.${waiting > 0 ? ` ${plural(waiting, "message")} not yet added will be deleted.` : " Messages not yet added are deleted."} Sources already added to handovers stay; remove them in Sources if you want.`}
              confirmLabel={`Disconnect ${noun}`}
              destructive
              onConfirm={async () => {
                await api.act(`inst:${inst.id}`, () => actions.disconnectInstallation({ installationId: inst.id }), () => `${inst.accountLabel} disconnected.`);
              }}
            />
          )}
        </div>
      </div>
      {status.detail && <p className="text-caption text-muted-foreground">{status.detail}</p>}

      {picking && (
        <ChannelPicker
          inst={inst}
          api={api}
          onLinked={(link) => {
            setPicking(false);
            setConsentFor(link);
          }}
        />
      )}

      {consentFor && (
        <ConsentStep
          link={consentFor}
          onCancel={() => setConsentFor(null)}
          onDone={() => {
            setConsentFor(null);
            api.reload();
          }}
        />
      )}

      {inst.links.length > 0 && (
        <ul className="divide-y divide-border" aria-label={`Channels linked from ${inst.accountLabel}`}>
          {inst.links.map((l) => (
            <li key={l.id} className="py-3 first:pt-0 last:pb-0">
              <LinkRow link={l} api={api} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ChannelPicker({ inst, api, onLinked }: { inst: ConnectorInstallationSummary; api: PanelApi; onLinked(link: ConnectorLinkSummary): void }) {
  const actions = useConnectorActions();
  const name = useId();
  const [channels, setChannels] = useState<ChannelChoiceDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string>("");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let live = true;
    actions.listInstallationChannels({ installationId: inst.id, handoverId: api.handoverId })
      .then((r) => {
        if (!live) return;
        if (r.ok) {
          setChannels(r.data);
          setError(null);
        } else setError(r.error.message);
      })
      .catch(() => live && setError("Couldn't load channels. Try again."));
    return () => {
      live = false;
    };
  }, [actions, inst.id, api.handoverId, attempt]);

  if (error)
    return (
      <Alert tone="danger" action={<Button size="xs" variant="outline" onClick={() => setAttempt((a) => a + 1)}>Try again</Button>}>
        {error}
      </Alert>
    );
  if (!channels) return <p className="text-caption text-muted-foreground">Loading channels…</p>;
  if (channels.length === 0) return <p className="text-caption text-muted-foreground">Baton can&apos;t see any channels in this {ACCOUNT_NOUN[inst.provider]}.</p>;

  return (
    <fieldset className="space-y-2 rounded-2xl border border-border p-3">
      <legend className="px-1 text-caption font-medium">Choose a channel for this handover</legend>
      <ul className="max-h-72 space-y-1 overflow-y-auto">
        {channels.map((c) => {
          const blocked = blockedReasonText(c.blockedReason, inst.provider);
          const disabled = !!blocked || c.linked;
          const hintId = `${name}-${c.id}-hint`;
          return (
            <li key={c.id}>
              <label className={`flex items-start gap-2.5 rounded-md px-2 py-1.5 text-sm ${disabled ? "text-muted-foreground" : "hover:bg-muted"}`}>
                <input
                  type="radio"
                  name={name}
                  value={c.id}
                  checked={selected === c.id}
                  disabled={disabled}
                  onChange={() => setSelected(c.id)}
                  aria-describedby={blocked || c.linked ? hintId : undefined}
                  className="mt-1 size-4 shrink-0 accent-[var(--primary)]"
                />
                <span>
                  <span className="font-medium">{c.label}</span>
                  {(blocked || c.linked) && (
                    <span id={hintId} className="block text-caption">
                      {c.linked ? "Already linked to this handover." : blocked}
                    </span>
                  )}
                </span>
              </label>
            </li>
          );
        })}
      </ul>
      <Button
        size="sm"
        disabled={!selected || api.busy !== null}
        onClick={async () => {
          const r = await api.act(`pick:${inst.id}`, () => actions.linkChannel({ installationId: inst.id, handoverId: api.handoverId, externalChannelId: selected }), (l) => `${l.channelLabel} linked. Confirm below to start saving messages.`);
          if (r?.ok) onLinked(r.data);
        }}
      >
        Link channel
      </Button>
    </fieldset>
  );
}

function LinkRow({ link, api }: { link: ConnectorLinkSummary; api: PanelApi }) {
  const actions = useConnectorActions();
  const [consenting, setConsenting] = useState(false);
  const s = linkStatus(link, { pullBased: PULL_BASED.has(link.provider) });
  const Settings = PROVIDER_SETTINGS[link.provider];
  const busy = api.busy !== null;

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium">{link.channelLabel}</span>
          <Badge tone={s.tone} size="sm" dot>
            {s.label}
          </Badge>
        </div>
      </div>
      {s.facts.length > 0 && (
        <ul className="space-y-0.5 text-caption text-muted-foreground">
          {s.facts.map((f) => (
            <li key={f}>{f}</li>
          ))}
        </ul>
      )}
      {s.problem && <Alert tone="warning">{s.problem}</Alert>}

      {consenting && (
        <ConsentStep
          link={link}
          onCancel={() => setConsenting(false)}
          onDone={() => {
            setConsenting(false);
            api.reload();
          }}
        />
      )}

      <div className="flex flex-wrap gap-2">
        {s.needsConsent && !consenting && (
          <Button size="sm" className="max-sm:h-10" onClick={() => setConsenting(true)}>
            Review and start
          </Button>
        )}
        {s.canBringIn && (
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() =>
              api.act(`sync:${link.id}`, () => actions.syncLinkNow({ linkId: link.id }), (r) =>
                r.status === "flushed" && r.messages > 0
                  ? `Added ${plural(r.messages, "message")} to the handover. Review the update in Sources and give consent to process it.`
                  : "There was nothing new to add.",
              )
            }
          >
            <RefreshCw aria-hidden="true" /> {api.busy === `sync:${link.id}` ? "Bringing in…" : "Bring in new messages"}
          </Button>
        )}
        {s.canPause && (
          <Button size="sm" className="max-sm:h-10" variant="ghost" disabled={busy} onClick={() => api.act(`pause:${link.id}`, () => actions.setCapturePaused({ linkId: link.id, paused: true }), () => `Paused ${link.channelLabel}.`)}>
            <Pause aria-hidden="true" /> Pause
          </Button>
        )}
        {s.canResume && (
          <Button size="sm" className="max-sm:h-10" variant="ghost" disabled={busy} onClick={() => api.act(`resume:${link.id}`, () => actions.setCapturePaused({ linkId: link.id, paused: false }), () => `Resumed ${link.channelLabel}.`)}>
            <Play aria-hidden="true" /> Resume
          </Button>
        )}
        <ConfirmDialog
          trigger={
            <Button size="sm" className="max-sm:h-10" variant="destructive-ghost" disabled={busy}>
              Disconnect channel
            </Button>
          }
          title={`Disconnect ${link.channelLabel}?`}
          description={`Baton stops saving messages from this channel for this handover${link.bufferedCount > 0 ? ` and deletes the ${plural(link.bufferedCount, "message")} not yet added` : ""}. Messages already added stay in Sources; remove them there if you want.`}
          confirmLabel="Disconnect channel"
          destructive
          onConfirm={async () => {
            await api.act(`unlink:${link.id}`, () => actions.unlinkChannel({ linkId: link.id }), () => `${link.channelLabel} disconnected.`);
          }}
        />
      </div>

      {Settings && link.state !== "pending_consent" && <Settings handoverId={api.handoverId} link={link} onSaved={api.reload} />}
    </div>
  );
}
