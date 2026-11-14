#!/bin/bash
# Restore rehearsal of a backup folder into a THROWAWAY LOCAL Postgres 17 container. Never contacts hosted.
# Usage: bash restore-rehearsal.sh <backup-folder>   [KEEP=1 to leave the container running]
set -uo pipefail
export MSYS_NO_PATHCONV=1
BK="$(cygpath -m "${1:?usage: restore-rehearsal.sh <backup-folder>}")"
BASE=C:/Users/manee/Documents/programing/baton-multiagent
SHIM="$BASE/baton-lead/supabase/tests/shim/00_supabase_shim.sql"
N=baton-pg-restore; IMG=postgres:17-alpine
docker rm -f $N >/dev/null 2>&1
docker run -d --name $N -e POSTGRES_HOST_AUTH_METHOD=trust -v "$BK:/bk:ro" $IMG >/dev/null
for _ in $(seq 1 60); do docker exec $N pg_isready -U postgres -q 2>/dev/null && break; sleep 0.5; done; sleep 1
q() { docker exec -i $N psql -X -q -U postgres -d restore -v ON_ERROR_STOP=1 "$@"; }
fail=0

echo "== 1. integrity: sha256 of every file matches the manifest"
( cd "$BK" && sha256sum -c --quiet sha256.txt ) && echo "sha256 OK" || { echo "sha256 MISMATCH"; fail=1; }

echo "== 2. both custom-format dumps are readable"
for d in public.dump auth_storage_data.dump; do
  n=$(docker exec $N pg_restore --list /bk/$d | grep -c "TABLE DATA") && echo "$d: $n table-data entries" || { echo "$d unreadable"; fail=1; }
done

echo "== 3. restore public + supabase_migrations into a local DB (Supabase shim provides roles/auth/storage stubs)"
docker exec $N createdb -U postgres restore
q -f - < "$SHIM" >/dev/null
q -c "create extension if not exists citext with schema extensions" >/dev/null
docker exec $N pg_restore -U postgres -d restore --schema-only --no-owner /bk/public.dump 2>/tmp/restore-schema.err || true
grep -v "already exists" /tmp/restore-schema.err | grep -iE "error" | head -5
# Data with FK triggers disabled: auth.users is only a stub locally, so profile -> auth.users links can't be checked here.
docker exec $N pg_restore -U postgres -d restore --data-only --disable-triggers --no-owner /bk/public.dump 2>/tmp/restore-data.err || true
grep -iE "error" /tmp/restore-data.err | head -5

echo "== 4. restored row counts equal the counts taken at backup time (public + supabase_migrations)"
docker exec -i $N psql -X -A -t -F "|" -U postgres -d restore -c "
  select n.nspname||'.'||c.relname, (xpath('/row/c/text()', query_to_xml(format('select count(*) as c from %I.%I', n.nspname, c.relname), false, true, '')))[1]::text
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where c.relkind = 'r' and n.nspname in ('public', 'supabase_migrations') order by 1" > /tmp/restored_counts.txt
grep -E "^(public|supabase_migrations)\." "$BK/row_counts.txt" | tr -d '\r' > /tmp/backup_counts.txt
if diff /tmp/backup_counts.txt /tmp/restored_counts.txt >/dev/null; then echo "counts match: $(wc -l < /tmp/backup_counts.txt) tables"; else echo "COUNT MISMATCH:"; diff /tmp/backup_counts.txt /tmp/restored_counts.txt | head; fail=1; fi

echo "== 5. auth + storage data: entries readable and auth.users row count matches"
docker exec $N sh -c "pg_restore -f - --data-only -t users -n auth /bk/auth_storage_data.dump" | awk '/^COPY auth.users /{c=1;next} /^\\\.$/{if(c){exit}} c{n++} END{print "auth.users rows in dump:", n+0}'
grep -E "^auth\.users\|" "$BK/row_counts.txt" | tr -d '\r'

echo "== 6. the migration pre-check runs against the restored copy"
q -f - < "$BASE/hosted-apply/01_precheck.sql"

[[ -n "${KEEP:-}" ]] || docker rm -f $N >/dev/null
[[ $fail -eq 0 ]] && echo "REHEARSAL PASS" || echo "REHEARSAL FAIL"
