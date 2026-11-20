# Round 3 Task 03: AI extraction and evidence reliability

Branch `round3/task03-ai-reliability`, based on Task 02 (`round3/task02-privacy` `1ca9e3c`, which contains Task 01/01B).
This task covers audit findings EXT-1, EXT-2, EXT-3, VER-1, VER-2 and VER-3 (`docs/audits/round3-architecture-audit.md`
in the `r3-arch-audit` worktree), the Omega Plus provider evaluation and the offline evaluation system. The interface
was not redesigned: the only UI changes are small indicators that reuse the existing panel styles.

**Production status:** no production AI behaviour changed. Gemini, the Task 02 governance gate and the fake adapter
behave as before. Omega Plus is an **evaluation-only** provider and is refused in every production configuration.
The one migration (`20261117300100_extraction_reliability.sql`) has **not** been applied to any hosted database.

---

## 1. Discovery architecture (EXT-1)

```
parse (Task 02: mask + pseudonymise)  →  extract job
                                          ├─ 1. deterministic signal pass   (lib/signals/detect.ts)   no AI
                                          │     over EVERY loaded message, before the first AI call
                                          │     → extraction_source_coverage + extraction_signals
                                          ├─ 2. chunked AI extraction       (lib/ai/extract.ts, unchanged)
                                          │     → points + evidence + checkpoint (DB-13, unchanged)
                                          │     → extraction_chunk_stats (counts per chunk)
                                       analyze job
                                          ├─ checklist gap questions (unchanged)
                                          └─ 3. review flags               (lib/pipeline/review-flags.ts)  no AI
                                                possible contradictions (VER-2) + attribution checks (VER-3)
```

- **Input.** The signal pass reads only the persisted text: masked (`[PHONE_1]`, `[UPI_2]`, `[PASSWORD]` …) and
  pseudonymised (`[PERSON_n]`). Nothing is unmasked, resolved or sent anywhere.
- **Provider independence.** The pass runs before the provider is called. A source whose AI extraction later fails
  still records its coverage and signals.
- **Evidence is preserved.** A signal stores the message id and UTF-16 offsets into the stored body
  (`body.slice(start, end)`), plus at most a short normalised value (a `[PERSON_n]` token, `INR 5000`, a URL host).
  It never copies or changes the message text.
- **Never a fact.** Nothing turns a signal into a point, evidence, a verdict or a status. A signal is "a person should
  check whether this message matters". A reviewer either adds a point (the existing *Add point* dialog) or marks the
  message **Not relevant** (`review_extraction_signals`).
- **Re-runs.** Signals are unique per `(message, detector version, kind, span)` and inserted with `ON CONFLICT DO NOTHING`,
  so a re-run never overwrites a reviewer's dismissal. A new detector version adds rows and does not rewrite old ones.
  Erasing or pruning a message cascades to its signals.
- **Resume.** The scan runs only when the job starts from chunk 0. A resumed job (`progress_done > 0`) does not rescan.
  The scan is deterministic, so a retry from 0 writes the same coverage row.

## 2. Signal taxonomy (`signals@1`, `lib/signals/taxonomy.ts`)

| kind | strength | examples |
|---|---|---|
| `deadline` | strong | a date with a cue: "by 15 August", "due Friday", "deadline is 12/12", Hindi "tak" |
| `date` | weak | "on Monday", "tomorrow", "3rd March" (full weekday names only: "sat"/"sun" are words) |
| `financial_commitment` | strong | an amount in a sentence with a payment cue: "pay ₹5,000 advance", "budget capped at ₹40,000" |
| `amount` | weak | any other amount (₹, Rs, INR, $, €, £, k, lakh, crore) |
| `assignment` | strong | "[PERSON_2] can you book…", "assigned to", "[PERSON_3] will handle" |
| `ownership` | strong | "in charge of", "responsible for", "point of contact", "owns the" |
| `decision` | strong | "we decided", "agreed to", "final:", "going with", "final hai", "pakka" |
| `reversal` | strong | "actually", "postponed", "moved to", "cancelled", "instead", "correction:" |
| `commitment` | strong / weak | "I'll", "will do", "leave it to me", "kar dungi" / "we'll" |
| `dependency` | strong | "waiting for", "depends on", "blocked by", "once … approves" |
| `open_question` | strong / weak | "does anyone know …?", "who is …?", "kis ke paas …?" / any other question |
| `person_mention` | weak | `[PERSON_n]`, `@[PERSON_n]` (context only) |
| `url` | strong | links, `forms.gle/…`, `docs.google.com/…` |
| `account_identifier` | strong / weak | mask tokens `[EMAIL_1]`, `[UPI_1]`, `[PASSWORD]` / "login", "password", "admin access" |

A message is **signal-bearing** when it has at least one strong signal, or weak signals of two different kinds. A person
mention alone never counts. Only signal-bearing messages store signals (at most 32 per message, strong first).

## 3. Coverage calculations (EXT-2, EXT-3)

`lib/contracts/extraction.ts` → `buildExtractionReport` (pure, shared by the DB mapper, the mocks and tests), fed by
`api_get_extraction_report` (SECURITY INVOKER, RLS: a source's numbers are visible only with the source).

| measure | where it comes from |
|---|---|
| messages inspected | the scan: every loaded text message of the source |
| messages with signals | the scan: signal-bearing messages |
| signals associated with extracted points | read time: signal-bearing messages cited by an active evidence link of a non-erased, non-rejected point |
| unreviewed signals | read time: signal-bearing messages not cited and not dismissed |
| candidates discarded | sum of `extraction_chunk_stats.dropped` by reason: lib/ai checks (`schema_invalid`, `fabricated`, `unmasked_content`, `over_budget`, `contradictory_citations`, `category_not_requested`, `all_citations_foreign`), `identity_dropped` (Task 02 output guard) and `unsupported` (all citations refused by the DB). `citations_unknown_message` counts removed citations, not candidates, and is excluded from the total. |
| oversized messages skipped | `planChunks.skippedOversize` (one message longer than the request budget) |
| chunks processed / total | the extract job's `progress_done` (the DB-13 checkpoint) / `chunks_total` |
| completeness per source | `chunkCompleteness = chunksDone / chunksTotal` and a state (below) |

Chunk stats are written after each chunk commits (one upsert per chunk index). If a crash happens between the commit
and the stats write, that chunk's counts are missing (the chunk itself is still checkpointed). The report then shows
fewer returned candidates than were processed. It never shows more.

## 4. Partial extraction behaviour (EXT-3)

Per-source state (`sourceExtractionState`):

| state | rule |
|---|---|
| `complete` | job succeeded, every chunk done, no message skipped |
| `complete_with_skips` | job succeeded, every chunk done, but some messages were too long to send |
| `partial` | the job failed or was cancelled after ≥ 1 committed chunk (or succeeded with done < total) |
| `failed` | the job failed before any chunk |
| `in_progress` / `not_processed` | open job / no extract job in the latest run |

**Run completion:** `complete` only when every processed source is `complete`. Any `partial`, `failed` (while another
source succeeded) or `complete_with_skips` source makes it `partial`. The run row itself still says `succeeded` (that
contract is unchanged), but the report never presents a partly analysed run as complete.

**Readiness blockers** (`ExtractionReport.blockers`):

| blocker | severity |
|---|---|
| `source_partially_extracted` | **blocking**: publishing needs an explicit acknowledgement |
| `source_extraction_failed` (another source succeeded) | **blocking** |
| `oversize_messages_skipped`, `candidates_discarded`, `unreviewed_signals`, `possible_contradictions`, `unresolved_attribution`, `coverage_unavailable` | advisory (shown, never required) |

**Enforcement.** `publishHandover` reads the report (user-scoped, RLS) before the publish RPC. If a blocking gap exists
and the input lacks `acknowledgeExtractionGaps: true`, it returns `precondition_failed` / `extraction_incomplete`. An
`internal` read error fails closed. A database without the migration reports `available: false` and blocks nothing.
The publish dialog shows the gaps and a confirmation checkbox. The SQL `publish_handover` and `readiness_report` are
unchanged, so this gate lives in the server action, not the database (see §11).

**Recovery.** DB-13 checkpointing is unchanged: a retry resumes after the last committed chunk. Signals are written once
at chunk 0 and chunk stats are idempotent per index. Every new write is fenced exactly like the existing ones (DB-12:
`_pipeline_claim`, optional claim generation). A `ClaimLostError` still stops the job immediately and is never
swallowed. Only a **missing function** (`PipelineSchemaError`, an unmigrated database) is tolerated: it is logged once as
`coverage_unavailable` and processing continues.

**Indicators (no redesign).** Processing page: a "Source coverage" panel (per-source state, parts done, messages
inspected, signals used/unreviewed, skips, discards, issues). Review page, left column under Readiness: the same summary
plus a collapsible "Messages no point uses yet" list with highlighted spans and a **Not relevant** button. Point detail:
"Check before approving" for open flags, with **Not an issue** / **Keep as noted**.

## 5. Evidence-verification states (VER-1)

Four separate mechanisms (`lib/contracts/verification.ts`), never blended in the data model or the interface:

| layer | mechanism | interface |
|---|---|---|
| **Quote found and matched** | deterministic: `verify_quotes` + the SQL plausibility re-check (QA-M1), **unchanged** | chip "Quote found word for word" / "Quote found in source" / "Quote not found in source" |
| **AI judged the quote supportive** | `verify_support` model verdict, after the PI-11 guard, **unchanged** | a separate chip, always prefixed "AI judged: …" (screen readers hear "Not a human confirmation"); guarded verdicts show "AI check flagged · read the quote yourself" |
| **Human confirmed the point** | review approval (mandatory before publishing), unchanged | review state |
| **Conflicting evidence identified** | a matched quote judged `contradicts`, **or** an open `possible_contradiction` flag (VER-2) | conflicting status / "A later message may change this point" |

`pointLayers()` gives the four booleans per point. An AI `supports` on a quote that was **not found** never counts as
supportive evidence. The "Sourced" description now reads: *"A quote was found in the source and the AI judged that it
supports this point. A person still decides."* The status derivation in SQL is unchanged.

## 6. Contradiction detection (VER-2)

`lib/signals/contradictions.ts`, run by `analyze` over every parsed source of the run (a source whose parse failed is
skipped). For each pending, unredacted point with citations:

- **anchor**: the point's newest cited message;
- **candidates**: messages strictly **newer** than the anchor (by time; by position within the same source when times
  are missing), never the cited ones, and on topic (≥ 1 shared topic word from the title/statement/attributes/cited
  text);
- **score**: shared topic (1–3), reversal marker +3, decision marker +1, shared participant +1, same date/amount +1,
  **different** date/amount +2. Kept when the score is ≥ 5; at most 3 per point.

Each candidate becomes a `point_review_flags` row (`possible_contradiction`, the later message id, reason tokens and
score; never text) for the point's **current revision**. Earlier evidence, verdicts and status are never overwritten.
An edit makes the flag stale (it is no longer counted or listed). A reviewer dismisses or confirms it.

## 7. Attribution verification (VER-3)

`lib/signals/attribution.ts`. Person fields checked: `decision.decidedByLabel`, `owner.ownerLabel`,
`open_task.assigneeLabel`, `next_action.actorLabel`, `account_access.holderLabel`. Contacts and dependencies may name
outsiders and are not checked.

| status | resolution |
|---|---|
| `cited_author`: the value is the author of a cited message | verified |
| `mentioned_in_evidence`: the value appears (whole token) in a cited message | verified |
| `participant_elsewhere`: a known participant, not in the cited evidence | **inferred** |
| `ambiguous`: the unnumbered `[PERSON]` token | **unresolved** |
| `unrecognized`: not a participant and not in the evidence (an invented name, an outsider, a role such as "the treasurer") | **unresolved** |

Inferred/unresolved fields become `attribution_inferred` / `attribution_unresolved` flags. They stay inferred or
unresolved until a reviewer approves, edits the point or reviews the flag. Points whose statement a reviewer edited are
not second-guessed. `[PERSON_1]` never matches `[PERSON_12]`. Note: the Task 02 output guard already drops candidates
that name a **known** participant in clear text, so in practice an unrecognised clear-text name is an outsider or an
invention.

## 8. Provider configuration

| variable | meaning |
|---|---|
| `AI_PROVIDER` | `gemini` (production, Task 02 gate), `fake` (dev/test), `omega` (evaluation; production only under `omega-owner-approved`, §9a) |
| `OMEGA_API_KEY` | server-side only; used only in the request header; never in config objects, provenance, errors, logs or reports |
| `OMEGA_API_BASE_URL` | optional; default `https://api.omegaplusapi.com`; https only, no credentials/query |
| `AI_MODEL_EXTRACT`, `AI_MODEL_VERIFY` | **required fixed ids** for Omega (no default). Any id containing `omega` (`omega-plus`, `claude-omega-plus`, `claude-omega-ultra`) is refused as a dynamic route |
| `OMEGA_OUTPUT_MODE` | `json_schema` (default: `output_config.format`) or `prompt` (no schema parameter; Zod still validates) |
| `BATON_ALLOW_EVAL_PROVIDER` | must be exactly `1`, and `NODE_ENV` exactly `development`/`test`, for Omega to be accepted in evaluation mode |
| `AI_DATA_GOVERNANCE` | `omega-owner-approved` (trimmed, exact) accepts Omega in production mode in any `NODE_ENV` (§9a) |

- **Production gate (Task 02) not bypassed.** Omega has no data-governance profile, so every non-dev/test environment
  returns `provider_not_configured` / `data_governance_unapproved`, whatever `AI_DATA_GOVERNANCE` says. Dev mode alone is
  also not enough, because `.env.local` may point at a real database: the explicit synthetic-data opt-in is required.
- **No fallback.** A misconfigured Omega is "not configured". It never falls back to Gemini or the fake adapter.
- **Provenance.** `AiRunConfig` records provider `omega`, `adapterVersion` `omega-anthropic@1+<mode>`, and the extract and
  verify model ids. They are snapshotted per run, hashed into `input_hash`, and any change mid-run fails with
  `ai_config_changed`. Each call records the requested model, the reported model, request id and token counts.
- **Separate models.** Extraction and verification use the two configured ids independently, and the evaluation reports
  them separately. Identical ids are allowed but visible in provenance. VER-1's recommendation to *refuse* identical ids
  remains a product decision.

## 9. Omega Plus compatibility findings

Sources: `https://omegaplusapi.com/documentation`, `https://omegaplusapi.com/privacy` (updated 27 July 2026) and the
public `GET https://api.omegaplusapi.com/v1/models`, all read 2026-11-17. No authenticated call was made: **no Omega key
is configured locally**.

| question | finding | adapter decision |
|---|---|---|
| Request/response format | `POST /v1/messages`, `x-api-key` or `Authorization: Bearer`. The docs list only `model`, `max_tokens`, `messages`, `stream`; the response body is not documented | Standard Anthropic Messages shape (`system`, `messages`, `max_tokens`, `anthropic-version: 2023-06-01`). The response is parsed defensively and fails closed |
| JSON/schema-constrained output | **not documented** | `output_config.format: {type: "json_schema"}` by default (conservative schema subset; `additionalProperties: false`). A 400 → `ai_request_invalid`, never silent. `OMEGA_OUTPUT_MODE=prompt` as fallback. Zod validation unchanged |
| Token limits | catalogue: 1,000,000 context for most ids; output 32,768–128,000 ("route-dependent") | `max_tokens` 16,000 (extract) / 1,024 (verify); Baton's own request budgets unchanged (200 messages / 60,000 chars) |
| Timeouts / cancellation | not documented | the caller's `AbortSignal` (`callSignal`, ≤ the stage deadline) is passed to `fetch`; abort → `ai_aborted`, timeout → `ai_timed_out` (retryable) |
| Retries / rate limits | numbers not documented ("five-hour token window or RPM cap"); no error schema | no adapter retries. 408/409/429/5xx/529 → retryable `ai_provider_error` with Baton's backoff; 400/413 → validation; 401/403/402/404 → non-retryable. Only `error.type` is read from a body, never the message |
| Streaming | `stream: true` supported (SSE) | not used (non-streaming, bounded `max_tokens`). Long extraction outputs could hit gateway timeouts; measure in the live run |
| Usage and cost | `/v1/usage` and `/v1/billing` expose quota counters; per-response `usage` not documented | `usage.input_tokens` (+ cache tokens) and `output_tokens` are recorded when present. No cost is computed (no price list) |
| Model identity | the docs page lists 23 ids such as `claude-opus-4-8`, `gemini-3.6-flash`; the **live catalogue lists 19 different ids, all `claude-` prefixed** (e.g. `claude-sonnet-5-5`, `claude-gpt-6`, `claude-glm-5-3`) with `owned_by` values. The vendor states "Public identity names do not guarantee a particular upstream model" | fixed ids required; dynamic `omega` routes refused; a response whose `model` differs from the requested id is **refused** (`model_mismatch`). A matching name is recorded, not trusted |
| Tools | not documented | none declared; `tool_use` content or stop reason is rejected (§12.10 rule 2) |
| Refusals | not documented | `stop_reason: "refusal"` → non-retryable `ai_provider_error` / `refusal` |
| Sampling / reproducibility (EXT-5) | `temperature` not documented; newer Claude models reject it | not sent, so output is **not reproducible**. The offline evaluation is the control |
| Data retention, logging, training, upstream processing, location | the privacy policy covers API traffic but says nothing on prompt/response retention, logging of content, training use, upstream sub-processors or data location | **blocking for any real data**. Evaluation with synthetic data only |

**Verdict.** The format is compatible enough for an adapter, and one exists behind the existing `AiProvider` abstraction
(`lib/ai/providers/omega.ts`). It has been verified **only against a mocked transport**. That proves Baton's half of
the contract, not the vendor's. Omega Plus is **not production-approved**: a successful API response would not change
that.

### Exact live test still needed (synthetic data only)

```bash
# 1. Model identity (no data sent):  GET https://api.omegaplusapi.com/v1/models  → pick two FIXED ids
# 2. Live prompt-injection suite (25 fixtures incl. PI-25 = D11-LIVE-1), recorded:
NODE_ENV=test AI_PROVIDER=omega OMEGA_API_KEY=… AI_MODEL_EXTRACT=<id> AI_MODEL_VERIFY=<id> \
BATON_ALLOW_EVAL_PROVIDER=1 BATON_LIVE_AI=1 BATON_LIVE_AI_REPORT=live-injection-omega.jsonl \
node --import ./lib/ai/__tests__/resolve-ai.mjs --test "lib/ai/__tests__/prompt-injection.live.test.ts"
# 3. Offline evaluation against the same configuration:
… same env … npm run eval:extraction -- --provider configured --out eval-omega-<extract>-<verify>.json
# 4. If (2) fails with ai_request_invalid on every call, re-run (2) and (3) with OMEGA_OUTPUT_MODE=prompt and record both.
```

Record per run: provider, `adapterVersion`, both model ids, every `reportedModel` (any `model_mismatch` is a finding),
pass/fail per case, the metric table, token usage, and any 429/529 patterns. Gate (unchanged from PI-11): 100% live
pass on that exact provider/model/prompt version. A PI-25 `supports` is a documented residual, mitigated by mandatory
human approval.

## 9a. Production use of Omega (owner-approved, 2026-11-20)

The owner decided on 2026-11-20 to use Omega Plus on the public site for the hackathon, **knowing** the gaps in §9:
the vendor does not document prompt/response retention, content logging, training use, upstream sub-processors or data
location, and a model name does not guarantee the upstream model. This is implemented as an explicit, auditable opt-in.
The governance gate is not removed or weakened.

- **Profile.** `APPROVED_AI_DATA_GOVERNANCE["omega-owner-approved"]` (provider `omega`), whose description records that the
  owner accepted those undocumented terms. `AI_DATA_GOVERNANCE=omega-owner-approved` (trimmed, case-sensitive) accepts
  `AI_PROVIDER=omega` with mode `production` in any `NODE_ENV`. Without it, production refuses Omega with
  `data_governance_unapproved`, as before. The profile never enables Gemini, and `gemini-paid-dpa` never enables Omega.
- **Evaluation path unchanged.** In `development`/`test` with `BATON_ALLOW_EVAL_PROVIDER=1`, Omega stays `evaluation` (checked
  first, even if the profile is also set).
- **No other check relaxed.** `OMEGA_API_KEY` required; fixed `AI_MODEL_EXTRACT`/`AI_MODEL_VERIFY` (no default, any id
  containing `omega` refused); https base URL; valid `OMEGA_OUTPUT_MODE`; no fallback provider; `model_mismatch` still
  refused by the adapter. Provenance is identical to evaluation: provider `omega`, `adapterVersion`
  `omega-anthropic@1+<mode>`.
- **Adapter selection.** `providerFor` (lib/ai/config.ts) builds the adapter by provider id, not by mode.
- **Display name.** Production: "Omega Plus API (Anthropic-compatible gateway)". Evaluation keeps "… evaluation only,
  synthetic data only".
- **Consent.** New disclosure kind `omega_owner_approved`, statement version `omega-owner-approved-2026-11-20-v1`. It says
  that masked content goes to the Omega Plus API, a third-party gateway that forwards it to upstream AI model providers;
  that Omega has not documented how long it keeps prompts or whether they are used for training; and that the uploader
  should not upload anything they would not share with a third party. The server derives the expected version from the
  live configuration and records exactly that version with provider `omega`. Other kinds and versions are unchanged.
- **Still open (unchanged by this decision).** §12 items 1–3 remain true as findings. The vendor terms are still
  undocumented: this decision accepts that risk, it does not resolve it. The live injection gate (PI-11) and live
  evaluation on the exact models to be deployed should still be recorded. Revoke by unsetting `AI_DATA_GOVERNANCE`:
  processing then shows "not configured" and new consents cannot be recorded.

## 10. Offline evaluation

**Datasets** (`fixtures/eval/handover-reliability/`): three synthetic WhatsApp-style conversations, already pseudonymised
and masked as Baton stores them: a college tech fest (English, ₹), an NGO food drive (Hinglish) and a UK robotics
society (£). Totals: 60 messages, 36 labels covering all eight kinds (decision, deadline, responsibility, financial
commitment, dependency, contradiction, reversed decision, unresolved question), 16 labelled claim/quote support pairs
and 9 owner-labelled items. Every message is either part of a label or not relevant, so precision is well defined.

**Method** (`lib/eval/run.ts`): it runs the real `lib/ai` code (`extractCandidates`, `verifySupport`, quote checks, the
PI-11 guard), the pipeline's `planChunks` and the deterministic `lib/signals`. Metric definitions are in the file header.
Every ratio is reported with its numerator and denominator.

**Repeatability:** `npm run eval:extraction` (fake), `-- --provider configured` (real, opt-in), `-- --write-baseline`.
`lib/eval/__tests__/eval.test.ts` (in `npm test`) re-runs the deterministic evaluation and fails unless it reproduces the
committed baseline exactly, so any change to the detector, prompts, schemas or `lib/ai` checks forces a deliberate
re-baseline.

### Measured baseline (2026-11-17, `fixtures/eval/baselines/fake-baseline.json`)

Provider `fake@1` (`fake-extract-v1` / `fake-verify-v1`, prompts `extract@1` / `support@1`), detector `signals@1`.
**The fake adapter is a keyword heuristic, not a model.** Its extraction and support numbers measure the pipeline
plumbing only and say **nothing** about real model quality. The detection and contradiction rows are the real
deterministic layers.

| metric | ds01 techfest | ds02 food drive | ds03 society | **total** |
|---|---|---|---|---|
| candidate detection recall | 78.6% (11/14) | 85.7% (12/14) | 91.7% (11/12) | **85.0% (34/40)** |
| candidate detection precision | 100% (11/11) | 100% (12/12) | 91.7% (11/12) | **97.1% (34/35)** |
| extraction recall *(fake)* | 33.3% (4/12) | 25.0% (3/12) | 25.0% (3/12) | 27.8% (10/36) |
| citation accuracy *(fake)* | 100% (4/4) | 100% (2/2) | 100% (3/3) | 100% (9/9) |
| semantic support precision *(fake)* | 100% (3/3) | 100% (2/2) | 100% (3/3) | 100% (8/8) |
| support accuracy *(fake)* | 66.7% (4/6) | 60.0% (3/5) | 100% (5/5) | 75.0% (12/16) |
| unsupported claim rate *(fake)* | 0% (0/4) | 0% (0/2) | 0% (0/3) | 0% (0/9) |
| participant attribution accuracy *(fake)* | n/a (0/0) | n/a | n/a | n/a: the fake writes no person fields |
| contradiction retrieval recall (deterministic) | 50.0% (1/2) | 50.0% (1/2) | 100% (2/2) | **66.7% (4/6)** |

**Before the baseline** the evaluation found two pattern defects, which were fixed and are covered by tests:
1. Cues ending in `:` (`final:`, `confirmed:`, `correction:`) could never match, because a trailing `\b` after `:`
   needs a word character.
2. The Hinglish `kis ke paas` (with a space) was not covered.

Pre-fix totals were detection recall 82.5% (33/40), precision 97.1% (33/34) and contradiction recall 50.0% (3/6). No
other tuning was done against the datasets.

**Known misses (measured, not fixed: fixing them would be fitting to the test set):**
- "We cannot pay any vendor until the dean approves" (`until` is not a dependency cue).
- Two contradictions phrased without a reversal marker or a changed value ("they will pay only after the fest" vs the
  MoU; "we still owe ₹3,000" vs "I paid the full amount").
- A bare "Should we … or not?" (one weak signal).
- "the Instagram login is in the password manager" (weak cues only).

**No real-model results exist.** Extraction recall, citation accuracy, semantic support precision, unsupported claim rate
and attribution accuracy for Gemini or Omega must be measured with the live procedure in §9. No figure in this document
is a claim about a real model.

## 11. Remaining limitations

- **Publish enforcement is in the server action.** `publish_handover` / `readiness_report` (SQL) were not changed. A
  caller with the service role bypassing the action is not gated, and the acknowledgement is not stored in the audit
  log. Moving it into SQL needs a lifecycle migration and a product decision on waivers.
- **Signals are English/Hinglish floors.** No other languages, no NER, no semantic matching. Documents use the same
  patterns. Precision and recall are measured only on 60 synthetic messages.
- **Contradiction retrieval is lexical** (shared words, dates, amounts, reversal cues). It misses paraphrased
  disagreements (see the misses above). No AI contradiction check of the candidates was added. That is the natural next
  step, within the verify budget, as an advisory verdict only.
- **Attribution** checks pseudonymised tokens. A role ("the treasurer") is always unresolved, even when it is correct.
- **EXT-5:** Gemini still sends no `temperature`, and Omega cannot. Extraction remains non-reproducible.
- **EXT-4/EXT-6** (media/OCR, pagination hardening) are out of scope and unchanged.
- **Same-model verification (VER-1 config rule)** is visible but not refused.
- **Pre-existing failures on the Task 02 baseline (not introduced here, reproduced on `1ca9e3c`):**
  Tier E `e2e-pipeline` step 4 (`getPoint` → `internal` during review/publication) and
  `supabase/tests/upgrade/verify.sql` ("exactly 8 generation-checked overloads", got 9 since Task 02's
  `pipeline_list_handover_people`).

## 12. Production approvals still required

1. **Vendor terms for Omega Plus**: data retention, content logging, no-training commitment, upstream sub-processors and
   data location, in writing. Until then, synthetic data only. No profile may be added to `APPROVED_AI_DATA_GOVERNANCE`.
   **Superseded for the hackathon by the owner's decision of 2026-11-20 (§9a):** profile `omega-owner-approved` accepts
   the undocumented terms explicitly. The terms themselves are still not documented.
2. **Live injection suite (D11/PI-11 gate)** on the exact provider, models and prompt versions to be enabled, including
   PI-25 (D11-LIVE-1). It has not been run for Gemini or Omega.
3. **Live evaluation** (§9 step 3) on the same configuration, with results recorded here.
4. **Hosted migration apply** of `20261117300100_extraction_reliability.sql` (additive; requires approval; apply before or
   with the worker that writes coverage. The worker tolerates its absence).
5. **Product decisions:** server-side publish gate and waiver audit; whether identical extract/verify models are refused.

## 13. Files

- Deterministic layers: `lib/signals/{taxonomy,detect,attribution,contradictions}.ts`
- Pipeline: `lib/pipeline/{coverage,review-flags}.ts`, `stages/extract.ts`, `stages/analyze.ts`
- Contracts: `lib/contracts/{extraction,verification}.ts`, `queries.ts`, `schemas.ts`
- DB: `supabase/migrations/20261117300100_extraction_reliability.sql`, `lib/db/{pipeline,queries,mutations,mappers-extraction}.ts`
- Actions: `lib/actions/{core/,}extraction.ts`, `core/handovers.ts` (publish gate)
- Provider: `lib/ai/providers/omega.ts`, `lib/ai/config.ts`
- UI: `components/review/extraction-coverage.tsx` (+ small wiring in review/processing views, `evidence-quote.tsx`, `config/status.ts`)
- Evaluation: `lib/eval/*`, `fixtures/eval/**`; injection fixture `PI-25`
- Tests: `supabase/tests/sql/99_extraction_reliability.sql`, `lib/signals/__tests__`, `lib/pipeline/__tests__/coverage-stages.test.ts`,
  `lib/contracts/__tests__/extraction.test.ts`, `lib/actions/__tests__/extraction-actions.test.ts`, `lib/ai/__tests__/omega.test.ts`,
  `lib/eval/__tests__/eval.test.ts`
