/**
 * `parse` job (§10.3 steps 3–5, D14, §12.8 point 9).
 *
 * 1. Fail closed without a verified identity pepper (retryable `processing_failed`).
 * 2. The SAME exclusion rules as the preview (`getParseExclusions`); malformed rules fail closed.
 * 3. Raw bytes re-verified against the confirmed size and SHA-256 (`downloadVerifiedRawSourceWithMeta`).
 * 4. `parseSource` drops excluded content and masks in memory; nothing is persisted before step 6.
 * 5. Any `identityMatches` entry stops here (`identity_confirmation_required`).
 * 6. R3 Task 02 (PRIV-1): pseudonymisation. Every chat sender of this source AND of the run's other
 *    unparsed chat sources is registered in the handover's encrypted identity vault (stable [PERSON_n]
 *    across sources, whatever order the parse jobs run in); labels become placeholders and mentions of every
 *    known person are replaced. Excluded people are never registered (the parser already dropped them).
 * 6b. R4 (audit 3.2 / S3): names of people who never sent a message (mentioned only, nicknames, joined
 *    honorifics, document-only handovers) are found locally (lib/privacy/name-detect.ts, no external service),
 *    registered in the vault like senders (person key from the same identity hash, so a later sender with
 *    the same name gets the same number) and replaced. A name that matches an exclusion rule is never
 *    registered (it becomes `[PERSON]`). Beyond MAX_MENTIONED_PEOPLE new names, the rest become `[PERSON]`:
 *    a name is never left in clear because the vault is full.
 * 7. `persistPseudonymizedSource`: participants, conversations and messages in ONE transaction, refused
 *    unless every label is a known placeholder; the source is marked `person_v1`.
 * 8. Only after that commit, `deleteParsedRawSource`. A failed delete is left to the retention sweep.
 *
 * Every failure before the commit keeps the raw upload for a retry; non-retryable ones mark the source
 * `failed` with a structural error code.
 */

import { isParserInputFailure, type ParsedSource } from "../../contracts/parser";
import { DbError } from "../../db/errors";
import {
  getParseExclusions,
  markSourceParseFailed,
  persistPseudonymizedSource,
  reserveHandoverPeople,
} from "../../db/pipeline";
import { deleteParsedRawSource, downloadVerifiedRawSourceWithMeta, readRawSourceForPeople } from "../../db/storage";
import { parseSource, previewSource } from "../../parsers/parse-source";
import { discoverExcludedNames } from "../../privacy/excluded-discovery";
import { compileExclusions } from "../../privacy/exclusions";
import { computeIdentityHash } from "../../privacy/identity";
import { personKeyFor, sealLabel, type IdentityMapKey } from "../../privacy/identity-vault";
import type { DiscoveredName } from "../../privacy/name-detect";
import { AMBIGUOUS_PERSON_TOKEN, personToken } from "../../privacy/pseudonymize";
import { discoverSourceNames, pseudonymizeMentionedNames, pseudonymizeParsedSource } from "../../privacy/pseudonymize-source";
import { identityMapKeyFor, openPeople, vaultLabelFor } from "../identity";
import { claimOf, type StageContext } from "../stage-context";
import { failed, type FailureReason, type StageOutcome } from "../types";

async function markFailed(ctx: StageContext, sourceId: string, errorCode: string): Promise<void> {
  try {
    await markSourceParseFailed(ctx.db, claimOf(ctx), errorCode);
  } catch (e) {
    ctx.logger.warn("source_mark_failed_error", { jobId: ctx.claimed.id, sourceId, code: e instanceof DbError ? e.code : "internal" });
  }
}

/** Fail the source (raw kept) and the job, non-retryable. */
async function failSource(
  ctx: StageContext,
  sourceId: string,
  code: Parameters<typeof failed>[0],
  reason: FailureReason,
  sourceErrorCode: string,
): Promise<StageOutcome> {
  await markFailed(ctx, sourceId, sourceErrorCode);
  return failed(code, reason);
}

export async function runParse(ctx: StageContext): Promise<StageOutcome> {
  const sourceId = ctx.job.job.sourceId;
  const source = ctx.job.source;
  if (!sourceId || !source || source.deleted || source.state === "removed" || source.state === "pending_upload") {
    return failed("precondition_failed", "source_unavailable");
  }

  // Idempotent re-run: the commit happened but the job was not recorded (crash, lost lease).
  if (source.state === "parsed") {
    if (source.rawAvailable) await deleteRaw(ctx, sourceId);
    return { kind: "succeeded", progress: { done: 1, total: 1 } };
  }

  const pepper = ctx.getPepper();
  if (!pepper.ok) {
    ctx.logger.error("identity_pepper_unverified", { jobId: ctx.claimed.id, sourceId, check: String(pepper.error.details?.check ?? "") });
    return failed("processing_failed", "identity_pepper_unverified", true);
  }

  const mapKey = identityMapKeyFor(ctx);
  if (!mapKey.ok) {
    ctx.logger.error("identity_map_key_unverified", { jobId: ctx.claimed.id, sourceId, reason: mapKey.reason });
    return failed("processing_failed", "identity_map_key_unverified", true);
  }

  let exclusions;
  try {
    exclusions = await getParseExclusions(ctx.db, sourceId);
  } catch (e) {
    if (e instanceof DbError && e.code === "internal" && !e.sqlState) return failed("internal", "exclusions_invalid");
    throw e;
  }

  let raw;
  try {
    raw = await downloadVerifiedRawSourceWithMeta(ctx.db, ctx.storage, sourceId, claimOf(ctx)); // DB-12: the mismatch is written under the claim
  } catch (e) {
    if (e instanceof DbError && e.code === "validation_failed") return failed("validation_failed", "integrity_mismatch"); // already marked failed
    if (e instanceof DbError && e.code === "not_found") return failed("processing_failed", "raw_unavailable", true); // raw kept; retry
    throw e;
  }

  const result = await parseSource({
    kind: raw.kind,
    fileName: raw.originalFilename,
    bytes: raw.bytes,
    timezone: raw.timezone,
    ...(raw.dateOrder ? { dateOrder: raw.dateOrder } : {}),
    exclusions,
    identityPepper: pepper.data.pepper,
  });

  if (!result.ok) {
    const err = result.error;
    if (isParserInputFailure(err)) {
      const inputCode = err.details.inputCode;
      if (inputCode === "identity_pepper_invalid") return failed("processing_failed", "identity_pepper_unverified", true);
      return failSource(ctx, sourceId, err.code, `input:${inputCode}`, inputCode);
    }
    return failSource(ctx, sourceId, err.code, `parser:${err.details.parserCode}`, err.details.parserCode);
  }

  const parsed: ParsedSource = result.data;
  if (parsed.identityMatches.length > 0) {
    return failSource(ctx, sourceId, "precondition_failed", "identity_confirmation_required", "identity_confirmation_required");
  }

  await ctx.heartbeat(); // never persist under a claim that is no longer ours

  // 6. Pseudonymisation (R3 Task 02). Nothing has been persisted yet.
  const handoverId = ctx.job.job.handoverId;
  const key = mapKey.key;
  const own = parsed.participants.map((p) => ({
    localId: p.localId,
    personKey: personKeyFor(key, handoverId, p.identityKind, p.identityHash),
    label: vaultLabelFor(p.displayLabel),
  }));
  const others = await peopleOfOtherChatSources(ctx, key, pepper.data.pepper);
  const people = await reserveHandoverPeople(
    ctx.db,
    claimOf(ctx),
    [...own, ...others.people].map((p) => ({
      personKey: p.personKey,
      sealed: p.label === null ? null : sealLabel(key, handoverId, p.personKey, p.label).sealed,
      keyVersion: key.version,
    })),
  );
  const ordinalByKey = new Map(people.map((p) => [p.personKey, p.ordinal]));
  const ordinalOf = new Map<string, number>();
  for (const o of own) {
    const ordinal = ordinalByKey.get(o.personKey);
    if (ordinal === undefined) return failed("internal", "internal"); // reserve always returns every requested person
    ordinalOf.set(o.localId, ordinal);
  }
  const known = pseudonymizeParsedSource(parsed, { ordinalOf, people: openPeople(key, handoverId, people) });

  // 6b. R4: names of people who never sent a message.
  const mentioned = await reserveMentionedPeople(ctx, key, pepper.data.pepper, exclusions, discoverSourceNames(known.parsed));
  const final = pseudonymizeMentionedNames(known.parsed, mentioned.names);
  const pseudo = { parsed: final.parsed, replaced: known.replaced + final.replaced };

  try {
    await persistPseudonymizedSource(ctx.db, claimOf(ctx), pseudo.parsed, pepper.data.version);
  } catch (e) {
    if (e instanceof DbError && !e.retryable) {
      if (e.code === "precondition_failed") {
        return failSource(ctx, sourceId, "precondition_failed", "identity_confirmation_required", "identity_confirmation_required");
      }
      if (e.code === "conflict") {
        return failSource(ctx, sourceId, "conflict", "excluded_participant_content", "excluded_participant_content");
      }
      if (e.code === "invalid_transition") return failed("invalid_transition", "run_inactive");
    }
    throw e;
  }

  ctx.logger.info("source_parsed", {
    jobId: ctx.claimed.id,
    sourceId,
    messages: parsed.messages.length,
    participants: parsed.participants.length,
    messagesExcluded: parsed.stats.messagesExcluded,
    peopleKnown: people.length,
    mentionsPseudonymized: pseudo.replaced,
    mentionedPeople: mentioned.registered,
    mentionedUnnumbered: mentioned.unnumbered,
    otherChatsRead: others.read,
    otherChatsSkipped: others.skipped,
  });

  await deleteRaw(ctx, sourceId); // §10.3 step 4: only after the commit above
  return { kind: "succeeded", progress: { done: 1, total: 1 } };
}

/** At most this many new mentioned-only people are registered per source; the rest become `[PERSON]`. */
export const MAX_MENTIONED_PEOPLE = 1000;

const normName = (s: string) => s.normalize("NFKC").toLocaleLowerCase("und").replace(/\s+/g, " ").trim();

/**
 * Registers discovered names in the vault (sealed, like senders) and returns each with its token. A single
 * word that belongs to exactly one discovered multi-word name ("Kavya" with "Kavya Menon") shares its number.
 * Names matching an exclusion rule are never registered.
 */
async function reserveMentionedPeople(
  ctx: StageContext,
  key: IdentityMapKey,
  pepper: string,
  exclusions: unknown,
  names: readonly DiscoveredName[],
): Promise<{ names: Array<{ label: string; token: string; caseSensitive: boolean }>; registered: number; unnumbered: number }> {
  if (names.length === 0) return { names: [], registered: 0, unnumbered: 0 };
  const handoverId = ctx.job.job.handoverId;
  const excluded = new Set(discoverExcludedNames(names.map((n) => n.label), compileExclusions(exclusions), pepper).map(normName));

  // Single words of exactly one multi-word name are aliases of it.
  const multiByWord = new Map<string, Set<string>>();
  for (const n of names) {
    const words = normName(n.label).split(" ");
    if (words.length < 2) continue;
    for (const w of words) multiByWord.set(w, (multiByWord.get(w) ?? new Set()).add(normName(n.label)));
  }
  const aliasOf = (n: DiscoveredName): string | null => {
    const k = normName(n.label);
    if (k.includes(" ")) return null;
    const owners = multiByWord.get(k);
    return owners && owners.size === 1 ? [...owners][0] : null;
  };

  const toRegister: Array<{ name: DiscoveredName; personKey: string }> = [];
  for (const n of names) {
    if (excluded.has(normName(n.label)) || aliasOf(n) !== null) continue;
    if (toRegister.length >= MAX_MENTIONED_PEOPLE) break;
    toRegister.push({ name: n, personKey: personKeyFor(key, handoverId, "name", computeIdentityHash(n.label, pepper)) });
  }
  const reserved =
    toRegister.length === 0
      ? []
      : await reserveHandoverPeople(
          ctx.db,
          claimOf(ctx),
          toRegister.map((r) => ({ personKey: r.personKey, sealed: sealLabel(key, handoverId, r.personKey, r.name.label).sealed, keyVersion: key.version })),
        );
  const ordinalByKey = new Map(reserved.map((p) => [p.personKey, p.ordinal]));
  const tokenByName = new Map<string, string>();
  for (const r of toRegister) {
    const ordinal = ordinalByKey.get(r.personKey);
    tokenByName.set(normName(r.name.label), ordinal === undefined ? AMBIGUOUS_PERSON_TOKEN : personToken(ordinal));
  }
  let unnumbered = 0;
  const out = names.map((n) => {
    const alias = aliasOf(n);
    const token = tokenByName.get(alias ?? normName(n.label));
    if (token === undefined || token === AMBIGUOUS_PERSON_TOKEN) unnumbered += 1;
    return { label: n.label, caseSensitive: n.caseSensitive, token: token ?? AMBIGUOUS_PERSON_TOKEN };
  });
  return { names: out, registered: toRegister.length, unnumbered };
}

async function deleteRaw(ctx: StageContext, sourceId: string): Promise<void> {
  try {
    await deleteParsedRawSource(ctx.db, ctx.storage, sourceId);
  } catch (e) {
    ctx.logger.warn("raw_delete_deferred", { jobId: ctx.claimed.id, sourceId, code: e instanceof DbError ? e.code : "internal" });
  }
}

/**
 * People of the run's OTHER chat sources that are not parsed yet, so a name is replaced in this source even
 * when its sender's own chat is parsed later. Each is read with that source's own exclusion rules (excluded
 * people are never registered); a source that cannot be read or needs an identity decision is skipped and
 * its people are registered by its own parse. Already-parsed sources registered their people when parsed.
 */
async function peopleOfOtherChatSources(
  ctx: StageContext,
  key: IdentityMapKey,
  pepper: string,
): Promise<{ people: Array<{ personKey: string; label: string | null }>; read: number; skipped: number }> {
  const handoverId = ctx.job.job.handoverId;
  const own = ctx.job.job.sourceId?.toLowerCase();
  const people: Array<{ personKey: string; label: string | null }> = [];
  let read = 0;
  let skipped = 0;
  for (const otherId of ctx.job.run.sourceIds) {
    if (otherId.toLowerCase() === own) continue;
    const raw = await readRawSourceForPeople(ctx.db, ctx.storage, otherId, handoverId);
    if (raw === null) continue; // not a chat, already parsed, or unreadable
    try {
      const preview = await previewSource({
        kind: raw.kind,
        fileName: raw.originalFilename,
        bytes: raw.bytes,
        timezone: raw.timezone,
        ...(raw.dateOrder ? { dateOrder: raw.dateOrder } : {}),
        exclusions: await getParseExclusions(ctx.db, otherId),
        identityPepper: pepper,
      });
      if (!preview.ok || preview.data.identityMatches.length > 0) {
        skipped += 1;
        continue;
      }
      for (const p of preview.data.participants) {
        people.push({ personKey: personKeyFor(key, handoverId, p.identityKind, p.identityHash), label: vaultLabelFor(p.displayLabel) });
      }
      read += 1;
    } catch {
      skipped += 1;
    }
  }
  return { people, read, skipped };
}
