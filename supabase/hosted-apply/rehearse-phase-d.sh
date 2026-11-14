#!/bin/bash
# LOCAL REHEARSAL of the Phase D transaction (r3_phase_d_txn.sql + the pinned bundle) on a throwaway Postgres.
# It never connects to Supabase: the container runs with --network none (no network at all), is reached only through
# `docker exec`, and uses no credentials. It does not read .env files or BATON_DEV_SECRETS.
#
#   bash supabase/hosted-apply/rehearse-phase-d.sh            # needs Docker; ~1-2 min
#   KEEP=1 bash supabase/hosted-apply/rehearse-phase-d.sh     # leave the container running
#
# Database: the Supabase shim, the 18 baseline migrations, the upgrade seed (real jobs through the real functions,
# one claimed mid-flight), then Phase A's 13 migrations, each recorded in supabase_migrations.schema_migrations:
# 31 rows, newest 20261113300400 (the state baton-dev is in). Every scenario runs in a fresh clone and compares a
# fingerprint of all public functions (definition + ACL), all public columns, the history and the job rows.
#
# Scenarios
#   A  nested BEGIN/COMMIT semantics in this Postgres (the wrapper relies on them)
#   H  the read-only gate queries run on the real schema (inside BEGIN READ ONLY)
#   B  guard: a job claimed mid-flight -> abort under lock, nothing applied
#   C  concurrent job activity while the Phase D transaction is open: inserts, claims, heartbeats, FOR UPDATE are
#      blocked; plain reads continue; a write that waited runs after COMMIT against the new schema
#   D1 lock_timeout: a worker transaction holding a row lock -> the wrapper's LOCK gives up after 10s, nothing applied
#   D2 lock_timeout midway: a long reader -> LOCK succeeds, #14-#16 run, #17's ALTER times out -> all rolled back
#   E  deliberate failure midway (after #14-#17 ran inside the transaction) -> all rolled back
#   F  success with the pinned files exactly as the runner invokes them -> every change committed exactly once
#   G  re-run after success -> refused, nothing duplicated
#   C, E use rehearsal-only copies made inside the container (shown as diffs): C adds pg_sleep(15) after the guard so
#   the transaction stays open; E adds a division by zero before #18. Everything else uses the pinned files as-is.
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
NAME="${BATON_REHEARSAL_CONTAINER:-baton-phase-d-rehearsal}"
IMAGE="${BATON_PG_IMAGE:-postgres:17-alpine}"
CUTOFF="20261113300500" # Phase D starts here; everything before it is applied (baseline + Phase A)
PHASE_A_FIRST="20261113"
TMPD="$(mktemp -d)"
T_START=$(date +%s)

# Docker transport. No call ever uses `docker exec -i` or feeds SQL through stdin: an earlier version piped files into
# `docker exec -i ... psql -f -` and ran every query with -i attached to the caller's stdin. Started from an interactive
# Git Bash terminal, the second piped exec hung before psql ever started in the container (0 % CPU, no psql process,
# the migration never applied). Now: SQL files are mounted read-only (/sb = supabase/, /ha = hosted-apply/) and run with
# psql -f; inline SQL uses repeated psql -c in one session; stdin is always /dev/null; docker.exe is called directly
# (not the resources/bin/docker sh wrapper); and every call has a hard timeout (DKT seconds, default 120).
DOCKER="$(command -v docker.exe || command -v docker)"
dk() { MSYS_NO_PATHCONV=1 timeout --kill-after=5 "${DKT:-120}" "$DOCKER" "$@" </dev/null; }
winpath() { if command -v cygpath >/dev/null 2>&1; then cygpath -w "$1"; else printf '%s\n' "$1"; fi; }
cleanup() { [[ -z "${KEEP:-}" ]] && dk rm -f -v "$NAME" >/dev/null 2>&1; rm -rf "$TMPD"; } # -v: no leaked data volume
trap cleanup EXIT
step() { printf '\n== [%s +%ss] %s\n' "$(date +%H:%M:%S)" "$(( $(date +%s) - T_START ))" "$*"; }

PASSES=0; FAILS=0
pass() { PASSES=$((PASSES + 1)); printf '  PASS  %s\n' "$1"; }
fail() { FAILS=$((FAILS + 1)); printf '  FAIL  %s\n' "$1"; }
expect() { if eval "$2"; then pass "$1"; else fail "$1"; fi; } # expect LABEL 'bash condition'

# psql helpers (all inside the container, as the local superuser; the hosted runner connects as `postgres`)
q() { dk exec "$NAME" psql -X -q -t -A -U postgres -d "$1" -v ON_ERROR_STOP=1 -c "$2"; }          # one scalar
runf() { dk exec "$NAME" psql -X -U postgres -d "$1" -v ON_ERROR_STOP=1 -f "$2"; }                 # file in container
quietf() { dk exec "$NAME" psql -X -q -U postgres -d "$1" -v ON_ERROR_STOP=1 -f "$2" >/dev/null; } # setup file, quiet
clone() { dk exec "$NAME" createdb -U postgres -T "$2" "$1"; }

FP_SQL="select md5(string_agg(x, E'\n' order by x)) from (
  select 'mig ' || version from supabase_migrations.schema_migrations
  union all select 'fn ' || p.oid::regprocedure::text || ' ' || md5(pg_get_functiondef(p.oid)) || ' ' || coalesce(p.proacl::text, '')
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.prokind = 'f'
  union all select 'col ' || table_name || '.' || column_name || ' ' || data_type || ' ' || is_nullable || ' ' || coalesce(column_default, '')
    from information_schema.columns where table_schema = 'public'
  union all select 'job ' || id || ' ' || status || ' ' || attempt || ' ' || coalesce(lease_expires_at::text, '-') from public.processing_jobs
) s(x)"
fp() { q "$1" "$FP_SQL"; }
hist() { q "$1" "select count(*) || '/' || max(version) from supabase_migrations.schema_migrations"; }
has_cg() { q "$1" "select count(*) from information_schema.columns where table_schema='public' and table_name='processing_jobs' and column_name='claim_generation'"; }
ms() { date +%s%3N; }
wait_lock() { # wait_lock DB TABLE MODE: until another session holds MODE on TABLE (max 20s)
  for _ in $(seq 1 80); do
    [[ "$(q "$1" "select count(*) from pg_locks l join pg_class c on c.oid = l.relation where c.relname = '$2' and l.mode = '$3' and l.granted and l.pid <> pg_backend_pid()")" -ge 1 ]] && return 0
    sleep 0.25
  done; return 1
}
kill_others() { q "$1" "select count(pg_terminate_backend(pid)) from pg_stat_activity where datname = '$1' and pid <> pg_backend_pid()" >/dev/null; }

# ── 0. offline verification of the pinned files ───────────────────────────────────────────────────────
step "offline verification"
node "$HERE/phase-d.mjs" verify || { echo "pinned files do not verify; not rehearsing"; exit 2; }
[[ -n "$DOCKER" ]] && dk info >/dev/null 2>&1 || { echo "Docker is not running; not rehearsing"; exit 4; }

# ── 1. throwaway Postgres without any network ─────────────────────────────────────────────────────────
step "container $NAME ($IMAGE, --network none, /sb and /ha read-only)"
dk rm -f -v "$NAME" >/dev/null 2>&1
DKT=300 dk run -d --name "$NAME" --network none -e POSTGRES_HOST_AUTH_METHOD=trust \
  -v "$(winpath "$ROOT/supabase"):/sb:ro" -v "$(winpath "$HERE"):/ha:ro" "$IMAGE" \
  -c max_connections=60 -c deadlock_timeout=200ms >/dev/null || { echo "docker run failed"; exit 4; }
ready=0; for _ in $(seq 1 120); do dk exec "$NAME" pg_isready -U postgres -q 2>/dev/null && { ready=1; break; }; sleep 0.5; done
[[ $ready == 1 ]] || { echo "postgres did not become ready within 60s"; exit 4; }
sleep 1 # the image restarts postgres once after init; wait until it is ready again
for _ in $(seq 1 60); do q postgres "select 1" >/dev/null 2>&1 && break; sleep 0.5; done
expect "container has no network (only loopback)" '[[ "$(dk exec "$NAME" sh -c "ls /sys/class/net" | tr "\n" " ")" == "lo " ]]'
expect "read-only mounts present (/sb/migrations, /ha bundle)" '[[ "$(dk exec "$NAME" sh -c "ls /sb/migrations/*.sql | wc -l; test -f /ha/03_phase_D_migrations_14-18.sql && echo ok; touch /ha/x 2>/dev/null || echo ro" | tr "\n" " ")" == "36 ok ro " ]]'
echo "   postgres $(q postgres 'show server_version')"

# ── 2. template: shim + baseline + seed + Phase A, with migration history ─────────────────────────────
step "building the pre-Phase-D database"
dk exec "$NAME" createdb -U postgres tpl_inflight
quietf tpl_inflight /sb/tests/shim/00_supabase_shim.sql || { echo "shim failed"; exit 3; }
q tpl_inflight "create schema if not exists supabase_migrations" >/dev/null
q tpl_inflight "create table if not exists supabase_migrations.schema_migrations (version text primary key, statements text[], name text)" >/dev/null
apply_migration() { # FILE(basename) DB
  local b="${1%.sql}" t0; t0=$(date +%s)
  quietf "$2" "/sb/migrations/$1" || { echo "   migration FAILED: $b"; exit 3; }
  q "$2" "insert into supabase_migrations.schema_migrations (version, name) values ('${b:0:14}', '${b:15}')" >/dev/null || exit 3
  printf '   applied %-55s %2ss\n' "$b" "$(( $(date +%s) - t0 ))"
}
nb=0; na=0
for f in "$ROOT"/supabase/migrations/*.sql; do
  b="$(basename "$f")"; [[ "$b" < "$PHASE_A_FIRST" ]] || continue; apply_migration "$b" tpl_inflight; nb=$((nb + 1))
done
quietf tpl_inflight /sb/tests/shim/10_test_helpers.sql || { echo "test helpers failed"; exit 3; }
echo "   seeding (real jobs through start_processing / claim_ready_processing_jobs)"
quietf tpl_inflight /sb/tests/upgrade/seed.sql || { echo "seed failed"; exit 3; }
for f in "$ROOT"/supabase/migrations/*.sql; do
  b="$(basename "$f")"; [[ "$b" < "$PHASE_A_FIRST" || ! "$b" < "$CUTOFF" ]] && continue; apply_migration "$b" tpl_inflight; na=$((na + 1))
done
echo "   baseline $nb + Phase A $na migrations; history $(hist tpl_inflight)"
echo "   jobs: $(q tpl_inflight "select string_agg(status || '=' || n, ', ') from (select status, count(*) n from public.processing_jobs group by 1 order by 1) s")"
# idle variant: settle every in-flight job AND its run (as the runbook requires before Phase D; on baton-dev every
# run is terminal: 3 succeeded, 1 failed)
clone tpl_idle tpl_inflight
q tpl_idle "update public.processing_jobs set status = 'cancelled', finished_at = now(), lease_expires_at = null where status in ('queued', 'running')" >/dev/null
q tpl_idle "update public.processing_runs set status = 'cancelled', finished_at = now() where status in ('queued', 'running')" >/dev/null
expect "templates: history 31 rows, newest 20261113300400" '[[ "$(hist tpl_inflight)" == "31/20261113300400" && "$(hist tpl_idle)" == "31/20261113300400" ]]'
expect "in-flight template has a running job (claimed mid-flight by the seed)" '[[ "$(q tpl_inflight "select count(*) from public.processing_jobs where status = '"'running'"'")" -ge 1 ]]'
expect "idle template has no queued/running job" '[[ "$(q tpl_idle "select count(*) from public.processing_jobs where status in ('"'queued'"', '"'running'"')")" == 0 ]]'
FP0="$(fp tpl_idle)"

# rehearsal-only copies (inside the container), shown as diffs against the pinned files
dk exec "$NAME" mkdir -p /work
dk exec "$NAME" sh -c "sed 's|^\\\\echo \\[phase D\\] locked|select pg_sleep(15); -- REHEARSAL ONLY: keep the transaction open\n&|' /ha/r3_phase_d_txn.sql > /work/txn_sleep.sql"
dk exec "$NAME" sh -c "sed 's|^-- ===== 20261113300900_point_evidence_guard_fields.sql (verbatim) =====|select '\"'\"'in-transaction history rows: '\"'\"' \|\| count(*) from supabase_migrations.schema_migrations; -- REHEARSAL ONLY\nselect 1/0; -- REHEARSAL ONLY: deliberate failure after #14-#17\n&|' /ha/03_phase_D_migrations_14-18.sql > /work/bundle_fail.sql"
dk exec "$NAME" sh -c "sed 's|^\\\\i /ha/03_phase_D_migrations_14-18.sql|\\\\i /work/bundle_fail.sql|' /ha/r3_phase_d_txn.sql > /work/txn_fail.sql"
# changed lines only, in a format both BusyBox and GNU diff produce: `diff -U0` minus its two file headers and @@ hunks
changed() { dk exec "$NAME" sh -c "diff -U0 '/ha/$1' '/work/$2' | tail -n +3 | grep -v '^@@'"; }
echo "   rehearsal-only differences (- pinned, + rehearsal copy):"
for p in "r3_phase_d_txn.sql txn_sleep.sql" "03_phase_D_migrations_14-18.sql bundle_fail.sql" "r3_phase_d_txn.sql txn_fail.sql"; do
  set -- $p; changed "$1" "$2" | sed "s|^|     $2: |"
done
expect "rehearsal copies differ from the pinned files only by the 5 marked lines" \
  '[[ "$(changed r3_phase_d_txn.sql txn_sleep.sql | grep -c "REHEARSAL ONLY")" == 1 && "$(changed r3_phase_d_txn.sql txn_sleep.sql | wc -l)" == 1 &&
      "$(changed 03_phase_D_migrations_14-18.sql bundle_fail.sql | grep -c "^+.*REHEARSAL ONLY")" == 2 && "$(changed 03_phase_D_migrations_14-18.sql bundle_fail.sql | wc -l)" == 2 &&
      "$(changed r3_phase_d_txn.sql txn_fail.sql | tr "\n" "|")" == "-\\i /ha/03_phase_D_migrations_14-18.sql|+\\i /work/bundle_fail.sql|" ]]'

# ── A. nested BEGIN/COMMIT semantics ──────────────────────────────────────────────────────────────────
step "A  nested BEGIN/COMMIT in this Postgres"
dk exec "$NAME" createdb -U postgres a_nested
q a_nested "create table t (x int)" >/dev/null
out="$(dk exec "$NAME" psql -X -U postgres -d a_nested -v ON_ERROR_STOP=1 -c "begin" -c "insert into t values (1)" -c "begin" -c "insert into t values (2)" -c "commit" 2>&1)"; rc=$?
expect "A1 a second BEGIN only warns ('already a transaction in progress'), exit 0" '[[ $rc == 0 && "$out" == *"there is already a transaction in progress"* ]]'
rows_t() { q a_nested "select coalesce(string_agg(x::text, chr(44) order by x), '') from t"; } # chr(44) = ','
expect "A1 the single COMMIT commits both inserts" '[[ "$(rows_t)" == "1,2" ]]'
out="$(dk exec "$NAME" psql -X -U postgres -d a_nested -v ON_ERROR_STOP=1 -c "begin" -c "insert into t values (3)" -c "begin" -c "insert into t values (4)" -c "select 1/0" -c "commit" 2>&1)"; rc=$?
expect "A2 an error before COMMIT stops psql (non-zero exit, COMMIT never sent)" '[[ $rc != 0 && "$out" == *"division by zero"* && "$out" != *COMMIT* ]]'
expect "A2 both inserts after the outer BEGIN are rolled back" '[[ "$(rows_t)" == "1,2" ]]'

# ── H. read-only gate queries on the real schema ──────────────────────────────────────────────────────
step "H  read-only gate queries (inside BEGIN READ ONLY)"
ro() { dk exec "$NAME" psql -X -q -A -t -F '|' -U postgres -d "$1" -v ON_ERROR_STOP=1 -c "begin read only" -f "/ha/$2" -c "rollback"; }
rows_ok() { local o; o="$(ro "$1" "$2")" || return 1; [[ "$(grep -c . <<<"$o")" == "$3" && "$(grep . <<<"$o" | grep -vc '|t$')" == 0 ]]; }
expect "H1 r3_prereq.sql: 8 rows, all t (idle)"        'rows_ok tpl_idle r3_prereq.sql 8'
expect "H2 r3_jobs.sql: 4 rows, all t (idle)"          'rows_ok tpl_idle r3_jobs.sql 4'
expect "H3 05_verify_phase_A.sql: 14 rows, all t"      'rows_ok tpl_idle 05_verify_phase_A.sql 14'
expect "H4 r3_jobs.sql flags the in-flight template"   '! rows_ok tpl_inflight r3_jobs.sql 4'
expect "H5 r3_post.sql is not satisfied before Phase D" '! rows_ok tpl_idle r3_post.sql 5'
expect "H6 the gates did not change anything"          '[[ "$(fp tpl_idle)" == "$FP0" ]]'

# ── B. guard with a job in flight ─────────────────────────────────────────────────────────────────────
step "B  in-flight job"
clone b_inflight tpl_inflight; before="$(fp b_inflight)"
out="$(runf b_inflight /ha/r3_phase_d_txn.sql 2>&1)"; rc=$?
expect "B1 the pinned wrapper aborts (exit 3) with the in-lock guard message" '[[ $rc == 3 && "$out" == *"processing job(s) queued or running (checked under lock)"* ]]'
expect "B2 nothing applied: fingerprint, history 31, no claim_generation" '[[ "$(fp b_inflight)" == "$before" && "$(hist b_inflight)" == "31/20261113300400" && "$(has_cg b_inflight)" == 0 ]]'
expect "B3 no lock left behind" '[[ "$(q b_inflight "select count(*) from pg_locks l join pg_class c on c.oid = l.relation where c.relname in ('"'processing_jobs'"','"'processing_runs'"')")" == 0 ]]'

# ── C. concurrent job activity during the open transaction ────────────────────────────────────────────
step "C  concurrent job activity while the transaction is open (rehearsal copy with pg_sleep(15))"
clone c_concurrent tpl_idle
JOB="$(q c_concurrent "select id || ' ' || attempt from public.processing_jobs order by id limit 1")"; JID="${JOB% *}"; JATT="${JOB#* }"
t0=$(ms); runf c_concurrent /work/txn_sleep.sql > "$TMPD/c.out" 2>&1 & WP=$!
if wait_lock c_concurrent processing_jobs ExclusiveLock && wait_lock c_concurrent processing_runs ExclusiveLock; then
  pass "C0 the transaction holds EXCLUSIVE locks on processing_jobs and processing_runs"
  probe() { # probe LABEL SQL: must fail with a lock timeout (55P03) within lock_timeout=1500ms
    local o r; o="$(dk exec "$NAME" psql -X -q -t -A -U postgres -d c_concurrent -v ON_ERROR_STOP=1 -c "set lock_timeout = '1500ms'" -c "$2" 2>&1)"; r=$?
    if [[ $r != 0 && "$o" == *"lock timeout"* ]]; then pass "$1 (blocked: lock timeout)"; else fail "$1 (rc=$r: ${o:0:120})"; fi
  }
  probe "C1 new job (INSERT processing_jobs) is blocked" \
    "insert into public.processing_jobs select (jsonb_populate_record(null::public.processing_jobs, to_jsonb(j) || jsonb_build_object('id', gen_random_uuid()))).* from public.processing_jobs j limit 1"
  probe "C2 new run (INSERT processing_runs) is blocked" \
    "insert into public.processing_runs select (jsonb_populate_record(null::public.processing_runs, to_jsonb(r) || jsonb_build_object('id', gen_random_uuid()))).* from public.processing_runs r limit 1"
  probe "C3 claim (claim_ready_processing_jobs) is blocked" "select count(*) from public.claim_ready_processing_jobs(5, 300)"
  probe "C4 heartbeat (heartbeat_processing_job) is blocked" "select public.heartbeat_processing_job('$JID', $JATT, 300)"
  probe "C5 worker-style SELECT ... FOR UPDATE SKIP LOCKED is blocked" "select id from public.processing_jobs for update skip locked limit 1"
  probe "C6 status UPDATE on a job is blocked" "update public.processing_jobs set progress_done = progress_done where id = '$JID'"
  o="$(dk exec "$NAME" psql -X -q -t -A -U postgres -d c_concurrent -c "set lock_timeout = '1500ms'" -c "select count(*) from public.processing_jobs" 2>&1)"
  expect "C7 plain reads still work during the lock" '[[ "$o" =~ ^[0-9]+$ ]]'
  # a write that WAITS (no lock_timeout) must run only after COMMIT, against the new schema
  dk exec "$NAME" psql -X -q -t -A -U postgres -d c_concurrent -c "update public.processing_jobs set progress_done = progress_done where id = '$JID' returning claim_generation, clock_timestamp()" > "$TMPD/c_wait.out" 2>&1 & WW=$!
  sleep 1
  expect "C8 the waiting write is still blocked while the transaction is open" '[[ ! -s "$TMPD/c_wait.out" ]] && kill -0 $WW 2>/dev/null'
else
  fail "C0 the transaction never took its locks"; WW=""
fi
wait $WP; rc=$?; t1=$(ms)
expect "C9 the transaction then commits (exit 0) after $(( (t1 - t0) / 1000 ))s" '[[ $rc == 0 ]]'
[[ -n "${WW:-}" ]] && wait "$WW"
expect "C10 the waiting write ran after COMMIT and already sees claim_generation" '[[ "$(cut -d"|" -f1 < "$TMPD/c_wait.out" | head -1)" =~ ^[0-9]+$ ]]'
expect "C11 history 36 rows, newest 20261113300900" '[[ "$(hist c_concurrent)" == "36/20261113300900" ]]'

# ── D1. lock_timeout: a worker transaction holds a row lock ───────────────────────────────────────────
step "D1 lock_timeout before anything runs (a worker transaction holds a row lock)"
clone d1_timeout tpl_idle; before="$(fp d1_timeout)"; JID1="$(q d1_timeout "select id from public.processing_jobs order by id limit 1")"
DKT=90 dk exec "$NAME" psql -X -q -U postgres -d d1_timeout -c "begin" \
  -c "update public.processing_jobs set progress_done = progress_done where id = '$JID1'" -c "select pg_sleep(40)" -c "commit" >/dev/null 2>&1 & HP=$!
wait_lock d1_timeout processing_jobs RowExclusiveLock || fail "D1 the holder never took its lock"
t0=$(ms); out="$(runf d1_timeout /ha/r3_phase_d_txn.sql 2>&1)"; rc=$?; t1=$(ms); el=$(( (t1 - t0) / 1000 ))
expect "D1 the pinned wrapper aborts with a lock timeout after ~10s (took ${el}s)" '[[ $rc != 0 && "$out" == *"lock timeout"* && $el -ge 9 && $el -le 20 ]]'
expect "D1 it stopped at its own LOCK: the bundle never started" '[[ "$out" != *"already a transaction in progress"* ]]'
kill_others d1_timeout; wait $HP 2>/dev/null
expect "D1 nothing applied: fingerprint, history 31, no claim_generation" '[[ "$(fp d1_timeout)" == "$before" && "$(hist d1_timeout)" == "31/20261113300400" && "$(has_cg d1_timeout)" == 0 ]]'

# ── D2. lock_timeout midway: a long reader blocks #17's ALTER TABLE ───────────────────────────────────
step "D2 lock_timeout midway (a long reader blocks #17's ALTER TABLE after #14-#16 ran)"
clone d2_midway tpl_idle; before="$(fp d2_midway)"
DKT=90 dk exec "$NAME" psql -X -q -U postgres -d d2_midway -c "begin" \
  -c "select count(*) from public.processing_jobs" -c "select pg_sleep(40)" -c "commit" >/dev/null 2>&1 & HP=$!
wait_lock d2_midway processing_jobs AccessShareLock || fail "D2 the reader never took its lock"
t0=$(ms); out="$(runf d2_midway /ha/r3_phase_d_txn.sql 2>&1)"; rc=$?; t1=$(ms); el=$(( (t1 - t0) / 1000 ))
expect "D2 the bundle started inside the transaction (nested BEGIN warning, #14-#16 statements ran)" \
  '[[ "$out" == *"already a transaction in progress"* && "$out" == *"REVOKE"* && "$out" == *"CREATE FUNCTION"* ]]'
expect "D2 #17's ALTER TABLE hit the lock timeout (${el}s) and psql stopped" '[[ $rc != 0 && "$out" == *"lock timeout"* && "$out" != *"COMMIT"* ]]'
kill_others d2_midway; wait $HP 2>/dev/null
expect "D2 everything rolled back: fingerprint, history 31, #14 grant still present" \
  '[[ "$(fp d2_midway)" == "$before" && "$(hist d2_midway)" == "31/20261113300400" && "$(q d2_midway "select has_function_privilege('"'service_role'"', '"'public.persist_parsed_source(uuid,jsonb,text)'"', '"'EXECUTE'"')")" == t ]]'

# ── E. deliberate failure midway ──────────────────────────────────────────────────────────────────────
step "E  deliberate failure after #14-#17 (rehearsal copy)"
clone e_fail tpl_idle; before="$(fp e_fail)"
out="$(runf e_fail /work/txn_fail.sql 2>&1)"; rc=$?
expect "E1 #14-#17 had run inside the transaction (35 history rows visible to it)" '[[ "$out" == *"in-transaction history rows: 35"* ]]'
expect "E2 the failure stops psql (exit 3, division by zero, no COMMIT)" '[[ $rc == 3 && "$out" == *"division by zero"* && "$out" != *"COMMIT"* ]]'
expect "E3 nothing persists: fingerprint, history 31, no claim_generation, no generation overloads" \
  '[[ "$(fp e_fail)" == "$before" && "$(hist e_fail)" == "31/20261113300400" && "$(has_cg e_fail)" == 0 && "$(q e_fail "select count(*) from pg_proc where proname like '"'pipeline\\_%'"' and proargnames[3] = '"'p_claim_generation'"'")" == 0 ]]'
expect "E4 #14/#15 grants are back (rolled back with the rest)" \
  '[[ "$(q e_fail "select bool_and(has_function_privilege('"'service_role'"', f, '"'EXECUTE'"')) from unnest(array['"'public.persist_parsed_source(uuid,jsonb,text)'"','"'public.mark_source_parse_failed(uuid,text)'"']) f")" == t ]]'

# ── F. success, exactly as the runner invokes it ──────────────────────────────────────────────────────
step "F  success (pinned wrapper, runner's psql flags)"
clone f_success tpl_idle
out="$(dk exec "$NAME" psql -X -U postgres -d f_success -v ON_ERROR_STOP=1 -f /ha/r3_phase_d_txn.sql 2>&1)"; rc=$?
expect "F1 exit 0, exactly one nested-BEGIN warning, one COMMIT, schema reload notified" \
  '[[ $rc == 0 && "$(grep -c "already a transaction in progress" <<<"$out")" == 1 && "$(grep -c "^COMMIT$" <<<"$out")" == 1 && "$out" == *NOTIFY* ]]'
expect "F2 history 36 rows; each Phase D version exactly once" \
  '[[ "$(hist f_success)" == "36/20261113300900" && "$(q f_success "select count(*) from (select version from supabase_migrations.schema_migrations where version between '"'20261113300500'"' and '"'20261113300900'"' group by version having count(*) = 1) s")" == 5 ]]'
expect "F3 04_verify_all.sql: 19 rows, all t" 'rows_ok f_success 04_verify_all.sql 19'
expect "F4 r3_post.sql: 5 rows, all t"        'rows_ok f_success r3_post.sql 5'
expect "F5 #17 backfill: claim_generation = attempt on every job" \
  '[[ "$(q f_success "select count(*) from public.processing_jobs where claim_generation <> attempt")" == 0 && "$(q f_success "select count(*) from public.processing_jobs")" -gt 0 ]]'
expect "F6 #14/#15 revoked from service_role" \
  '[[ "$(q f_success "select bool_or(has_function_privilege('"'service_role'"', f, '"'EXECUTE'"')) from unnest(array['"'public.persist_parsed_source(uuid,jsonb,text)'"','"'public.mark_source_parse_failed(uuid,text)'"','"'public.set_job_provenance(uuid,jsonb)'"']) f")" == f ]]'
expect "F7 no lock left behind" '[[ "$(q f_success "select count(*) from pg_locks l join pg_class c on c.oid = l.relation where c.relname in ('"'processing_jobs'"','"'processing_runs'"')")" == 0 ]]'

# ── G. re-run after success ───────────────────────────────────────────────────────────────────────────
step "G  re-run after success"
before="$(fp f_success)"; out="$(runf f_success /ha/r3_phase_d_txn.sql 2>&1)"; rc=$?
expect "G1 refused by the in-lock guard (history has 36 rows)" '[[ $rc == 3 && "$out" == *"migration history has 36 rows"* ]]'
expect "G2 nothing duplicated or changed" '[[ "$(fp f_success)" == "$before" && "$(hist f_success)" == "36/20261113300900" ]]'

echo
step "rehearsal: $PASSES passed, $FAILS failed"
[[ $FAILS == 0 ]]
