#!/bin/bash
# baton-dev hosted restore runner. NOT RUN YET — every phase needs the user's explicit approval.
# One phase per invocation, verification between phases:
#   bash run-hosted.sh precheck   read-only: target is baton-dev and empty
#   bash run-hosted.sh probe      decides replica vs fallback: begin; set local session_replication_role; ROLLBACK (writes nothing)
#   bash run-hosted.sh phase1     10_baseline_schema.sql            (one transaction)
#   bash run-hosted.sh phase2     20_auth_users[_noreplica].sql      (one transaction)
#   bash run-hosted.sh phase3     30_public_data[_noreplica].sql     (one transaction)
#   bash run-hosted.sh verify     read-only verify.sql + row counts compared with the backup
# Credentials: backup/secrets/baton-dev.env (written by the user):
#   SUPABASE_DB_URL=postgresql://postgres.xnwppnzvrpthukxjfojj:<password>@aws-1-ap-southeast-1.pooler.supabase.com:5432/postgres
# The URL is split into PG* variables in a 0600 temp file (deleted on exit); the password is never printed,
# never on a command line, never in a connection string libpq re-parses.
set -euo pipefail
export MSYS_NO_PATHCONV=1
PHASE="${1:?precheck|probe|phase1|phase2|phase3|verify|authcheck|fkcheck|r3precheck|r3phaseA|r3verifyA}"
TARGET_REF=xnwppnzvrpthukxjfojj
FORBIDDEN_REF=enalguyitewjojgrgzxv
BASE=C:/Users/manee/Documents/programing/baton-multiagent
RD=$BASE/restore-dev
BK=$BASE/backup/20261113T063630Z
SECRETS=${BATON_DEV_SECRETS:-$BASE/backup/secrets/baton-dev.env}   # override only for guard tests
PGENV=$BASE/backup/secrets/baton-dev.pg.env
MODEFILE=$RD/.mode   # written by `probe`: replica | noreplica
IMG=postgres:17-alpine
[[ -f "$SECRETS" ]] || { echo "missing $SECRETS"; exit 2; }
(cd "$RD" && sha256sum -c --quiet SHA256SUMS) || { echo "restore files changed since the rehearsal; regenerate and rehearse again"; exit 2; }

node -e '
const fs=require("fs");const [ref,bad,src,out]=process.argv.slice(1);
const line=fs.readFileSync(src,"utf8").split(/\r?\n/).find(l=>l.startsWith("SUPABASE_DB_URL="));
if(!line){console.error("SUPABASE_DB_URL not set");process.exit(2)}
const u=new URL(line.slice(16).trim().replace(/^postgres:/,"postgresql:"));
if(u.username.includes(bad)||u.hostname.includes(bad)){console.error("REFUSED: credentials belong to the ORIGINAL project");process.exit(3)}
if(u.username!==`postgres.${ref}`){console.error("REFUSED: not the baton-dev pooler user");process.exit(3)}
if(!/\.pooler\.supabase\.com$/.test(u.hostname)||(u.port||"5432")!=="5432"){console.error("REFUSED: use the Session pooler on port 5432");process.exit(3)}
const pw=decodeURIComponent(u.password);if(!pw||/[\r\n]/.test(pw)){console.error("bad password field");process.exit(3)}
fs.writeFileSync(out,["PGHOST="+u.hostname,"PGPORT=5432","PGUSER="+u.username,"PGPASSWORD="+pw,"PGDATABASE=postgres","PGSSLMODE=require","PGCONNECT_TIMEOUT=15"].join("\n")+"\n",{mode:0o600});
console.log("target OK:",ref,"via",u.hostname+":5432");' "$TARGET_REF" "$FORBIDDEN_REF" "$SECRETS" "$PGENV"
trap 'rm -f "$PGENV"' EXIT
psqlf() { docker run --rm --env-file "$PGENV" -v "$RD:/rd:ro" "$IMG" psql -X -v ON_ERROR_STOP=1 "$@"; }

case "$PHASE" in
  precheck)
    psqlf -A -t -F ' | ' -c "select 'public_tables', count(*) from information_schema.tables where table_schema='public'
      union all select 'history_table_exists', (to_regclass('supabase_migrations.schema_migrations') is not null)::int
      union all select 'auth_users', count(*) from auth.users
      union all select 'source_uploads_bucket', count(*) from storage.buckets where id='source-uploads'"
    echo "expected: public_tables 0, history_table_exists 0, auth_users 0, source_uploads_bucket 0" ;;
  probe)
    rm -f "$MODEFILE"
    out=$(psqlf -q -A -t -c "begin" -c "set local session_replication_role = replica" -c "show session_replication_role" -c "rollback" 2>&1) && rc=0 || rc=$?
    if [[ $rc -eq 0 ]] && grep -q "replica" <<<"$out"; then
      echo replica > "$MODEFILE"; echo "replica mode permitted (set inside a transaction, then rolled back) -> phases 2/3 use the replica files"
    elif grep -qiE "permission denied to set parameter" <<<"$out"; then
      echo noreplica > "$MODEFILE"; echo "replica mode NOT permitted (permission denied; transaction rolled back) -> phases 2/3 use the *_noreplica files"
    else
      echo "PROBE ERROR (no decision recorded):"; sed -E 's#[a-z]+://[^ ]*#<url>#g' <<<"$out" | head -5; exit 4
    fi ;;
  phase1) psqlf -q -f /rd/10_baseline_schema.sql && echo "phase 1 committed" ;;
  phase2|phase3)
    [[ -f "$MODEFILE" ]] || { echo "run probe first"; exit 2; }
    m=$(cat "$MODEFILE"); suf=""; [[ "$m" == noreplica ]] && suf="_noreplica"
    f=$([[ "$PHASE" == phase2 ]] && echo "20_auth_users$suf.sql" || echo "30_public_data$suf.sql")
    echo "running $f ($m)"; psqlf -q -f "/rd/$f" && echo "$PHASE committed" ;;
  authcheck)
    psqlf -A -t -F ' | ' -c "select 'users', count(*)::text from auth.users
      union all select 'identities', count(*)::text from auth.identities
      union all select 'user_ids', coalesce(string_agg(id::text, ','), '') from auth.users
      union all select 'identity_user_ids', coalesce(string_agg(user_id::text, ','), '') from auth.identities
      union all select 'identities_linked_to_a_user', count(*)::text from auth.identities i join auth.users u on u.id = i.user_id
      union all select 'sessions', count(*)::text from auth.sessions
      union all select 'refresh_tokens', count(*)::text from auth.refresh_tokens
      union all select 'mfa_amr_claims', count(*)::text from auth.mfa_amr_claims
      union all select 'mfa_factors', count(*)::text from auth.mfa_factors
      union all select 'one_time_tokens', count(*)::text from auth.one_time_tokens
      union all select 'public_profiles', count(*)::text from public.profiles" ;;
  fkcheck)
    docker run --rm -i --env-file "$PGENV" "$IMG" psql -X -v ON_ERROR_STOP=1 -q -f - <<'SQL' 2>&1 | grep -oE '(FK_CHECKED|TOTAL_ORPHANS|orphans in [^ ]+): ?[0-9]+|(FK_CHECKED|TOTAL_ORPHANS)=[0-9]+'
begin read only;
do $$ declare k record; n bigint; total bigint := 0; checked int := 0; begin
  for k in select c.conrelid::regclass t, c.confrelid::regclass p,
      (select string_agg(format('c.%I', a.attname), ',' order by x.i) from unnest(c.conkey) with ordinality x(n,i) join pg_attribute a on a.attrelid=c.conrelid and a.attnum=x.n) cc,
      (select string_agg(format('p.%I', a.attname), ',' order by x.i) from unnest(c.confkey) with ordinality x(n,i) join pg_attribute a on a.attrelid=c.confrelid and a.attnum=x.n) pc,
      (select string_agg(format('c.%I is not null', a.attname), ' and ') from unnest(c.conkey) x(n) join pg_attribute a on a.attrelid=c.conrelid and a.attnum=x.n) nn
    from pg_constraint c join pg_namespace s on s.oid=c.connamespace where c.contype='f' and s.nspname='public'
  loop
    execute format('select count(*) from %s c where %s and not exists (select 1 from %s p where (%s) = (%s))', k.t, k.nn, k.p, k.pc, k.cc) into n;
    if n > 0 then raise notice 'orphans in %: %', k.t, n; end if;
    total := total + n; checked := checked + 1;
  end loop;
  raise notice 'FK_CHECKED=%', checked; raise notice 'TOTAL_ORPHANS=%', total;
end $$;
rollback;
SQL
    ;;
  r3precheck)
    # Round 3 runbook step 1: hosted-apply/01_precheck.sql, read-only, inside a read-only transaction.
    docker run --rm -i --env-file "$PGENV" -v "$BASE/hosted-apply:/ha:ro" "$IMG" psql -X -v ON_ERROR_STOP=1       -c "begin read only" -f /ha/01_precheck.sql -c "rollback" ;;
  r3phaseA)
    # Round 3 runbook step A: migrations #1-#13 verbatim in ONE transaction (begin ... commit inside the file),
    # stop on first error. Pinned to the reviewed bundle.
    echo "501bf87ddd92cd78d235f3063b4cead237faaf4dcc7d0335a660c583fa58b76f  $BASE/hosted-apply/02_phase_A_migrations_1-13.sql" | sha256sum -c --quiet -       || { echo "phase A bundle changed since review; refusing"; exit 2; }
    docker run --rm -i --env-file "$PGENV" -v "$BASE/hosted-apply:/ha:ro" "$IMG" psql -X -q -v ON_ERROR_STOP=1 -f /ha/02_phase_A_migrations_1-13.sql       && echo "r3 phase A committed" ;;
  r3verifyA)
    docker run --rm -i --env-file "$PGENV" -v "$BASE/hosted-apply:/ha:ro" "$IMG" psql -X -A -t -v ON_ERROR_STOP=1       -c "begin read only" -f /ha/05_verify_phase_A.sql -c "rollback" ;;
  verify)
    psqlf -A -t -F '|' -f /rd/verify.sql > /tmp/hosted_verify.txt
    grep -vE '^rows:' /tmp/hosted_verify.txt
    grep -E '^rows:' /tmp/hosted_verify.txt | sed 's/^rows://' | sort > /tmp/hosted_counts.txt
    grep -E '^public\.' "$BK/row_counts.txt" | tr -d '\r' | sort > /tmp/bk_counts.txt
    if diff -q /tmp/bk_counts.txt /tmp/hosted_counts.txt >/dev/null; then echo "public row counts: EQUAL to the backup ($(wc -l < /tmp/bk_counts.txt) tables)"
    else echo "public row counts: DIFFERENT"; diff /tmp/bk_counts.txt /tmp/hosted_counts.txt; fi ;;
  *) echo "unknown phase"; exit 2 ;;
esac
