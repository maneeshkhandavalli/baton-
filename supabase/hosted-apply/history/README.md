# Historical hosted-apply and restore scripts (archived 2026-11-14)

Preserved from the retired `baton-multiagent` workspace so the original repository is the only home of
Baton's maintenance history. **Reference only: do not run these against any project without re-reading
them.** The current, guarded runner is `supabase/hosted-apply/run-hosted.sh` + `phase-d.mjs`.

None of these files contains a secret, a password, a database dump, auth rows or user data. Database
credentials were always read at run time from a file outside the repository (`SUPABASE_DB_URL=…`).

## phase-a/ — Phase A apply to baton-dev (migrations #1–#13, 2026-11-13)
| File | Purpose |
|---|---|
| `01_precheck.sql` | Read-only pre-check run before Phase A. |
| `rehearse.sh` | Local rehearsal of the Phase A bundle. |

Not copied: `02_phase_A_migrations_1-13.sql` (sha256 `501bf87ddd92cd78d235f3063b4cead237faaf4dcc7d0335a660c583fa58b76f`).
It is an exact concatenation of `supabase/migrations/20261113100100_*.sql` … `20261113300400_*.sql` (13 sections,
each verified verbatim against the repository's migration file), so it would only duplicate them. Phase D's
pinned bundle (`../03_phase_D_migrations_14-18.sql`) and the verify scripts (`../04_*`, `../05_*`) were already
in the repository.

## restore/ — original project → baton-dev restore (was `restore-dev/`; renamed because `.git/info/exclude` ignores `restore-dev/` at any depth) (2026-11-13, see `docs/round3/DEV_PROJECT_RESTORE_PLAN.md`)
| File | Purpose |
|---|---|
| `gen.sh` | Generated the restore SQL from the dumps (code only). |
| `rehearse.sh` | Local rehearsal of the restore (synthetic `@example.invalid` test user only). |
| `run-hosted.sh` | The restore-era hosted runner (superseded by `../run-hosted.sh`). Its default credentials path pointed at a local `backup/secrets/baton-dev.env`; that file was never in Git. |
| `storage-restore.mjs` | Uploaded the single restored Storage object through the Storage API. |
| `verify.sql` | Post-restore read-only verification. |

Deliberately NOT preserved here (they contain auth rows or user data and must never be committed):
`10_baseline_schema.sql`, `20_auth_users*.sql`, `30_public_data*.sql`, and the dumps under `backup/`.
They are to be archived in encrypted storage outside the repository.
