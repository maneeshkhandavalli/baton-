import Link from "next/link";
import { History } from "lucide-react";

import { formatDate } from "@/components/handover/format";
import { Badge } from "@/components/ui/badge";
import type { PublicationVersionSummary } from "@/lib/actions/core/revisions";
import { cn } from "@/lib/utils";

/**
 * Round 4 B (audit E2): every published version of the handover, newest first, for the creator, reviewers and the
 * incoming member. The list and each version come through RLS (membership and clearance), so a viewer only ever
 * sees what they could read in the current version. Earlier versions are read-only.
 */
export function VersionSwitcher({
  handoverId,
  versions,
  selectedVersion,
}: {
  handoverId: string;
  versions: PublicationVersionSummary[];
  selectedVersion: number;
}) {
  if (versions.length < 2) return null;
  return (
    <nav aria-label="Published versions" className="rounded-2xl border border-border bg-card p-4" data-testid="version-switcher">
      <p className="flex items-center gap-2 text-sm font-medium">
        <History className="size-4 text-muted-foreground" aria-hidden />
        Published versions
      </p>
      <ul className="mt-3 flex flex-wrap gap-2">
        {versions.map((v) => {
          const selected = v.version === selectedVersion;
          const href = v.isCurrent ? `/handover/${handoverId}/published` : `/handover/${handoverId}/published?version=${v.version}`;
          return (
            <li key={v.publicationId}>
              <Link
                href={href}
                aria-current={selected ? "page" : undefined}
                className={cn(
                  "flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm transition-colors",
                  selected ? "border-border-strong bg-muted text-foreground" : "border-border text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
              >
                <span className="font-medium">Version {v.version}</span>
                <span className="text-caption">{formatDate(v.publishedAt)}</span>
                {v.isCurrent ? (
                  <Badge tone="success" size="sm">
                    Current
                  </Badge>
                ) : null}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/** Shown above an earlier version: it is history, not what the team works from now. */
export function EarlierVersionNotice({ handoverId, version, publishedAt, currentVersion }: { handoverId: string; version: number; publishedAt: string; currentVersion: number | null }) {
  return (
    <div role="status" className="rounded-2xl border border-warning/25 bg-warning-soft p-4 text-sm text-warning-fg" data-testid="earlier-version-notice">
      <p className="font-medium">
        You are reading version {version}, published on {formatDate(publishedAt)}.
      </p>
      <p className="mt-1">
        This is an earlier version, kept as it was published. It can&rsquo;t be acknowledged.{" "}
        <Link href={`/handover/${handoverId}/published`} className="font-medium underline underline-offset-2">
          {currentVersion ? `Read the current version (version ${currentVersion})` : "Read the current version"}
        </Link>
      </p>
    </div>
  );
}
