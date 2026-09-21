import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import type {
  AccountStore,
  ActivityEvent,
  ConnectedStore,
  LibraryStore,
  NotebookStore,
  OrganizationStore,
  OutboxEvent,
  ProjectStore,
  UnitOfWork,
  WorkTransaction,
} from "@arclattice/application";
import type {
  ActorContext,
  Principal,
  WorkEdge,
  WorkItem,
  Workspace,
} from "@arclattice/domain";
import { DomainError } from "@arclattice/domain";
import { accountStore } from "./accounts";
import { categoryPort } from "./categories";
import { connectedStore } from "./connected";
import {
  beginImmediate,
  StorageError,
  snapshotToNewFile,
  sqliteCode,
  validateIntegrity,
} from "./database";
import { libraryStore } from "./library";
import { inspectSchema, migrate } from "./migrations";
import { notebookStore } from "./notebook";
import { organizationStore } from "./organization";
import { projectStore } from "./project-materials";
import { workflowPort } from "./workflows";

export { StorageError } from "./database";
export { currentSchemaVersion } from "./migrations";

// Trusted, static field maps only. All user values are bound parameters.
const workFields = {
  workspaceId: "workspace_id",
  id: "id",
  type: "type",
  title: "title",
  descriptionMd: "description_md",
  status: "status",
  priority: "priority",
  executionMode: "execution_mode",
  assigneePrincipalId: "assignee_principal_id",
  projectId: "project_id",
  activationState: "activation_state",
  activationPolicy: "activation_policy",
  startDate: "start_date",
  dueDate: "due_date",
  version: "version",
  createdBy: "created_by",
  updatedBy: "updated_by",
  createdAt: "created_at",
  updatedAt: "updated_at",
  completedAt: "completed_at",
  deletedAt: "deleted_at",
} satisfies Record<Exclude<keyof WorkItem, "projectIds">, string>;
const edgeFields = {
  workspaceId: "workspace_id",
  id: "id",
  fromId: "from_id",
  toId: "to_id",
  type: "type",
  createdBy: "created_by",
  createdAt: "created_at",
} satisfies Record<keyof WorkEdge, string>;
const activityFields = {
  fromId: "from_id",
  toId: "to_id",
  edgeType: "edge_type",
  workspaceId: "workspace_id",
  id: "id",
  principalId: "principal_id",
  entityId: "entity_id",
  type: "type",
  occurredAt: "occurred_at",
} satisfies Record<keyof ActivityEvent, string>;
const outboxFields = {
  workspaceId: "workspace_id",
  id: "id",
  activityId: "activity_id",
  type: "type",
  occurredAt: "occurred_at",
} satisfies Record<keyof OutboxEvent, string>;
function projection(fields: Record<string, string>) {
  return Object.entries(fields)
    .map(([key, column]) => column + ' AS "' + key + '"')
    .join(", ");
}
function values<T extends object>(
  fields: Partial<Record<keyof T, string>>,
  entity: T,
): SQLInputValue[] {
  return (Object.keys(fields) as (keyof T)[]).map(
    (key) => entity[key] as SQLInputValue,
  );
}
function insert<T extends object>(
  db: DatabaseSync,
  table: string,
  fields: Partial<Record<keyof T, string>>,
  entity: T,
) {
  db.prepare(
    "INSERT INTO " +
      table +
      " (" +
      Object.values(fields).join(", ") +
      ") VALUES (" +
      Object.keys(fields)
        .map(() => "?")
        .join(", ") +
      ")",
  ).run(...values(fields, entity));
}

export interface SqliteOptions {
  /** Bound only lock acquisition; callbacks themselves must be short and local. */
  readonly lockTimeoutMs?: number;
}

/** Node-only adapter. Construct through open(); never expose this object to UI. */
export class SqliteUnitOfWork implements UnitOfWork {
  private tail: Promise<void> = Promise.resolve();
  private closing = false;
  private closePromise: Promise<void> | undefined;
  private readonly context = new AsyncLocalStorage<{ active: boolean }>();

  private constructor(
    private readonly db: DatabaseSync,
    readonly filename: string,
    private readonly timeoutMs: number,
  ) {}

  getInstanceSetting(key: string): Promise<string | null> {
    return this.enqueue(async () => {
      const row = this.db
        .prepare("SELECT value FROM instance_setting WHERE key=?")
        .get(key) as { value?: string } | undefined;
      return row?.value ?? null;
    });
  }

  setInstanceSetting(
    key: string,
    value: string,
    receipt?: Parameters<SqliteUnitOfWork["accounts"]>[1],
  ): Promise<void> {
    return this.accounts(() => {
      this.db
        .prepare(
          "INSERT INTO instance_setting (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        )
        .run(key, value);
    }, receipt);
  }

  static async open(
    filename: string,
    options: SqliteOptions = {},
  ): Promise<SqliteUnitOfWork> {
    if (!filename.trim() || filename === ":memory:")
      throw new StorageError("FILE_DATABASE_REQUIRED");
    const timeoutMs = options.lockTimeoutMs ?? 2000;
    if (!Number.isFinite(timeoutMs) || timeoutMs < 0 || timeoutMs > 60_000)
      throw new StorageError("INVALID_LOCK_TIMEOUT");
    const path = resolve(filename);
    const db = new DatabaseSync(path, {
      enableForeignKeyConstraints: true,
      timeout: 0,
      allowExtension: false,
    });
    try {
      await migrate(db, path, timeoutMs);
      db.exec(
        "PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA trusted_schema=OFF",
      );
      return new SqliteUnitOfWork(db, path, timeoutMs);
    } catch (error) {
      db.close();
      throw error;
    }
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    if (this.context.getStore()?.active)
      return Promise.reject(new StorageError("NESTED_OPERATION"));
    if (this.closing) return Promise.reject(new StorageError("STORAGE_CLOSED"));
    const pending = this.tail.then(() => {
      const context = { active: true };
      return this.context.run(context, async () => {
        try {
          return await operation();
        } finally {
          context.active = false;
        }
      });
    });
    this.tail = pending.then(
      () => undefined,
      () => undefined,
    );
    return pending;
  }

  private async transaction<T>(operation: () => T | Promise<T>): Promise<T> {
    await beginImmediate(this.db, this.timeoutMs);
    try {
      const result = structuredClone(await operation());
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      this.db.exec("ROLLBACK");
      if ((sqliteCode(error) ?? 0) % 256 === 19)
        throw new DomainError("VALIDATION_ERROR", {
          field: "storage_constraint",
        });
      throw error;
    }
  }

  /** Host-only explicit provisioning; not authentication or a registration API. */
  accounts<T>(
    operation: (store: AccountStore) => T,
    receipt?: {
      context: ActorContext;
      key: string;
      digest: string;
      once?: boolean;
      authorize?: (store: AccountStore) => void;
    },
  ): Promise<T> {
    return this.enqueue(() =>
      this.transaction(() => {
        let active = true;
        try {
          const store = accountStore(this.db, () => {
            if (!active) throw new StorageError("TRANSACTION_CLOSED");
          });
          receipt?.authorize?.(store);
          if (receipt) {
            const cached = this.db
              .prepare(
                "SELECT digest,result FROM request_receipt WHERE workspace_id=? AND principal_id=? AND key=?",
              )
              .get(
                receipt.context.workspaceId,
                receipt.context.principalId,
                receipt.key,
              );
            if (cached) {
              if (receipt.once || cached.digest !== receipt.digest)
                throw new DomainError("VERSION_CONFLICT");
              return JSON.parse(String(cached.result)) as T;
            }
          }
          const result = operation(store);
          if (receipt)
            this.db
              .prepare("INSERT INTO request_receipt VALUES (?,?,?,?,?,?)")
              .run(
                receipt.context.workspaceId,
                receipt.context.principalId,
                receipt.key,
                receipt.digest,
                JSON.stringify(result ?? null),
                new Date().toISOString(),
              );
          return result;
        } finally {
          active = false;
        }
      }),
    );
  }

  provisionWorkspace(
    workspace: Workspace,
    principals: readonly Principal[],
  ): Promise<void> {
    return this.enqueue(() =>
      this.transaction(() => {
        const existing = this.db
          .prepare("SELECT name FROM workspace WHERE id=?")
          .get(workspace.id);
        if (existing && existing.name !== workspace.name)
          throw new StorageError("PROVISIONING_CONFLICT");
        if (!existing)
          this.db
            .prepare("INSERT INTO workspace VALUES (?, ?)")
            .run(workspace.id, workspace.name);
        for (const principal of principals) {
          const old = this.db
            .prepare("SELECT kind, display_name FROM principal WHERE id=?")
            .get(principal.id);
          if (
            old &&
            (old.kind !== principal.kind ||
              old.display_name !== principal.displayName)
          )
            throw new StorageError("PROVISIONING_CONFLICT");
          if (!old)
            this.db
              .prepare("INSERT INTO principal VALUES (?, ?, ?)")
              .run(principal.id, principal.kind, principal.displayName);
          this.db
            .prepare(
              "INSERT INTO workspace_principal VALUES (?, ?) ON CONFLICT DO NOTHING",
            )
            .run(workspace.id, principal.id);
        }
      }),
    );
  }

  run<T>(
    workspaceId: string,
    operation: (tx: WorkTransaction) => T | Promise<T>,
  ): Promise<T> {
    return this.enqueue(() =>
      this.transaction(() => this.scopedOperation(workspaceId, operation)),
    );
  }

  private async scopedOperation<T>(
    workspaceId: string,
    operation: (tx: WorkTransaction) => T | Promise<T>,
  ): Promise<T> {
    if (!this.db.prepare("SELECT 1 FROM workspace WHERE id=?").get(workspaceId))
      throw new DomainError("NOT_FOUND");
    let active = true;
    const guard = () => {
      if (!active) throw new StorageError("TRANSACTION_CLOSED");
    };
    const scope = (entity: { workspaceId: string }) => {
      guard();
      if (entity.workspaceId !== workspaceId)
        throw new DomainError("FORBIDDEN");
    };
    const member = (principalId: string | null) => {
      if (
        principalId !== null &&
        !this.db
          .prepare(
            "SELECT 1 FROM workspace_principal WHERE workspace_id=? AND principal_id=?",
          )
          .get(workspaceId, principalId)
      )
        throw new DomainError("FORBIDDEN");
    };
    const hydrate = (row: WorkItem): WorkItem =>
      row.type !== "TASK"
        ? row
        : {
            ...row,
            projectIds: this.db
              .prepare(
                "SELECT project_id FROM task_project WHERE workspace_id=? AND task_id=? ORDER BY position",
              )
              .all(workspaceId, row.id)
              .map((r) => String(r.project_id)),
          };
    const memberships = (item: WorkItem) => {
      this.db
        .prepare("DELETE FROM task_project WHERE workspace_id=? AND task_id=?")
        .run(workspaceId, item.id);
      if (item.type === "TASK")
        for (const [position, id] of (
          item.projectIds ?? (item.projectId ? [item.projectId] : [])
        ).entries())
          this.db
            .prepare("INSERT INTO task_project VALUES (?,?,?,?)")
            .run(workspaceId, item.id, id, position);
    };
    const get = (id: string): WorkItem => {
      guard();
      const row = this.db
        .prepare(
          "SELECT " +
            projection(workFields) +
            " FROM work_item WHERE workspace_id=? AND id=?",
        )
        .get(workspaceId, id);
      if (!row) throw new DomainError("NOT_FOUND");
      return hydrate({ ...row } as unknown as WorkItem);
    };
    const tx: WorkTransaction = {
      calendarSettings: async () => {
        guard();
        const row = this.db
          .prepare(
            "SELECT version, timezone FROM workspace_calendar WHERE workspace_id=?",
          )
          .get(workspaceId);
        return row
          ? {
              version: Number(row.version),
              timezone: row.timezone === null ? null : String(row.timezone),
            }
          : { version: 0, timezone: null };
      },
      saveCalendarSettings: async (settings, expected) => {
        guard();
        if (settings.version !== expected + 1)
          throw new DomainError("VERSION_CONFLICT");
        const result =
          expected === 0
            ? this.db
                .prepare(
                  "INSERT INTO workspace_calendar (workspace_id,version,timezone) VALUES (?,?,?) ON CONFLICT DO NOTHING",
                )
                .run(workspaceId, settings.version, settings.timezone)
            : this.db
                .prepare(
                  "UPDATE workspace_calendar SET version=?,timezone=? WHERE workspace_id=? AND version=?",
                )
                .run(
                  settings.version,
                  settings.timezone,
                  workspaceId,
                  expected,
                );
        if (result.changes !== 1) throw new DomainError("VERSION_CONFLICT");
      },
      ...categoryPort(this.db, workspaceId, guard),
      ...workflowPort(this.db, workspaceId, guard),
      get: async (id) => get(id),
      list: async (includeDeleted = false) => {
        guard();
        return (
          this.db
            .prepare(
              "SELECT " +
                projection(workFields) +
                " FROM work_item WHERE workspace_id=?" +
                (includeDeleted ? "" : " AND deleted_at IS NULL") +
                " ORDER BY created_at, id",
            )
            .all(workspaceId) as unknown as WorkItem[]
        ).map(hydrate);
      },
      edges: async () => {
        guard();
        return this.db
          .prepare(
            "SELECT " +
              projection(edgeFields) +
              " FROM work_edge WHERE workspace_id=? ORDER BY created_at, id",
          )
          .all(workspaceId) as unknown as WorkEdge[];
      },
      insert: async (item) => {
        scope(item);
        member(item.createdBy);
        member(item.updatedBy);
        member(item.assigneePrincipalId);
        if (
          item.version !== 1 ||
          this.db
            .prepare("SELECT 1 FROM work_item WHERE workspace_id=? AND id=?")
            .get(workspaceId, item.id)
        )
          throw new DomainError("VERSION_CONFLICT");
        insert(this.db, "work_item", workFields, item);
        memberships(item);
      },
      replace: async (item, expectedVersion) => {
        scope(item);
        member(item.createdBy);
        member(item.updatedBy);
        member(item.assigneePrincipalId);
        const old = get(item.id);
        if (
          !Number.isSafeInteger(expectedVersion) ||
          old.version !== expectedVersion ||
          item.version !== expectedVersion + 1
        )
          throw new DomainError("VERSION_CONFLICT", {
            expectedVersion,
            actualVersion: old.version,
          });
        const result = this.db
          .prepare(
            "UPDATE work_item SET " +
              Object.values(workFields)
                .map((column) => column + "=?")
                .join(", ") +
              " WHERE workspace_id=? AND id=? AND version=?",
          )
          .run(
            ...values(workFields, item),
            workspaceId,
            item.id,
            expectedVersion,
          );
        if (result.changes !== 1) throw new DomainError("VERSION_CONFLICT");
        memberships(item);
      },
      addEdge: async (edge) => {
        scope(edge);
        member(edge.createdBy);
        if (get(edge.fromId).deletedAt || get(edge.toId).deletedAt)
          throw new DomainError("NOT_FOUND");
        try {
          insert(this.db, "work_edge", edgeFields, edge);
        } catch (error) {
          if ([1555, 2067].includes(sqliteCode(error) ?? 0))
            throw new DomainError("DUPLICATE_EDGE");
          throw error;
        }
      },
      removeEdge: async (id) => {
        guard();
        if (
          this.db
            .prepare("DELETE FROM work_edge WHERE workspace_id=? AND id=?")
            .run(workspaceId, id).changes !== 1
        )
          throw new DomainError("NOT_FOUND");
      },
      appendActivity: async (event) => {
        scope(event);
        member(event.principalId);
        insert(this.db, "activity", activityFields, {
          ...event,
          fromId: event.fromId ?? null,
          toId: event.toId ?? null,
          edgeType: event.edgeType ?? null,
        });
      },
      appendOutbox: async (event) => {
        scope(event);
        insert(this.db, "outbox", outboxFields, event);
      },
    };
    try {
      return await operation(tx);
    } finally {
      active = false;
    }
  }

  /** Host-only atomic request boundary. Call exactly one application mutation. */
  request<T>(
    context: ActorContext,
    receipt: { key: string; digest: string } | null,
    operation: (
      uow: UnitOfWork,
      notes: NotebookStore,
      connected: ConnectedStore,
      library: LibraryStore,
      organization: OrganizationStore,
      projects: ProjectStore,
    ) => Promise<T>,
    authorize?: (store: AccountStore) => void,
  ): Promise<T> {
    return this.enqueue(() =>
      this.transaction(async () => {
        inspectSchema(this.db);
        if (
          !this.db
            .prepare(
              "SELECT 1 FROM workspace_principal WHERE workspace_id=? AND principal_id=?",
            )
            .get(context.workspaceId, context.principalId)
        )
          throw new DomainError("FORBIDDEN");
        let active = true;
        const guard = () => {
          if (!active) throw new StorageError("TRANSACTION_CLOSED");
        };
        try {
          authorize?.(accountStore(this.db, guard));
          if (receipt) {
            const cached = this.db
              .prepare(
                "SELECT digest,result FROM request_receipt WHERE workspace_id=? AND principal_id=? AND key=?",
              )
              .get(context.workspaceId, context.principalId, receipt.key);
            if (cached) {
              if (cached.digest !== receipt.digest)
                throw new DomainError("VERSION_CONFLICT");
              return JSON.parse(String(cached.result)) as T;
            }
          }
          const result = await operation(
            {
              run: (workspaceId, callback) => {
                guard();
                if (workspaceId !== context.workspaceId)
                  throw new DomainError("FORBIDDEN");
                return this.scopedOperation(workspaceId, callback);
              },
            },
            notebookStore(this.db, context, guard),
            connectedStore(this.db, context, guard),
            libraryStore(this.db, context, guard),
            organizationStore(this.db, context, guard),
            projectStore(this.db, context, guard),
          );
          if (receipt)
            this.db
              .prepare("INSERT INTO request_receipt VALUES (?,?,?,?,?,?)")
              .run(
                context.workspaceId,
                context.principalId,
                receipt.key,
                receipt.digest,
                JSON.stringify(result ?? null),
                new Date().toISOString(),
              );
          return result;
        } finally {
          active = false;
        }
      }),
    );
  }

  inspectEvents(
    workspaceId: string,
  ): Promise<{ activity: ActivityEvent[]; outbox: OutboxEvent[] }> {
    return this.enqueue(() =>
      this.transaction(() => ({
        activity: this.db
          .prepare(
            "SELECT " +
              projection(activityFields) +
              " FROM activity WHERE workspace_id=? ORDER BY occurred_at, id",
          )
          .all(workspaceId) as unknown as ActivityEvent[],
        outbox: this.db
          .prepare(
            "SELECT " +
              projection(outboxFields) +
              " FROM outbox WHERE workspace_id=? ORDER BY occurred_at, id",
          )
          .all(workspaceId) as unknown as OutboxEvent[],
      })),
    );
  }

  audit(
    context: ActorContext,
    entityId: string,
    action: string,
  ): Promise<void> {
    return this.enqueue(() =>
      this.transaction(() => {
        this.db
          .prepare("INSERT INTO audit_record VALUES (?,?,?,?,?,?)")
          .run(
            context.workspaceId,
            randomUUID(),
            context.principalId,
            entityId,
            action,
            new Date().toISOString(),
          );
      }),
    );
  }

  backup(destination: string): Promise<string> {
    return this.enqueue(async () => {
      inspectSchema(this.db);
      return snapshotToNewFile(this.db, destination);
    });
  }

  close(): Promise<void> {
    if (this.context.getStore()?.active)
      return Promise.reject(new StorageError("NESTED_OPERATION"));
    if (!this.closePromise) {
      this.closing = true;
      this.closePromise = this.tail.then(() => this.db.close());
    }
    return this.closePromise;
  }
}

/** Offline recovery to a NEW path; never overwrite or switch an active database. */
export async function restoreDatabase(
  source: string,
  destination: string,
): Promise<string> {
  const db = new DatabaseSync(resolve(source), { readOnly: true });
  try {
    if (inspectSchema(db) === 0)
      throw new StorageError("UNRECOGNIZED_DATABASE");
    validateIntegrity(db);
    return await snapshotToNewFile(db, destination);
  } finally {
    db.close();
  }
}
