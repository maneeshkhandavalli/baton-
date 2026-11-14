#!/bin/bash
# Round 3 hosted runner for the isolated baton-dev Supabase project (xnwppnzvrpthukxjfojj). Ported from
# baton-multiagent/restore-dev/run-hosted.sh (r3precheck/r3phaseA/r3verifyA), plus Phase D. One command per run:
#
#   bash supabase/hosted-apply/run-hosted.sh verify-files   offline only: pins, order, byte-exact bundle (no network)
#   bash supabase/hosted-apply/run-hosted.sh r3jobs         READ-ONLY: queued/running jobs, runs, live leases
#   bash supabase/hosted-apply/run-hosted.sh r3verifyA      READ-ONLY: Phase A verify (14 rows) + Phase D prerequisites
#   bash supabase/hosted-apply/run-hosted.sh r3phaseD       WRITES: migrations #14-#18 in one locked transaction
#   bash supabase/hosted-apply/run-hosted.sh r3verifyAll    READ-ONLY: all 18 Verify blocks (19 rows) + post-Phase-D state
#
# Every command first runs phase-d.mjs verify (pinned SHA-256 of every SQL file and of the five migrations,
# migration order, bundle rebuilt byte-for-byte from the migration files) and refuses on any mismatch.
#
# Credentials: BATON_DEV_SECRETS must name a file OUTSIDE this repository containing
#   SUPABASE_DB_URL=postgresql://postgres.xnwppnzvrpthukxjfojj:<password>@<region>.pooler.supabase.com:5432/postgres
# It is split into PG* variables in a private temp file (deleted on exit). The password is never printed, never
# on a command line, and never in a connection string that libpq re-parses. The original project is refused.
#
# r3phaseD additionally requires BATON_PHASE_D_CONFIRM=apply-phase-d-to-xnwppnzvrpthukxjfojj, re-runs every
# read-only gate, then applies r3_phase_d_txn.sql (locks + in-transaction guard + the pinned bundle).
# Stop the local dev server (its background worker drains jobs) before running r3phaseD.
set -euo pipefail
# Git Bash must not rewrite container paths (/ha/...) for docker, but must still translate host paths for the
# Windows node.exe, so MSYS_NO_PATHCONV is set per docker call (dk), never globally.
dk() { MSYS_NO_PATHCONV=1 docker "$@"; }

CMD="${1:-}"
HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
TARGET_REF=xnwppnzvrpthukxjfojj
FORBIDDEN_REFS="enalguyitewjojgrgzxv enalguyitewjojgrgzv" # the original project (real 20-char ref + a known misspelling)
CONFIRM_PHRASE="apply-phase-d-to-${TARGET_REF}"
IMG="${BATON_PG_IMAGE:-postgres:17-alpine}"

case "$CMD" in
  verify-files|r3jobs|r3verifyA|r3phaseD|r3verifyAll) ;;
  *) echo "usage: run-hosted.sh verify-files|r3jobs|r3verifyA|r3phaseD|r3verifyAll" >&2; exit 2 ;;
esac

# ── 1. offline file verification (always) ────────────────────────────────────────────────────────────
node "$HERE/phase-d.mjs" verify || exit 2
[[ "$CMD" == verify-files ]] && exit 0

# ── 2. explicit approval for the only writing command, before any connection ─────────────────────────
if [[ "$CMD" == r3phaseD && "${BATON_PHASE_D_CONFIRM:-}" != "$CONFIRM_PHRASE" ]]; then
  echo "REFUSED: r3phaseD writes to baton-dev. Set BATON_PHASE_D_CONFIRM=$CONFIRM_PHRASE to approve this run." >&2
  exit 3
fi

# ── 3. credentials: baton-dev only, outside the repo, never printed ─────────────────────────────────
SECRETS="${BATON_DEV_SECRETS:-}"
[[ -n "$SECRETS" ]] || { echo "REFUSED: set BATON_DEV_SECRETS to the credentials file (kept outside the repo)" >&2; exit 3; }
[[ -f "$SECRETS" ]] || { echo "REFUSED: BATON_DEV_SECRETS does not name a file" >&2; exit 3; }
umask 077
PGENV="$(mktemp)"
trap 'rm -f "$PGENV"' EXIT
node -e '
const fs = require("fs"), path = require("path");
const [ref, repo, src, out, ...bad] = process.argv.slice(1);
const fail = (m) => { console.error("REFUSED: " + m); process.exit(3); };
const real = (p) => fs.realpathSync(p).toLowerCase();
if ((real(src) + path.sep).startsWith(real(repo) + path.sep)) fail("the credentials file is inside the repository; keep it outside");
const line = fs.readFileSync(src, "utf8").split(/\r?\n/).find((l) => l.startsWith("SUPABASE_DB_URL="));
if (!line) fail("SUPABASE_DB_URL is not set in the credentials file");
const raw = line.slice("SUPABASE_DB_URL=".length).trim();
if (bad.some((b) => raw.includes(b))) fail("the credentials belong to the ORIGINAL project");
let u; try { u = new URL(raw.replace(/^postgres:/, "postgresql:")); } catch { fail("SUPABASE_DB_URL is not a URL"); }
if (u.protocol !== "postgresql:") fail("SUPABASE_DB_URL is not a postgresql:// URL");
if (u.username !== "postgres." + ref) fail("not the baton-dev pooler user (postgres." + ref + ")");
if (!/^[a-z0-9-]+\.pooler\.supabase\.com$/.test(u.hostname) || (u.port || "5432") !== "5432")
  fail("use the baton-dev Session pooler (*.pooler.supabase.com:5432)");
const pw = decodeURIComponent(u.password);
if (!pw || /[\r\n]/.test(pw)) fail("bad password field");
fs.writeFileSync(out, ["PGHOST=" + u.hostname, "PGPORT=5432", "PGUSER=" + u.username, "PGPASSWORD=" + pw,
  "PGDATABASE=postgres", "PGSSLMODE=require", "PGCONNECT_TIMEOUT=15", "PGAPPNAME=baton-hosted-runner"].join("\n") + "\n", { mode: 0o600 });
console.log("[runner] target " + ref + " via " + u.hostname + ":5432 as postgres." + ref);
' "$TARGET_REF" "$REPO" "$SECRETS" "$PGENV" $FORBIDDEN_REFS || exit 3

dk info >/dev/null 2>&1 || { echo "Docker is not running: start Docker Desktop, then re-run" >&2; exit 4; }

winpath() { if command -v cygpath >/dev/null 2>&1; then cygpath -w "$1"; else printf '%s\n' "$1"; fi; }
ENVFILE="$(winpath "$PGENV")"
HA="$(winpath "$HERE")"

# Read-only query: inside BEGIN READ ONLY ... ROLLBACK; unaligned rows "name|...|t|f".
psql_ro() { dk run --rm -i --env-file "$ENVFILE" -v "$HA:/ha:ro" "$IMG" \
  psql -X -q -A -t -F '|' -v ON_ERROR_STOP=1 -c "begin read only" -f "/ha/$1" -c "rollback"; }

# check FILE EXPECTED_ROWS LABEL: prints each row, passes only if the row count matches and every last column is t.
check() {
  local out rows bad
  out="$(psql_ro "$1")" || { echo "  $3: QUERY FAILED"; return 1; }
  awk -F'|' 'NF { printf "    %-30s %-18s %s\n", $1, (NF > 2 ? $2 : ""), ($NF == "t" ? "ok" : "FAIL") }' <<<"$out"
  rows="$(grep -c . <<<"$out" || true)"; bad="$(grep . <<<"$out" | grep -vc '|t$' || true)"
  if [[ "$rows" -eq "$2" && "$bad" -eq 0 ]]; then echo "  $3: PASS ($rows/$2)"; return 0; fi
  echo "  $3: FAIL (rows $rows, expected $2; failing $bad)"; return 1
}

gates() { # every read-only precondition for Phase D
  local ok=0
  echo "[r3jobs] jobs (read-only)";                 check r3_jobs.sql 4 "jobs idle" || ok=1
  echo "[r3verifyA] Phase A verify (read-only)";    check 05_verify_phase_A.sql 14 "Phase A #1-#13" || ok=1
  echo "[r3verifyA] Phase D prerequisites";         check r3_prereq.sql 8 "prerequisites" || ok=1
  return $ok
}

case "$CMD" in
  r3jobs)
    echo "[r3jobs] jobs (read-only)"; check r3_jobs.sql 4 "jobs idle" ;;
  r3verifyA)
    echo "[r3verifyA] Phase A verify (read-only)"; a=0; check 05_verify_phase_A.sql 14 "Phase A #1-#13" || a=1
    echo "[r3verifyA] Phase D prerequisites (read-only)"; b=0; check r3_prereq.sql 8 "prerequisites" || b=1
    exit $(( a || b )) ;;
  r3verifyAll)
    echo "[r3verifyAll] all 18 Verify blocks (read-only)"; a=0; check 04_verify_all.sql 19 "Verify #1-#18" || a=1
    echo "[r3verifyAll] post-Phase-D state (read-only)"; b=0; check r3_post.sql 5 "post state" || b=1
    exit $(( a || b )) ;;
  r3phaseD)
    gates || { echo "REFUSED: a read-only gate failed; nothing was applied" >&2; exit 5; }
    echo "[r3phaseD] applying #14-#18 in one locked transaction"
    if dk run --rm -i --env-file "$ENVFILE" -v "$HA:/ha:ro" "$IMG" psql -X -v ON_ERROR_STOP=1 -f /ha/r3_phase_d_txn.sql; then
      echo "[r3phaseD] committed. Post-apply verification:"
      a=0; check 04_verify_all.sql 19 "Verify #1-#18" || a=1; b=0; check r3_post.sql 5 "post state" || b=1
      exit $(( a || b ))
    fi
    echo "[r3phaseD] FAILED: the transaction was rolled back, nothing applied. Current state:" >&2
    check r3_prereq.sql 8 "prerequisites (unchanged)" || true
    exit 6 ;;
esac
