"use client";

/**
 * GitHub link settings (Worker 02): which event families of the repository are captured for this handover.
 * Controlled and DTO-driven: the generic connectors panel (Worker 03) passes the link's `settings` and persists
 * changes through Main's settings action. Validation of the stored value happens server-side in the adapter
 * (`githubAdapter.parseSettings`); this component only edits the five booleans.
 */

import { useId } from "react";

const FAMILIES = [
  { key: "issues", label: "Issues", hint: "Opened, edited, closed and reopened issues, and their comments." },
  { key: "pullRequests", label: "Pull requests", hint: "Opened, merged, closed and ready-for-review pull requests, and their comments." },
  { key: "reviews", label: "Reviews", hint: "Approvals, change requests and review summaries. Inline code comments are never captured." },
  { key: "commits", label: "Commits", hint: "Commit messages pushed to the default branch. Never code or diffs." },
  { key: "releases", label: "Releases", hint: "Published release notes." },
] as const;

export type GithubFamilyKey = (typeof FAMILIES)[number]["key"];
export type GithubFamiliesValue = Record<GithubFamilyKey, boolean>;

/** Reads families from a link's settings JSON (missing or malformed values default to on, like the server). */
export function githubFamiliesFromSettings(settings: Record<string, unknown> | null | undefined): GithubFamiliesValue {
  const raw = settings && typeof settings.families === "object" && settings.families !== null ? (settings.families as Record<string, unknown>) : {};
  return Object.fromEntries(FAMILIES.map((f) => [f.key, raw[f.key] !== false])) as GithubFamiliesValue;
}

export function GithubSettings({
  settings,
  onChange,
  disabled = false,
}: {
  settings: Record<string, unknown> | null | undefined;
  /** Called with the full next settings object (other keys preserved). */
  onChange: (next: Record<string, unknown>) => void;
  disabled?: boolean;
}) {
  const id = useId();
  const families = githubFamiliesFromSettings(settings);
  return (
    <fieldset className="space-y-3" disabled={disabled}>
      <legend className="text-sm font-medium">What Baton captures from this repository</legend>
      {FAMILIES.map((f) => (
        <div key={f.key} className="flex items-start gap-3">
          <input
            id={`${id}-${f.key}`}
            type="checkbox"
            className="mt-1 size-4 accent-foreground"
            checked={families[f.key]}
            onChange={(e) => onChange({ ...(settings ?? {}), families: { ...families, [f.key]: e.target.checked } })}
          />
          <label htmlFor={`${id}-${f.key}`} className="text-sm">
            <span className="font-medium">{f.label}</span>
            <span className="block text-muted-foreground">{f.hint}</span>
          </label>
        </div>
      ))}
      <p className="text-xs text-muted-foreground">Bots are always skipped. Changes apply to new events only.</p>
    </fieldset>
  );
}
