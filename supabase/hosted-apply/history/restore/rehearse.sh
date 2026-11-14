#!/bin/bash
# LOCAL ONLY. Rehearses the baton-dev restore on a throwaway Postgres 17 + the repo's Supabase shim.
#   bash rehearse.sh replica     phases 2/3 with session_replication_role (run as superuser)
#   bash rehearse.sh noreplica   phases 2/3 fallback, run as a NON-superuser role that only owns public
# Phase 1 always runs as the superuser (on hosted, these 18 migrations already ran as `postgres` once).
set -uo pipefail
export MSYS_NO_PATHCONV=1
MODE="${1:?replica|noreplica}"
BASE=C:/Users/manee/Documents/programing/baton-multiagent
BK=$BASE/backup/20261113T063630Z
REPO=$BASE/baton-lead
RD=$BASE/restore-dev
N=rd-tgt; IMG=postgres:17-alpine
docker rm -f $N >/dev/null 2>&1
docker run -d --name $N -e POSTGRES_HOST_AUTH_METHOD=trust $IMG >/dev/null
[[ -n "${KEEP:-}" ]] || trap 'docker rm -f $N >/dev/null 2>&1' EXIT
for _ in $(seq 1 60); do docker exec $N pg_isready -U postgres -q 2>/dev/null && break; sleep 0.5; done; sleep 1
docker exec $N createdb -U postgres postgres_tgt
su() { docker exec -i $N psql -X -q -U postgres -d postgres_tgt -v ON_ERROR_STOP=1 "$@"; }
val() { docker exec -i $N psql -X -q -t -A -U postgres -d postgres_tgt -c "$1"; }
pass=0; fail=0
check() { if [[ "$2" == "$3" ]]; then echo "  PASS $1 ($2)"; pass=$((pass+1)); else echo "  FAIL $1: got '$2' expected '$3'"; fail=$((fail+1)); fi; }

echo "== target: Supabase shim (local stand-in for a fresh project)"
su -f - < "$REPO/supabase/tests/shim/00_supabase_shim.sql" >/dev/null
# The shim's auth.users is minimal; add the columns the real Supabase table has (taken from the backup's
# column list) so the restore INSERTs can be exercised. Hosted column compatibility is NOT proven by this.
cols_users=$(grep -m1 -oE "insert into auth\.users \([^)]*\)" "$RD/20_auth_users.sql" | sed -E 's/.*\((.*)\)/\1/')
cols_ident=$(grep -m1 -oE "insert into auth\.identities \([^)]*\)" "$RD/20_auth_users.sql" | sed -E 's/.*\((.*)\)/\1/')
for c in $(echo "$cols_users" | tr -d ' ' | tr ',' ' '); do su -c "alter table auth.users add column if not exists $c text" >/dev/null 2>&1; done
su -c "create table auth.identities ($(echo "$cols_ident" | sed -E 's/([a-z_]+)/\1 text/g'))" >/dev/null

echo "== PHASE 1: 10_baseline_schema.sql"
if su -f - < "$RD/10_baseline_schema.sql" >/tmp/p1.log 2>&1; then echo "  phase 1 committed"; else echo "  phase 1 FAILED"; tail -5 /tmp/p1.log; exit 1; fi
check "history rows" "$(val "select count(*) from supabase_migrations.schema_migrations")" 18
check "newest version" "$(val "select max(version) from supabase_migrations.schema_migrations")" 20261112000500
check "no Round 3 version" "$(val "select count(*) from supabase_migrations.schema_migrations where version like '20261113%'")" 0
check "public rows seeded by migrations" "$(val "select coalesce(sum((xpath('/row/c/text()', query_to_xml(format('select count(*) c from public.%I', relname), false, true, '')))[1]::text::int),0) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and relkind='r'")" 0
check "phase 1 guard refuses a second run" "$(su -f - < "$RD/10_baseline_schema.sql" >/dev/null 2>&1 && echo ran || echo refused)" refused

if [[ "$MODE" == "noreplica" ]]; then
  echo "== emulate hosted limits: role 'restorer' (NOSUPERUSER) owns public, may write auth.users/identities"
  su -c "create role restorer login nosuperuser; grant usage on schema auth, public, extensions to restorer;
         grant select, insert on auth.users, auth.identities to restorer;" >/dev/null
  su -c "do \$\$ declare r record; begin for r in select tablename from pg_tables where schemaname='public' loop
           execute format('alter table public.%I owner to restorer', r.tablename); end loop;
           for r in select sequencename from pg_sequences where schemaname='public' loop
           execute format('alter sequence public.%I owner to restorer', r.sequencename); end loop;
           for r in select p.oid::regprocedure sig from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' loop
           execute format('alter routine %s owner to restorer', r.sig); end loop;
           for r in select viewname from pg_views where schemaname='public' loop
           execute format('alter view public.%I owner to restorer', r.viewname); end loop; end \$\$;" >/dev/null
  check "non-superuser may NOT set replica mode (vanilla PG)" "$(docker exec -i $N psql -X -q -U restorer -d postgres_tgt -c 'set session_replication_role = replica' >/dev/null 2>&1 && echo allowed || echo denied)" denied
  run() { docker exec -i $N psql -X -q -U restorer -d postgres_tgt -v ON_ERROR_STOP=1 "$@"; }
  P2=20_auth_users_noreplica.sql; P3=30_public_data_noreplica.sql
else
  run() { su "$@"; }
  P2=20_auth_users.sql; P3=30_public_data.sql
fi

echo "== PHASE 3 before PHASE 2 must refuse (guard)"
check "phase 3 guard without auth users" "$(run -f - < "$RD/$P3" >/dev/null 2>&1 && echo ran || echo refused)" refused
check "nothing written by the refused phase 3" "$(val "select count(*) from public.handovers")" 0

echo "== PHASE 2: $P2"
if run -f - < "$RD/$P2" >/tmp/p2.log 2>&1; then echo "  phase 2 committed"; else echo "  phase 2 FAILED"; tail -5 /tmp/p2.log; exit 1; fi
check "auth.users" "$(val "select count(*) from auth.users")" 1
check "auth.identities" "$(val "select count(*) from auth.identities")" 1
[[ "$MODE" == "replica" ]] && check "no profile auto-created in replica mode" "$(val "select count(*) from public.profiles")" 0

echo "== PHASE 3: $P3"
if run -f - < "$RD/$P3" >/tmp/p3.log 2>&1; then echo "  phase 3 committed"; else echo "  phase 3 FAILED"; grep -m3 -E "ERROR|DETAIL" /tmp/p3.log; exit 1; fi

echo "== VERIFY"
docker exec -i $N psql -X -A -t -F "|" -U postgres -d postgres_tgt -c "
  select 'public.'||relname, (xpath('/row/c/text()', query_to_xml(format('select count(*) c from public.%I', relname), false, true, '')))[1]::text
    from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and relkind='r' order by 1" > /tmp/tgt_counts.txt
grep -E "^public\." "$BK/row_counts.txt" | tr -d '\r' | sort > /tmp/bk_counts.txt
check "public row counts equal the backup (all tables)" "$(diff -q /tmp/bk_counts.txt /tmp/tgt_counts.txt >/dev/null && echo equal || echo different)" equal
check "tables compared" "$(wc -l < /tmp/tgt_counts.txt | tr -d ' ')" "$(wc -l < /tmp/bk_counts.txt | tr -d ' ')"
check "profile joins its auth user" "$(val "select count(*) from public.profiles p join auth.users u on u.id = p.id::text::uuid")" 1
check "profile display_name is the original (not trigger-derived)" "$(val "select count(*) from public.profiles")" 1
orphans=$(su -t -A -f - <<'SQL'
do $$ declare k record; n bigint; total bigint := 0; begin
  for k in select c.oid, c.conrelid::regclass t, c.confrelid::regclass p,
      (select string_agg(format('c.%I', a.attname), ',' order by x.i) from unnest(c.conkey) with ordinality x(n,i) join pg_attribute a on a.attrelid=c.conrelid and a.attnum=x.n) cc,
      (select string_agg(format('p.%I', a.attname), ',' order by x.i) from unnest(c.confkey) with ordinality x(n,i) join pg_attribute a on a.attrelid=c.confrelid and a.attnum=x.n) pc,
      (select string_agg(format('c.%I is not null', a.attname), ' and ') from unnest(c.conkey) x(n) join pg_attribute a on a.attrelid=c.conrelid and a.attnum=x.n) nn
    from pg_constraint c join pg_namespace s on s.oid=c.connamespace where c.contype='f' and s.nspname='public'
  loop
    execute format('select count(*) from %s c where %s and not exists (select 1 from %s p where (%s) = (%s))', k.t, k.nn, k.p, k.pc, k.cc) into n;
    if n > 0 then raise notice 'orphans in %: %', k.t, n; end if; total := total + n;
  end loop;
  raise notice 'TOTAL_ORPHANS=%', total;
end $$;
SQL
)
check "foreign keys: orphan rows across all 87 FKs" "$(docker exec -i $N psql -X -q -U postgres -d postgres_tgt -f - 2>&1 <<'SQL' | grep -oE 'TOTAL_ORPHANS=[0-9]+' | cut -d= -f2
do $$ declare k record; n bigint; total bigint := 0; begin
  for k in select c.conrelid::regclass t, c.confrelid::regclass p,
      (select string_agg(format('c.%I', a.attname), ',' order by x.i) from unnest(c.conkey) with ordinality x(n,i) join pg_attribute a on a.attrelid=c.conrelid and a.attnum=x.n) cc,
      (select string_agg(format('p.%I', a.attname), ',' order by x.i) from unnest(c.confkey) with ordinality x(n,i) join pg_attribute a on a.attrelid=c.confrelid and a.attnum=x.n) pc,
      (select string_agg(format('c.%I is not null', a.attname), ' and ') from unnest(c.conkey) x(n) join pg_attribute a on a.attrelid=c.conrelid and a.attnum=x.n) nn
    from pg_constraint c join pg_namespace s on s.oid=c.connamespace where c.contype='f' and s.nspname='public'
  loop
    execute format('select count(*) from %s c where %s and not exists (select 1 from %s p where (%s) = (%s))', k.t, k.nn, k.p, k.pc, k.cc) into n;
    total := total + n;
  end loop;
  raise notice 'TOTAL_ORPHANS=%', total;
end $$;
SQL
)" 0
check "FK constraints present" "$(val "select count(*) from pg_constraint c join pg_namespace s on s.oid=c.connamespace where c.contype='f' and s.nspname='public'")" 87
check "user triggers re-enabled (none disabled)" "$(val "select count(*) from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and not t.tgisinternal and t.tgenabled='D'")" 0
check "RLS policies on public" "$(val "select count(*) from pg_policies where schemaname='public'")" 22
check "tables with RLS enabled" "$(val "select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and relkind='r' and relrowsecurity")" "$(grep -c 'ENABLE ROW LEVEL SECURITY' "$BK/public_schema.sql")"
check "default privileges: a NEW public table grants nothing to anon/authenticated/service_role" "$(su -t -A -c "begin; create table public.zz_probe(i int); select (has_table_privilege('anon','public.zz_probe','select') or has_table_privilege('authenticated','public.zz_probe','select') or has_table_privilege('service_role','public.zz_probe','select'))::text; rollback;" | grep -E '^(true|false)$')" false
check "citext extension" "$(val "select count(*) from pg_extension where extname='citext'")" 1
check "trigger on auth.users" "$(val "select count(*) from pg_trigger where tgname='on_auth_user_created' and tgrelid='auth.users'::regclass")" 1
check "storage policy baton_source_uploads_insert" "$(val "select count(*) from pg_policies where schemaname='storage' and policyname='baton_source_uploads_insert'")" 1
check "bucket source-uploads (private, 25 MB)" "$(val "select public::text||'/'||file_size_limit from storage.buckets where id='source-uploads'")" "false/26214400"
check "restored source points at the backed-up object path" "$(val "select count(*) from public.sources where raw_storage_path='raw/58053120-daa8-4c5a-83b5-dbe6830ea429/28820916-61e3-4bdc-8379-98412eef0794'")" 1
check "auth trigger still creates profiles for NEW users" "$(su -t -A -c "begin; insert into auth.users (id, email) values ('00000000-0000-4000-8000-0000000000aa', 'probe@example.invalid'); select count(*) from public.profiles where id='00000000-0000-4000-8000-0000000000aa'; rollback;" | grep -E '^[0-9]+$')" 1
check "audit trigger fires again after the load" "$(val "select count(*) from pg_trigger t join pg_class c on c.oid=t.tgrelid where c.relname='handovers' and not t.tgisinternal and t.tgenabled='O'") >= 1" "$(val "select count(*) from pg_trigger t join pg_class c on c.oid=t.tgrelid where c.relname='handovers' and not t.tgisinternal and t.tgenabled='O'") >= 1"

echo "== migration pre-check (hosted-apply/01_precheck.sql) on the restored target"
su -f - < "$BASE/hosted-apply/01_precheck.sql"

echo "== schema diff vs the backup's public_schema.sql (normalised: comments, psql meta, OWNER/ACL lines of Supabase-internal roles)"
norm() { grep -vE '^--|^\\(un)?restrict|^SET |^SELECT pg_catalog\.set_config|^$|OWNER TO|supabase_admin|supabase_auth_admin|supabase_storage_admin|pg_database_owner|^ALTER DEFAULT PRIVILEGES' ; }
docker exec $N pg_dump -U postgres -d postgres_tgt --schema-only -n public -n supabase_migrations | norm > /tmp/tgt_schema.sql
norm < "$BK/public_schema.sql" | tr -d '\r' > /tmp/bk_schema.sql
d=$(diff /tmp/bk_schema.sql /tmp/tgt_schema.sql | grep -cE '^[<>]')
echo "  differing lines after normalisation: $d"
diff /tmp/bk_schema.sql /tmp/tgt_schema.sql | grep -E '^[<>]' | head -20
echo "== $MODE: $pass passed, $fail failed"
