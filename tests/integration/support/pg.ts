/**
 * Tier E harness: a local, throw-away PostgreSQL 15 in Docker (never a hosted Supabase project) with the
 * Supabase shim, every migration and the test helpers, plus
 *   * PsqlDbClient — a lib/db DbClient whose rpc(fn, args) calls the SQL function through `docker exec psql`
 *     as `service_role` or as an `authenticated` user (request.jwt.claims), exactly like PostgREST would.
 *     No new dependency: argument types come from pg_proc; SQLSTATEs come from psql's verbose errors.
 *   * PgBackedStorage — a RecordingStorage that also keeps storage.objects in step (Supabase Storage keeps
 *     that row; confirm_source_uploaded reads its size).
 * Used only when BATON_IT_PG=1.
 */

import { spawn } from "node:child_process";
import { readdirSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import type { DbClient, DbRpcResponse } from "../../../lib/db/client";
import type { StorageBucketApi } from "../../../lib/db/storage";
import { RecordingStorage } from "./recording-storage";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));

interface Run {
  code: number;
  stdout: string;
  stderr: string;
}

function run(cmd: string, args: string[], stdin?: string): Promise<Run> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ["pipe", "pipe", "pipe"], env: { ...process.env, MSYS_NO_PATHCONV: "1" } });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("error", reject);
    child.on("close", (code) => resolve({ code: code ?? 1, stdout, stderr }));
    child.stdin.end(stdin ?? "");
  });
}

export const lit = (s: string) => `'${s.replace(/'/g, "''")}'`;

export class PgContainer {
  readonly name: string;
  readonly db: string;

  constructor(name = "baton-pg-e2e", db = "baton_e2e") {
    this.name = name;
    this.db = db;
  }

  async start(): Promise<void> {
    await run("docker", ["rm", "-f", this.name]);
    const started = await run("docker", ["run", "-d", "--name", this.name, "-e", "POSTGRES_PASSWORD=postgres", "-e",
      "POSTGRES_HOST_AUTH_METHOD=trust", process.env.BATON_PG_IMAGE ?? "postgres:15-alpine"]);
    if (started.code !== 0) throw new Error(`docker run failed: ${started.stderr}`);
    for (let i = 0; i < 120; i++) {
      if ((await run("docker", ["exec", this.name, "pg_isready", "-U", "postgres", "-q"])).code === 0) break;
      await new Promise((r) => setTimeout(r, 500));
    }
    await new Promise((r) => setTimeout(r, 1000));
    const created = await run("docker", ["exec", this.name, "createdb", "-U", "postgres", this.db]);
    if (created.code !== 0) throw new Error(`createdb failed: ${created.stderr}`);
    const files = [
      join(ROOT, "supabase/tests/shim/00_supabase_shim.sql"),
      ...readdirSync(join(ROOT, "supabase/migrations")).filter((f) => f.endsWith(".sql")).sort().map((f) => join(ROOT, "supabase/migrations", f)),
      join(ROOT, "supabase/tests/shim/10_test_helpers.sql"),
    ];
    for (const file of files) {
      const r = await this.psql(await readFile(file, "utf8"));
      if (r.code !== 0) throw new Error(`applying ${file} failed: ${r.stderr.slice(0, 2000)}`);
    }
  }

  async stop(): Promise<void> {
    if (!process.env.KEEP) await run("docker", ["rm", "-f", this.name]);
  }

  psql(sql: string): Promise<Run> {
    return run("docker", ["exec", "-i", this.name, "psql", "-X", "-q", "-At", "-U", "postgres", "-d", this.db, "-v", "ON_ERROR_STOP=1",
      "-f", "-"], sql);
  }

  /** Runs SQL as the owner and parses the single JSON value it prints (null for no output). Throws on error. */
  async json<T = unknown>(sql: string): Promise<T> {
    const r = await this.psql(`${sql.trim().replace(/;?$/, "")};\n`);
    if (r.code !== 0) throw new Error(`SQL failed: ${r.stderr.slice(0, 2000)}`);
    const out = r.stdout.trim();
    return (out === "" ? null : JSON.parse(out.split("\n").pop()!)) as T;
  }
}

/** Who the client acts as, evaluated at every call (the signed-in user can change between calls). */
export type PgIdentity = { role: "service_role" } | { role: "authenticated"; sub: string | null };

interface Signature {
  names: string[];
  types: string[];
  retset: boolean;
  rettype: string;
}

function pgArray(values: unknown[]): string {
  return `{${values.map((v) => (v === null ? "NULL" : `"${String(v).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`)).join(",")}}`;
}

function argSql(value: unknown, type: string): string {
  if (value === null) return `NULL::${type}`;
  if (type === "jsonb" || type === "json") return `${lit(JSON.stringify(value))}::${type}`;
  if (type.endsWith("[]")) return `${lit(pgArray(value as unknown[]))}::${type}`;
  return `${lit(String(value))}::${type}`;
}

export class PsqlDbClient implements DbClient {
  readonly calls: Array<{ fn: string; args: Record<string, unknown>; as: string }> = [];
  private readonly pg: PgContainer;
  private readonly identity: () => PgIdentity;
  private static readonly signatures = new Map<string, Signature[]>();

  constructor(pg: PgContainer, identity: () => PgIdentity) {
    this.pg = pg;
    this.identity = identity;
  }

  private async signature(fn: string, keys: string[]): Promise<Signature> {
    let sigs = PsqlDbClient.signatures.get(fn);
    if (!sigs) {
      sigs = (await this.pg.json<Signature[]>(`
        select coalesce(jsonb_agg(jsonb_build_object(
                 'names', coalesce(to_jsonb(p.proargnames), '[]'::jsonb),
                 'types', coalesce((select jsonb_agg(format_type(t, null) order by o) from unnest(p.proargtypes) with ordinality u (t, o)), '[]'::jsonb),
                 'retset', p.proretset, 'rettype', format_type(p.prorettype, null))), '[]'::jsonb)
          from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.proname = ${lit(fn)}`)) ?? [];
      PsqlDbClient.signatures.set(fn, sigs);
    }
    const sig = sigs.find((s) => keys.every((k) => s.names.includes(k)));
    if (!sig) throw new Error(`PsqlDbClient: no public.${fn} accepting ${keys.join(", ")}`);
    return sig;
  }

  async rpc(fn: string, args: Record<string, unknown> = {}): Promise<DbRpcResponse> {
    const who = this.identity();
    this.calls.push({ fn, args: structuredClone(args), as: who.role });
    const keys = Object.keys(args).filter((k) => args[k] !== undefined);
    const sig = await this.signature(fn, keys);
    const call = `public.${fn}(${keys.map((k) => `${k} => ${argSql(args[k], sig.types[sig.names.indexOf(k)])}`).join(", ")})`;
    const select = sig.retset
      ? `select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) from ${call} t`
      : sig.rettype === "void"
        ? `select 'null' from (select ${call}) v`
        : `select to_jsonb(${call})`;
    const claims = who.role === "service_role" ? { role: "service_role" } : { sub: who.sub, role: "authenticated" };
    const r = await this.pg.psql(
      `\\set VERBOSITY verbose\nset request.jwt.claims = ${lit(JSON.stringify(claims))};\nset role ${who.role};\n${select};\n`,
    );
    if (r.code !== 0) {
      const m = /ERROR:\s+([0-9A-Z]{5}):\s*([^\n]*)/.exec(r.stderr);
      return { data: null, error: { code: m?.[1] ?? "XX000", message: m?.[2] ?? "psql failed" } };
    }
    const out = r.stdout.trim();
    return { data: out === "" ? null : JSON.parse(out.split("\n").pop()!), error: null };
  }
}

/** Storage whose objects are mirrored into storage.objects, as Supabase Storage does. */
export class PgBackedStorage extends RecordingStorage {
  private readonly pg: PgContainer;

  constructor(pg: PgContainer, events: string[] = []) {
    super(events);
    this.pg = pg;
  }

  /** A direct-to-storage upload through the signed URL (the browser's part of §10 step 1). */
  async upload(bucket: string, path: string, bytes: Uint8Array): Promise<void> {
    this.put(bucket, path, bytes);
    await this.pg.json(`insert into storage.objects (bucket_id, name, metadata)
                        values (${lit(bucket)}, ${lit(path)}, jsonb_build_object('size', ${bytes.byteLength})) returning null`);
  }

  override from(bucket: string): StorageBucketApi {
    const api = super.from(bucket);
    return {
      ...api,
      remove: async (paths: string[]) => {
        const r = await api.remove(paths);
        if (!r.error) {
          await this.pg.json(`delete from storage.objects where bucket_id = ${lit(bucket)}
                              and name = any (${lit(pgArray(paths))}::text[]) returning null`);
        }
        return r;
      },
    };
  }
}
