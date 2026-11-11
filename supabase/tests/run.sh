#!/usr/bin/env bash
# Local database test runner (vanilla PostgreSQL 15 in Docker + supabase/tests/shim).
#
#   bash supabase/tests/run.sh            # fresh database, apply migrations, run every test file
#   bash supabase/tests/run.sh 30_rls     # only test files whose name contains "30_rls"
#   KEEP=1 bash supabase/tests/run.sh     # leave the container running afterwards
#
# This verifies schema, constraints, triggers, RLS and locking on real Postgres. It does NOT verify
# Supabase-specific behaviour (see the header of shim/00_supabase_shim.sql).
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
NAME="${BATON_PG_CONTAINER:-baton-pg-test}"
IMAGE="${BATON_PG_IMAGE:-postgres:15-alpine}"
FILTER="${1:-}"

export MSYS_NO_PATHCONV=1 # Git Bash on Windows: don't rewrite container paths

docker rm -f "$NAME" >/dev/null 2>&1 || true
docker run -d --name "$NAME" -e POSTGRES_PASSWORD=postgres -e POSTGRES_HOST_AUTH_METHOD=trust "$IMAGE" \
  -c max_connections=200 -c log_lock_waits=on -c deadlock_timeout=200ms >/dev/null

for _ in $(seq 1 60); do
  if docker exec "$NAME" pg_isready -U postgres -q 2>/dev/null; then break; fi
  sleep 0.5
done
sleep 1

# psql_file FILE [DB]
psql_file() {
  docker exec -i "$NAME" psql -X -q -U postgres -d "${2:-baton_template}" -v ON_ERROR_STOP=1 -f - <"$1"
}

# Shim + migrations go into a template database; every test file runs in its own fresh clone of it.
docker exec "$NAME" createdb -U postgres baton_template

echo "== shim"
psql_file "$HERE/shim/00_supabase_shim.sql"

echo "== migrations"
for f in "$ROOT"/supabase/migrations/*.sql; do
  echo "   $(basename "$f")"
  psql_file "$f"
done

echo "== test helpers"
psql_file "$HERE/shim/10_test_helpers.sql"

status=0
shopt -s nullglob
for f in "$HERE"/sql/*.sql; do
  base="$(basename "$f")"
  if [[ -n "$FILTER" && "$base" != *"$FILTER"* ]]; then continue; fi
  db="t_$(echo "$base" | tr -c 'a-zA-Z0-9
' '_' | tr 'A-Z' 'a-z')"
  db="${db%_}"
  docker exec "$NAME" createdb -U postgres -T baton_template "$db"
  if out=$(psql_file "$f" "$db" 2>&1); then
    echo "PASS $base"
    [[ -n "${VERBOSE:-}" ]] && echo "$out"
  else
    echo "FAIL $base"
    echo "$out" | sed 's/^/     /'
    status=1
  fi
done

if [[ -z "${KEEP:-}" ]]; then docker rm -f "$NAME" >/dev/null; fi
exit $status
