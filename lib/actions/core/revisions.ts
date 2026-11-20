/**
 * Round 4 B (audit E2): the version history of a published handover, read with the USER's session so RLS decides
 * what is visible (membership for the publication list; clearance, redaction and privacy hold for every point), exactly
 * as for the current version (api_get_published_handover). Read-only RPCs from migration 20261121200100:
 *   api_list_publication_versions(handover)       → PublicationVersionSummary[] (newest first)
 *   api_get_publication_version(handover, version) → PublishedHandover (same shape as the current version)
 * Takes the user-scoped client explicitly (lib/db `userDb()`), never the service role.
 */

import { z } from "zod";

import type { Result } from "../../contracts/api";
import type { PublishedHandover } from "../../contracts/dto";
import type { DbClient } from "../../db/client";
import { isDbError } from "../../db/errors";
import { mapPublishedHandover } from "../../db/mappers";
import { callRpc } from "../../db/rpc";
import { diffPublications, type PublicationDiff } from "../../signals/publication-diff";

export interface PublicationVersionSummary {
  publicationId: string;
  version: number;
  publishedAt: string;
  publishedByLabel: string;
  isCurrent: boolean;
  /** Points of that version the viewer may read. */
  visiblePoints: number;
  viewerAcknowledgedAt: string | null;
}

const UUID = z.string().uuid();

const versionRow = z.object({
  publication_id: z.string(),
  version: z.number().int().positive(),
  published_at: z.string(),
  published_by_label: z.string(),
  is_current: z.boolean(),
  visible_points: z.number().int().nonnegative(),
  viewer_acknowledged_at: z.string().nullable(),
});

export function mapPublicationVersions(raw: unknown): PublicationVersionSummary[] {
  return z.array(versionRow).parse(raw).map((r) => ({
    publicationId: r.publication_id,
    version: r.version,
    publishedAt: r.published_at,
    publishedByLabel: r.published_by_label,
    isCurrent: r.is_current,
    visiblePoints: r.visible_points,
    viewerAcknowledgedAt: r.viewer_acknowledged_at,
  }));
}

/** A version number from a query string: a positive integer, or null. */
export function parseVersionParam(value: string | string[] | undefined): number | null {
  const v = Array.isArray(value) ? value[0] : value;
  if (!v || !/^[1-9][0-9]{0,5}$/.test(v)) return null;
  return Number(v);
}

async function read<T>(work: () => Promise<T>): Promise<Result<T>> {
  try {
    return { ok: true, data: await work() };
  } catch (e) {
    if (isDbError(e) && e.code === "not_found") return { ok: false, error: { code: "not_found", message: "Not found.", retryable: false } };
    return { ok: false, error: { code: "internal", message: "We couldn't load the earlier versions.", retryable: true } };
  }
}

export async function listPublicationVersions(db: DbClient, handoverId: string): Promise<Result<PublicationVersionSummary[]>> {
  if (!UUID.safeParse(handoverId).success) return { ok: false, error: { code: "not_found", message: "Not found.", retryable: false } };
  return read(async () => mapPublicationVersions((await callRpc(db, "api_list_publication_versions", { p_handover_id: handoverId })) ?? []));
}

export async function getPublicationVersion(db: DbClient, handoverId: string, version: number): Promise<Result<PublishedHandover>> {
  if (!UUID.safeParse(handoverId).success || !Number.isInteger(version) || version < 1) {
    return { ok: false, error: { code: "not_found", message: "Not found.", retryable: false } };
  }
  const data = await read(async () => callRpc(db, "api_get_publication_version", { p_handover_id: handoverId, p_version: version }));
  if (!data.ok) return data;
  if (data.data === null || data.data === undefined) return { ok: false, error: { code: "not_found", message: "Not found.", retryable: false } };
  return read(async () => mapPublishedHandover(data.data));
}

/**
 * "What changed since v(N-1)" for the version the viewer is reading: null for version 1, or when the previous
 * version cannot be read (deleted or never visible to this viewer).
 */
export async function whatChangedSincePrevious(db: DbClient, current: PublishedHandover): Promise<PublicationDiff | null> {
  if (current.version <= 1) return null;
  const previous = await getPublicationVersion(db, current.handoverId, current.version - 1);
  if (!previous.ok) return null;
  return diffPublications(previous.data, current);
}
