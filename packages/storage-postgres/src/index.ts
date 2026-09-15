import { AsyncLocalStorage } from "node:async_hooks";
import type {
  ActivityEvent,
  OutboxEvent,
  UnitOfWork,
  WorkTransaction,
} from "@arclattice/application";
import type { Principal, Workspace } from "@arclattice/domain";
import { Pool, type PoolClient, type PoolConfig } from "pg";
import {
  begin,
  lockWorkspace,
  PostgresStorageError,
  sharedMigrationLock,
  translateError,
} from "./database";
import { activityFields, outboxFields, projection } from "./fields";
import { type BeforeUpgrade, migrate, migrations } from "./migrations";
import { repository } from "./repository";

export { PostgresStorageError } from "./database";
export type { BeforeUpgrade, UpgradeInfo } from "./migrations";
export interface PostgresOptions {
  /** Explicit host configuration. Never supply browser/user-controlled config. */
  readonly connection: PoolConfig;
  readonly lockTimeoutMs?: number;
  readonly beforeUpgrade?: BeforeUpgrade;
  /** Idle connection failures contain infrastructure details; host must redact. */
  readonly onPoolError?: (error: Error) => void;
}

/** Owns its pool. Host-only adapter; no auth, no web endpoint, no global parser. */
export class PostgresUnitOfWork implements UnitOfWork {
  private closing = false;
  private closePromise: Promise<void> | undefined;
  private readonly pending = new Set<Promise<unknown>>();
  private readonly context = new AsyncLocalStorage<{ active: boolean }>();
  private constructor(
    private readonly pool: Pool,
    private readonly timeoutMs: number,
  ) {}

  static async open(options: PostgresOptions): Promise<PostgresUnitOfWork> {
    const timeout = options.lockTimeoutMs ?? 2000;
    // PostgreSQL zero disables lock_timeout, so reject zero rather than mislead.
    if (!Number.isInteger(timeout) || timeout < 1 || timeout > 60_000)
      throw new PostgresStorageError("INVALID_LOCK_TIMEOUT");
    let database = options.connection.database;
    if (!database && options.connection.connectionString) {
      try {
        database = new URL(options.connection.connectionString).pathname.slice(
          1,
        );
      } catch {
        throw new PostgresStorageError("EXPLICIT_DATABASE_REQUIRED");
      }
    }
    if (!database?.trim())
      throw new PostgresStorageError("EXPLICIT_DATABASE_REQUIRED");
    const pool = new Pool({
      max: 4,
      connectionTimeoutMillis: 5000,
      ...options.connection,
    });
    // pg evicts broken idle clients; always handle its event to avoid a process
    // crash. Hosts may observe/report it without leaking connection secrets.
    pool.on("error", (error) => options.onPoolError?.(error));
    let client: PoolClient | undefined;
    let connectionError: Error | undefined;
    const onError = (error: Error) => {
      connectionError = error;
    };
    try {
      client = await pool.connect();
      client.on("error", onError);
      await migrate(client, timeout, options.beforeUpgrade);
      if (connectionError) throw connectionError;
      client.release();
      return new PostgresUnitOfWork(pool, timeout);
    } catch (error) {
      client?.release(true);
      await pool.end();
      throw error;
    } finally {
      client?.removeListener("error", onError);
    }
  }

  private accept<T>(operation: () => Promise<T>): Promise<T> {
    if (this.context.getStore()?.active)
      return Promise.reject(new PostgresStorageError("NESTED_OPERATION"));
    if (this.closing)
      return Promise.reject(new PostgresStorageError("STORAGE_CLOSED"));
    const context = { active: true };
    const result = this.context.run(context, async () => {
      try {
        return await operation();
      } finally {
        context.active = false;
      }
    });
    this.pending.add(result);
    void result.then(
      () => this.pending.delete(result),
      () => this.pending.delete(result),
    );
    return result;
  }
  private async transaction<T>(
    operation: (client: PoolClient) => Promise<T>,
  ): Promise<T> {
    const client = await this.pool.connect();
    let destroy = false;
    let connectionError: Error | undefined;
    const onError = (error: Error) => {
      connectionError = error;
      destroy = true;
    };
    client.on("error", onError);
    try {
      await begin(client, this.timeoutMs);
      await sharedMigrationLock(client);
      const schema = (
        await client.query(
          "SELECT max(version) AS version, count(*)::int AS count FROM arclattice.schema_migrations",
        )
      ).rows[0];
      if (
        schema?.version !== migrations.length ||
        schema?.count !== migrations.length
      )
        throw new PostgresStorageError("SCHEMA_CHANGED_REOPEN_REQUIRED");
      const result = structuredClone(await operation(client));
      if (connectionError) throw connectionError;
      await client.query("COMMIT");
      return result;
    } catch (error) {
      try {
        await client.query("ROLLBACK");
      } catch {
        destroy = true;
      }
      throw translateError(error);
    } finally {
      client.release(destroy);
      client.removeListener("error", onError);
    }
  }
  provisionWorkspace(
    workspace: Workspace,
    principals: readonly Principal[],
  ): Promise<void> {
    const copy = structuredClone({ workspace, principals });
    return this.accept(() =>
      this.transaction(async (client) => {
        await client.query(
          "INSERT INTO arclattice.workspace (id,name) VALUES ($1,$2) ON CONFLICT DO NOTHING",
          [copy.workspace.id, copy.workspace.name],
        );
        await lockWorkspace(client, copy.workspace.id);
        const old = (
          await client.query(
            "SELECT name FROM arclattice.workspace WHERE id=$1",
            [copy.workspace.id],
          )
        ).rows[0];
        if (old?.name !== copy.workspace.name)
          throw new PostgresStorageError("PROVISIONING_CONFLICT");
        // Stable order avoids different workspaces deadlocking on global principals.
        for (const principal of [...copy.principals].sort((a, b) =>
          a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
        )) {
          await client.query(
            "INSERT INTO arclattice.principal VALUES ($1,$2,$3) ON CONFLICT DO NOTHING",
            [principal.id, principal.kind, principal.displayName],
          );
          const previous = (
            await client.query(
              "SELECT kind, display_name FROM arclattice.principal WHERE id=$1",
              [principal.id],
            )
          ).rows[0];
          if (
            previous?.kind !== principal.kind ||
            previous?.display_name !== principal.displayName
          )
            throw new PostgresStorageError("PROVISIONING_CONFLICT");
          await client.query(
            "INSERT INTO arclattice.workspace_principal VALUES ($1,$2) ON CONFLICT DO NOTHING",
            [copy.workspace.id, principal.id],
          );
        }
      }),
    );
  }
  run<T>(
    workspaceId: string,
    operation: (tx: WorkTransaction) => T | Promise<T>,
  ): Promise<T> {
    return this.accept(() =>
      this.transaction(async (client) => {
        await lockWorkspace(client, workspaceId);
        const handle = repository(client, workspaceId);
        try {
          return await operation(handle.port);
        } finally {
          await handle.finish();
        }
      }),
    );
  }
  inspectEvents(
    workspaceId: string,
  ): Promise<{ activity: ActivityEvent[]; outbox: OutboxEvent[] }> {
    return this.accept(() =>
      this.transaction(async (client) => {
        await lockWorkspace(client, workspaceId);
        return {
          activity: (
            await client.query(
              "SELECT " +
                projection(activityFields) +
                " FROM arclattice.activity WHERE workspace_id=$1 ORDER BY occurred_at,id",
              [workspaceId],
            )
          ).rows,
          outbox: (
            await client.query(
              "SELECT " +
                projection(outboxFields) +
                " FROM arclattice.outbox WHERE workspace_id=$1 ORDER BY occurred_at,id",
              [workspaceId],
            )
          ).rows,
        };
      }),
    );
  }
  close(): Promise<void> {
    if (this.context.getStore()?.active)
      return Promise.reject(new PostgresStorageError("NESTED_OPERATION"));
    if (this.closePromise) return this.closePromise;
    this.closing = true;
    this.closePromise = Promise.allSettled([...this.pending]).then(() =>
      this.pool.end(),
    );
    return this.closePromise;
  }
}
