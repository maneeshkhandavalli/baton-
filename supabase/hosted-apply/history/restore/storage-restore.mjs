// baton-dev Storage restore via the Storage API only (no SQL on storage.*). NOT RUN YET.
// Usage: node storage-restore.mjs <path-to-baton-dev env file>   (needs NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY of baton-dev)
// 1. confirms the target is baton-dev (never the original project);
// 2. checks bucket `source-uploads` exists, private, 25 MB (created by baseline migration 20261111001000_storage.sql);
// 3. uploads the one backed-up object to its ORIGINAL path, x-upsert: false (refuses to overwrite);
// 4. downloads it once and compares SHA-256 with the backup manifest.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const TARGET = "xnwppnzvrpthukxjfojj", FORBIDDEN = "enalguyitewjojgrgzxv";
const BK = "C:/Users/manee/Documents/programing/baton-multiagent/backup/20261113T063630Z";
const env = Object.fromEntries(readFileSync(process.argv[2], "utf8").split(/\r?\n/).filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim()]));
const base = new URL(env.NEXT_PUBLIC_SUPABASE_URL).origin;
const host = new URL(base).hostname;
if (host.includes(FORBIDDEN) || host !== `${TARGET}.supabase.co`) throw new Error("REFUSED: not the baton-dev project");
const key = env.SUPABASE_SERVICE_ROLE_KEY;
const auth = { apikey: key, Authorization: `Bearer ${key}` };
const [obj] = JSON.parse(readFileSync(`${BK}/storage/objects.json`, "utf8"));
const bytes = readFileSync(`${BK}/${obj.localPath}`);
const sha = (b) => createHash("sha256").update(b).digest("hex");
if (sha(bytes) !== obj.sha256) throw new Error("backup file checksum mismatch");

const b = await fetch(`${base}/storage/v1/bucket/source-uploads`, { headers: auth });
if (!b.ok) throw new Error(`bucket source-uploads not found (HTTP ${b.status}); run restore phase 1 first`);
const bucket = await b.json();
if (bucket.public !== false || Number(bucket.file_size_limit) !== 26214400) throw new Error("bucket config differs from the original");

const up = await fetch(`${base}/storage/v1/object/source-uploads/${obj.objectPath}`, {
  method: "POST",
  headers: { ...auth, "content-type": obj.contentType, "x-upsert": "false" },
  body: bytes,
});
if (!up.ok) throw new Error(`upload failed: HTTP ${up.status}`);
const back = Buffer.from(await (await fetch(`${base}/storage/v1/object/source-uploads/${obj.objectPath}`, { headers: auth })).arrayBuffer());
console.log(JSON.stringify({ uploaded: obj.objectPath, bytes: back.length, sha256Match: sha(back) === obj.sha256 }));
