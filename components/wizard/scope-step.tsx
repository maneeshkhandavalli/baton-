"use client";

import { FileText, MessageCircle, UserX } from "lucide-react";

import { formatCount, formatDate } from "@/components/handover/format";
import { accessLevelMeta, identityKindLabel } from "@/components/handover/labels";
import { MaskedText } from "@/components/shared/masked-text";
import { Alert } from "@/components/ui/alert";
import { ChoiceCard } from "@/components/ui/choice-card";
import { Field, FieldGroup } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { ACCESS_LEVELS } from "@/lib/contracts/enums";
import { cn } from "@/lib/utils";

import type { DraftSource } from "./draft-state";

const dateOnly = (iso: string | null | undefined) => (iso ? iso.slice(0, 10) : "");

/** Step 4: per source — date range, conversations, people left out, document date, and who may see it. */
export function ScopeStep({ sources, update }: { sources: DraftSource[]; update: (id: string, patch: Partial<DraftSource>) => void }) {
  const toggle = (list: string[], v: string) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  return (
    <div className="space-y-6">
      {sources.some((s) => s.excludedParticipants.length > 0) && (
        <Alert tone="warning" title="People you leave out are saved when you continue">
          They are left out of every chat in this handover, including later uploads. That can&rsquo;t be undone here.
        </Alert>
      )}
      {sources.map((s) => {
        const p = s.preview;
        const keptConversations = p?.conversations.filter((c) => !s.excludedConversations.includes(c.localId)) ?? [];
        const KindIcon = s.kind === "whatsapp_export" ? MessageCircle : FileText;
        return (
          <section key={s.localId} className="overflow-hidden rounded-xl border border-border bg-card shadow-soft" aria-labelledby={`${s.localId}-name`}>
            <header className="flex items-center gap-2.5 border-b border-border bg-muted/40 px-4 py-3 sm:px-5">
              <KindIcon aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
              <h3 id={`${s.localId}-name`} className="min-w-0 truncate type-subheading" title={s.name}>
                {s.name}
              </h3>
            </header>

            <div className="space-y-8 p-4 sm:p-5">
              {s.kind === "whatsapp_export" && p ? (
                <>
                  <FieldGroup legend="Dates to read" description={`The export covers ${formatDate(p.firstMessageAt)} to ${formatDate(p.lastMessageAt)}.`}>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <Field id={`${s.localId}-from`} label="From">
                        <Input
                          id={`${s.localId}-from`}
                          type="date"
                          value={s.rangeFrom}
                          min={dateOnly(p.firstMessageAt)}
                          max={s.rangeTo || dateOnly(p.lastMessageAt)}
                          onChange={(e) => update(s.localId, { rangeFrom: e.target.value })}
                        />
                      </Field>
                      <Field id={`${s.localId}-to`} label="To">
                        <Input
                          id={`${s.localId}-to`}
                          type="date"
                          value={s.rangeTo}
                          min={s.rangeFrom || dateOnly(p.firstMessageAt)}
                          max={dateOnly(p.lastMessageAt)}
                          onChange={(e) => update(s.localId, { rangeTo: e.target.value })}
                        />
                      </Field>
                    </div>
                  </FieldGroup>

                  <FieldGroup
                    legend={
                      <>
                        Conversations{" "}
                        <span className="font-normal text-muted-foreground">
                          · {keptConversations.length} of {p.conversations.length} included
                        </span>
                      </>
                    }
                    description="Untick conversations that aren't about this role."
                  >
                    <ul className="divide-y divide-border rounded-lg border border-border">
                      {p.conversations.map((c) => {
                        const included = !s.excludedConversations.includes(c.localId);
                        return (
                          <li key={c.localId}>
                            <label className={cn("flex cursor-pointer items-start gap-3 p-3 text-sm transition-colors hover:bg-muted/40", !included && "bg-muted/50 text-muted-foreground")}>
                              <input
                                type="checkbox"
                                className="mt-0.5 size-4 shrink-0 accent-primary"
                                checked={included}
                                onChange={() => update(s.localId, { excludedConversations: toggle(s.excludedConversations, c.localId) })}
                              />
                              <span className="min-w-0">
                                <MaskedText text={c.preview} className={cn("block type-quote", !included && "line-through")} />
                                <span className="text-caption text-muted-foreground">
                                  {formatDate(c.startedAt)} – {formatDate(c.endedAt)} · {formatCount(c.messageCount)} messages
                                </span>
                              </span>
                            </label>
                          </li>
                        );
                      })}
                    </ul>
                  </FieldGroup>

                  <FieldGroup
                    legend="People"
                    description="Untick anyone who asked to be left out. Their messages are dropped before anything is saved, in every chat of this handover. People saved under a name, not a number, are matched in other chats only after you confirm it's the same person."
                  >
                    <div className="flex flex-wrap gap-2">
                      {p.participants.map((person) => {
                        const included = !s.excludedParticipants.includes(person.localId);
                        return (
                          <label
                            key={person.localId}
                            title={identityKindLabel[person.identityKind].label}
                            className={cn(
                              "inline-flex min-h-9 cursor-pointer items-center gap-2 rounded-full border px-3 text-caption transition-colors has-focus-visible:ring-3 has-focus-visible:ring-ring/35",
                              included ? "border-border-strong bg-card" : "border-warning/30 bg-warning-soft text-warning-fg",
                            )}
                          >
                            <input
                              type="checkbox"
                              className="size-3.5 accent-primary outline-none"
                              checked={included}
                              onChange={() => update(s.localId, { excludedParticipants: toggle(s.excludedParticipants, person.localId) })}
                            />
                            <span className={cn(!included && "line-through")}>{person.displayLabel}</span>
                            <span className="text-muted-foreground tabular-nums">{formatCount(person.messageCount)}</span>
                            {!included && <span className="sr-only">(will be left out)</span>}
                          </label>
                        );
                      })}
                    </div>
                    {(s.savedParticipantExclusions > 0 || p.stats.messagesExcluded > 0) && (
                      <p className="flex items-start gap-1.5 text-caption text-muted-foreground">
                        <UserX aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
                        <span>
                          {s.savedParticipantExclusions > 0 ? `${s.savedParticipantExclusions === 1 ? "1 person" : `${s.savedParticipantExclusions} people`} left out and saved. ` : ""}
                          {formatCount(p.stats.messagesExcluded)} messages won&rsquo;t be read.
                          {p.warnings.some((w) => w.code === "excluded_mentions_redacted") && " Mentions of them in other messages are removed."}
                        </span>
                      </p>
                    )}
                  </FieldGroup>
                </>
              ) : (
                <Field id={`${s.localId}-date`} label="Document date" optional hint="Used to flag points that may be outdated." className="max-w-xs">
                  <Input
                    id={`${s.localId}-date`}
                    type="date"
                    value={s.documentDate}
                    onChange={(e) => update(s.localId, { documentDate: e.target.value })}
                    aria-describedby={`${s.localId}-date-hint`}
                  />
                </Field>
              )}

              <FieldGroup legend="Who can see evidence from this source?">
                <div className="grid gap-3 sm:grid-cols-3">
                  {ACCESS_LEVELS.map((level) => (
                    <ChoiceCard
                      key={level}
                      name={`${s.localId}-access`}
                      checked={s.accessLevel === level}
                      onChange={() => update(s.localId, { accessLevel: level })}
                      title={accessLevelMeta[level].label}
                      description={accessLevelMeta[level].description}
                    />
                  ))}
                </div>
              </FieldGroup>
            </div>
          </section>
        );
      })}
    </div>
  );
}
