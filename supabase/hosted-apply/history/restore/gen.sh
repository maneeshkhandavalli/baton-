#!/bin/bash
# LOCAL ONLY. Generates the three baton-dev restore files from the verified backup. No network access:
# a throwaway local Postgres 17 (+ the repo's Supabase shim) is used as a scratch "source".
# Usage: bash gen.sh
set -euo pipefail
export MSYS_NO_PATHCONV=1
BASE=C:/Users/manee/Documents/programing/baton-multiagent
BK=$BASE/backup/20261113T063630Z
REPO=$BASE/baton-lead
OUT=$BASE/restore-dev
N=rd-src; IMG=postgres:17-alpine
(cd "$BK" && sha256sum -c --quiet sha256.txt) || { echo "backup checksum mismatch"; exit 1; }

docker rm -f $N >/dev/null 2>&1 || true
docker run -d --name $N -e POSTGRES_HOST_AUTH_METHOD=trust -v "$BK:/bk:ro" $IMG >/dev/null
trap 'docker rm -f $N >/dev/null 2>&1 || true' EXIT
for _ in $(seq 1 60); do docker exec $N pg_isready -U postgres -q 2>/dev/null && break; sleep 0.5; done; sleep 1
q() { docker exec -i $N psql -X -q -U postgres -d src -v ON_ERROR_STOP=1 "$@"; }
docker exec $N createdb -U postgres src
q -f - < "$REPO/supabase/tests/shim/00_supabase_shim.sql" >/dev/null
q -c "create extension if not exists citext with schema extensions" >/dev/null

echo "== scratch source: restore public + supabase_migrations from the backup"
docker exec $N pg_restore -U postgres -d src --schema-only --no-owner /bk/public.dump 2>/dev/null || true
docker exec $N pg_restore -U postgres -d src --data-only --disable-triggers --no-owner /bk/public.dump

echo "== auth rows: load the COPY blocks of auth.users / auth.identities into text-typed scratch tables"
for t in users identities; do
  hdr=$(docker exec $N sh -c "pg_restore -f - --data-only -n auth -t $t /bk/auth_storage_data.dump" | grep -m1 "^COPY auth.$t ")
  cols=$(echo "$hdr" | sed -E 's/^COPY auth\.[a-z_]+ \((.*)\) FROM stdin;$/\1/')
  q -c "create schema if not exists scratch; create table scratch.$t ($(echo "$cols" | sed -E 's/([a-z_]+)/\1 text/g'))" >/dev/null
  docker exec $N sh -c "pg_restore -f - --data-only -n auth -t $t /bk/auth_storage_data.dump" \
    | awk -v t="$t" 'index($0,"COPY auth." t " ")==1{print "COPY scratch." t " (" substr($0, index($0,"(")+1); f=1; next} /^\\\.$/{if(f){print; f=0}; next} f{print}' \
    | sed -E "s/^COPY scratch\.$t \((.*)\) FROM stdin;\$/COPY scratch.$t (\1) FROM stdin;/" > /tmp/copy_$t.sql
  q -f - < /tmp/copy_$t.sql >/dev/null
  echo "auth.$t rows: $(q -t -A -c "select count(*) from scratch.$t")"
done

echo "== writing 10_baseline_schema.sql"
{
  echo "-- baton-dev restore, PHASE 1: baseline schema (the 18 migrations up to 20261112000500, verbatim)"
  echo "-- plus the original migration history. NO Round 3 migration. One transaction; stops on first error."
  echo "-- Generated $(date -u +%Y-%m-%dT%H:%M:%SZ) by restore-dev/gen.sh from backup 20261113T063630Z."
  echo "\\set ON_ERROR_STOP on"
  echo "begin;"
  echo "do \$guard\$ begin"
  echo "  if exists (select 1 from information_schema.tables where table_schema = 'public') then"
  echo "    raise exception 'phase 1 aborted: public schema already has tables (target is not a fresh project)';"
  echo "  end if;"
  echo "end \$guard\$;"
  for f in $(ls "$REPO"/supabase/migrations/*.sql | sort); do
    b=$(basename "$f"); [[ "$b" < "20261113" ]] || continue
    echo; echo "-- ===== $b (verbatim) ====="; cat "$f"; echo
  done
  echo "-- ===== migration history (exact rows from the backup) ====="
  echo "create schema if not exists supabase_migrations;"
  echo "create table if not exists supabase_migrations.schema_migrations (version text not null primary key, statements text[], name text);"
  docker exec $N pg_dump -U postgres -d src --data-only --column-inserts --no-comments -t supabase_migrations.schema_migrations \
    | grep -vE '^[\](un)?restrict [A-Za-z0-9]+$'
  echo "commit;"
} > "$OUT/10_baseline_schema.sql"

echo "== writing 20_auth_users.sql"
{
  echo "-- baton-dev restore, PHASE 2: auth.users + auth.identities ONLY (no sessions, refresh tokens, MFA,"
  echo "-- auth.schema_migrations). Replica mode stops on_auth_user_created from auto-creating a profile:"
  echo "-- the original profile row arrives in phase 3. One transaction; stops on first error."
  echo "\\set ON_ERROR_STOP on"
  echo "begin;"
  echo "set local session_replication_role = replica;"
  for t in users identities; do
    q -t -A -c "select format('insert into auth.$t (%s) values (%s);',
                  (select string_agg(quote_ident(column_name), ', ' order by ordinal_position) from information_schema.columns where table_schema='scratch' and table_name='$t'),
                  (select string_agg(quote_nullable(to_jsonb(r) ->> c.column_name), ', ' order by c.ordinal_position) from information_schema.columns c where c.table_schema='scratch' and c.table_name='$t'))
                from scratch.$t r"
  done
  echo "commit;"
} > "$OUT/20_auth_users.sql"

echo "== writing 30_public_data.sql"
{
  echo "-- baton-dev restore, PHASE 3: every public row from the backup, ids and timestamps preserved."
  echo "-- Replica mode: user triggers and FK triggers do not fire during the load (Supabase's documented"
  echo "-- data-restore pattern); FK integrity is verified explicitly afterwards (verify.sql). One transaction."
  echo "\\set ON_ERROR_STOP on"
  echo "begin;"
  echo "set local session_replication_role = replica;"
  echo "do \$guard\$ begin"
  echo "  if (select count(*) from auth.users) < 1 then raise exception 'phase 3 aborted: run phase 2 (auth users) first'; end if;"
  echo "end \$guard\$;"
  docker exec $N pg_dump -U postgres -d src --data-only --column-inserts --no-comments -n public \
    | grep -vE '^[\](un)?restrict [A-Za-z0-9]+$'
  echo "commit;"
} > "$OUT/30_public_data.sql"

echo "== writing 30_public_data_noreplica.sql (fallback: no superuser, no replica mode)"
# Dependency order over NON-deferrable FKs between different tables (deferrable ones are deferred).
# An FK whose columns are NULL in every row never needs its parent first, so it adds no ordering edge.
cat > /tmp/fk_used.sql <<'SQL'
create or replace function scratch.fk_used(con oid) returns boolean language plpgsql as $f$
declare tbl regclass; cond text; r boolean;
begin
  select c.conrelid::regclass,
         string_agg(format('%I is not null', a.attname), ' and ')
    into tbl, cond
    from pg_constraint c join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any (c.conkey)
   where c.oid = con group by c.conrelid;
  execute format('select exists (select 1 from %s where %s)', tbl, cond) into r;
  return r;
end $f$;
SQL
q -f - < /tmp/fk_used.sql >/dev/null
q -t -A -F ' ' -c "select distinct cf.relname, c.relname from pg_constraint k join pg_class c on c.oid=k.conrelid join pg_class cf on cf.oid=k.confrelid
   join pg_namespace n on n.oid=c.relnamespace join pg_namespace nf on nf.oid=cf.relnamespace
   where k.contype='f' and not k.condeferrable and k.conrelid<>k.confrelid and n.nspname='public' and nf.nspname='public'
     and scratch.fk_used(k.oid)" > /tmp/edges.txt
q -t -A -c "select c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r'" | awk '{print $1, $1}' >> /tmp/edges.txt
order=$(tsort /tmp/edges.txt)
{
  echo "-- baton-dev restore, PHASE 3 FALLBACK: same rows as 30_public_data.sql, for a target where"
  echo "-- session_replication_role is not permitted. Needs only table ownership (postgres owns public):"
  echo "-- user triggers are disabled per table, the 2 deferrable FKs are deferred, every other FK is"
  echo "-- satisfied by inserting tables in dependency order. One transaction; stops on first error."
  echo "\set ON_ERROR_STOP on"
  echo "begin;"
  echo "set constraints all deferred;"
  echo "do \$guard\$ begin"
  echo "  if (select count(*) from auth.users) < 1 then raise exception 'phase 3 aborted: run phase 2 (auth users) first'; end if;"
  echo "end \$guard\$;"
  for t in $order; do echo "alter table public.$t disable trigger user;"; done
  echo "-- phase 2 without replica fires on_auth_user_created, which auto-creates a profile; replace it with the original row."
  echo "delete from public.profiles;"
  for t in $order; do
    docker exec $N pg_dump -U postgres -d src --data-only --column-inserts --no-comments -t "public.$t" | { grep -vE '^[\](un)?restrict [A-Za-z0-9]+$' || true; }
  done
  echo "-- run the deferred FK checks now (fails here on any violation), then re-enable triggers"
  echo "set constraints all immediate;"
  for t in $order; do echo "alter table public.$t enable trigger user;"; done
  echo "commit;"
} > "$OUT/30_public_data_noreplica.sql"
{
  echo "-- baton-dev restore, PHASE 2 FALLBACK: auth.users + auth.identities without replica mode."
  echo "-- on_auth_user_created will fire and create a provisional profile; phase 3 fallback replaces it."
  echo "\set ON_ERROR_STOP on"
  grep -vE "^set local session_replication_role" "$OUT/20_auth_users.sql" | grep -vE "^--|^\\set"
} > "$OUT/20_auth_users_noreplica.sql"
ls -la "$OUT"/*.sql
grep -c "^INSERT INTO public\." "$OUT/30_public_data.sql" | sed 's/^/public INSERTs: /'
grep -c "^INSERT INTO supabase_migrations" "$OUT/10_baseline_schema.sql" | sed 's/^/history INSERTs: /'
grep -c "^insert into auth\." "$OUT/20_auth_users.sql" | sed 's/^/auth INSERTs: /'
grep -lE "2026111330|20261113[0-9]{6}_" "$OUT"/*.sql && echo "!! Round 3 reference found" || echo "no Round 3 migration in any file"
