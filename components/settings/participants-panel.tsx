"use client";

import { UserX } from "lucide-react";

import { formatCount, formatDate } from "@/components/handover/format";
import { exclusionKindLabel, identityKindLabel } from "@/components/handover/labels";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { MaskedText } from "@/components/shared/masked-text";
import { Button } from "@/components/ui/button";
import { useAction } from "@/hooks/use-action";
import type { ExclusionSummary, SourceParticipantSummary, SourceSummary } from "@/lib/contracts/dto";
import { eraseParticipant } from "@/lib/actions/privacy";

interface ParticipantsPanelProps {
  handoverId: string;
  participants: SourceParticipantSummary[];
  exclusions: ExclusionSummary[];
  sources: SourceSummary[];
  creator: boolean;
}

function exclusionDetail(e: ExclusionSummary, sourceTitle: (id: string | null) => string) {
  const where = e.scope === "handover" ? "every source" : sourceTitle(e.sourceId);
  if (e.kind === "participant") return `${e.identityKind ? identityKindLabel[e.identityKind].label : "Identity"} · ${where}`;
  if (e.kind === "conversation") return `Conversation ${e.conversationLocalId?.replace("c_", "#") ?? ""} · ${where}`;
  return `${formatDate(e.rangeStart)} – ${formatDate(e.rangeEnd)} · ${where}`;
}

/**
 * Review roles: who was parsed from each chat, and what was left out (§12.2, `listParticipants`,
 * `listExclusions`). Exclusions never name the person. Erasure (§12.8) is creator-only.
 */
export function ParticipantsPanel({ handoverId, participants, exclusions, sources, creator }: ParticipantsPanelProps) {
  const { run } = useAction();
  const sourceTitle = (id: string | null) => sources.find((s) => s.id === id)?.title ?? "a removed source";
  const bySource = new Map<string, SourceParticipantSummary[]>();
  for (const p of participants) bySource.set(p.sourceTitle, [...(bySource.get(p.sourceTitle) ?? []), p]);

  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <h3 className="text-sm font-medium">People in the chats</h3>
        {participants.length === 0 ? (
          <p className="text-sm text-muted-foreground">No chat participants yet. They appear after processing.</p>
        ) : (
          [...bySource.entries()].map(([title, people]) => (
            <div key={title} className="space-y-1.5">
              <p className="text-xs text-muted-foreground">{title}</p>
              <ul className="divide-y divide-border rounded-lg border border-border">
                {people.map((p) => (
                  <li key={p.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm">{p.displayLabel}</p>
                      <p className="text-xs text-muted-foreground" title={identityKindLabel[p.identityKind].description}>
                        {identityKindLabel[p.identityKind].label} · {formatCount(p.messageCount)} messages
                        {p.excluded && " · left out"}
                      </p>
                    </div>
                    {creator && !p.excluded && (
                      <ConfirmDialog
                        trigger={
                          <Button size="xs" variant="ghost" aria-label={`Erase ${p.displayLabel}`}>
                            <UserX aria-hidden="true" data-icon="inline-start" />
                            Erase
                          </Button>
                        }
                        title={`Erase ${p.displayLabel}?`}
                        description={
                          p.identityKind === "name"
                            ? "Their messages and quotes in this chat are deleted, affected points go to privacy review and published versions are redacted. Names are weak identities: people with the same saved name in other chats are reported, not erased. This can't be undone."
                            : "Their messages and quotes in every chat of this handover are deleted, affected points go to privacy review and published versions are redacted. This can't be undone."
                        }
                        confirmLabel="Erase permanently"
                        destructive
                        onConfirm={async () => {
                          await run(() => eraseParticipant({ handoverId, participantId: p.id, confirm: true }), { success: "Participant erased" });
                        }}
                      />
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))
        )}
      </div>

      <div className="space-y-2">
        <h3 className="text-sm font-medium">Left out before processing</h3>
        {exclusions.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing was left out.</p>
        ) : (
          <ul className="divide-y divide-border rounded-lg border border-border">
            {exclusions.map((e) => (
              <li key={e.id} className="px-3 py-2">
                <p className="text-sm">
                  {exclusionKindLabel[e.kind]}
                  {e.requestedVia === "participant_request" && <span className="text-muted-foreground"> · at their request</span>}
                </p>
                <p className="text-xs text-muted-foreground">
                  {exclusionDetail(e, sourceTitle)} · {formatDate(e.createdAt)}
                  {e.reason && (
                    <>
                      {" · "}
                      <MaskedText text={e.reason} />
                    </>
                  )}
                </p>
              </li>
            ))}
          </ul>
        )}
        <p className="text-xs text-muted-foreground">Exclusions are permanent and never name the person.</p>
      </div>
    </div>
  );
}
