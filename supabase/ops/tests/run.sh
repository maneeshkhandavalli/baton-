#!/usr/bin/env bash
# Local verification of supabase/ops/*.sql against the real Supabase Postgres image (pg_cron, pg_net,
# Vault, pgcrypto). Never touches a hosted project. Needs Docker and Node.
#
#   bash supabase/ops/tests/run.sh                   # full run (~3 minutes: waits for one real cron tick)
#   KEEP=1 bash supabase/ops/tests/run.sh            # leave the container running
#   BATON_SUPABASE_PG_IMAGE=supabase/postgres:<tag>  # another image
#
# public.pipeline_work_due() is STUBBED here (a flag table) so the scheduler can be driven deterministically;
# its real definition is tested against the full schema in tests/integration/db/sql/it20_worker_slots.sql.
# All secrets are synthetic.
set -euo pipefail
export MSYS_NO_PATHCONV=1

HERE="$(cd "$(dirname "$0")" && pwd)"
OPS="$(cd "$HERE/.." && pwd)"
ROOT="$(cd "$OPS/../.." && pwd)"
IMAGE="${BATON_SUPABASE_PG_IMAGE:-supabase/postgres:17.12.0.000}"
NAME="${BATON_OPS_CONTAINER:-baton-ops-check}"
PORT="${BATON_OPS_PORT:-48123}"
KEY="ops-test-signing-key-0123456789abcdefghij"   # synthetic, 40 chars
BASE="http://host.docker.internal:$PORT/api/pipeline/drain"
WORK="$(mktemp -d)"
LOG="$WORK/requests.log"
FAILS=0

node_path() { if command -v cygpath >/dev/null 2>&1; then cygpath -w "$1"; else echo "$1"; fi; }

cleanup() {
  [[ -n "${LPID:-}" ]] && kill "$LPID" 2>/dev/null || true
  [[ -z "${KEEP:-}" ]] && docker rm -f "$NAME" >/dev/null 2>&1 || true
}
trap cleanup EXIT

as() { local role="$1"; shift; docker exec -i "$NAME" psql -X -q -At -U "$role" -h localhost -d postgres -v ON_ERROR_STOP=1 "$@"; }
pg() { as postgres "$@"; }
admin() { as supabase_admin "$@"; }
check() { # check <description> <actual> <expected>
  if [[ "$2" == "$3" ]]; then echo "  PASS $1"; else echo "  FAIL $1: got [$2], expected [$3]"; FAILS=$((FAILS + 1)); fi
}
wait_response() { # wait until pg_net has answered dispatch $1 (or 15 s)
  for _ in $(seq 1 30); do
    [[ "$(pg -c "select count(*) from net._http_response h join baton_ops.worker_dispatches d on d.request_id = h.id where d.id = $1")" == "1" ]] && return 0
    sleep 0.5
  done
}
set_url() { pg -c "select vault.update_secret((select id from vault.secrets where name = 'baton_worker_url'), '$BASE$1')" >/dev/null; }
due() { pg -c "update ops_test.due set flag = $1" >/dev/null; }
outcome() { pg -c "select outcome || ':' || coalesce(status_code::text, '-') from baton_ops.worker_dispatches where id = $1"; }

echo "== start $IMAGE"
docker rm -f "$NAME" >/dev/null 2>&1 || true
: >"$LOG"
node "$(node_path "$HERE/listener.mjs")" "$PORT" "$KEY" >>"$LOG" 2>&1 &
LPID=$!
docker run -d --name "$NAME" --add-host=host.docker.internal:host-gateway -e POSTGRES_PASSWORD=postgres "$IMAGE" >/dev/null
for _ in $(seq 1 120); do docker exec "$NAME" pg_isready -U postgres -h localhost -q 2>/dev/null && break; sleep 1; done
sleep 5

echo "== stub of public.pipeline_work_due() (owned by postgres, like the migration on hosted)"
pg <<'SQL'
create schema if not exists ops_test;
create table if not exists ops_test.due (flag boolean not null);
insert into ops_test.due values (false);
create or replace function public.pipeline_work_due() returns boolean language sql stable as $$ select flag from ops_test.due $$;
SQL

echo "== apply schedule-pipeline-worker.sql as postgres (the hosted SQL editor role), twice"
pg -f - <"$OPS/schedule-pipeline-worker.sql" >/dev/null 2>"$WORK/apply1.err" || { cat "$WORK/apply1.err"; exit 1; }
pg -f - <"$OPS/schedule-pipeline-worker.sql" >/dev/null 2>"$WORK/apply2.err" || { cat "$WORK/apply2.err"; exit 1; }
check "idempotent: one job of each name" "$(pg -c "select string_agg(jobname || '=' || n, ',' order by jobname) from (select jobname, count(*) n from cron.job group by jobname) x")" \
  "baton-pipeline-worker=1,baton-pipeline-worker-housekeeping=1"
check "schedules" "$(pg -c "select string_agg(schedule, ',' order by jobname) from cron.job")" "* * * * *,17 3 * * *"
check "pg_net exposure is reported, not hidden" "$(grep -c 'readable by anon' "$WORK/apply1.err")" "1"
# Pause the real schedule while the scheduler is driven by hand; it is re-enabled for the real tick at the end.
pg -c "select cron.alter_job((select jobid from cron.job where jobname = 'baton-pipeline-worker'), active := false)" >/dev/null

echo "== gate: no due work"
check "idle when nothing is due" "$(pg -c "select baton_ops.pipeline_worker_tick()")" "idle"
check "no dispatch recorded while idle" "$(pg -c "select count(*) from baton_ops.worker_dispatches")" "0"

echo "== due work but no secrets"
due true
check "tick without secrets still 'dispatches'" "$(pg -c "select baton_ops.pipeline_worker_tick()")" "dispatched"
check "recorded as not_sent / secrets_missing" "$(pg -c "select outcome || '/' || error from baton_ops.worker_dispatches order by id desc limit 1")" "not_sent/secrets_missing"
check "no HTTP request without secrets" "$(grep -c '"path"' "$LOG" || true)" "0"

echo "== secrets (synthetic)"
pg -c "select vault.create_secret('$BASE/ok', 'baton_worker_url', 'test')" >/dev/null
pg -c "select vault.create_secret('$KEY', 'baton_worker_secret', 'test')" >/dev/null

echo "== the queued request never contains the key (inspected before commit, so pg_net cannot send it yet)"
QUEUED="$(pg <<'SQL'
begin;
select baton_ops.dispatch_pipeline_worker();
select (headers::text like '%x-baton-dispatch%')::text || ',' || (headers::text ~* 'authorization')::text || ',' ||
       (position((select decrypted_secret from vault.decrypted_secrets where name = 'baton_worker_secret') in headers::text || coalesce(body::text, '')) > 0)::text
  from net.http_request_queue order by id desc limit 1;
rollback;
SQL
)"
check "queue holds the signed header, no Authorization, no key" "$(echo "$QUEUED" | tail -1)" "true,false,false"

echo "== signature agrees with the TypeScript verifier (golden vector)"
SQL_SIG="$(pg -c "select encode(extensions.hmac('v1.1700000000.42', 'golden-signing-key-0123456789abcdefghijkl', 'sha256'), 'hex')")"
TS_SIG="$(node -e "console.log(require('node:crypto').createHmac('sha256','golden-signing-key-0123456789abcdefghijkl').update('v1.1700000000.42').digest('hex'))")"
check "pgcrypto HMAC == node HMAC" "$SQL_SIG" "$TS_SIG"

echo "== 200 ok"
check "tick dispatches" "$(pg -c "select baton_ops.pipeline_worker_tick()")" "dispatched"
ID="$(pg -c "select max(id) from baton_ops.worker_dispatches")"
wait_response "$ID"
pg -c "select baton_ops.reconcile_worker_dispatches()" >/dev/null
check "ok:200 recorded" "$(outcome "$ID")" "ok:200"
check "counts parsed from the response" "$(pg -c "select claimed || '/' || succeeded || '/' || busy from baton_ops.worker_dispatches where id = $ID")" "3/3/0"
check "listener: valid signature, no Authorization, key never seen" "$(grep '"path":"/ok"' "$LOG" | tail -1 | node -e "const l=JSON.parse(require('fs').readFileSync(0,'utf8'));console.log([l.dispatchValid,l.hasAuthorization,l.keySeen].join(','))")" "true,false,false"

echo "== at most one scheduler request in flight"
# A pending dispatch is simulated (a real hung request would also stall pg_net itself: it does not start
# queued requests while one of its batch is still open; see docs/architecture/autonomous-worker.md).
pg -c "insert into baton_ops.worker_dispatches (request_id) values (999999980)" >/dev/null
check "the tick waits while a dispatch is pending" "$(pg -c "select baton_ops.pipeline_worker_tick()")" "in_flight"
pg -c "update baton_ops.worker_dispatches set dispatched_at = now() - interval '8 minutes' where request_id = 999999980" >/dev/null
check "a dispatch with no response for 7 min stops blocking (missing)" "$(pg -c "select baton_ops.pipeline_worker_tick()")" "dispatched"
check "and is recorded as missing" "$(pg -c "select outcome from baton_ops.worker_dispatches where request_id = 999999980")" "missing"
LAST="$(pg -c "select max(id) from baton_ops.worker_dispatches")"; wait_response "$LAST"; pg -c "select baton_ops.reconcile_worker_dispatches()" >/dev/null

dispatch_to() { # dispatch_to <path> [timeout_ms] → id, after its response arrived and was reconciled
  set_url "$1"
  local id; id="$(pg -c "select baton_ops.dispatch_pipeline_worker(${2:-300000})")"
  wait_response "$id"; pg -c "select baton_ops.reconcile_worker_dispatches()" >/dev/null; echo "$id"
}
echo "== failures are detected"
check "200 busy is ok with busy=1" "$(pg -c "select outcome || '/' || busy from baton_ops.worker_dispatches where id = $(dispatch_to /busy)")" "ok/1"
check "401 is http_error" "$(outcome "$(dispatch_to /unauth)")" "http_error:401"
check "500 is http_error" "$(outcome "$(dispatch_to /boom)")" "http_error:500"
check "a hung endpoint is a timeout" "$(outcome "$(dispatch_to /hang 1500)")" "timeout:-"
pg -c "select vault.update_secret((select id from vault.secrets where name = 'baton_worker_url'), 'http://host.docker.internal:9/api/pipeline/drain')" >/dev/null
CID="$(pg -c "select baton_ops.dispatch_pipeline_worker(3000)")"; wait_response "$CID"; pg -c "select baton_ops.reconcile_worker_dispatches()" >/dev/null
check "a refused connection is connection_error" "$(outcome "$CID")" "connection_error:-"
check "error text kept, short" "$(pg -c "select (length(error) between 1 and 200)::text from baton_ops.worker_dispatches where id = $CID")" "true"

echo "== missing vs pending"
pg -c "insert into baton_ops.worker_dispatches (dispatched_at, request_id) values (now() - interval '10 minutes', 999999990), (now(), 999999991)" >/dev/null
pg -c "select baton_ops.reconcile_worker_dispatches()" >/dev/null
check "no response after 7 min is missing" "$(pg -c "select outcome from baton_ops.worker_dispatches where request_id = 999999990")" "missing"
check "a fresh request without response stays pending" "$(pg -c "select outcome from baton_ops.worker_dispatches where request_id = 999999991")" "pending"
check "health report counts it" "$(pg -c "select pending_now || '/' || (failures_since_last_ok > 0)::text || '/' || work_due_now::text from baton_ops.worker_health")" "1/true/true"
pg -c "delete from baton_ops.worker_dispatches where request_id = 999999991" >/dev/null

echo "== housekeeping touches only Baton's cron history"
admin -c "select cron.schedule('unrelated-job', '0 0 1 1 *', 'select 1')" >/dev/null
admin <<'SQL' >/dev/null
insert into cron.job_run_details (jobid, runid, job_pid, database, username, command, status, return_message, start_time, end_time)
select j.jobid, nextval('cron.runid_seq'), 1, 'postgres', 'postgres', 'select 1', 'succeeded', 'old', now() - interval '30 days', now() - interval '30 days'
  from cron.job j where j.jobname in ('baton-pipeline-worker', 'unrelated-job');
SQL
pg -c "select baton_ops.housekeeping()" >/dev/null
check "old Baton history deleted, unrelated kept" "$(admin -c "select string_agg(j.jobname, ',' order by j.jobname) from cron.job_run_details d join cron.job j using (jobid) where d.return_message = 'old'")" "unrelated-job"

echo "== privileges"
for r in anon authenticated; do
  check "$r: no baton_ops" "$(admin -c "select has_schema_privilege('$r', 'baton_ops', 'USAGE')")" "f"
  check "$r: no vault secrets" "$(admin -c "select has_table_privilege('$r', 'vault.decrypted_secrets', 'SELECT')")" "f"
  check "$r: cannot run the tick" "$(admin -c "select has_function_privilege('$r', 'baton_ops.pipeline_worker_tick()', 'EXECUTE')")" "f"
done
check "no cron command contains the key" "$(pg -c "select count(*) from cron.job where position('$KEY' in command) > 0")" "0"

echo "== schedule-raw-retention.sql (R3 Task 02): same infrastructure, purpose-bound signature"
check "refused before the retention migration" "$(pg -f - <"$OPS/schedule-raw-retention.sql" 2>&1 | grep -c 'apply migration 20261117200200')" "1"
# Stand-ins for the migration's two tables (their real definitions are tested in it22_raw_retention.sql).
pg <<'SQL' >/dev/null
create table public.raw_retention_items (source_id uuid primary key);
create table public.raw_retention_runs (id uuid primary key);
revoke all on public.raw_retention_items, public.raw_retention_runs from public, anon, authenticated;
SQL
pg -f - <"$OPS/schedule-raw-retention.sql" >/dev/null 2>"$WORK/ret1.err" || { cat "$WORK/ret1.err"; exit 1; }
pg -f - <"$OPS/schedule-raw-retention.sql" >/dev/null 2>"$WORK/ret2.err" || { cat "$WORK/ret2.err"; exit 1; }
check "idempotent: retention jobs once each, worker jobs untouched" \
  "$(pg -c "select string_agg(jobname || '=' || n, ',' order by jobname) from (select jobname, count(*) n from cron.job where jobname like 'baton-%' group by jobname) x")" \
  "baton-pipeline-worker=1,baton-pipeline-worker-housekeeping=1,baton-raw-retention=1,baton-raw-retention-housekeeping=1"
pg -c "select cron.alter_job((select jobid from cron.job where jobname = 'baton-raw-retention'), active := false)" >/dev/null
check "without its URL secret: not_sent" "$(pg -c "select baton_ops.retention_tick()")" "not_sent"
pg -c "select vault.create_secret('http://host.docker.internal:$PORT/api/cron/retention', 'baton_retention_url', 'test')" >/dev/null
check "retention tick dispatches" "$(pg -c "select baton_ops.retention_tick()")" "dispatched"
RID="$(pg -c "select max(id) from baton_ops.retention_dispatches")"
for _ in $(seq 1 30); do
  [[ "$(pg -c "select count(*) from net._http_response h join baton_ops.retention_dispatches d on d.request_id = h.id where d.id = $RID")" == "1" ]] && break; sleep 0.5
done
pg -c "select baton_ops.reconcile_retention_dispatches()" >/dev/null
check "ok:200 with counts" "$(pg -c "select outcome || ':' || status_code || '/' || deleted from baton_ops.retention_dispatches where id = $RID")" "ok:200/2"
check "retention signature valid, NOT valid as a drain dispatch, no Authorization, key never seen" \
  "$(grep '"path":"/retention"' "$LOG" | tail -1 | node -e "const l=JSON.parse(require('fs').readFileSync(0,'utf8'));console.log([l.retentionValid,l.dispatchValid,l.hasAuthorization,l.keySeen].join(','))")" \
  "true,false,false,false"
check "drain dispatches are not valid retention dispatches" "$(grep '"path":"/ok"' "$LOG" | tail -1 | node -e "const l=JSON.parse(require('fs').readFileSync(0,'utf8'));console.log(l.retentionValid)")" "false"
pg -c "insert into baton_ops.retention_dispatches (request_id) values (999999970)" >/dev/null
check "an in-flight retention dispatch blocks the next tick" "$(pg -c "select baton_ops.retention_tick()")" "in_flight"
pg -c "delete from baton_ops.retention_dispatches where request_id = 999999970" >/dev/null
for r in anon authenticated; do
  check "$r: cannot run the retention tick" "$(admin -c "select has_function_privilege('$r', 'baton_ops.retention_tick()', 'EXECUTE')")" "f"
done

echo "== harden-pg-net.sql: a no-op as postgres, effective as the owner, pg_net still delivers"
check "postgres cannot change it" "$(pg -f - <"$OPS/harden-pg-net.sql" 2>&1 | grep -c 'nothing changed')" "1"
check "anon still reads the queue (Supabase default)" "$(admin -c "select has_table_privilege('anon', 'net.http_request_queue', 'SELECT')")" "t"
admin -f - <"$OPS/harden-pg-net.sql" >/dev/null 2>&1
check "after owner hardening: anon cannot read the queue" "$(admin -c "select has_table_privilege('anon', 'net.http_request_queue', 'SELECT')")" "f"
check "after owner hardening: authenticated cannot http_post" "$(admin -c "select has_function_privilege('authenticated', 'net.http_post(text,jsonb,jsonb,jsonb,integer)', 'EXECUTE')")" "f"
check "after owner hardening: pg_net still delivers for postgres" "$(outcome "$(dispatch_to /ok)")" "ok:200"

echo "== one real cron tick (waits for the next minute boundary)"
set_url /ok
pg -c "update baton_ops.worker_dispatches set outcome = 'missing' where outcome = 'pending'" >/dev/null
BEFORE="$(pg -c "select count(*) from baton_ops.worker_dispatches")"
pg -c "select cron.alter_job((select jobid from cron.job where jobname = 'baton-pipeline-worker'), active := true)" >/dev/null
sleep $((62 - $(date +%S | sed 's/^0//')))
for _ in $(seq 1 20); do
  [[ "$(pg -c "select count(*) from baton_ops.worker_dispatches")" -gt "$BEFORE" ]] && break; sleep 1
done
check "pg_cron ran the tick" "$(pg -c "select status from cron.job_run_details d join cron.job j using (jobid) where j.jobname = 'baton-pipeline-worker' order by start_time desc limit 1")" "succeeded"
NEW="$(pg -c "select max(id) from baton_ops.worker_dispatches")"
wait_response "$NEW"; pg -c "select baton_ops.reconcile_worker_dispatches()" >/dev/null
check "the scheduled dispatch reached the endpoint" "$(outcome "$NEW")" "ok:200"

echo "== no request ever carried the key or an Authorization header"
check "key seen in any request" "$(grep -c '"keySeen":true' "$LOG" || true)" "0"
check "Authorization header in any request" "$(grep -c '"hasAuthorization":true' "$LOG" || true)" "0"

echo
if [[ $FAILS -eq 0 ]]; then echo "ALL OPS CHECKS PASSED"; else echo "$FAILS OPS CHECK(S) FAILED"; exit 1; fi
