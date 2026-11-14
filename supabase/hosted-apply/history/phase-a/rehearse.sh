#!/bin/bash
# Rehearses 01..04 on a local PG (baseline + seeded data), exactly as they'll be pasted into the SQL editor.
set -uo pipefail
ROOT=/c/Users/manee/Documents/programing/baton-multiagent/baton-lead; OUT=/c/Users/manee/Documents/programing/baton-multiagent/hosted-apply
N=baton-pg-rehearse; IMG=${BATON_PG_IMAGE:-postgres:17-alpine}; export MSYS_NO_PATHCONV=1
docker rm -f $N >/dev/null 2>&1; docker run -d --name $N -e POSTGRES_HOST_AUTH_METHOD=trust $IMG >/dev/null
for _ in $(seq 1 60); do docker exec $N pg_isready -U postgres -q 2>/dev/null && break; sleep 0.5; done; sleep 1
q() { docker exec -i $N psql -X -q -U postgres -d db -v ON_ERROR_STOP=1 "$@"; }
docker exec $N createdb -U postgres db
q -f - < $ROOT/supabase/tests/shim/00_supabase_shim.sql >/dev/null
q -c "create schema if not exists supabase_migrations; create table supabase_migrations.schema_migrations (version text primary key, statements text[], name text);" >/dev/null
for f in $ROOT/supabase/migrations/2026111[12]*.sql $ROOT/supabase/migrations/2026110*.sql; do [ -e "$f" ] || continue; done
for f in $(ls $ROOT/supabase/migrations/*.sql | sort); do b=$(basename $f); [[ "$b" < "20261113" ]] || continue
  q -f - < $f >/dev/null || { echo "baseline failed $b"; exit 1; }; q -c "insert into supabase_migrations.schema_migrations(version,name) values ('${b:0:14}','${b:15:-4}')" >/dev/null; done
q -f - < $ROOT/supabase/tests/shim/10_test_helpers.sql >/dev/null
q -f - < $ROOT/supabase/tests/upgrade/seed.sql >/dev/null || { echo "seed failed"; exit 1; }
echo "== 01 precheck"; q -c "set role postgres" -f - < $OUT/01_precheck.sql
echo "== 02 phase A"; q -f - < $OUT/02_phase_A_migrations_1-13.sql >/dev/null && echo "phase A OK"
echo "== 03 phase D with a job in flight (must abort, nothing applied)"; q -f - < $OUT/03_phase_D_migrations_14-18.sql >/dev/null 2>/tmp/d.err; tail -1 /tmp/d.err
q -t -A -c "select count(*) from supabase_migrations.schema_migrations where version >= '20261113300500'"
echo "== settle in-flight jobs (rehearsal only), rerun 03"; q -c "update public.processing_jobs set status='cancelled' where status in ('queued','running')" >/dev/null
q -f - < $OUT/03_phase_D_migrations_14-18.sql >/dev/null && echo "phase D OK"
echo "== 01 precheck again"; q -f - < $OUT/01_precheck.sql
echo "== 04 verify"; q -t -A -f - < $OUT/04_verify_all.sql
docker rm -f $N >/dev/null
