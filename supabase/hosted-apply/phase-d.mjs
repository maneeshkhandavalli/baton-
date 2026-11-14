#!/usr/bin/env node
// Offline verifier for the Phase D hosted apply (no network, no database). Run by every run-hosted.sh command
// before it connects anywhere; exits non-zero on any mismatch.
//
//   node supabase/hosted-apply/phase-d.mjs verify   # pins, migration order, byte-exact bundle rebuild
//   node supabase/hosted-apply/phase-d.mjs hashes   # print the full SHA-256 of every pinned file
//
// Paths are derived from this file's location (<repo>/supabase/hosted-apply), never from the working directory.
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.resolve(HERE, "../migrations");

/** Phase A's last migration: everything after it, and only that, is Phase D. */
export const PHASE_A_LAST = "20261113300400";

/** Phase D, in apply order, with full SHA-256 pins of the migration files. */
export const MIGRATIONS = [
  { version: "20261113300500", name: "revoke_unfenced_pipeline_writers", sha256: "da3c11645f96700a16ae5ddc97a2c95fc65a3507849bd3d809e0ee4038c81c31" },
  { version: "20261113300600", name: "revoke_mark_source_parse_failed", sha256: "489f89e4a8cebbf1231284979ba628840ccd19453d84bd25d3fec762d81a2578" },
  { version: "20261113300700", name: "processing_status_partial", sha256: "4dfcc4d9a8b6123ea0cc5a0fdc03b837a67a6931ac8464611bb714ec0e38aa69" },
  { version: "20261113300800", name: "claim_generation", sha256: "c85abbb954c4d1a3ab5e5376cc06a808765e3a7ba0d721bb8a0a16c9dfe83cc3" },
  { version: "20261113300900", name: "point_evidence_guard_fields", sha256: "7f7711568d4dc876c896a116ebdca3bb55084ea6e719973984d48a39a97a8449" },
];

/** Every SQL file in this directory, pinned. An unpinned or changed SQL file fails verification. */
export const PINNED_SQL = {
  "03_phase_D_migrations_14-18.sql": "db184aa314589a8f5b81dc26ad0439f5458d1ce9f575e6b10a7c5c20429e6bc8", // reviewed + rehearsed bundle
  "04_verify_all.sql": "1867a4e0ba352afef6a34d6bd4bcedc4b5c5f24dbe8df22ad584d7d390747e03",
  "05_verify_phase_A.sql": "f9f80703d9342a0865d929cd543888082fc0e4fdd155e20daacce044c00e48e0",
  "r3_phase_d_txn.sql": "84b2766c5915c166ad38e4acf217552fca0de6ada0d502e255f1089619140fea",
  "r3_prereq.sql": "9406c4a6e82dbd969e1bd0c90e05a423d9b309e1424a568d4716074a43faffa6",
  "r3_jobs.sql": "2944bac85b359702c134610c52d0ff6b5b06bc6f06dc83be60b9ab4046a8bc2f",
  "r3_post.sql": "7f68925698ad1e6139e527199a554301a5c69e1d4237bf9751298f21a471750c",
};

export const BUNDLE = "03_phase_D_migrations_14-18.sql";

// The bundle is exactly PREFIX + sections joined by "\n" + SUFFIX, where a section is the marker line, the
// migration file's bytes, and its history row. Rebuilding it proves every section is verbatim and in order.
const PREFIX =
  "-- Baton Round 3 hosted apply, PHASE D: migrations #14-#18, verbatim, in file order, in ONE transaction.\n" +
  "-- Run ONLY after phase A succeeded AND the Round 3 app/worker (>= 0bb1b96) is the one running.\n" +
  "-- The guard below aborts (nothing applied) if any processing job is running or queued.\n" +
  "do $$ begin\n" +
  "  if exists (select 1 from public.processing_jobs where status in ('queued','running')) then\n" +
  "    raise exception 'phase D aborted: processing jobs are queued or running';\n" +
  "  end if;\n" +
  "end $$;\n" +
  "begin;\n\n";
const SUFFIX = "\ncommit;\n\n-- PostgREST must see #17's new overloads.\nnotify pgrst, 'reload schema';\n";

export const fileName = (m) => `${m.version}_${m.name}.sql`;
const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");

export function expectedBundle(read = (f) => readFileSync(path.join(MIGRATIONS_DIR, f), "utf8")) {
  const sections = MIGRATIONS.map(
    (m) =>
      `-- ===== ${fileName(m)} (verbatim) =====\n${read(fileName(m))}` +
      `insert into supabase_migrations.schema_migrations (version, name) values ('${m.version}', '${m.name}');\n`,
  );
  return PREFIX + sections.join("\n") + SUFFIX;
}

/** Returns a list of failures (empty = verified). */
export function verify() {
  const failures = [];
  const check = (ok, msg) => {
    if (!ok) failures.push(msg);
  };

  // 1. Every SQL file here is pinned and unchanged.
  const present = readdirSync(HERE).filter((f) => f.endsWith(".sql")).sort();
  for (const f of present) check(f in PINNED_SQL, `unpinned SQL file in hosted-apply: ${f}`);
  for (const [f, pin] of Object.entries(PINNED_SQL)) {
    let actual = null;
    try {
      actual = sha256(readFileSync(path.join(HERE, f)));
    } catch {
      check(false, `missing ${f}`);
      continue;
    }
    check(actual === pin, `checksum mismatch: hosted-apply/${f} is ${actual}, pinned ${pin}`);
  }

  // 2. Phase D is exactly these five migrations, after Phase A, in ascending order, nothing more.
  const after = readdirSync(MIGRATIONS_DIR)
    .filter((f) => /^\d{14}_.+\.sql$/.test(f) && f.slice(0, 14) > PHASE_A_LAST)
    .sort();
  check(
    JSON.stringify(after) === JSON.stringify(MIGRATIONS.map(fileName)),
    `migrations after ${PHASE_A_LAST} are [${after.join(", ")}], expected exactly [${MIGRATIONS.map(fileName).join(", ")}]`,
  );
  for (let i = 1; i < MIGRATIONS.length; i++)
    check(MIGRATIONS[i - 1].version < MIGRATIONS[i].version, `apply order is not ascending at ${MIGRATIONS[i].version}`);

  // 3. Each migration file matches its pin.
  for (const m of MIGRATIONS) {
    let actual = null;
    try {
      actual = sha256(readFileSync(path.join(MIGRATIONS_DIR, fileName(m))));
    } catch {
      check(false, `missing migration ${fileName(m)}`);
      continue;
    }
    check(actual === m.sha256, `checksum mismatch: migrations/${fileName(m)} is ${actual}, pinned ${m.sha256}`);
  }

  // 4. The bundle is byte-for-byte the five files, in order, each with its own history row.
  if (failures.length === 0) {
    const bundle = readFileSync(path.join(HERE, BUNDLE), "utf8");
    const expected = expectedBundle();
    if (bundle !== expected) {
      let i = 0;
      while (i < bundle.length && bundle[i] === expected[i]) i++;
      const line = bundle.slice(0, i).split("\n").length;
      check(false, `bundle differs from the five migration files at line ${line}`);
    }
    // 5. The wrapper ends by including exactly this bundle (and nothing after it).
    const txn = readFileSync(path.join(HERE, "r3_phase_d_txn.sql"), "utf8").trimEnd();
    check(txn.endsWith(`\\i /ha/${BUNDLE}`), "r3_phase_d_txn.sql must end by including the pinned bundle");
  }
  return failures;
}

function main(cmd) {
  if (cmd === "hashes") {
    for (const f of Object.keys(PINNED_SQL)) console.log(`${sha256(readFileSync(path.join(HERE, f)))}  supabase/hosted-apply/${f}`);
    for (const m of MIGRATIONS) console.log(`${sha256(readFileSync(path.join(MIGRATIONS_DIR, fileName(m))))}  supabase/migrations/${fileName(m)}`);
    return 0;
  }
  if (cmd !== "verify") {
    console.error("usage: node phase-d.mjs verify|hashes");
    return 2;
  }
  const failures = verify();
  if (failures.length) {
    for (const f of failures) console.error(`[phase-d] FAIL ${f}`);
    console.error("[phase-d] REFUSED: files do not match the reviewed Phase D set");
    return 1;
  }
  console.log(
    `[phase-d] verified: ${Object.keys(PINNED_SQL).length} pinned SQL files, ${MIGRATIONS.length} migrations ` +
      `(${MIGRATIONS[0].version}..${MIGRATIONS.at(-1).version}) in order, bundle rebuilt byte-for-byte`,
  );
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exit(main(process.argv[2]));
