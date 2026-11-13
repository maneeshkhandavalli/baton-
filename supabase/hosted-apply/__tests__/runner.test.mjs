// Tests for supabase/hosted-apply (Phase D runner). No database and no network: every test runs the real
// run-hosted.sh against a throwaway copy of the files, with a fake `docker` first on PATH that records each call
// and answers read-only queries from canned output. Nothing can reach a real Supabase project.
//
//   node --test supabase/hosted-apply/__tests__/runner.test.mjs
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { appendFileSync, cpSync, existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const HOSTED = path.resolve(HERE, "..");
const REPO = path.resolve(HOSTED, "../..");
const PASSWORD = "Sup3r-Secret-Pa55word";
const GOOD_URL = `postgresql://postgres.xnwppnzvrpthukxjfojj:${PASSWORD}@aws-1-ap-southeast-1.pooler.supabase.com:5432/postgres`;
const CONFIRM = "apply-phase-d-to-xnwppnzvrpthukxjfojj";

const temps = [];
const tmp = (p) => {
  const d = mkdtempSync(path.join(tmpdir(), p));
  temps.push(d);
  return d;
};
after(() => temps.forEach((d) => rmSync(d, { recursive: true, force: true })));

/** A copy of the repo's Phase D files: <root>/supabase/{hosted-apply,migrations}. */
function fakeRepo() {
  const root = tmp("baton-phase-d-repo-");
  cpSync(HOSTED, path.join(root, "supabase/hosted-apply"), { recursive: true, filter: (s) => !s.includes("__tests__") });
  mkdirSync(path.join(root, "supabase/migrations"), { recursive: true });
  for (const f of readdirSync(path.join(REPO, "supabase/migrations")).filter((f) => f >= "20261113300400")) {
    cpSync(path.join(REPO, "supabase/migrations", f), path.join(root, "supabase/migrations", f));
  }
  return root;
}

const GOOD = {
  "r3_jobs.sql": "jobs_queued|0|t\njobs_running|0|t\nruns_queued_or_running|0|t\nunexpired_job_leases|0|t",
  "05_verify_phase_A.sql": Array.from({ length: 14 }, (_, i) => `#${i}|t`).join("\n"),
  "r3_prereq.sql": "history_rows|31|t\nhistory_newest|20261113300400|t\nphase_A_rows_20261113|13|t\nphase_D_rows_present|0|t\n" +
    "claim_generation_column|0|t\nprerequisite_functions_15|15|t\nphase_A_claim_functions|2|t\ngeneration_overloads_absent|0|t",
  "04_verify_all.sql": Array.from({ length: 19 }, (_, i) => `#${i}|t`).join("\n"),
  "r3_post.sql": "history_rows|36|t\nhistory_newest|20261113300900|t\nphase_D_rows_present|5|t\nclaim_generation_not_null|1|t\ngeneration_overloads_8|8|t",
};

/** Fake docker: logs argv (and the env-file's PGUSER line, never the password), answers -f /ha/<file>. */
function fakeDocker({ down = false, outputs = GOOD, txnExit = 0 } = {}) {
  const dir = tmp("baton-fake-docker-");
  const out = path.join(dir, "out");
  mkdirSync(out);
  for (const [f, text] of Object.entries(outputs)) writeFileSync(path.join(out, f), `${text}\n`);
  const log = path.join(dir, "calls.log");
  writeFileSync(log, "");
  writeFileSync(path.join(dir, "docker"), `#!/bin/bash
echo "CALL $*" >> "${log.replace(/\\/g, "/")}"
[ "$1" = info ] && exit ${down ? 1 : 0}
prev=""; file=""; envf=""
for a in "$@"; do [ "$prev" = "-f" ] && file="$a"; [ "$prev" = "--env-file" ] && envf="$a"; prev="$a"; done
[ -n "$envf" ] && grep -E '^(PGUSER|PGHOST|PGPORT)=' "$envf" | sed 's/^/ENV /' >> "${log.replace(/\\/g, "/")}"
case "$file" in
  /ha/r3_phase_d_txn.sql) echo "TXN" >> "${log.replace(/\\/g, "/")}"; exit ${txnExit} ;;
  /ha/*) cat "${out.replace(/\\/g, "/")}/\${file#/ha/}" 2>/dev/null ;;
esac
`);
  return { dir, calls: () => readFileSync(log, "utf8") };
}

function secrets(url, where = tmp("baton-secrets-")) {
  const f = path.join(where, "baton-dev.env");
  writeFileSync(f, `# test credentials\nSUPABASE_DB_URL=${url}\n`);
  return f;
}

function run(root, cmd, { docker = fakeDocker(), env = {} } = {}) {
  const r = spawnSync("bash", [path.join(root, "supabase/hosted-apply/run-hosted.sh"), cmd], {
    encoding: "utf8",
    env: { ...process.env, PATH: `${docker.dir}${path.delimiter}${process.env.PATH}`, BATON_DEV_SECRETS: "", BATON_PHASE_D_CONFIRM: "", ...env },
  });
  return { code: r.status, out: `${r.stdout}${r.stderr}`, calls: docker.calls() };
}

describe("offline verification (phase-d.mjs via run-hosted.sh verify-files)", () => {
  it("passes on the repository's files", () => {
    const r = spawnSync("bash", [path.join(HOSTED, "run-hosted.sh"), "verify-files"], { encoding: "utf8" });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /bundle rebuilt byte-for-byte/);
  });

  const tamper = {
    "a changed byte in the bundle": (root) => {
      const f = path.join(root, "supabase/hosted-apply/03_phase_D_migrations_14-18.sql");
      writeFileSync(f, readFileSync(f, "utf8").replace("revoke execute", "revoke  execute"));
    },
    "a changed migration file": (root) => appendFileSync(path.join(root, "supabase/migrations/20261113300800_claim_generation.sql"), "\n-- x\n"),
    "a missing migration file": (root) => rmSync(path.join(root, "supabase/migrations/20261113300700_processing_status_partial.sql")),
    "an extra migration after Phase A": (root) => writeFileSync(path.join(root, "supabase/migrations/20261113301000_extra.sql"), "select 1;\n"),
    "an unpinned SQL file in hosted-apply": (root) => writeFileSync(path.join(root, "supabase/hosted-apply/99_extra.sql"), "select 1;\n"),
    "an edited transaction wrapper": (root) => appendFileSync(path.join(root, "supabase/hosted-apply/r3_phase_d_txn.sql"), "\n"),
    "a loosened read-only gate": (root) => {
      const f = path.join(root, "supabase/hosted-apply/r3_prereq.sql");
      writeFileSync(f, readFileSync(f, "utf8").replace("count(*) = 31", "count(*) >= 0"));
    },
  };
  for (const [what, apply] of Object.entries(tamper)) {
    it(`refuses ${what}, before any docker call`, () => {
      const root = fakeRepo();
      apply(root);
      const docker = fakeDocker();
      for (const cmd of ["verify-files", "r3phaseD"]) {
        const r = run(root, cmd, { docker, env: { BATON_DEV_SECRETS: secrets(GOOD_URL), BATON_PHASE_D_CONFIRM: CONFIRM } });
        assert.equal(r.code, 2, r.out);
        assert.match(r.out, /REFUSED: files do not match/);
      }
      assert.equal(docker.calls(), "", "docker was never called");
    });
  }
});

describe("target and credentials", () => {
  for (const [what, url] of [
    ["the original project (20-char ref)", `postgresql://postgres.enalguyitewjojgrgzxv:${PASSWORD}@aws-1-ap-southeast-1.pooler.supabase.com:5432/postgres`],
    ["the original project (19-char spelling)", `postgresql://postgres.enalguyitewjojgrgzv:${PASSWORD}@aws-1-ap-southeast-1.pooler.supabase.com:5432/postgres`],
    ["the original ref anywhere in the URL", `postgresql://postgres.xnwppnzvrpthukxjfojj:${PASSWORD}@aws-1-ap-southeast-1.pooler.supabase.com:5432/postgres?x=enalguyitewjojgrgzxv`],
    ["another pooler user", `postgresql://postgres.abcdefghijklmnopqrst:${PASSWORD}@aws-1-ap-southeast-1.pooler.supabase.com:5432/postgres`],
    ["a direct (non-pooler) host", `postgresql://postgres.xnwppnzvrpthukxjfojj:${PASSWORD}@db.xnwppnzvrpthukxjfojj.supabase.co:5432/postgres`],
    ["the transaction pooler port", `postgresql://postgres.xnwppnzvrpthukxjfojj:${PASSWORD}@aws-1-ap-southeast-1.pooler.supabase.com:6543/postgres`],
    ["a lookalike pooler host", `postgresql://postgres.xnwppnzvrpthukxjfojj:${PASSWORD}@aws-1.pooler.supabase.com.evil.io:5432/postgres`],
  ]) {
    it(`refuses ${what}, never prints the password, never calls docker`, () => {
      const docker = fakeDocker();
      for (const cmd of ["r3jobs", "r3phaseD"]) {
        const r = run(REPO, cmd, { docker, env: { BATON_DEV_SECRETS: secrets(url), BATON_PHASE_D_CONFIRM: CONFIRM } });
        assert.equal(r.code, 3, r.out);
        assert.match(r.out, /REFUSED/);
        assert.ok(!r.out.includes(PASSWORD), "password not printed");
      }
      assert.equal(docker.calls(), "");
    });
  }

  it("refuses a credentials file inside the repository", () => {
    const root = fakeRepo();
    const docker = fakeDocker();
    const r = run(root, "r3jobs", { docker, env: { BATON_DEV_SECRETS: secrets(GOOD_URL, root) } });
    assert.equal(r.code, 3, r.out);
    assert.match(r.out, /inside the repository/);
    assert.equal(docker.calls(), "");
  });

  it("refuses when BATON_DEV_SECRETS is unset", () => {
    const r = run(REPO, "r3jobs");
    assert.equal(r.code, 3);
    assert.match(r.out, /set BATON_DEV_SECRETS/);
  });

  it("stops cleanly when Docker is not running, without printing the password", () => {
    const docker = fakeDocker({ down: true });
    const r = run(REPO, "r3jobs", { docker, env: { BATON_DEV_SECRETS: secrets(GOOD_URL) } });
    assert.equal(r.code, 4, r.out);
    assert.match(r.out, /target xnwppnzvrpthukxjfojj via aws-1-ap-southeast-1\.pooler\.supabase\.com:5432/);
    assert.ok(!r.out.includes(PASSWORD));
    assert.doesNotMatch(docker.calls(), /CALL run/);
  });
});

describe("read-only commands", () => {
  for (const [cmd, files] of [
    ["r3jobs", ["r3_jobs.sql"]],
    ["r3verifyA", ["05_verify_phase_A.sql", "r3_prereq.sql"]],
    ["r3verifyAll", ["04_verify_all.sql", "r3_post.sql"]],
  ]) {
    it(`${cmd} runs only ${files.join(" + ")}, each inside BEGIN READ ONLY ... ROLLBACK`, () => {
      const docker = fakeDocker();
      const r = run(REPO, cmd, { docker, env: { BATON_DEV_SECRETS: secrets(GOOD_URL) } });
      assert.equal(r.code, 0, r.out);
      const runs = docker.calls().split("\n").filter((l) => l.startsWith("CALL run"));
      assert.equal(runs.length, files.length);
      files.forEach((f, i) => {
        assert.match(runs[i], new RegExp(`-c begin read only -f /ha/${f.replace(/\./g, "\\.")} -c rollback`));
      });
      assert.doesNotMatch(docker.calls(), /TXN|r3_phase_d_txn/);
      assert.match(docker.calls(), /ENV PGUSER=postgres\.xnwppnzvrpthukxjfojj/);
      assert.ok(!r.out.includes(PASSWORD) && !docker.calls().includes(PASSWORD), "password never on a command line or in output");
    });
  }

  it("r3verifyA fails (exit 1) when a prerequisite is not met, and still reports every check", () => {
    const docker = fakeDocker({ outputs: { ...GOOD, "r3_prereq.sql": GOOD["r3_prereq.sql"].replace("history_rows|31|t", "history_rows|18|f") } });
    const r = run(REPO, "r3verifyA", { docker, env: { BATON_DEV_SECRETS: secrets(GOOD_URL) } });
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /Phase A #1-#13: PASS/);
    assert.match(r.out, /prerequisites: FAIL/);
  });
});

describe("r3phaseD", () => {
  it("refuses without the explicit confirmation phrase, before reading credentials or calling docker", () => {
    for (const confirm of ["", "yes", "apply-phase-d-to-enalguyitewjojgrgzxv"]) {
      const docker = fakeDocker();
      const r = run(REPO, "r3phaseD", { docker, env: { BATON_DEV_SECRETS: secrets(GOOD_URL), BATON_PHASE_D_CONFIRM: confirm } });
      assert.equal(r.code, 3, r.out);
      assert.match(r.out, /BATON_PHASE_D_CONFIRM=apply-phase-d-to-xnwppnzvrpthukxjfojj/);
      assert.equal(docker.calls(), "");
    }
  });

  const blockers = {
    "a running job": ["r3_jobs.sql", "jobs_running|0|t", "jobs_running|1|f"],
    "a queued run": ["r3_jobs.sql", "runs_queued_or_running|0|t", "runs_queued_or_running|1|f"],
    "the 18-row original history": ["r3_prereq.sql", "history_rows|31|t", "history_rows|18|f"],
    "Phase D already applied": ["r3_prereq.sql", "phase_D_rows_present|0|t", "phase_D_rows_present|5|f"],
    "a failing Phase A verify row": ["05_verify_phase_A.sql", "#3|t", "#3|f"],
    "a missing gate row": ["r3_prereq.sql", "\ngeneration_overloads_absent|0|t", ""],
  };
  for (const [what, [file, from, to]] of Object.entries(blockers)) {
    it(`does not start the transaction when a gate shows ${what}`, () => {
      const docker = fakeDocker({ outputs: { ...GOOD, [file]: GOOD[file].replace(from, to) } });
      const r = run(REPO, "r3phaseD", { docker, env: { BATON_DEV_SECRETS: secrets(GOOD_URL), BATON_PHASE_D_CONFIRM: CONFIRM } });
      assert.equal(r.code, 5, r.out);
      assert.match(r.out, /nothing was applied/);
      assert.doesNotMatch(docker.calls(), /TXN|r3_phase_d_txn/);
    });
  }

  it("with every gate green: runs the wrapper once (not the bare bundle), then the read-only post-checks", () => {
    const docker = fakeDocker();
    const r = run(REPO, "r3phaseD", { docker, env: { BATON_DEV_SECRETS: secrets(GOOD_URL), BATON_PHASE_D_CONFIRM: CONFIRM } });
    assert.equal(r.code, 0, r.out);
    const runs = docker.calls().split("\n").filter((l) => l.startsWith("CALL run"));
    const order = runs.map((l) => /-f \/ha\/(\S+)/.exec(l)?.[1]);
    assert.deepEqual(order, ["r3_jobs.sql", "05_verify_phase_A.sql", "r3_prereq.sql", "r3_phase_d_txn.sql", "04_verify_all.sql", "r3_post.sql"]);
    assert.doesNotMatch(runs[3], /begin read only/);
    assert.ok(!runs.some((l) => l.includes("-f /ha/03_phase_D")), "the bundle is only ever included by the wrapper");
    assert.ok(!r.out.includes(PASSWORD));
  });

  it("reports a failed transaction as rolled back (exit 6) and shows the unchanged state", () => {
    const docker = fakeDocker({ txnExit: 3 });
    const r = run(REPO, "r3phaseD", { docker, env: { BATON_DEV_SECRETS: secrets(GOOD_URL), BATON_PHASE_D_CONFIRM: CONFIRM } });
    assert.equal(r.code, 6, r.out);
    assert.match(r.out, /rolled back, nothing applied/);
    assert.match(r.out, /prerequisites \(unchanged\): PASS/);
  });

  it("deletes the temporary PG* credentials file on exit", () => {
    const before = new Set(readdirSync(tmpdir()));
    run(REPO, "r3jobs", { env: { BATON_DEV_SECRETS: secrets(GOOD_URL) } });
    const leaked = readdirSync(tmpdir()).filter((f) => !before.has(f) && /^tmp\./.test(f))
      .filter((f) => existsSync(path.join(tmpdir(), f)) && readFileSync(path.join(tmpdir(), f), "utf8").includes("PGPASSWORD"));
    assert.deepEqual(leaked, []);
  });
});

describe("the transaction wrapper (static)", () => {
  const txn = readFileSync(path.join(HOSTED, "r3_phase_d_txn.sql"), "utf8");
  const statements = txn.split("\n").filter((l) => l.trim() && !l.trim().startsWith("--"));
  it("opens the transaction, bounds lock waits and locks both job tables BEFORE checking anything", () => {
    const idx = (re) => statements.findIndex((l) => re.test(l));
    assert.ok(idx(/^\\set ON_ERROR_STOP on$/) >= 0);
    assert.ok(idx(/^begin;$/) < idx(/^set local lock_timeout/));
    assert.ok(idx(/^set local lock_timeout/) < idx(/^lock table public\.processing_runs, public\.processing_jobs in exclusive mode;$/));
    assert.ok(idx(/^lock table/) < idx(/^do \$\$$/));
    assert.ok(idx(/^do \$\$$/) < idx(/^\\i \/ha\/03_phase_D_migrations_14-18\.sql$/));
    assert.equal(statements.filter((l) => /^(commit|rollback|end);?$/i.test(l.trim())).length, 0, "the wrapper never commits on its own");
  });
  it("the in-transaction guard checks jobs, history (31 rows, newest 20261113300400), Phase D absence and the column", () => {
    for (const re of [/status in \('queued', 'running'\)/, /v_rows <> 31/, /'20261113300400'/, /20261113300900/, /column_name = 'claim_generation'/])
      assert.match(txn, re);
  });
});
