# Design Q5: per-user and per-team upload and AI rate limits (before production AI)

Status: **DESIGN, not implemented.** Decision so far: keep the per-run caps (≤ 200 extract and ≤ 2000
verify calls per run, `lib/pipeline`) temporarily. This must be implemented, with the owner choosing the
values, **before a production AI provider is enabled (D11)**.

## Why the per-run caps are not enough
A run is bounded, but nothing bounds how many runs, sources or uploads one user or team can trigger.
`startProcessing` can be repeated after each run finishes, and each source can be re-uploaded as a new
source. With a paid provider that is a cost-amplification and abuse path. Storage uploads are bounded
per handover (10 sources, 25 MB, D15) but not per user.

## Mechanism (no new infrastructure)
Reuse D12's Postgres counters: `rate_limit_counters` and `consume_rate_limit`, fixed windows with limits
held inside SQL so callers cannot raise them.

1. **New scopes**, added in an additive migration. The values below are placeholders for the owner:
   | Scope | Key | Window | Proposed limit |
   |---|---|---|---|
   | `upload.actor` | profile id | 1 h | 30 source uploads |
   | `upload.bytes.actor` | profile id | 24 h | 500 MB confirmed |
   | `processing.handover` | handover id | 24 h | 6 runs |
   | `processing.actor` | profile id | 24 h | 15 runs |
   | `ai.calls.team` | handover creator's profile id (v1 has no team entity, D18) | 24 h | 2,000 provider calls |
   | `ai.calls.global` | constant | 1 h | operator ceiling |
2. **Enforcement points:**
   - `createSourceUpload` and `confirmSourceUploaded` consume the `upload.*` scopes before the
     mutation, and fail with `rate_limited`.
   - `startProcessing` consumes the `processing.*` scopes before `start_processing`.
   - The pipeline consumes `ai.calls.*` immediately before each provider call. On refusal the job
     retries with backoff (reason `ai_rate_limited`). It never fakes success, and after
     `max_attempts` the run fails visibly.
3. **Ordering and fairness:** counters are consumed before any write, so a refused request writes
   nothing (the same rule as token redemption, §12.4). Limits are per subject, never per IP alone
   (QA-L7: `X-Forwarded-For` trust is not settled).
4. **Visibility:** the processing view shows "daily processing limit reached; try again after ..."
   from the typed `rate_limited` error, without exposing other users' counts.
5. **Tests:** SQL tests for each scope's window and limit; integration tests showing that a refused
   upload or start makes zero writes, and that a refused AI call never produces a point.

## Open for the owner
The limit values; whether a team entity (D18) should replace "handover creator" as the AI budget
subject; and whether paid tiers need different ceilings.
