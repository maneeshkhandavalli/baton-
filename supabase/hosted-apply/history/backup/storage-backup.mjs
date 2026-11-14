// Read-only Storage backup: lists every bucket and downloads every object with the service-role key.
// Never prints the key. Usage: node storage-backup.mjs <path-to-.env.local> <out-dir>
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const [envPath, out] = process.argv.slice(2);
const env = Object.fromEntries(
  readFileSync(envPath, "utf8").split(/\r?\n/).filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim()]),
);
const base = new URL(env.NEXT_PUBLIC_SUPABASE_URL).origin;
const key = env.SUPABASE_SERVICE_ROLE_KEY;
if (!key) throw new Error("service-role key missing in .env.local");
const h = { apikey: key, Authorization: `Bearer ${key}` };

async function json(path, init = {}) {
  const r = await fetch(base + path, { ...init, headers: { ...h, "content-type": "application/json", ...(init.headers ?? {}) } });
  if (!r.ok) throw new Error(`${init.method ?? "GET"} ${path} -> ${r.status}`);
  return r.json();
}
async function listAll(bucket, prefix = "") {
  const files = [];
  for (let offset = 0; ; offset += 1000) {
    const page = await json(`/storage/v1/object/list/${bucket}`, { method: "POST", body: JSON.stringify({ prefix, limit: 1000, offset }) });
    for (const e of page) {
      const p = prefix ? `${prefix}/${e.name}` : e.name;
      if (e.id === null) files.push(...(await listAll(bucket, p))); // folder
      else files.push({ path: p, size: e.metadata?.size ?? null });
    }
    if (page.length < 1000) break;
  }
  return files;
}

const buckets = await json("/storage/v1/bucket");
const index = [];
for (const b of buckets) {
  const files = await listAll(b.id);
  for (const f of files) {
    const r = await fetch(`${base}/storage/v1/object/${b.id}/${f.path.split("/").map(encodeURIComponent).join("/")}`, { headers: h });
    if (!r.ok) {
      index.push({ bucket: b.id, path: f.path, status: r.status });
      continue;
    }
    const buf = Buffer.from(await r.arrayBuffer());
    const dest = join(out, b.id, f.path);
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, buf);
    index.push({ bucket: b.id, path: f.path, bytes: buf.length });
  }
}
writeFileSync(join(out, "buckets.json"), JSON.stringify(buckets.map(({ id, name, public: pub, file_size_limit, allowed_mime_types }) => ({ id, name, public: pub, file_size_limit, allowed_mime_types })), null, 2));
writeFileSync(join(out, "objects.json"), JSON.stringify(index, null, 2));
console.log(`storage: ${buckets.length} bucket(s), ${index.length} object(s), ${index.filter((i) => i.status).length} failed`);
