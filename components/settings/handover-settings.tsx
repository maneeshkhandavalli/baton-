"use client";

import { useRouter } from "next/navigation";
import { Check, Clock, Copy, Crown, FileText, MessageCircle, RotateCcw, ShieldCheck, Trash2, UserMinus, UserPlus, X } from "lucide-react";
import { useState } from "react";

import { AccessBadge, HandoverStateBadge } from "@/components/handover/badges";
import { formatBytes, formatCount, formatDate, formatDateRange } from "@/components/handover/format";
import { AccessLinks } from "@/components/settings/access-links";
import { ParticipantsPanel } from "@/components/settings/participants-panel";
import { accessLevelMeta, maskKindLabel, memberRoleLabel, sourceKindLabel, sourceStateLabel } from "@/components/handover/labels";
import { ConfirmDialog } from "@/components/shared/confirm-dialog";
import { SectionHeading } from "@/components/shared/section-heading";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAction } from "@/hooks/use-action";
import type { AccessTokenSummary, ExclusionSummary, HandoverSummary, MemberSummary, SourceParticipantSummary, SourceSummary } from "@/lib/contracts/dto";
import { ACCESS_LEVELS, type AccessLevel, type MaskKind, type MemberRole } from "@/lib/contracts/enums";
import { deleteHandover, offerCreatorTransfer, respondToCreatorTransfer, startRevision } from "@/lib/actions/handovers";
import { inviteMember, removeMember, updateMemberClearance } from "@/lib/actions/members";
import { removeSource } from "@/lib/actions/sources";
import { routes } from "@/lib/routes";

interface HandoverSettingsProps {
  handover: HandoverSummary;
  members: MemberSummary[];
  sources: SourceSummary[];
  /** Review roles only; empty otherwise. */
  tokens: AccessTokenSummary[];
  participants: SourceParticipantSummary[];
  exclusions: ExclusionSummary[];
}

function Panel({ children, id }: { children: React.ReactNode; id?: string }) {
  return (
    <section id={id} className="space-y-5 rounded-xl border border-border bg-card p-5 shadow-soft sm:p-6">
      {children}
    </section>
  );
}

const selectClass = "h-8 rounded-lg border border-input bg-card px-2 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-60";

export function HandoverSettings({ handover: h, members, sources, tokens, participants, exclusions }: HandoverSettingsProps) {
  const router = useRouter();
  const { run, isPending } = useAction();
  const creator = h.viewerIsCreator;
  const review = h.viewerRole === "outgoing" || h.viewerRole === "reviewer";
  const me = members.find((m) => m.isViewer);
  const offer = h.pendingCreatorTransfer;
  const offeredTo = offer ? members.find((m) => m.id === offer.toMemberId) : undefined;
  const offerIsForMe = !!offer && !!me && offer.toMemberId === me.id;
  const canManageSources = creator || h.viewerRole === "outgoing";
  const [invite, setInvite] = useState<{ email: string; role: MemberRole; clearance: AccessLevel | "" }>({ email: "", role: "incoming", clearance: "" });
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [transferTo, setTransferTo] = useState("");

  // §12.9: an active outgoing or reviewer member who is not the creator (the server checks this too).
  const transferable = members.filter((m) => !m.isCreator && (m.role === "outgoing" || m.role === "reviewer"));
  const masking = sources.reduce<Partial<Record<MaskKind, number>>>((acc, s) => {
    for (const [k, v] of Object.entries(s.maskingCounts ?? {})) acc[k as MaskKind] = (acc[k as MaskKind] ?? 0) + (v ?? 0);
    return acc;
  }, {});
  const reviewRole = invite.role === "outgoing" || invite.role === "reviewer";

  return (
    <div className="space-y-6">
      <Panel>
        <SectionHeading title="Handover" description="Lifecycle and basic details." />
        <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-[10rem_1fr]">
          <dt className="text-muted-foreground">Status</dt>
          <dd>
            <HandoverStateBadge state={h.state} />
          </dd>
          <dt className="text-muted-foreground">Team</dt>
          <dd>{h.teamName}</dd>
          <dt className="text-muted-foreground">Role</dt>
          <dd>{h.roleTitle ?? "—"}</dd>
          <dt className="text-muted-foreground">Created</dt>
          <dd>{formatDate(h.createdAt)}</dd>
          <dt className="text-muted-foreground">Your access</dt>
          <dd>
            {memberRoleLabel[h.viewerRole]}
            {creator && " · creator"} · <AccessBadge level={h.viewerClearance} className="align-middle" />
          </dd>
        </dl>
        {offerIsForMe && offer && (
          <div className="flex flex-col gap-3 rounded-lg border border-primary/25 bg-primary-soft/50 p-3 sm:flex-row sm:items-center">
            <Crown aria-hidden="true" className="hidden size-4 shrink-0 text-primary sm:block" />
            <p className="flex-1 text-sm">
              {members.find((m) => m.isCreator)?.displayName ?? "The creator"} offered you creatorship on {formatDate(offer.offeredAt)}. As creator you publish, invite
              people and can delete the handover.
            </p>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" disabled={isPending} onClick={() => run(() => respondToCreatorTransfer({ handoverId: h.id, accept: false }), { success: "Offer declined" })}>
                <X aria-hidden="true" data-icon="inline-start" />
                Decline
              </Button>
              <Button size="sm" disabled={isPending} onClick={() => run(() => respondToCreatorTransfer({ handoverId: h.id, accept: true }), { success: "You're now the creator" })}>
                <Check aria-hidden="true" data-icon="inline-start" />
                Accept
              </Button>
            </div>
          </div>
        )}
        {creator && (h.state === "approved" || h.state === "acknowledged") && (
          <div className="flex flex-col gap-3 border-t border-border pt-5 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-muted-foreground">The published version stays readable while you revise. Publishing again asks the incoming member to re-acknowledge.</p>
            <Button variant="outline" disabled={isPending} onClick={() => run(() => startRevision({ handoverId: h.id }), { success: "Revision started", onSuccess: () => router.push(routes.handover.review(h.id)) })}>
              <RotateCcw aria-hidden="true" data-icon="inline-start" />
              Start a revision
            </Button>
          </div>
        )}
      </Panel>

      <Panel id="members">
        <SectionHeading
          title="Members and access"
          description={creator ? "Clearance decides which points each person can see. Outgoing and reviewer members always see everything." : "Only the creator can invite people or change access."}
        />
        <ul className="divide-y divide-border rounded-lg border border-border">
          {members.map((m) => {
            const fixed = m.role === "outgoing" || m.role === "reviewer";
            return (
              <li key={m.id} className="flex flex-col gap-2 px-3 py-3 sm:flex-row sm:items-center">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">
                    {m.displayName}
                    {m.isViewer && <span className="font-normal text-muted-foreground"> (you)</span>}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {memberRoleLabel[m.role]}
                    {m.isCreator && " · creator"}
                    {m.ackRequired && " · must acknowledge"}
                  </p>
                </div>
                {m.clearance && (
                  <div className="flex items-center gap-2">
                    <Label htmlFor={`clr-${m.id}`} className="sr-only">
                      Clearance for {m.displayName}
                    </Label>
                    <select
                      id={`clr-${m.id}`}
                      className={selectClass}
                      value={m.clearance}
                      disabled={!creator || fixed || isPending}
                      title={fixed ? "Outgoing and reviewer members always have reviewer-only clearance" : undefined}
                      onChange={(e) => run(() => updateMemberClearance({ memberId: m.id, clearance: e.target.value as AccessLevel }), { success: "Clearance updated" })}
                    >
                      {ACCESS_LEVELS.map((l) => (
                        <option key={l} value={l}>
                          Sees: {accessLevelMeta[l].label}
                        </option>
                      ))}
                    </select>
                    {creator && !m.isCreator && (
                      <ConfirmDialog
                        trigger={
                          <Button size="icon-sm" variant="ghost" aria-label={`Remove ${m.displayName}`}>
                            <UserMinus />
                          </Button>
                        }
                        title={`Remove ${m.displayName}?`}
                        description="They lose access straight away. Their contributions and evidence stay."
                        confirmLabel="Remove"
                        destructive
                        onConfirm={async () => {
                          await run(() => removeMember({ memberId: m.id }), { success: "Member removed" });
                        }}
                      />
                    )}
                  </div>
                )}
                {!m.clearance && <span className="text-xs text-muted-foreground">Access details are visible to the creator</span>}
              </li>
            );
          })}
        </ul>

        {creator && (
          <form
            className="space-y-3 border-t border-border pt-5"
            onSubmit={(e) => {
              e.preventDefault();
              void run(
                () =>
                  inviteMember({
                    handoverId: h.id,
                    email: invite.email,
                    role: invite.role,
                    clearance: reviewRole || !invite.clearance ? undefined : invite.clearance,
                  }),
                {
                  success: "Invite created",
                  onSuccess: (d) => {
                    // The real action returns an absolute URL (BATON_SITE_URL); the mock returns a path.
                    setInviteLink(new URL(d.url, window.location.origin).href);
                    setInvite({ email: "", role: "incoming", clearance: "" });
                  },
                },
              );
            }}
          >
            <p className="text-sm font-medium">Invite someone</p>
            <div className="grid gap-2 sm:grid-cols-[1fr_auto_auto_auto]">
              <Label htmlFor="invite-email" className="sr-only">
                Email
              </Label>
              <Input id="invite-email" type="email" required placeholder="name@college.edu" value={invite.email} onChange={(e) => setInvite({ ...invite, email: e.target.value })} />
              <Label htmlFor="invite-role" className="sr-only">
                Role
              </Label>
              <select id="invite-role" className={selectClass} value={invite.role} onChange={(e) => setInvite({ ...invite, role: e.target.value as MemberRole, clearance: "" })}>
                <option value="incoming">Incoming</option>
                <option value="lead">Lead</option>
                <option value="reviewer">Reviewer</option>
                <option value="outgoing">Outgoing</option>
              </select>
              <Label htmlFor="invite-clearance" className="sr-only">
                Clearance
              </Label>
              <select id="invite-clearance" className={selectClass} disabled={reviewRole} value={reviewRole ? "reviewer_only" : invite.clearance} onChange={(e) => setInvite({ ...invite, clearance: e.target.value as AccessLevel })}>
                {!reviewRole && <option value="">Default clearance</option>}
                {ACCESS_LEVELS.map((l) => (
                  <option key={l} value={l}>
                    Sees: {accessLevelMeta[l].label}
                  </option>
                ))}
              </select>
              <Button type="submit" disabled={isPending || !invite.email}>
                <UserPlus aria-hidden="true" data-icon="inline-start" />
                Invite
              </Button>
            </div>
            {inviteLink && (
              <div className="space-y-1.5 rounded-lg bg-muted/40 p-3">
                <p className="text-xs text-muted-foreground">
                  Invite link, shown only once. It expires in 7 days and works once. They sign in with a magic link sent to that email.
                </p>
                <div className="flex gap-2">
                  <Input readOnly value={inviteLink} aria-label="Invite link" className="font-mono text-xs" onFocus={(e) => e.currentTarget.select()} />
                  <Button
                    type="button"
                    variant="outline"
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(inviteLink);
                        setCopied(true);
                      } catch {
                        setCopied(false);
                      }
                    }}
                  >
                    {copied ? <Check aria-hidden="true" data-icon="inline-start" /> : <Copy aria-hidden="true" data-icon="inline-start" />}
                    {copied ? "Copied" : "Copy"}
                  </Button>
                </div>
              </div>
            )}
          </form>
        )}
      </Panel>

      {review && (
        <Panel id="links">
          <SectionHeading
            title={creator ? "Invitations and links" : "Gap Interview links"}
            description="Links are shown only once, when they're created. Turn one off here if it was shared by mistake."
          />
          <AccessLinks tokens={tokens} creator={creator} />
        </Panel>
      )}

      {sources.length > 0 && (
        <Panel id="sources">
          <SectionHeading title="Sources" description="Access is set per source when consent is recorded. Points inherit the strictest level of their evidence." />
          <ul className="divide-y divide-border rounded-lg border border-border">
            {sources.map((s) => (
              <li key={s.id} className="flex items-start gap-3 px-3 py-3">
                {s.kind === "whatsapp_export" ? <MessageCircle aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-muted-foreground" /> : <FileText aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-muted-foreground" />}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{s.title}</p>
                  <p className="text-xs text-muted-foreground">
                    {sourceKindLabel[s.kind]} · {formatBytes(s.sizeBytes)} · {sourceStateLabel[s.state]}
                    {s.messageCount !== null && ` · ${formatCount(s.messageCount)} ${s.kind === "whatsapp_export" ? "messages" : "blocks"}`}
                    {s.firstMessageAt && ` · ${formatDateRange(s.firstMessageAt, s.lastMessageAt)}`}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {s.consentRecordedAt ? `Consent recorded ${formatDate(s.consentRecordedAt)}` : "No consent yet"}
                    {s.rawDeletedAt ? ` · raw upload deleted ${formatDate(s.rawDeletedAt)}` : ""}
                  </p>
                </div>
                <AccessBadge level={s.accessLevel} />
                {canManageSources && h.state !== "processing" && (
                  <ConfirmDialog
                    trigger={
                      <Button size="icon-sm" variant="ghost" aria-label={`Remove ${s.title}`}>
                        <Trash2 />
                      </Button>
                    }
                    title={`Remove ${s.title}?`}
                    description="It won't be used in future processing. Points already extracted from it keep their evidence until you reprocess."
                    confirmLabel="Remove source"
                    destructive
                    onConfirm={async () => {
                      await run(() => removeSource({ sourceId: s.id }), { success: "Source removed" });
                    }}
                  />
                )}
              </li>
            ))}
          </ul>
        </Panel>
      )}

      <Panel id="privacy">
        <SectionHeading title="Privacy" description="What Baton keeps, and how people can opt out." />
        <ul className="space-y-3 text-sm">
          <li className="flex gap-3">
            <ShieldCheck aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-status-sourced" />
            <span>
              Personal and financial details were masked before storage
              {Object.keys(masking).length > 0 && (
                <span className="text-muted-foreground">
                  {" "}
                  (
                  {(Object.entries(masking) as Array<[MaskKind, number]>)
                    .filter(([, n]) => n > 0)
                    .map(([k, n]) => `${n} ${maskKindLabel[k].label.toLowerCase()}`)
                    .join(", ")}
                  )
                </span>
              )}
              . Masked values are never revealed.
            </span>
          </li>
          <li className="flex gap-3">
            <ShieldCheck aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-status-sourced" />
            <span>Raw uploads are deleted as soon as processing succeeds. Only masked, permitted evidence is kept.</span>
          </li>
          <li className="flex gap-3">
            <ShieldCheck aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-status-sourced" />
            <span>
              <span className="font-medium">Late opt-outs.</span> If someone asks to be removed after processing, the creator can erase them as a participant. Their
              messages and quotes are deleted, affected points go to privacy review, and published versions are redacted.
            </span>
          </li>
        </ul>
        {review && (
          <div className="border-t border-border pt-5">
            <ParticipantsPanel handoverId={h.id} participants={participants} exclusions={exclusions} sources={sources} creator={creator} />
          </div>
        )}
      </Panel>

      {creator && (
        <Panel id="danger">
          <SectionHeading title="Ownership and deletion" description="Only the creator can do these." />
          {offer && (
            <p className="flex items-start gap-2 rounded-lg bg-muted/40 p-3 text-sm">
              <Clock aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
              <span>
                Creatorship offered to {offeredTo?.displayName ?? "a member"} on {formatDate(offer.offeredAt)}. You stay the creator until they accept. Offers lapse after 14
                days; sending a new one replaces it.
              </span>
            </p>
          )}
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="flex-1 space-y-1.5">
              <Label htmlFor="transfer">Offer creatorship to</Label>
              <select id="transfer" className={`${selectClass} w-full`} value={transferTo} onChange={(e) => setTransferTo(e.target.value)} disabled={transferable.length === 0}>
                <option value="">{transferable.length ? "Choose an outgoing or reviewer member" : "No eligible members"}</option>
                {transferable.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.displayName} ({memberRoleLabel[m.role]})
                  </option>
                ))}
              </select>
            </div>
            <Button
              variant="outline"
              disabled={!transferTo || isPending}
              onClick={() => run(() => offerCreatorTransfer({ handoverId: h.id, toMemberId: transferTo }), { success: "Offer sent. They need to accept it.", onSuccess: () => setTransferTo("") })}
            >
              {offer ? "Replace offer" : "Send offer"}
            </Button>
          </div>
          <div className="flex flex-col gap-3 border-t border-border pt-5 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-muted-foreground">
              Deleting removes the handover for everyone and turns off every link straight away. It&rsquo;s removed permanently after 30 days, and there&rsquo;s no undo.
            </p>
            <ConfirmDialog
              trigger={
                <Button variant="destructive">
                  <Trash2 aria-hidden="true" data-icon="inline-start" />
                  Delete handover
                </Button>
              }
              title={`Delete “${h.title}”?`}
              description="Everyone loses access and all links stop working now. Baton removes it permanently after 30 days. There is no undo."
              confirmLabel="Delete handover"
              destructive
              onConfirm={async () => {
                const r = await run(() => deleteHandover({ handoverId: h.id }), { success: "Handover deleted" });
                if (r.ok) router.push(routes.dashboard);
              }}
            />
          </div>
        </Panel>
      )}
    </div>
  );
}
