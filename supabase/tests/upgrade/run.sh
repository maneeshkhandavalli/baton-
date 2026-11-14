#!/usr/bin/env bash
# UPGRADE-PATH test for the Round 3 migrations (LOCAL DOCKER ONLY: never point this at a hosted project).
#
#   1. fresh Postgres in Docker + supabase/tests/shim + every BASELINE migration (name < 20261113)
#   2. seed.sql: realistic synthetic data through the existing functions (a draft with unfinished uploads,
#      a processing run with a job claimed mid-flight, an in-review handover with points and evidence, a
#      published handover, a discarded draft with its upload still in Storage) and a snapshot of every read
#   3. every Round 3 migration (name >= 20261113) applied ONE AT A TIME on that populated database; after
#      each one, every member's reads are compared with the snapshot (only the deliberately added
#      HandoverSummary.description key is ignored)
#   4. verify.sql: post-apply checks of each migration and the new behaviour on pre-upgrade rows
#
#   bash supabase/tests/upgrade/run.sh
#   BATON_PG_IMAGE=postgres:15-alpine bash supabase/tests/upgrade/run.sh
#   BATON_UPGRADE_EXTRA_DIR=/path/to/dir bash supabase/tests/upgrade/run.sh   # add migrations not yet merged
#   KEEP=1 ...                                                                # leave the container running
#
# Container name: BATON_PG_CONTAINER (default baton-pg-upgrade). Exit status 0 only if every step passed.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../../.." && pwd)"
SHIM="$ROOT/supabase/tests/shim"
NAME="${BATON_PG_CONTAINER:-baton-pg-upgrade}"
IMAGE="${BATON_PG_IMAGE:-postgres:17-alpine}"
EXTRA="${BATON_UPGRADE_EXTRA_DIR:-}"
CUTOFF="20261113"
DB="upgrade_db"

export MSYS_NO_PATHCONV=1 # Git Bash on Windows: don't rewrite container paths

docker rm -f "$NAME" >/dev/null 2>&1 || true
docker run -d --name "$NAME" -e POSTGRES_PASSWORD=postgres -e POSTGRES_HOST_AUTH_METHOD=trust "$IMAGE" \
  -c max_connections=100 -c deadlock_timeout=200ms >/dev/null
cleanup() { if [[ -z "${KEEP:-}" ]]; then docker rm -f "$NAME" >/dev/null 2>&1 || true; fi; }
trap cleanup EXIT

for _ in $(seq 1 60); do
  if docker exec "$NAME" pg_isready -U postgres -q 2>/dev/null; then break; fi
  sleep 0.5
done
sleep 1

psql_file() { docker exec -i "$NAME" psql -X -q -U postgres -d "$DB" -v ON_ERROR_STOP=1 -f - <"$1"; }
psql_cmd() { docker exec -i "$NAME" psql -X -q -t -A -U postgres -d "$DB" -v ON_ERROR_STOP=1 -c "$1"; }

echo "== image $IMAGE, container $NAME"
docker exec "$NAME" createdb -U postgres "$DB"
psql_file "$SHIM/00_supabase_shim.sql" >/dev/null

shopt -s nullglob
baseline=()
round3=()
for f in "$ROOT"/supabase/migrations/*.sql; do
  b="$(basename "$f")"
  if [[ "$b" < "$CUTOFF" ]]; then baseline+=("$f"); else round3+=("$f"); fi
done
if [[ -n "$EXTRA" ]]; then
  for f in "$EXTRA"/*.sql; do
    b="$(basename "$f")"
    [[ "$b" < "$CUTOFF" ]] && { echo "extra migration $b predates the Round 3 cutoff"; exit 2; }
    [[ -e "$ROOT/supabase/migrations/$b" ]] && continue # the repository's copy wins
    round3+=("$f")
  done
fi
# global apply order = file name order
IFS=$'\n' round3=($(for f in "${round3[@]}"; do echo "$(basename "$f")|$f"; done | sort | cut -d'|' -f2-)); unset IFS

echo "== baseline (${#baseline[@]} migrations)"
for f in "${baseline[@]}"; do psql_file "$f" >/dev/null; done
psql_file "$SHIM/10_test_helpers.sql" >/dev/null

echo "== seed + snapshot"
psql_file "$HERE/seed.sql" >/dev/null
psql_cmd "create table upgrade.applied (name text primary key, applied_at timestamptz not null default clock_timestamp());" >/dev/null

echo "== Round 3 migrations on populated data (${#round3[@]})"
status=0
for f in "${round3[@]}"; do
  b="$(basename "$f")"
  if ! out=$(psql_file "$f" 2>&1); then
    echo "FAIL apply  $b"; echo "$out" | sed 's/^/     /'; status=1; break
  fi
  psql_cmd "insert into upgrade.applied (name) values ('$b');" >/dev/null
  changed="$(psql_cmd "select array_to_string(upgrade.diff(), ', ');")"
  if [[ -n "$changed" ]]; then
    echo "FAIL reads  $b changed: $changed"; status=1
  else
    echo "PASS        $b (applied; every pre-upgrade read unchanged)"
  fi
done

if [[ $status -eq 0 ]]; then
  echo "== post-apply verification"
  if out=$(psql_file "$HERE/verify.sql" 2>&1); then
    echo "PASS verify.sql"
  else
    echo "FAIL verify.sql"; echo "$out" | grep -E "ERROR|ASSERTION|CONTEXT" | sed 's/^/     /'; status=1
  fi
fi

exit $status
