#!/bin/bash
# Baton hosted-DEV logical backup (read-only against hosted). Writes OUTSIDE the repository:
#   C:/Users/manee/Documents/programing/baton-multiagent/backup/<UTC timestamp>/
# Usage: bash run-backup.sh <expected-project-ref>
# Secrets (never printed, never written to the backup folder):
#   backup/secrets/db.env      SUPABASE_DB_URL=<Session pooler URI, port 5432>   (created by the user)
#   baton-lead/.env.local      NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (Storage download)
set -euo pipefail
export MSYS_NO_PATHCONV=1
EXPECTED_REF="${1:?usage: run-backup.sh <expected-project-ref>}"
BASE=C:/Users/manee/Documents/programing/baton-multiagent
SECRETS="$BASE/backup/secrets/db.env"
ENVLOCAL="$BASE/baton-lead/.env.local"
IMG=postgres:17-alpine

[[ -f "$SECRETS" ]] || { echo "missing $SECRETS"; exit 2; }
PGENV="$BASE/backup/secrets/pg.env"

# 1. The DB URL must point at the expected project (pooler user postgres.<ref> or host db.<ref>.supabase.co)
#    and use session mode (5432). Checked without printing the URL.
node -e '
const fs=require("fs");const ref=process.argv[1];
const line=fs.readFileSync(process.argv[2],"utf8").split(/\r?\n/).find(l=>l.startsWith("SUPABASE_DB_URL="));
if(!line){console.error("SUPABASE_DB_URL not set");process.exit(2)}
const u=new URL(line.slice(16).trim().replace(/^postgres:/,"postgresql:"));
const refOk=u.username===`postgres.${ref}`||u.hostname===`db.${ref}.supabase.co`;
const envRef=new URL(fs.readFileSync(process.argv[3],"utf8").match(/^NEXT_PUBLIC_SUPABASE_URL=(.*)$/m)[1].trim()).hostname.split(".")[0];
if(!refOk){console.error("DB URL does not belong to project",ref);process.exit(3)}
if(envRef!==ref){console.error(".env.local points at a different project");process.exit(3)}
if(u.port&&u.port!=="5432"){console.error("use the Session pooler (port 5432); transaction mode breaks pg_dump");process.exit(3)}
// Split into libpq keyword variables (decoded), so a password with URL-special characters is never
// re-parsed by libpq and connection errors cannot echo it. Written to a 0600 temp file, deleted on exit.
const pg=["PGHOST="+u.hostname,"PGPORT="+(u.port||"5432"),"PGUSER="+decodeURIComponent(u.username),
  "PGPASSWORD="+decodeURIComponent(u.password),"PGDATABASE="+(decodeURIComponent(u.pathname.slice(1))||"postgres"),"PGSSLMODE=require"];
if(pg.some(l=>/[\r\n]/.test(l))){console.error("unexpected newline in credentials");process.exit(3)}
fs.writeFileSync(process.argv[4],pg.join("\n")+"\n",{mode:0o600});
console.log("ref check OK:",ref,"host",u.hostname,"port",u.port||"5432");
' "$EXPECTED_REF" "$SECRETS" "$ENVLOCAL" "$PGENV"
trap 'rm -f "$PGENV"' EXIT

TS=$(date -u +%Y%m%dT%H%M%SZ)
OUT="$BASE/backup/$TS"
mkdir -p "$OUT/storage"
chmod 700 "$OUT" 2>/dev/null || true
echo "== output $OUT"

# pg tools run in the local image; the URL reaches the container only through --env-file (never argv).
pgrun() { docker run --rm --env-file "$PGENV" -v "$OUT:/out" "$IMG" sh -c "$1"; }

echo "== server identity"
pgrun 'psql -X -A -t -c "select current_database(), version(), now()"' > "$OUT/server.txt"

echo "== public + supabase_migrations (schema + data, custom format)"
pgrun 'pg_dump -Fc -n public -n supabase_migrations -f /out/public.dump'
echo "== same, plain SQL schema only (for reading/diffing)"
pgrun 'pg_dump --schema-only -n public -n supabase_migrations -f /out/public_schema.sql'
echo "== auth + storage metadata (data only; schemas are Supabase-managed)"
pgrun 'pg_dump -Fc --data-only -n auth -n storage -f /out/auth_storage_data.dump'

echo "== row counts at backup time"
pgrun 'psql -X -A -t -F "|" -c "
  select n.nspname||\$\$.\$\$||c.relname, (xpath(\$\$/row/c/text()\$\$, query_to_xml(format(\$\$select count(*) as c from %I.%I\$\$, n.nspname, c.relname), false, true, \$\$\$\$)))[1]::text
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where c.relkind = \$\$r\$\$ and n.nspname in (\$\$public\$\$, \$\$supabase_migrations\$\$, \$\$auth\$\$, \$\$storage\$\$)
   order by 1"' > "$OUT/row_counts.txt"

echo "== storage objects (bucket configs are in storage.buckets above)"
node "$BASE/backup/storage-backup.mjs" "$ENVLOCAL" "$OUT/storage"

echo "== manifest"
( cd "$OUT" && find . -type f ! -name manifest.txt -printf "%s\t%p\n" | sort -k2 > sizes.txt && find . -type f ! -name manifest.txt ! -name sha256.txt -exec sha256sum {} + | sort -k2 > sha256.txt )
echo "done: $OUT"
