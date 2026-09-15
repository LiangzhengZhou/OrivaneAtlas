import { execFile } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { appendFile, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { promisify } from "node:util";
import { WorkService } from "@arclattice/application";
import { Client, type ClientConfig, Pool, type PoolClient } from "pg";
import { afterAll, afterEach, beforeAll } from "vitest";
import { PostgresUnitOfWork } from "./index";

const execute = promisify(execFile);
export const context = { workspaceId: "workspace-a", principalId: "human" };
export const principal = {
  id: "human",
  kind: "USER" as const,
  displayName: "Human",
};

/** Test-only real PostgreSQL, no ambient DATABASE_URL and no system service. */
export class TemporaryPostgres {
  private constructor(
    readonly directory: string,
    readonly control: string,
    readonly connection: ClientConfig,
  ) {}
  static async start() {
    if (
      process.arch !== "x64" ||
      !["win32", "linux"].includes(process.platform)
    )
      throw new Error(
        "Portable PostgreSQL tests require Windows/Linux x64 (no tests were skipped)",
      );
    const packageName =
      "@embedded-postgres/" +
      (process.platform === "win32" ? "windows" : "linux") +
      "-x64";
    const binaries = (await import(packageName)) as {
      initdb: string;
      pg_ctl: string;
    };
    const directory = await mkdtemp(join(tmpdir(), "arclattice-pg-"));
    const password = randomBytes(32).toString("hex");
    const pwfile = join(directory, "init-password");
    const listener = createServer();
    await new Promise<void>((accept, reject) => {
      listener.once("error", reject);
      listener.listen(0, "127.0.0.1", accept);
    });
    const address = listener.address();
    if (!address || typeof address === "string")
      throw new Error("No loopback port");
    const port = address.port;
    await new Promise<void>((accept, reject) =>
      listener.close((error) => (error ? reject(error) : accept())),
    );
    const cluster = new TemporaryPostgres(directory, binaries.pg_ctl, {
      host: "127.0.0.1",
      port,
      user: "arclattice_test",
      password,
      database: "postgres",
      connectionTimeoutMillis: 5000,
    });
    try {
      await writeFile(pwfile, password, { flag: "wx", mode: 0o600 });
      await execute(
        binaries.initdb,
        [
          "-D",
          join(directory, "data"),
          "--username=arclattice_test",
          "--auth=scram-sha-256",
          "--pwfile=" + pwfile,
          "--encoding=UTF8",
          "--locale=C",
        ],
        { windowsHide: true, timeout: 30_000 },
      );
      await rm(pwfile);
      await appendFile(
        join(directory, "data", "postgresql.conf"),
        "\nlisten_addresses='127.0.0.1'\nport=" +
          port +
          "\nunix_socket_directories=''\nmax_connections=30\n",
      );
      await cluster.boot();
      return cluster;
    } catch (error) {
      // A partial startup is diagnostic evidence; do not delete it or stop some
      // process listening on the selected port. pg_ctl is scoped to our data dir.
      await cluster.stop().catch(() => undefined);
      throw error;
    }
  }
  async boot() {
    await execute(
      this.control,
      [
        "-D",
        join(this.directory, "data"),
        "-l",
        join(this.directory, "server.log"),
        "-w",
        "-t",
        "15",
        "start",
      ],
      { windowsHide: true, timeout: 20_000 },
    );
  }
  async stop() {
    await execute(
      this.control,
      [
        "-D",
        join(this.directory, "data"),
        "-w",
        "-t",
        "15",
        "-m",
        "fast",
        "stop",
      ],
      { windowsHide: true, timeout: 20_000 },
    );
  }
  async dispose() {
    await this.stop();
    const path = resolve(this.directory);
    if (!path.startsWith(resolve(tmpdir()) + sep + "arclattice-pg-"))
      throw new Error("Unsafe cleanup path");
    await rm(path, { recursive: true, maxRetries: 5, retryDelay: 100 });
  }
  async query(database: string, sql: string, values?: unknown[]) {
    const client = new Client({ ...this.connection, database });
    try {
      await client.connect();
      return await client.query(sql, values);
    } finally {
      await client.end();
    }
  }
}

export function postgresHarness() {
  let cluster: TemporaryPostgres;
  const databases = new Set<string>();
  const connections: PostgresUnitOfWork[] = [];
  beforeAll(async () => {
    cluster = await TemporaryPostgres.start();
  }, 60_000);
  afterEach(async () => {
    for (const db of connections.splice(0)) await db.close();
    for (const name of databases) {
      if (!/^arclattice_test_[a-f0-9]{32}$/.test(name))
        throw new Error("Unsafe database cleanup");
      await cluster.query("postgres", 'DROP DATABASE "' + name + '"');
      databases.delete(name);
    }
  }, 30_000);
  afterAll(async () => {
    if (cluster) await cluster.dispose();
  }, 30_000);
  const database = async () => {
    const name = "arclattice_test_" + randomUUID().replaceAll("-", "");
    await cluster.query("postgres", 'CREATE DATABASE "' + name + '"');
    databases.add(name);
    return name;
  };
  const open = async (name: string, lockTimeoutMs = 2000) => {
    const db = await PostgresUnitOfWork.open({
      connection: { ...cluster.connection, database: name },
      lockTimeoutMs,
    });
    connections.push(db);
    return db;
  };
  const provision = async (db: PostgresUnitOfWork) => {
    for (const id of ["workspace-a", "workspace-b"])
      await db.provisionWorkspace({ id, name: id }, [principal]);
    return db;
  };
  const create = async () => provision(await open(await database()));
  const client = async <T>(
    name: string,
    action: (client: PoolClient) => Promise<T>,
  ) => {
    const pool = new Pool({ ...cluster.connection, database: name, max: 1 });
    const connection = await pool.connect();
    try {
      return await action(connection);
    } finally {
      connection.release(true);
      await pool.end();
    }
  };
  return {
    database,
    open,
    provision,
    create,
    client,
    cluster: () => cluster,
    query: (name: string, sql: string, values?: unknown[]) =>
      cluster.query(name, sql, values),
  };
}
export function service(db: PostgresUnitOfWork) {
  return new WorkService(
    db,
    {
      require: async (actor) => {
        if (
          actor.workspaceId !== context.workspaceId ||
          actor.principalId !== context.principalId
        )
          throw new Error("FORBIDDEN");
      },
    },
    { now: () => "2026-09-13T00:00:00.000Z" },
    { next: randomUUID },
  );
}
