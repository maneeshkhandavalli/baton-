#!/usr/bin/env bash
# Integration acceptance tests, Tier P (QA). Local vanilla PostgreSQL 15 in Docker only: it never touches a
# hosted Supabase project. Reuses supabase/tests/shim (Supabase shim and the `tests.*` helpers), applies every
# migration into a template database, adds tests/integration/db/helpers.sql (`it.*`), then runs each
# tests/integration/db/sql/*.sql file in its own fresh clone.
#
#   bash tests/integration/db/run.sh              # all files
#   bash tests/integration/db/run.sh it05         # only files whose name contains "it05"
#   KEEP=1 bash tests/integration/db/run.sh       # leave the container running
#   VERBOSE=1 bash tests/integration/db/run.sh    # print each file's full output
#
# Findings that are still open on feature/main-integration are reported, not failed: a file calls
# it.todo(...), which prints "TODO(open <finding>)" (or "NOW HOLDS <finding>" once it is fixed, so the check
# can be turned into a hard assertion). The runner lists those lines after each file.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../../.." && pwd)"
NAME="${BATON_IT_CONTAINER:-baton-pg-it}"
IMAGE="${BATON_PG_IMAGE:-postgres:17-alpine}" # hosted dev runs 17.x; override for older versions
FILTER="${1:-}"
SHIM="$ROOT/supabase/tests/shim"

export MSYS_NO_PATHCONV=1 # Git Bash on Windows: don't rewrite container paths

docker rm -f "$NAME" >/dev/null 2>&1 || true
docker run -d --name "$NAME" -e POSTGRES_PASSWORD=postgres -e POSTGRES_HOST_AUTH_METHOD=trust "$IMAGE" \
  -c max_connections=100 -c deadlock_timeout=200ms >/dev/null

for _ in $(seq 1 60); do
  if docker exec "$NAME" pg_isready -U postgres -q 2>/dev/null; then break; fi
  sleep 0.5
done
sleep 1

psql_file() {
  docker exec -i "$NAME" psql -X -q -U postgres -d "${2:-it_template}" -v ON_ERROR_STOP=1 -f - <"$1"
}

docker exec "$NAME" createdb -U postgres it_template
echo "== shim";       psql_file "$SHIM/00_supabase_shim.sql"
echo "== migrations"
for f in "$ROOT"/supabase/migrations/*.sql; do
  echo "   $(basename "$f")"
  psql_file "$f"
done
echo "== helpers";    psql_file "$SHIM/10_test_helpers.sql"; psql_file "$HERE/helpers.sql"

status=0
open=0
shopt -s nullglob
for f in "$HERE"/sql/*.sql; do
  base="$(basename "$f")"
  if [[ -n "$FILTER" && "$base" != *"$FILTER"* ]]; then continue; fi
  db="t_$(echo "${base%.sql}" | tr -c 'a-zA-Z0-9\n' '_' | tr 'A-Z' 'a-z')"
  docker exec "$NAME" createdb -U postgres -T it_template "$db"
  if out=$(psql_file "$f" "$db" 2>&1); then
    echo "PASS $base"
  else
    echo "FAIL $base"
    echo "$out" | grep -v '^\s*$' | sed 's/^/     /' | tail -40
    status=1
  fi
  if [[ -n "${VERBOSE:-}" ]]; then echo "$out"; fi
  while IFS= read -r line; do
    echo "     ${line#*NOTICE:  }"
    open=$((open + 1))
  done < <(echo "$out" | grep -E 'TODO\(open|NOW HOLDS' || true)
done

echo "== open findings reported: $open"
if [[ -z "${KEEP:-}" ]]; then docker rm -f "$NAME" >/dev/null; fi
exit $status
